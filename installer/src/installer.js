const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog } = window.__TAURI__.dialog;
const appWin = window.__TAURI__.window.getCurrentWindow();

const DEFAULTS = {
	root: "C:\\quipux",
};

const T = {
	"pt-BR": {
		tagline: "Gerenciador de serviços locais",
		version: "Versão %v%",
		"btn.continue": "Continuar",
		"btn.back": "Voltar",
		"btn.install": "Instalar",
		"btn.update": "Atualizar",
		"btn.finish": "Concluir",
		"btn.close": "Fechar",
		"btn.retry": "Tentar novamente",
		"btn.browse": "Procurar",
		"btn.cancel": "Cancelar",
		"btn.remove": "Remover",
		"btn.recheck": "Verificar de novo",
		"w.title.install": "Instalar o Orchestra",
		"w.title.update": "Atualizar o Orchestra",
		"w.text":
			"Inicie, pare e acompanhe todos os seus serviços locais em um só lugar. Vamos deixar tudo configurado em poucos passos.",
		"w.lang": "Idioma",
		"w.running": "O Orchestra está aberto. Feche-o para continuar.",
		"s.title": "Configuração",
		"s.dir": "Pasta de instalação",
		"s.dir.hint": "Instalado só para o seu usuário, sem precisar de administrador.",
		"s.root": "Pasta raiz dos projetos",
		"s.root.hint":
			'Onde ficam os projetos nesta máquina. Os caminhos da lista de serviços usam <span class="mono">{root}</span>. Pode ficar em branco e ser definida depois.',
		"s.services": "Lista de serviços",
		"s.svc.keep": "Manter minha configuração atual",
		"s.svc.keep.d": "Não altera a lista de serviços nem o arquivo configurado.",
		"s.svc.file": "Usar um arquivo JSON compartilhado",
		"s.svc.file.d": "Aponta para um arquivo em rede ou repositório; a lista recarrega sozinha quando ele muda.",
		"s.svc.empty": "Começar vazio",
		"s.svc.empty.d": "Você cadastra os serviços depois.",
		"s.shortcuts": "Atalhos",
		"s.sc.menu": "Menu Iniciar",
		"s.sc.desktop": "Área de trabalho",
		"p.install": "Instalando…",
		"p.update": "Atualizando…",
		"p.uninstall": "Removendo…",
		"step.prepare": "Preparando",
		"step.copy": "Copiando arquivos",
		"step.config": "Aplicando configurações",
		"step.shortcuts": "Criando atalhos",
		"step.register": "Registrando no Windows",
		"step.done": "Concluído",
		"ustep.shortcuts": "Removendo atalhos",
		"ustep.register": "Limpando o registro",
		"ustep.files": "Removendo arquivos",
		"ustep.cleanup": "Finalizando",
		"ustep.done": "Concluído",
		"d.title.install": "Tudo pronto",
		"d.title.update": "Atualização concluída",
		"d.text": "O Orchestra foi instalado em %dir%.",
		"d.launch": "Abrir o Orchestra agora",
		"e.title": "Não foi possível concluir",
		"u.title": "Remover o Orchestra",
		"u.text": "O aplicativo, os atalhos e o registro no Windows serão removidos.",
		"u.data": "Remover também as configurações e a lista de serviços",
		"u.data.hint": "Ficam em %path%.",
		"ud.title": "Orchestra removido",
		"ud.text": "Obrigado por usar o Orchestra.",
		"err.dir": "Informe a pasta de instalação.",
		"err.file": "Escolha o arquivo JSON compartilhado.",
		"pick.dir": "Selecione a pasta",
		"pick.file": "Selecione o arquivo de configuração",
		"pick.filter": "Configuração do Orchestra (JSON)",
		"p.selfupdate": "Atualizando o Orchestra…",
		"step.wait": "Aguardando o Orchestra fechar",
	},
	"es-CO": {
		tagline: "Gestor de servicios locales",
		version: "Versión %v%",
		"btn.continue": "Continuar",
		"btn.back": "Atrás",
		"btn.install": "Instalar",
		"btn.update": "Actualizar",
		"btn.finish": "Finalizar",
		"btn.close": "Cerrar",
		"btn.retry": "Intentar de nuevo",
		"btn.browse": "Examinar",
		"btn.cancel": "Cancelar",
		"btn.remove": "Eliminar",
		"btn.recheck": "Verificar de nuevo",
		"w.title.install": "Instalar Orchestra",
		"w.title.update": "Actualizar Orchestra",
		"w.text":
			"Inicie, detenga y haga seguimiento de todos sus servicios locales en un solo lugar. Dejaremos todo configurado en pocos pasos.",
		"w.lang": "Idioma",
		"w.running": "Orchestra está abierto. Ciérrelo para continuar.",
		"s.title": "Configuración",
		"s.dir": "Carpeta de instalación",
		"s.dir.hint": "Se instala solo para su usuario, sin necesidad de administrador.",
		"s.root": "Carpeta raíz de los proyectos",
		"s.root.hint":
			'Dónde están los proyectos en este computador. Las rutas de la lista de servicios usan <span class="mono">{root}</span>. Puede quedar en blanco y definirse después.',
		"s.services": "Lista de servicios",
		"s.svc.keep": "Mantener mi configuración actual",
		"s.svc.keep.d": "No modifica la lista de servicios ni el archivo configurado.",
		"s.svc.file": "Usar un archivo JSON compartido",
		"s.svc.file.d": "Apunta a un archivo en red o repositorio; la lista se recarga sola cuando cambia.",
		"s.svc.empty": "Empezar vacío",
		"s.svc.empty.d": "Usted registra los servicios después.",
		"s.shortcuts": "Accesos directos",
		"s.sc.menu": "Menú Inicio",
		"s.sc.desktop": "Escritorio",
		"p.install": "Instalando…",
		"p.update": "Actualizando…",
		"p.uninstall": "Eliminando…",
		"step.prepare": "Preparando",
		"step.copy": "Copiando archivos",
		"step.config": "Aplicando configuración",
		"step.shortcuts": "Creando accesos directos",
		"step.register": "Registrando en Windows",
		"step.done": "Listo",
		"ustep.shortcuts": "Eliminando accesos directos",
		"ustep.register": "Limpiando el registro",
		"ustep.files": "Eliminando archivos",
		"ustep.cleanup": "Finalizando",
		"ustep.done": "Listo",
		"d.title.install": "Todo listo",
		"d.title.update": "Actualización completada",
		"d.text": "Orchestra se instaló en %dir%.",
		"d.launch": "Abrir Orchestra ahora",
		"e.title": "No fue posible completar",
		"u.title": "Eliminar Orchestra",
		"u.text": "Se eliminarán la aplicación, los accesos directos y el registro en Windows.",
		"u.data": "Eliminar también la configuración y la lista de servicios",
		"u.data.hint": "Están en %path%.",
		"ud.title": "Orchestra eliminado",
		"ud.text": "Gracias por usar Orchestra.",
		"err.dir": "Indique la carpeta de instalación.",
		"err.file": "Elija el archivo JSON compartido.",
		"pick.dir": "Seleccione la carpeta",
		"pick.file": "Seleccione el archivo de configuración",
		"pick.filter": "Configuración de Orchestra (JSON)",
		"p.selfupdate": "Actualizando Orchestra…",
		"step.wait": "Esperando que Orchestra se cierre",
	},
	"en-US": {
		tagline: "Local services manager",
		version: "Version %v%",
		"btn.continue": "Continue",
		"btn.back": "Back",
		"btn.install": "Install",
		"btn.update": "Update",
		"btn.finish": "Finish",
		"btn.close": "Close",
		"btn.retry": "Try again",
		"btn.browse": "Browse",
		"btn.cancel": "Cancel",
		"btn.remove": "Remove",
		"btn.recheck": "Check again",
		"w.title.install": "Install Orchestra",
		"w.title.update": "Update Orchestra",
		"w.text":
			"Start, stop and monitor all your local services in one place. Let’s get everything set up in a few steps.",
		"w.lang": "Language",
		"w.running": "Orchestra is open. Close it to continue.",
		"s.title": "Setup",
		"s.dir": "Installation folder",
		"s.dir.hint": "Installed for your user only, no administrator required.",
		"s.root": "Projects root folder",
		"s.root.hint":
			'Where the projects live on this machine. Paths in the service list use <span class="mono">{root}</span>. You can leave it blank and set it later.',
		"s.services": "Service list",
		"s.svc.keep": "Keep my current configuration",
		"s.svc.keep.d": "Does not change the service list or the configured file.",
		"s.svc.file": "Use a shared JSON file",
		"s.svc.file.d":
			"Points to a file on the network or in a repository; the list reloads automatically when it changes.",
		"s.svc.empty": "Start empty",
		"s.svc.empty.d": "You add the services later.",
		"s.shortcuts": "Shortcuts",
		"s.sc.menu": "Start menu",
		"s.sc.desktop": "Desktop",
		"p.install": "Installing…",
		"p.update": "Updating…",
		"p.uninstall": "Removing…",
		"step.prepare": "Preparing",
		"step.copy": "Copying files",
		"step.config": "Applying settings",
		"step.shortcuts": "Creating shortcuts",
		"step.register": "Registering with Windows",
		"step.done": "Done",
		"ustep.shortcuts": "Removing shortcuts",
		"ustep.register": "Cleaning the registry",
		"ustep.files": "Removing files",
		"ustep.cleanup": "Finishing",
		"ustep.done": "Done",
		"d.title.install": "All set",
		"d.title.update": "Update complete",
		"d.text": "Orchestra was installed in %dir%.",
		"d.launch": "Open Orchestra now",
		"e.title": "Could not finish",
		"u.title": "Remove Orchestra",
		"u.text": "The application, its shortcuts and its Windows registration will be removed.",
		"u.data": "Also remove the settings and the service list",
		"u.data.hint": "They are in %path%.",
		"ud.title": "Orchestra removed",
		"ud.text": "Thanks for using Orchestra.",
		"err.dir": "Enter the installation folder.",
		"err.file": "Choose the shared JSON file.",
		"pick.dir": "Select the folder",
		"pick.file": "Select the configuration file",
		"pick.filter": "Orchestra configuration (JSON)",
		"p.selfupdate": "Updating Orchestra…",
		"step.wait": "Waiting for Orchestra to close",
	},
};
const LANGS = [
	["pt-BR", "Português (Brasil)"],
	["es-CO", "Español (Colombia)"],
	["en-US", "English"],
];

