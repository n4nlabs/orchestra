#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LEGACY_APP_ID: &str = "com.orquestra.app";

static LANG: AtomicU8 = AtomicU8::new(0);

fn set_lang_code(code: &str) {
    let v = if code.starts_with("es") {
        1
    } else if code.starts_with("en") {
        2
    } else {
        0
    };
    LANG.store(v, Ordering::Relaxed);
}

macro_rules! tr {
    ($pt:literal, $es:literal, $en:literal $(, $arg:expr)* $(,)?) => {
        match LANG.load(Ordering::Relaxed) {
            1 => format!($es $(, $arg)*),
            2 => format!($en $(, $arg)*),
            _ => format!($pt $(, $arg)*),
        }
    };
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Service {
    id: String,
    name: String,
    path: String,
    command: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    env: String,
    #[serde(default)]
    order: u32,
    #[serde(default)]
    wait_after: u32,
    #[serde(default)]
    auto_restart: bool,
    #[serde(default)]
    max_retries: u32,
    #[serde(default)]
    restart_delay: u32,
    #[serde(default)]
    wait_for_exit: bool,
    #[serde(default)]
    manual: bool,
}

struct Running {
    pid: u32,
    stopping: Arc<AtomicBool>,
}

struct AppState {
    running: Mutex<HashMap<String, Running>>,
    log_tx: Mutex<Sender<LogLine>>,
}

struct UpdateState {
    pending: Mutex<Option<Update>>,
}

#[derive(Serialize, Clone)]
struct LogLine {
    id: String,
    err: bool,
    text: String,
}

#[derive(Serialize, Clone)]
struct StatusEvent {
    id: String,
    running: bool,
    pid: Option<u32>,
    code: Option<i32>,
    stopped: bool,
}

#[derive(Serialize, Clone)]
struct Stat {
    id: String,
    cpu: f32,
    mem: u64,
    procs: u32,
}

#[derive(Serialize)]
struct RunningInfo {
    id: String,
    pid: u32,
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    config_path: Option<String>,
    #[serde(default)]
    root: String,
    #[serde(default)]
    lang: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_update: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConfigInfo {
    path: String,
    custom: bool,
    root: String,
    mtime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    auto_update: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
}

#[derive(Serialize, Clone)]
struct UpdateProgress {
    got: u64,
    total: Option<u64>,
}

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn migrate_legacy_dir(app: &AppHandle) {
    let Ok(dir) = app_dir(app) else { return };
    if dir.join("settings.json").exists() || dir.join("services.json").exists() {
        return;
    }
    let Some(old) = dir.parent().map(|p| p.join(LEGACY_APP_ID)) else { return };
    for f in ["settings.json", "services.json", "session.json"] {
        let src = old.join(f);
        if src.exists() {
            let _ = std::fs::copy(&src, dir.join(f));
        }
    }
}

fn read_settings(app: &AppHandle) -> Settings {
    app_dir(app)
        .ok()
        .and_then(|d| std::fs::read_to_string(d.join("settings.json")).ok())
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, st: &Settings) -> Result<(), String> {
    let file = app_dir(app)?.join("settings.json");
    let raw = serde_json::to_string_pretty(st).map_err(|e| e.to_string())?;
    std::fs::write(file, raw).map_err(|e| e.to_string())
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let st = read_settings(app);
    if let Some(p) = st.config_path.filter(|p| !p.trim().is_empty()) {
        return Ok(PathBuf::from(p));
    }
    Ok(app_dir(app)?.join("services.json"))
}

fn mtime_of(p: &PathBuf) -> u64 {
    std::fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_services(raw: &str) -> Result<Vec<Service>, String> {
    let raw = raw.trim_start_matches('\u{feff}');
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|e| tr!("JSON inválido: {e}", "JSON inválido: {e}", "Invalid JSON: {e}"))?;
    let list = match value {
        serde_json::Value::Array(_) => value,
        serde_json::Value::Object(mut m) => m
            .remove("services")
            .unwrap_or_else(|| serde_json::Value::Array(vec![])),
        _ => {
            return Err(tr!(
                "Formato inesperado: use uma lista ou {{ \"services\": [...] }}.",
                "Formato inesperado: use una lista o {{ \"services\": [...] }}.",
                "Unexpected format: use a list or {{ \"services\": [...] }}."
            ))
        }
    };
    serde_json::from_value(list).map_err(|e| {
        tr!(
            "Lista de serviços inválida: {e}",
            "Lista de servicios inválida: {e}",
            "Invalid service list: {e}"
        )
    })
}

fn resolve_path(app: &AppHandle, raw: &str) -> Result<PathBuf, String> {
    let st = read_settings(app);
    let mut p = raw.trim().to_string();
    if p.contains("{root}") {
        let root = st.root.trim().trim_end_matches(['\\', '/']).to_string();
        if root.is_empty() {
            return Err(tr!(
                "O caminho usa {{root}}, mas a pasta raiz não foi definida (Configurações).",
                "La ruta usa {{root}}, pero no se ha definido la carpeta raíz (Configuración).",
                "The path uses {{root}}, but the root folder is not set (Settings)."
            ));
        }
        p = p.replace("{root}", &root);
    }
    let pb = PathBuf::from(p);
    if pb.is_absolute() {
        return Ok(pb);
    }
    let base = config_file(app)?
        .parent()
        .map(|x| x.to_path_buf())
        .unwrap_or_default();
    Ok(base.join(pb))
}

#[tauri::command]
fn get_config_info(app: AppHandle) -> Result<ConfigInfo, String> {
    let st = read_settings(&app);
    let file = config_file(&app)?;
    Ok(ConfigInfo {
        custom: st.config_path.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false),
        path: file.to_string_lossy().to_string(),
        root: st.root,
        mtime: mtime_of(&file),
    })
}

#[tauri::command]
fn config_mtime(app: AppHandle) -> u64 {
    config_file(&app).map(|f| mtime_of(&f)).unwrap_or(0)
}

#[tauri::command]
fn set_config_path(app: AppHandle, path: Option<String>) -> Result<(), String> {
    let path = path.filter(|p| !p.trim().is_empty());
    if let Some(p) = &path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            let raw = std::fs::read_to_string(&pb).map_err(|e| {
                tr!(
                    "Não foi possível ler o arquivo: {e}",
                    "No fue posible leer el archivo: {e}",
                    "Could not read the file: {e}"
                )
            })?;
            parse_services(&raw)?;
        }
    }
    let mut st = read_settings(&app);
    st.config_path = path;
    write_settings(&app, &st)
}

