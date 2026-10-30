#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const APP_EXE: &[u8] = include_bytes!("../payload/orchestra.exe");

const APP_NAME: &str = "Orchestra";
const PUBLISHER: &str = "N4nLabs";
const APP_ID: &str = "com.orchestra.app";
const EXE_NAME: &str = "orchestra.exe";
const UNINSTALLER: &str = "Uninstall.exe";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orchestra";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

const LEGACY_NAME: &str = "Orquestra";
const LEGACY_APP_ID: &str = "com.orquestra.app";
const LEGACY_EXE: &str = "orquestra.exe";
const LEGACY_UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Orquestra";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    mode: String,
    version: String,
    default_dir: String,
    installed: bool,
    running: bool,
    lang: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOpts {
    dir: String,
    lang: String,
    root: String,
    services_mode: String,
    config_path: String,
    desktop_shortcut: bool,
    start_menu_shortcut: bool,
}

#[derive(Serialize, Clone)]
struct Progress {
    pct: u32,
    key: String,
}

fn m(lang: &str, pt: &str, es: &str, en: &str) -> String {
    if lang.starts_with("es") {
        es.to_string()
    } else if lang.starts_with("en") {
        en.to_string()
    } else {
        pt.to_string()
    }
}

fn env_path(name: &str) -> PathBuf {
    PathBuf::from(std::env::var(name).unwrap_or_default())
}

fn data_dir() -> PathBuf {
    env_path("APPDATA").join(APP_ID)
}

fn standard_dir() -> PathBuf {
    env_path("LOCALAPPDATA").join("Programs").join(APP_NAME)
}

fn has_flag(flag: &str) -> bool {
    std::env::args().any(|a| a == flag)
}

fn arg_value(flag: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1).cloned())
        .filter(|v| !v.trim().is_empty())
}

fn mode() -> &'static str {
    if has_flag("--uninstall") {
        "uninstall"
    } else if has_flag("--update") {
        "update"
    } else {
        "install"
    }
}

fn saved_lang() -> String {
    fs::read_to_string(data_dir().join("settings.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s.trim_start_matches('\u{feff}')).ok())
        .and_then(|v| v.get("lang").and_then(|l| l.as_str()).map(String::from))
        .unwrap_or_default()
}

fn registered_dir() -> Option<PathBuf> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(UNINSTALL_KEY)
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
        .map(PathBuf::from)
        .filter(|p| p.join(EXE_NAME).exists())
}

fn legacy_dir() -> Option<PathBuf> {
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(LEGACY_UNINSTALL_KEY)
        .ok()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
        .map(PathBuf::from)
        .or_else(|| Some(env_path("LOCALAPPDATA").join("Programs").join(LEGACY_NAME)))
        .filter(|p| p.join(LEGACY_EXE).exists())
}

fn current_install_dir() -> PathBuf {
    if let Some(d) = arg_value("--dir") {
        return PathBuf::from(d);
    }
    registered_dir().unwrap_or_else(standard_dir)
}

fn image_running(image: &str) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {image}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(image))
        .unwrap_or(false)
}

fn app_running() -> bool {
    image_running(EXE_NAME) || image_running(LEGACY_EXE)
}

fn pid_running(pid: &str) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(pid))
        .unwrap_or(false)
}

fn step(app: &AppHandle, pct: u32, key: &str) {
    let _ = app.emit("progress", Progress { pct, key: key.to_string() });
    std::thread::sleep(Duration::from_millis(260));
}

fn ps_quote(p: &Path) -> String {
    p.to_string_lossy().replace('\'', "''")
}