function detectLang() {
	const nav = (navigator.language || "").toLowerCase();
	if (nav.startsWith("es")) {
		return "es-CO";
	}
	if (nav.startsWith("en")) {
		return "en-US";
	}
	return "pt-BR";
}
let lang = detectLang();
const t = (k, v) => {
	const s = T[lang][k] ?? T["pt-BR"][k] ?? k;
	return v ? s.replace(/%(\w+)%/g, (m, n) => (v[n] !== undefined ? v[n] : m)) : s;
};

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';

let info = null;
let page = "welcome";
let busy = "install";
let progress = { pct: 0, key: "prepare" };
let errorMsg = "";
let installedExe = "";
const form = {
	dir: "",
	root: DEFAULTS.root,
	mode: "empty",
	file: "",
	menu: true,
	desktop: true,
	launch: true,
	removeData: false,
};

function toast(msg) {
	const el = document.createElement("div");
	el.className = "toast";
	el.textContent = msg;
	$("#toasts").appendChild(el);
	setTimeout(() => el.remove(), 4200);
}

(function buildEq() {
	const hs = [46, 78, 58, 92, 66, 100, 72, 54, 86, 62, 40];
	$("#eq").innerHTML = hs
		.map(
			(h, i) =>
				`<i style="--h:${h}%; --d:${(1.1 + (i % 5) * 0.23).toFixed(2)}s; --w:${(-i * 0.17).toFixed(2)}s"></i>`,
		)
		.join("");
})();