#[tauri::command]
fn set_lang(app: AppHandle, lang: String) -> Result<(), String> {
    set_lang_code(&lang);
    let mut st = read_settings(&app);
    st.lang = lang;
    write_settings(&app, &st)
}

#[tauri::command]
fn get_lang(app: AppHandle) -> String {
    read_settings(&app).lang
}

#[tauri::command]
fn set_root(app: AppHandle, root: String) -> Result<(), String> {
    let mut st = read_settings(&app);
    st.root = root.trim().to_string();
    write_settings(&app, &st)
}

#[tauri::command]
fn load_services(app: AppHandle) -> Result<Vec<Service>, String> {
    let st = read_settings(&app);
    let file = config_file(&app)?;
    if !file.exists() {
        if st.config_path.is_some() {
            return Err(tr!(
                "Arquivo de configuração não encontrado: {}",
                "Archivo de configuración no encontrado: {}",
                "Configuration file not found: {}",
                file.display()
            ));
        }
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&file).map_err(|e| {
        tr!(
            "Não foi possível ler {}: {e}",
            "No fue posible leer {}: {e}",
            "Could not read {}: {e}",
            file.display()
        )
    })?;
    parse_services(&raw)
}

#[tauri::command]
fn save_services(app: AppHandle, services: Vec<Service>) -> Result<(), String> {
    let file = config_file(&app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let doc = serde_json::json!({ "version": 1, "services": services });
    let raw = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    std::fs::write(&file, raw).map_err(|e| {
        tr!(
            "Não foi possível gravar {}: {e}",
            "No fue posible escribir {}: {e}",
            "Could not write {}: {e}",
            file.display()
        )
    })
}

fn kill_tree(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn pipe_reader<R: Read + Send + 'static>(reader: R, id: String, err: bool, tx: Sender<LogLine>) {
    std::thread::spawn(move || {
        let mut br = BufReader::new(reader);
        let mut buf: Vec<u8> = Vec::with_capacity(512);
        loop {
            buf.clear();
            match br.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let text = String::from_utf8_lossy(&buf)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if tx
                        .send(LogLine {
                            id: id.clone(),
                            err,
                            text,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });
}

#[tauri::command]
fn start_service(app: AppHandle, state: State<AppState>, service: Service) -> Result<u32, String> {
    if state.running.lock().unwrap().contains_key(&service.id) {
        return Err(tr!(
            "O serviço já está em execução.",
            "El servicio ya está en ejecución.",
            "The service is already running."
        ));
    }
    let workdir = resolve_path(&app, &service.path)?;
    if !workdir.is_dir() {
        return Err(tr!(
            "Pasta não encontrada: {}",
            "Carpeta no encontrada: {}",
            "Folder not found: {}",
            workdir.display()
        ));
    }
    if service.command.trim().is_empty() {
        return Err(tr!(
            "Informe o comando de execução.",
            "Indique el comando de ejecución.",
            "Enter the command to run."
        ));
    }

    let mut cmd = Command::new("cmd");
    cmd.raw_arg(format!("/S /C \"{}\"", service.command))
        .current_dir(&workdir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0");

    for line in service.env.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            cmd.env(k.trim(), v.trim());
        }
    }

    let mut child = cmd.spawn().map_err(|e| {
        tr!(
            "Falha ao iniciar o processo: {e}",
            "Error al iniciar el proceso: {e}",
            "Failed to start the process: {e}"
        )
    })?;
    let pid = child.id();
    let stopping = Arc::new(AtomicBool::new(false));

    state.running.lock().unwrap().insert(
        service.id.clone(),
        Running {
            pid,
            stopping: stopping.clone(),
        },
    );

    let tx = state.log_tx.lock().unwrap().clone();
    if let Some(out) = child.stdout.take() {
        pipe_reader(out, service.id.clone(), false, tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        pipe_reader(err, service.id.clone(), true, tx.clone());
    }

    let _ = app.emit(
        "status",
        StatusEvent {
            id: service.id.clone(),
            running: true,
            pid: Some(pid),
            code: None,
            stopped: false,
        },
    );

    let app2 = app.clone();
    let id = service.id.clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().and_then(|s| s.code());
        let was_stopped = stopping.load(Ordering::SeqCst);
        {
            let st = app2.state::<AppState>();
            st.running.lock().unwrap().remove(&id);
        }
        let _ = app2.emit(
            "status",
            StatusEvent {
                id,
                running: false,
                pid: None,
                code,
                stopped: was_stopped,
            },
        );
    });

    Ok(pid)
}

#[tauri::command]
fn stop_service(state: State<AppState>, id: String) -> Result<(), String> {
    let entry = state
        .running
        .lock()
        .unwrap()
        .get(&id)
        .map(|r| (r.pid, r.stopping.clone()));
    if let Some((pid, flag)) = entry {
        flag.store(true, Ordering::SeqCst);
        std::thread::spawn(move || kill_tree(pid));
    }
    Ok(())
}

#[tauri::command]
fn get_running(state: State<AppState>) -> Vec<RunningInfo> {
    let list: Vec<RunningInfo> = state
        .running
        .lock()
        .unwrap()
        .iter()
        .map(|(id, r)| RunningInfo {
            id: id.clone(),
            pid: r.pid,
        })
        .collect();
    list
}

fn kill_all(app: &AppHandle) {
    let pids: Vec<u32> = {
        let st = app.state::<AppState>();
        let guard = st.running.lock().unwrap();
        let v: Vec<u32> = guard.values().map(|r| r.pid).collect();
        v
    };
    let handles: Vec<_> = pids
        .into_iter()
        .map(|pid| std::thread::spawn(move || kill_tree(pid)))
        .collect();
    for h in handles {
        let _ = h.join();
    }
}

fn session_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("session.json"))
}