fn run_powershell(script: &str) -> Result<(), String> {
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn make_shortcut(kind: &str, target: &Path, workdir: &Path) -> Result<(), String> {
    let script = format!(
        "$ErrorActionPreference='Stop'; $d=[Environment]::GetFolderPath('{kind}'); \
         $s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d '{APP_NAME}.lnk')); \
         $s.TargetPath='{t}'; $s.WorkingDirectory='{w}'; $s.IconLocation='{t},0'; $s.Save()",
        t = ps_quote(target),
        w = ps_quote(workdir),
    );
    run_powershell(&script)
}

fn shortcut_exists(kind: &str, name: &str) -> bool {
    let base = match kind {
        "Desktop" => env_path("USERPROFILE").join("Desktop"),
        _ => env_path("APPDATA").join(r"Microsoft\Windows\Start Menu\Programs"),
    };
    base.join(format!("{name}.lnk")).exists()
}

fn remove_shortcuts(name: &str) {
    let script = format!(
        "foreach ($k in 'Desktop','Programs') {{ \
           $f = Join-Path ([Environment]::GetFolderPath($k)) '{name}.lnk'; \
           if (Test-Path $f) {{ Remove-Item $f -Force -ErrorAction SilentlyContinue }} }}"
    );
    let _ = run_powershell(&script);
}

fn register_uninstall(dir: &Path, exe: &Path, uninstaller: &Path, version: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(UNINSTALL_KEY).map_err(|e| e.to_string())?;
    let set = |name: &str, value: String| key.set_value(name, &value).map_err(|e| e.to_string());
    set("DisplayName", APP_NAME.to_string())?;
    set("DisplayVersion", version.to_string())?;
    set("Publisher", PUBLISHER.to_string())?;
    set("InstallLocation", dir.to_string_lossy().to_string())?;
    set("DisplayIcon", exe.to_string_lossy().to_string())?;
    set("UninstallString", format!("\"{}\" --uninstall", uninstaller.display()))?;
    key.set_value("NoModify", &1u32).map_err(|e| e.to_string())?;
    key.set_value("NoRepair", &1u32).map_err(|e| e.to_string())?;
    key.set_value("EstimatedSize", &((APP_EXE.len() / 1024) as u32)).map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate_legacy_data() {
    let new_dir = data_dir();
    if new_dir.join("settings.json").exists() || new_dir.join("services.json").exists() {
        return;
    }
    let old = env_path("APPDATA").join(LEGACY_APP_ID);
    if !old.exists() {
        return;
    }
    let _ = fs::create_dir_all(&new_dir);
    for f in ["settings.json", "services.json", "session.json"] {
        let src = old.join(f);
        if src.exists() {
            let _ = fs::copy(&src, new_dir.join(f));
        }
    }
}

fn remove_legacy_install() -> (bool, bool) {
    let had = (shortcut_exists("Programs", LEGACY_NAME), shortcut_exists("Desktop", LEGACY_NAME));
    if let Some(dir) = legacy_dir() {
        let _ = fs::remove_file(dir.join(LEGACY_EXE));
        let _ = fs::remove_file(dir.join(UNINSTALLER));
        let _ = fs::remove_dir(&dir);
    }
    if had.0 || had.1 {
        remove_shortcuts(LEGACY_NAME);
    }
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(LEGACY_UNINSTALL_KEY);
    had
}

fn write_config(o: &InstallOpts) -> Result<(), String> {
    let dd = data_dir();
    fs::create_dir_all(&dd).map_err(|e| e.to_string())?;

    let settings_file = dd.join("settings.json");
    let mut v: serde_json::Map<String, serde_json::Value> = fs::read_to_string(&settings_file)
        .ok()
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default();

    v.insert("lang".into(), serde_json::json!(o.lang));
    if !o.root.trim().is_empty() {
        v.insert("root".into(), serde_json::json!(o.root.trim()));
    }
    if o.services_mode == "file" {
        let p = o.config_path.trim();
        if p.is_empty() || !Path::new(p).exists() {
            return Err(m(
                &o.lang,
                "O arquivo JSON compartilhado não foi encontrado. Confira o caminho.",
                "No se encontró el archivo JSON compartido. Verifique la ruta.",
                "The shared JSON file was not found. Check the path.",
            ));
        }
        v.insert("configPath".into(), serde_json::json!(p));
    } else if o.services_mode != "keep" {
        v.remove("configPath");
    }
    let raw = serde_json::to_string_pretty(&serde_json::Value::Object(v)).map_err(|e| e.to_string())?;
    fs::write(&settings_file, raw).map_err(|e| e.to_string())
}

fn copy_files(dir: &Path, lang: &str) -> Result<PathBuf, String> {
    let exe = dir.join(EXE_NAME);
    let mut last_err = String::new();
    for _ in 0..20 {
        match fs::write(&exe, APP_EXE) {
            Ok(()) => {
                last_err.clear();
                break;
            }
            Err(e) => {
                last_err = e.to_string();
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
    if !last_err.is_empty() {
        return Err(m(
            lang,
            "Não foi possível copiar o aplicativo: ",
            "No fue posible copiar la aplicación: ",
            "Could not copy the application: ",
        ) + &last_err);
    }
    let uninstaller = dir.join(UNINSTALLER);
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    if me != uninstaller {
        fs::copy(&me, &uninstaller).map_err(|e| {
            m(
                lang,
                "Não foi possível criar o desinstalador: ",
                "No fue posible crear el desinstalador: ",
                "Could not create the uninstaller: ",
            ) + &e.to_string()
        })?;
    }
    Ok(exe)
}

#[tauri::command]
fn get_info(app: AppHandle) -> Info {
    let dir = current_install_dir();
    Info {
        mode: mode().into(),
        version: app.package_info().version.to_string(),
        default_dir: dir.to_string_lossy().to_string(),
        installed: dir.join(EXE_NAME).exists() || legacy_dir().is_some(),
        running: app_running(),
        lang: saved_lang(),
    }
}

#[tauri::command]
fn check_running() -> bool {
    app_running()
}

fn do_install(app: &AppHandle, o: InstallOpts) -> Result<String, String> {
    let lang = o.lang.clone();
    if app_running() {
        return Err(m(
            &lang,
            "O Orchestra está aberto. Feche-o e tente novamente.",
            "Orchestra está abierto. Ciérrelo e intente de nuevo.",
            "Orchestra is open. Close it and try again.",
        ));
    }
    let dir = PathBuf::from(o.dir.trim());
    if o.dir.trim().is_empty() {
        return Err(m(
            &lang,
            "Informe a pasta de instalação.",
            "Indique la carpeta de instalación.",
            "Enter the installation folder.",
        ));
    }

    step(app, 6, "prepare");
    fs::create_dir_all(&dir).map_err(|e| {
        m(
            &lang,
            "Não foi possível criar a pasta de instalação: ",
            "No fue posible crear la carpeta de instalación: ",
            "Could not create the installation folder: ",
        ) + &e.to_string()
    })?;
    migrate_legacy_data();

    step(app, 22, "copy");
    let exe = copy_files(&dir, &lang)?;
    let uninstaller = dir.join(UNINSTALLER);

    step(app, 48, "config");
    write_config(&o)?;

    step(app, 68, "shortcuts");
    let (legacy_menu, legacy_desktop) = remove_legacy_install();
    if o.start_menu_shortcut || legacy_menu {
        let _ = make_shortcut("Programs", &exe, &dir);
    }
    if o.desktop_shortcut || legacy_desktop {
        let _ = make_shortcut("Desktop", &exe, &dir);
    }

    step(app, 88, "register");
    register_uninstall(&dir, &exe, &uninstaller, &app.package_info().version.to_string())?;

    step(app, 100, "done");
    Ok(exe.to_string_lossy().to_string())
}

#[tauri::command]
async fn install(app: AppHandle, opts: InstallOpts) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || do_install(&app, opts))
        .await
        .map_err(|e| e.to_string())?
}

fn do_update(app: &AppHandle) -> Result<String, String> {
    let lang = saved_lang();
    let dir = current_install_dir();

    step(app, 6, "wait");
    let deadline = Instant::now() + Duration::from_secs(60);
    let still_open = || match arg_value("--pid") {
        Some(pid) => pid_running(&pid),
        None => app_running(),
    };
    while still_open() {
        if Instant::now() > deadline {
            return Err(m(
                &lang,
                "O Orchestra não fechou. Feche-o e tente novamente.",
                "Orchestra no se cerró. Ciérrelo e intente de nuevo.",
                "Orchestra did not close. Close it and try again.",
            ));
        }
        std::thread::sleep(Duration::from_millis(400));
    }

    step(app, 30, "copy");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let exe = copy_files(&dir, &lang)?;

    step(app, 70, "register");
    if registered_dir().map(|r| r == dir).unwrap_or(true) {
        register_uninstall(&dir, &exe, &dir.join(UNINSTALLER), &app.package_info().version.to_string())?;
    }

    step(app, 100, "done");
    Ok(exe.to_string_lossy().to_string())
}

#[tauri::command]
async fn update(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || do_update(&app))
        .await
        .map_err(|e| e.to_string())?
}

fn do_uninstall(app: &AppHandle, remove_data: bool, lang: &str) -> Result<(), String> {
    if app_running() {
        return Err(m(
            lang,
            "O Orchestra está aberto. Feche-o e tente novamente.",
            "Orchestra está abierto. Ciérrelo e intente de nuevo.",
            "Orchestra is open. Close it and try again.",
        ));
    }
    let dir = current_install_dir();

    step(app, 12, "shortcuts");
    remove_shortcuts(APP_NAME);

    step(app, 38, "register");
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);

    step(app, 62, "files");
    let _ = fs::remove_file(dir.join(EXE_NAME));
    if remove_data {
        let _ = fs::remove_dir_all(data_dir());
        let _ = fs::remove_dir_all(env_path("APPDATA").join(LEGACY_APP_ID));
    }

    step(app, 88, "cleanup");
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let own = dir.join(UNINSTALLER);
    if me == own {
        let _ = Command::new("cmd")
            .raw_arg(format!(
                "/C ping 127.0.0.1 -n 3 >nul & del /F /Q \"{}\" & rmdir \"{}\"",
                own.display(),
                dir.display()
            ))
            .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
            .spawn();
    } else {
        let _ = fs::remove_file(&own);
        let _ = fs::remove_dir(&dir);
    }

    step(app, 100, "done");
    Ok(())
}

#[tauri::command]
async fn uninstall(app: AppHandle, remove_data: bool, lang: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || do_uninstall(&app, remove_data, &lang))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch(exe: String) {
    let p = PathBuf::from(&exe);
    let dir = p.parent().map(|x| x.to_path_buf()).unwrap_or_default();
    let _ = Command::new(&p)
        .current_dir(dir)
        .creation_flags(DETACHED_PROCESS)
        .spawn();
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_info, check_running, install, update, uninstall, launch])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o instalador");
}