function warnRunning() {
	return info.running
		? `<div class="warn"><span class="grow">${esc(t("w.running"))}</span><button class="btn" data-act="recheck">${esc(t("btn.recheck"))}</button></div>`
		: "";
}

function pageWelcome() {
	const upd = info.installed;
	return `<div class="page">
    <div>
      <h1>${esc(t(upd ? "w.title.update" : "w.title.install"))}</h1>
      <p class="lead">${esc(t("w.text"))}</p>
    </div>
    <div class="body">
      <div class="field"><span>${esc(t("w.lang"))}</span>
        <div class="seg">${LANGS.map(([c, n]) => `<button class="${c === lang ? "on" : ""}" data-act="lang" data-lang="${c}">${esc(n)}</button>`).join("")}</div>
      </div>
      ${warnRunning()}
    </div>
    <div class="foot"><span class="grow"></span>
      <button class="btn primary" data-act="next" ${info.running ? "disabled" : ""}>${esc(t("btn.continue"))}</button>
    </div>
  </div>`;
}

function modeOptions() {
	const list = [];
	if (info.installed) {
		list.push("keep");
	}
	list.push("file", "empty");
	return list;
}

function pageSetup() {
	const opts = modeOptions()
		.map((m) => {
			const d = t(`s.svc.${m}.d`);
			const extra =
				m === "file" && form.mode === "file"
					? `<div class="row extra"><input type="text" data-bind="file" value="${esc(form.file)}" placeholder="C:\\caminho\\servicos.json" spellcheck="false" />
           <button class="btn" data-act="browseFile">${esc(t("btn.browse"))}</button></div>`
					: "";
			return `<div class="opt-wrap"><div class="opt ${form.mode === m ? "on" : ""}" data-act="mode" data-mode="${m}" role="radio" aria-checked="${form.mode === m}" tabindex="0">
        <span class="dot"></span><span style="flex:1"><b>${esc(t(`s.svc.${m}`))}</b><small>${esc(d)}</small>${extra}</span></div></div>`;
		})
		.join("");

	return `<div class="page">
    <h1>${esc(t("s.title"))}</h1>
    <div class="body">
      <div class="field"><span>${esc(t("s.dir"))}</span>
        <div class="row"><input type="text" data-bind="dir" value="${esc(form.dir)}" spellcheck="false" />
          <button class="btn" data-act="browseDir" data-field="dir">${esc(t("btn.browse"))}</button></div>
        <span class="hint">${esc(t("s.dir.hint"))}</span>
      </div>
      <div class="field"><span>${esc(t("s.root"))}</span>
        <div class="row"><input type="text" data-bind="root" value="${esc(form.root)}" placeholder="C:\\projetos" spellcheck="false" />
          <button class="btn" data-act="browseDir" data-field="root">${esc(t("btn.browse"))}</button></div>
        <span class="hint">${t("s.root.hint")}</span>
      </div>
      <div class="field"><span>${esc(t("s.services"))}</span><div class="opts">${opts}</div></div>
      <div class="field"><span>${esc(t("s.shortcuts"))}</span>
        <div class="two">
          <label class="sw"><input type="checkbox" data-check="menu" ${form.menu ? "checked" : ""} /> ${esc(t("s.sc.menu"))}</label>
          <label class="sw"><input type="checkbox" data-check="desktop" ${form.desktop ? "checked" : ""} /> ${esc(t("s.sc.desktop"))}</label>
        </div>
      </div>
    </div>
    <div class="foot">
      <button class="btn ghost" data-act="back">${esc(t("btn.back"))}</button>
      <span class="grow"></span>
      <button class="btn primary" data-act="install">${esc(t(info.installed ? "btn.update" : "btn.install"))}</button>
    </div>
  </div>`;
}