fn save_session(app: &AppHandle) {
    let ids: Vec<String> = {
        let st = app.state::<AppState>();
        let guard = st.running.lock().unwrap();
        let v: Vec<String> = guard.keys().cloned().collect();
        v
    };
    if let Ok(file) = session_file(app) {
        let raw = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into());
        let _ = std::fs::write(file, raw);
    }
}

#[tauri::command]
fn take_last_session(app: AppHandle) -> Vec<String> {
    let file = match session_file(&app) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    let raw = std::fs::read_to_string(&file).unwrap_or_default();
    let _ = std::fs::remove_file(&file);
    serde_json::from_str(&raw).unwrap_or_default()
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        auto_update: read_settings(&app).auto_update.unwrap_or(true),
    }
}

#[tauri::command]
fn set_auto_update(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut st = read_settings(&app);
    st.auto_update = Some(enabled);
    write_settings(&app, &st)
}

#[tauri::command]
async fn check_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| {
        tr!(
            "Não foi possível verificar atualizações: {e}",
            "No fue posible buscar actualizaciones: {e}",
            "Could not check for updates: {e}"
        )
    })?;
    let info = found.as_ref().map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    });
    *state.pending.lock().unwrap() = found;
    Ok(info)
}

#[tauri::command]
async fn install_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    let update = state.pending.lock().unwrap().clone().ok_or_else(|| {
        tr!(
            "Nenhuma atualização pendente.",
            "No hay ninguna actualización pendiente.",
            "No pending update."
        )
    })?;

    let progress_app = app.clone();
    let mut got: u64 = 0;
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk as u64;
                let _ = progress_app.emit("update-progress", UpdateProgress { got, total });
            },
            || {},
        )
        .await
        .map_err(|e| {
            tr!(
                "Falha ao baixar a atualização: {e}",
                "Error al descargar la actualización: {e}",
                "Failed to download the update: {e}"
            )
        })?;

    save_session(&app);
    kill_all(&app);
    update.install(bytes).map_err(|e| {
        tr!(
            "Não foi possível instalar a atualização: {e}",
            "No fue posible instalar la actualización: {e}",
            "Could not install the update: {e}"
        )
    })?;
    app.restart();
}