function pageProgress() {
	const title =
		busy === "uninstall"
			? "p.uninstall"
			: busy === "selfupdate"
				? "p.selfupdate"
				: info.installed
					? "p.update"
					: "p.install";
	return `<div class="page">
    <h1>${esc(t(title))}</h1>
    <div class="center">
      <div class="bar"><i id="barFill" style="width:${progress.pct}%"></i></div>
      <div class="plabel"><span id="plabel">${esc(stepLabel())}</span><span id="ppct">${progress.pct}%</span></div>
    </div>
  </div>`;
}
const stepLabel = () => t((busy === "uninstall" ? "ustep." : "step.") + progress.key);

function pageDone() {
	return `<div class="page">
    <div class="center" style="align-content:start;margin-top:18px">
      <span class="badge">${CHECK}</span>
      <div><h1>${esc(t(info.installed ? "d.title.update" : "d.title.install"))}</h1>
        <p class="lead">${esc(t("d.text", { dir: form.dir }))}</p></div>
      <label class="sw"><input type="checkbox" data-check="launch" ${form.launch ? "checked" : ""} /> ${esc(t("d.launch"))}</label>
    </div>
    <div class="foot"><span class="grow"></span><button class="btn primary" data-act="finish">${esc(t("btn.finish"))}</button></div>
  </div>`;
}