fn spawn_log_flusher(app: AppHandle, rx: Receiver<LogLine>) {
    std::thread::spawn(move || loop {
        let first = match rx.recv() {
            Ok(l) => l,
            Err(_) => break,
        };
        let mut batch = vec![first];
        std::thread::sleep(Duration::from_millis(60));
        while let Ok(l) = rx.try_recv() {
            batch.push(l);
            if batch.len() >= 5000 {
                break;
            }
        }
        let _ = app.emit("logs", batch);
    });
}

fn spawn_stats(app: AppHandle) {
    std::thread::spawn(move || {
        let mut sys = System::new();
        let cores = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1) as f32;

        loop {
            std::thread::sleep(Duration::from_millis(2000));

            let running: Vec<(String, u32)> = {
                let st = app.state::<AppState>();
                let guard = st.running.lock().unwrap();
                let v: Vec<(String, u32)> =
                    guard.iter().map(|(k, v)| (k.clone(), v.pid)).collect();
                v
            };
            if running.is_empty() {
                continue;
            }

            sys.refresh_processes(ProcessesToUpdate::All, true);

            let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
            for (pid, p) in sys.processes() {
                if let Some(parent) = p.parent() {
                    children.entry(parent).or_default().push(*pid);
                }
            }

            let mut out: Vec<Stat> = Vec::with_capacity(running.len());
            for (id, root) in running {
                let mut stack = vec![Pid::from_u32(root)];
                let (mut cpu, mut mem, mut procs) = (0f32, 0u64, 0u32);
                let mut guard_count = 0;
                while let Some(p) = stack.pop() {
                    guard_count += 1;
                    if guard_count > 2000 {
                        break;
                    }
                    if let Some(proc_) = sys.process(p) {
                        cpu += proc_.cpu_usage();
                        mem += proc_.memory();
                        procs += 1;
                    }
                    if let Some(c) = children.get(&p) {
                        stack.extend(c.iter().copied());
                    }
                }
                out.push(Stat {
                    id,
                    cpu: cpu / cores,
                    mem,
                    procs,
                });
            }
            let _ = app.emit("stats", out);
        }
    });
}

fn main() {
    let (tx, rx) = channel::<LogLine>();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            running: Mutex::new(HashMap::new()),
            log_tx: Mutex::new(tx),
        })
        .manage(UpdateState {
            pending: Mutex::new(None),
        })
        .setup(move |app| {
            migrate_legacy_dir(app.handle());
            set_lang_code(&read_settings(app.handle()).lang);
            spawn_log_flusher(app.handle().clone(), rx);
            spawn_stats(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_services,
            save_services,
            start_service,
            stop_service,
            get_running,
            get_config_info,
            config_mtime,
            set_config_path,
            set_root,
            set_lang,
            get_lang,
            take_last_session,
            get_app_info,
            set_auto_update,
            check_update,
            install_update
        ])
        .build(tauri::generate_context!())
        .expect("erro ao iniciar o Orchestra");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            save_session(handle);
            kill_all(handle);
        }
    });
}