function pageError() {
	return `<div class="page">
    <div class="center" style="align-content:start;margin-top:18px">
      <span class="badge bad">${CROSS}</span>
      <h1>${esc(t("e.title"))}</h1>
      <div class="errbox">${esc(errorMsg)}</div>
    </div>
    <div class="foot">
      <button class="btn ghost" data-act="close">${esc(t("btn.close"))}</button><span class="grow"></span>
      <button class="btn primary" data-act="retry">${esc(t("btn.retry"))}</button>
    </div>
  </div>`;
}

function pageUninstall() {
	return `<div class="page">
    <div><h1>${esc(t("u.title"))}</h1><p class="lead">${esc(t("u.text"))}</p></div>
    <div class="body">
      <label class="sw"><input type="checkbox" data-check="removeData" ${form.removeData ? "checked" : ""} />
        <span>${esc(t("u.data"))}<small>${esc(t("u.data.hint", { path: "%APPDATA%\\com.orchestra.app" }))}</small></span></label>
      <div class="field"><span>${esc(t("w.lang"))}</span>
        <div class="seg">${LANGS.map(([c, n]) => `<button class="${c === lang ? "on" : ""}" data-act="lang" data-lang="${c}">${esc(n)}</button>`).join("")}</div></div>
      ${warnRunning()}
    </div>
    <div class="foot"><button class="btn ghost" data-act="close">${esc(t("btn.cancel"))}</button><span class="grow"></span>
      <button class="btn danger" data-act="uninstall" ${info.running ? "disabled" : ""}>${esc(t("btn.remove"))}</button></div>
  </div>`;
}

function pageUDone() {
	return `<div class="page">
    <div class="center" style="align-content:start;margin-top:18px">
      <span class="badge">${CHECK}</span>
      <div><h1>${esc(t("ud.title"))}</h1><p class="lead">${esc(t("ud.text"))}</p></div>
    </div>
    <div class="foot"><span class="grow"></span><button class="btn primary" data-act="close">${esc(t("btn.close"))}</button></div>
  </div>`;
}

const PAGES = {
	welcome: pageWelcome,
	setup: pageSetup,
	progress: pageProgress,
	done: pageDone,
	error: pageError,
	uninstall: pageUninstall,
	udone: pageUDone,
};

let lastPage = null;
function render() {
	const oldBody = $("#content .body");
	const keepScroll = oldBody ? oldBody.scrollTop : 0;
	$("#pTag").textContent = t("tagline");
	$("#pVer").textContent = t("version", { v: info ? info.version : "" });
	document.documentElement.lang = lang;
	$("#content").innerHTML = PAGES[page]();
	const pg = $("#content .page");
	if (pg && page !== lastPage) {
		pg.classList.add("enter");
	}
	const nb = $("#content .body");
	if (nb && keepScroll && page === lastPage) {
		nb.scrollTop = keepScroll;
	}
	lastPage = page;
	$("#eq").classList.toggle("busy", page === "progress");
}

async function browseDir(field) {
	try {
		const dir = await openDialog({
			directory: true,
			multiple: false,
			title: t("pick.dir"),
			defaultPath: form[field] || undefined,
		});
		if (dir) {
			form[field] = dir;
			const el = $(`[data-bind="${field}"]`);
			if (el) {
				el.value = dir;
			}
		}
	} catch (e) {
		toast(String(e));
	}
}
async function browseFile() {
	try {
		const f = await openDialog({
			directory: false,
			multiple: false,
			title: t("pick.file"),
			filters: [{ name: t("pick.filter"), extensions: ["json"] }],
		});
		if (f) {
			form.file = f;
			const el = $('[data-bind="file"]');
			if (el) {
				el.value = f;
			}
		}
	} catch (e) {
		toast(String(e));
	}
}

async function runInstall() {
	if (!form.dir.trim()) {
		return toast(t("err.dir"));
	}
	if (form.mode === "file" && !form.file.trim()) {
		return toast(t("err.file"));
	}
	busy = "install";
	progress = { pct: 0, key: "prepare" };
	page = "progress";
	render();
	try {
		installedExe = await invoke("install", {
			opts: {
				dir: form.dir.trim(),
				lang,
				root: form.root.trim(),
				servicesMode: form.mode,
				configPath: form.file.trim(),
				desktopShortcut: form.desktop,
				startMenuShortcut: form.menu,
			},
		});
		page = "done";
	} catch (e) {
		errorMsg = String(e);
		page = "error";
	}
	render();
}

async function runSelfUpdate() {
	busy = "selfupdate";
	progress = { pct: 0, key: "wait" };
	page = "progress";
	render();
	try {
		const exe = await invoke("update");
		try {
			await invoke("launch", { exe });
		} catch {}
		appWin.close();
	} catch (e) {
		errorMsg = String(e);
		page = "error";
		render();
	}
}

async function runUninstall() {
	busy = "uninstall";
	progress = { pct: 0, key: "shortcuts" };
	page = "progress";
	render();
	try {
		await invoke("uninstall", { removeData: form.removeData, lang });
		page = "udone";
	} catch (e) {
		errorMsg = String(e);
		page = "error";
	}
	render();
}

const actions = {
	lang: (el) => {
		lang = el.dataset.lang;
		render();
	},
	next: () => {
		page = "setup";
		render();
	},
	back: () => {
		page = "welcome";
		render();
	},
	mode: (el) => {
		form.mode = el.dataset.mode;
		render();
	},
	browseDir: (el) => browseDir(el.dataset.field),
	browseFile: () => browseFile(),
	install: () => runInstall(),
	uninstall: () => runUninstall(),
	retry: () => {
		if (info.mode === "update") {
			return runSelfUpdate();
		}
		page = info.mode === "uninstall" ? "uninstall" : "setup";
		render();
	},
	recheck: async () => {
		try {
			info.running = await invoke("check_running");
		} catch {}
		render();
	},
	finish: async () => {
		if (form.launch && installedExe) {
			try {
				await invoke("launch", { exe: installedExe });
			} catch {}
		}
		appWin.close();
	},
	close: () => appWin.close(),
};

document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-act]");
	if (!el) {
		return;
	}
	const fn = actions[el.dataset.act];
	if (fn) {
		fn(el, e);
	}
});
document.addEventListener("keydown", (e) => {
	if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('.opt[data-act="mode"]')) {
		e.preventDefault();
		e.target.click();
	}
});
document.addEventListener("input", (e) => {
	const k = e.target.dataset?.bind;
	if (k) {
		form[k] = e.target.value;
	}
});
document.addEventListener("change", (e) => {
	const k = e.target.dataset?.check;
	if (k) {
		form[k] = e.target.checked;
	}
});
$("#wClose").addEventListener("click", () => appWin.close());

listen("progress", (e) => {
	progress = e.payload;
	const bar = $("#barFill");
	if (bar) {
		bar.style.width = `${progress.pct}%`;
		$("#plabel").textContent = stepLabel();
		$("#ppct").textContent = `${progress.pct}%`;
	}
});

(async function init() {
	try {
		info = await invoke("get_info");
	} catch (e) {
		info = {
			mode: "install",
			version: "",
			defaultDir: "",
			installed: false,
			running: false,
			lang: "",
		};
		toast(String(e));
	}
	form.dir = info.defaultDir || "";
	form.mode = info.installed ? "keep" : "empty";
	if (T[info.lang]) {
		lang = info.lang;
	}
	if (info.mode === "update") {
		return runSelfUpdate();
	}
	page = info.mode === "uninstall" ? "uninstall" : "welcome";
	render();
})();
