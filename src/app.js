const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;
const appWin = window.__TAURI__.window.getCurrentWindow();

function detectLang() {
	const saved = localStorage.getItem("orq.lang");
	if (saved && I18N[saved]) {
		return saved;
	}
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

function t(key, vars) {
	let v = I18N[lang][key];
	if (v === undefined) {
		v = I18N["pt-BR"][key];
	}
	if (v === undefined) {
		return key;
	}
	return vars ? v.replace(/%(\w+)%/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : v;
}

function applyStatic() {
	document.documentElement.lang = lang;
	document.querySelectorAll("[data-i18n]").forEach((el) => {
		el.textContent = t(el.dataset.i18n);
	});
	document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
		el.placeholder = t(el.dataset.i18nPh);
	});
	document.querySelectorAll("[data-i18n-title]").forEach((el) => {
		const v = t(el.dataset.i18nTitle);
		el.title = v;
		el.setAttribute("aria-label", v);
	});
}

const KINDS = {
	angular: { label: "Angular", glyph: "Ng", color: "var(--k-angular)", hint: "npm start" },
	java: { label: "Java", glyph: "Jv", color: "var(--k-java)", hint: "mvn spring-boot:run" },
	node: { label: "Node", glyph: "No", color: "var(--k-node)", hint: "npm run dev" },
	python: { label: "Python", glyph: "Py", color: "var(--k-python)", hint: "python main.py" },
	dotnet: { label: ".NET", glyph: "C#", color: "var(--k-dotnet)", hint: "dotnet run" },
	other: { label: "", glyph: "•", color: "var(--k-other)", hint: "" },
};
const STAGGER = [0, 1000, 1500, 3000, 5000, 10000];
const NO_GROUP = "__none__";
const MAX_BUFFER = 5000;
const MAX_DOM = 1500;
const HIST = 60;

const ic = (body) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const P = {
	play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
	stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none"/>',
	redo: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
	edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
	trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
	search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
	chev: '<path d="M6 9l6 6 6-6"/>',
	sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
	moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
	copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
	grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8"/>',
};
const I = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, ic(v)]));

const $ = (s, r = document) => r.querySelector(s);
let services = [];
let cfg = { path: "", custom: false, root: "", mtime: 0 };
const status = {};
const stats = {};
const hist = {};
const totals = { cpu: [], mem: [] };
const logs = {};
const collapsed = new Set();
let view = "overview";
let ovMode = ["groups", "stages", "active"].includes(localStorage.getItem("orq.ov"))
	? localStorage.getItem("orq.ov")
	: "groups";
let search = "";
let termFilter = "";
let autoscroll = true;
let showTime = localStorage.getItem("orq.time") !== "0";
let pendingDom = [];
let staggerMs = Number(localStorage.getItem("orq.stagger") || 1500);

const getSt = (id) =>
	(status[id] ||= { state: "stopped", pid: null, code: null, startedAt: 0, retries: 0, timer: null });
const isActive = (id) => ["running", "restarting"].includes(getSt(id).state);
const anyActive = () => services.some((s) => isActive(s.id));
const kindOf = (k) => KINDS[k] || KINDS.other;
const kindLabel = (k) => KINDS[k]?.label || t("kind.other");
const byId = (id) => services.find((s) => s.id === id);
const byOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name, lang);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const groupName = (s) => (s.group || "").trim() || NO_GROUP;
const gLabel = (g) => (g === NO_GROUP ? t("noGroup") : g);

function normalize(x, i) {
	return {
		id: x.id || crypto.randomUUID(),
		name: x.name || "",
		path: x.path || "",
		command: x.command || "",
		kind: x.kind || "other",
		group: x.group || "",
		env: x.env || "",
		order: x.order > 0 ? x.order : i + 1,
		waitAfter: Math.max(x.waitAfter, 0),
		autoRestart: !!x.autoRestart,
		maxRetries: x.maxRetries > 0 ? x.maxRetries : x.autoRestart ? 0 : 5,
		restartDelay: x.restartDelay > 0 ? x.restartDelay : 5,
		waitForExit: !!x.waitForExit,
		manual: !!x.manual,
	};
}

const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
const pct = (v) => `${v.toFixed(1).replace(".", ",")}%`;

function fmtMem(b) {
	if (!b) {
		return "0 MB";
	}
	const mb = b / 1048576;
	return mb >= 1024 ? `${(mb / 1024).toFixed(1).replace(".", ",")} GB` : `${Math.round(mb)} MB`;
}
function fmtUp(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(s / 3600),
		m = Math.floor((s % 3600) / 60),
		x = s % 60;
	return h ? `${h}h ${String(m).padStart(2, "0")}m` : m ? `${m}m ${String(x).padStart(2, "0")}s` : `${x}s`;
}
function stateLabel(id) {
	const st = getSt(id);
	if (st.state === "restarting") {
		return t("st.restarting");
	}
	if (st.state === "running") {
		return t("st.running");
	}
	if (st.state === "crashed") {
		return st.code != null ? t("st.failedCode", { code: st.code }) : t("st.ended");
	}
	return t("st.stopped");
}
const stateDot = (id) =>
	`<span class="state ${getSt(id).state}"><i class="${getSt(id).state}"></i>${esc(stateLabel(id))}</span>`;
const staggerLabel = (v) => (v === 0 ? t("none") : `${(v / 1000).toString().replace(".", ",")} s`);

let lastSec = -1,
	lastStr = "";
function tsStr(ms) {
	const sec = Math.floor(ms / 1000);
	if (sec !== lastSec) {
		const d = new Date(ms),
			p = (n) => String(n).padStart(2, "0");
		lastStr = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
		lastSec = sec;
	}
	return lastStr;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");
function classify(text, isErr) {
	if (/\b(ERROR|SEVERE|FATAL|FAILED|Exception|Error:)/.test(text)) {
		return "err";
	}
	if (/\bWARN(ING)?\b/.test(text)) {
		return "warn";
	}
	if (/\bINFO\b/.test(text)) {
		return "info";
	}
	if (isErr && /^\s+at\s/.test(text)) {
		return "err";
	}
	return "";
}

function toast(msg, kind = "") {
	const el = document.createElement("div");
	el.className = `toast ${kind}`;
	el.textContent = msg;
	$("#toasts").appendChild(el);
	setTimeout(() => el.remove(), 5000);
}

async function persist() {
	try {
		await invoke("save_services", { services });
		cfg.mtime = await invoke("config_mtime");
	} catch (e) {
		toast(t("err.save", { e }), "bad");
	}
}

function applyTheme(th) {
	document.documentElement.dataset.theme = th;
	localStorage.setItem("orq.theme", th);
	$("#btnTheme").innerHTML = th === "dark" ? I.sun : I.moon;
}

const prefersReducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function toggleTheme(e) {
	const root = document.documentElement;
	const next = root.dataset.theme === "dark" ? "light" : "dark";
	if (!document.startViewTransition || prefersReducedMotion()) {
		applyTheme(next);
		return;
	}

	let x = e?.clientX,
		y = e?.clientY;
	if (!x && !y) {
		const r = $("#btnTheme").getBoundingClientRect();
		x = r.left + r.width / 2;
		y = r.top + r.height / 2;
	}
	const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

	root.classList.add("no-trans");
	const tr = document.startViewTransition(() => applyTheme(next));
	tr.ready
		.then(() => {
			root.animate(
				{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
				{ duration: 650, easing: "cubic-bezier(.4, 0, .15, 1)", pseudoElement: "::view-transition-new(root)" },
			);
		})
		.catch(() => {});
	tr.finished.finally(() => root.classList.remove("no-trans"));
}

function pushLog(id, text, cls = "") {
	if (!logs[id]) {
		logs[id] = [];
	}
	const buf = logs[id];
	const entry = { t: text, c: cls, ts: Date.now() };
	buf.push(entry);
	if (buf.length > MAX_BUFFER + 1000) {
		buf.splice(0, buf.length - MAX_BUFFER);
	}
	if (view === id && matchesFilter(entry)) {
		pendingDom.push(entry);
		scheduleTerm();
	}
}
const matchesFilter = (e) => !termFilter || e.t.toLowerCase().includes(termFilter);

function lineEl(e) {
	const d = document.createElement("div");
	d.className = `ln${e.c ? ` ${e.c}` : ""}`;
	d.dataset.ts = tsStr(e.ts);
	d.textContent = e.t;
	return d;
}

let termQueued = false;
function scheduleTerm() {
	if (termQueued) {
		return;
	}
	termQueued = true;
	requestAnimationFrame(() => {
		termQueued = false;
		flushTerm();
	});
}

function flushTerm() {
	const term = $("#term");
	if (!term) {
		pendingDom = [];
		return;
	}
	if (!pendingDom.length) {
		return;
	}
	term.querySelector(".none")?.remove();
	const frag = document.createDocumentFragment();
	for (const e of pendingDom) {
		frag.appendChild(lineEl(e));
	}
	pendingDom = [];
	term.appendChild(frag);
	let excess = term.childElementCount - MAX_DOM;
	while (excess-- > 0) {
		term.removeChild(term.firstChild);
	}
	if (autoscroll) {
		term.scrollTop = term.scrollHeight;
	}
}

function renderTerm() {
	const term = $("#term");
	if (!term) {
		return;
	}
	pendingDom = [];
	const buf = (logs[view] || []).filter(matchesFilter).slice(-MAX_DOM);
	term.textContent = "";
	if (!buf.length) {
		term.innerHTML = `<div class="none">${esc(termFilter ? t("log.none.filter") : t("log.none"))}</div>`;
		return;
	}
	const frag = document.createDocumentFragment();
	for (const e of buf) {
		frag.appendChild(lineEl(e));
	}
	term.appendChild(frag);
	term.scrollTop = term.scrollHeight;
}

const barsEl = (spec, n) => `<div class="bars" data-spark="${spec}" data-n="${n}" aria-hidden="true"></div>`;

function ensureBars(el) {
	const n = Number(el.dataset.n) || 28;
	if (el.children.length === n) {
		return;
	}
	el.textContent = "";
	for (let i = 0; i < n; i++) {
		const b = document.createElement("span");
		b.style.opacity = (0.22 + 0.78 * (i / Math.max(1, n - 1))).toFixed(2);
		el.appendChild(b);
	}
}

function drawBars() {
	document.querySelectorAll("[data-spark]").forEach((el) => {
		ensureBars(el);
		const [a, b] = el.dataset.spark.split(":");
		const key = a === "total" ? b : a;
		const series = a === "total" ? totals[b] : hist[b]?.[a] || [];
		const n = el.children.length;
		const vals = series.slice(-n);
		const max = Math.max(...vals, key === "cpu" ? 2 : 64 * 1048576) * 1.05;
		const off = n - vals.length;
		for (let i = 0; i < n; i++) {
			const v = i < off ? 0 : vals[i - off];
			const h = `${(v ? Math.max(7, (v / max) * 100) : 3).toFixed(0)}%`;
			const st = el.children[i].style;
			if (st.height !== h) {
				st.height = h;
			}
		}
	});
}

const pushCap = (arr, v) => {
	arr.push(v);
	if (arr.length > HIST) {
		arr.shift();
	}
};
function pushTotals() {
	let m = 0,
		c = 0;
	for (const id in stats) {
		m += stats[id].mem;
		c += stats[id].cpu;
	}
	pushCap(totals.mem, m);
	pushCap(totals.cpu, c);
}

const SA_BAR = '<div class="sa-bar off" aria-hidden="true"><div class="sa-thumb"></div></div>';
const SA_TARGETS = [
	[".page", "sa-fill"],
	["#term", "sa-fill dark"],
	["#list", "sa-fill"],
	[".m-body", "sa-body"],
];

function enhanceScroll() {
	for (const [sel, cls] of SA_TARGETS) {
		document.querySelectorAll(sel).forEach((el) => {
			if (el.parentElement?.classList.contains("sa")) {
				return;
			}
			const root = document.createElement("div");
			root.className = `sa ${cls}`;
			el.parentNode.insertBefore(root, el);
			el.classList.add("sa-view");
			root.appendChild(el);
			root.insertAdjacentHTML("beforeend", SA_BAR);
		});
	}
	document.querySelectorAll(".sa").forEach((root) => {
		if (!root._sa) {
			setupScrollArea(root);
		}
	});
}

function setupScrollArea(root) {
	const view = root.querySelector(":scope > .sa-view");
	const bar = root.querySelector(":scope > .sa-bar");
	const thumb = bar.firstElementChild;
	let hideT = null,
		hovering = false,
		dragging = false,
		startY = 0,
		startTop = 0,
		followUntil = 0,
		raf = 0;
	root._sa = true;

	const metrics = () => {
		const sh = view.scrollHeight,
			ch = view.clientHeight;
		if (sh <= ch + 1) {
			return null;
		}
		const trackH = Math.max(0, bar.clientHeight - 2);
		const th = Math.max(18, (trackH * ch) / sh);
		return { max: sh - ch, th, maxTop: Math.max(1, trackH - th) };
	};
	const update = () => {
		const m = metrics();
		bar.classList.toggle("off", !m);
		if (!m) {
			return;
		}
		thumb.style.height = `${m.th}px`;
		thumb.style.transform = `translateY(${(view.scrollTop / m.max) * m.maxTop}px)`;
	};
	const tick = () => {
		raf = 0;
		update();
		if (performance.now() < followUntil) {
			raf = requestAnimationFrame(tick);
		}
	};
	const schedule = (follow = 0) => {
		followUntil = Math.max(followUntil, performance.now() + follow);
		if (!raf) {
			raf = requestAnimationFrame(tick);
		}
	};
	const show = () => {
		clearTimeout(hideT);
		bar.classList.add("on");
	};
	const hideLater = () => {
		clearTimeout(hideT);
		hideT = setTimeout(() => {
			if (!hovering && !dragging) {
				bar.classList.remove("on");
			}
		}, 600);
	};

	root.addEventListener("pointerenter", () => {
		hovering = true;
		update();
		show();
	});
	root.addEventListener("pointerleave", () => {
		hovering = false;
		hideLater();
	});
	view.addEventListener(
		"scroll",
		() => {
			update();
			if (!root._quiet) {
				show();
				hideLater();
			}
		},
		{ passive: true },
	);

	thumb.addEventListener("pointerdown", (e) => {
		e.preventDefault();
		e.stopPropagation();
		dragging = true;
		startY = e.clientY;
		startTop = view.scrollTop;
		bar.classList.add("drag");
		thumb.setPointerCapture(e.pointerId);
	});
	thumb.addEventListener("pointermove", (e) => {
		if (!dragging) {
			return;
		}
		const m = metrics();
		if (m) {
			view.scrollTop = startTop + (e.clientY - startY) * (m.max / m.maxTop);
		}
	});
	const endDrag = () => {
		if (!dragging) {
			return;
		}
		dragging = false;
		bar.classList.remove("drag");
		hideLater();
	};
	thumb.addEventListener("pointerup", endDrag);
	thumb.addEventListener("pointercancel", endDrag);

	bar.addEventListener("pointerdown", (e) => {
		if (e.target !== bar) {
			return;
		}
		const m = metrics();
		if (!m) {
			return;
		}
		const y = e.clientY - bar.getBoundingClientRect().top - 1 - m.th / 2;
		view.scrollTop = Math.min(1, Math.max(0, y / m.maxTop)) * m.max;
	});

	if (typeof ResizeObserver !== "undefined") {
		new ResizeObserver(() => schedule()).observe(view);
	}
	new MutationObserver((muts) => schedule(muts.some((mu) => mu.type === "attributes") ? 450 : 0)).observe(view, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
		attributeFilter: ["class"],
	});
	schedule();
}

function groupsOf(list) {
	const map = new Map();
	for (const s of list) {
		const g = groupName(s);
		if (!map.has(g)) {
			map.set(g, []);
		}
		map.get(g).push(s);
	}
	for (const arr of map.values()) {
		arr.sort(byOrder);
	}
	return [...map.entries()].sort(([a], [b]) => (a === NO_GROUP ? 1 : b === NO_GROUP ? -1 : a.localeCompare(b, lang)));
}
function filtered() {
	const q = search.trim().toLowerCase();
	if (!q) {
		return services;
	}
	return services.filter((s) => `${s.name} ${s.group} ${s.command} ${kindLabel(s.kind)}`.toLowerCase().includes(q));
}

function itemHtml(s) {
	const k = kindOf(s.kind);
	return `
    <div class="item-row" style="--kc:${k.color}">
      <button class="item ${view === s.id ? "active" : ""}" data-act="open" data-id="${s.id}">
        <span class="ktile sm">${k.glyph}</span>
        <span class="i-main"><span class="nm">${esc(s.name)}</span><span class="sub" data-m="sub:${s.id}"></span></span>
        <span class="led ${getSt(s.id).state}"></span>
      </button>
      ${
			isActive(s.id)
				? `<button class="mini stop" data-act="stop" data-id="${s.id}" title="${esc(t("act.stop"))}" aria-label="${esc(t("aria.stopX", { name: s.name }))}">${I.stop}</button>`
				: `<button class="mini play" data-act="start" data-id="${s.id}" title="${esc(t("act.start"))}" aria-label="${esc(t("aria.startX", { name: s.name }))}">${I.play}</button>`
		}
    </div>`;
}

function renderSidebar() {
	$("#navOverview").classList.toggle("active", view === "overview");
	const list = filtered();
	if (!list.length) {
		$("#list").innerHTML = `<div class="none">${esc(services.length ? t("side.notFound") : t("side.empty"))}</div>`;
		return;
	}
	$("#list").innerHTML = groupsOf(list)
		.map(([g, items]) => {
			const run = items.filter((s) => getSt(s.id).state === "running").length;
			const col = collapsed.has(g);
			return `<button class="group-title ${col ? "collapsed" : ""}" data-act="toggleGroup" data-group="${esc(g)}" aria-expanded="${!col}">
        ${I.chev}<span class="gname">${esc(gLabel(g))}</span><span class="gcount">${run}/${items.length}</span>
      </button>
      <div class="collapsible ${col ? "closed" : ""}" data-group-body="${esc(g)}"><div class="inner">${items.map(itemHtml).join("")}</div></div>`;
		})
		.join("");
	updateStatsUI();
}

function cardHtml(s) {
	const st = getSt(s.id),
		k = kindOf(s.kind);
	const running = st.state === "running";
	const sub = [kindLabel(s.kind), (s.group || "").trim()].filter(Boolean).join(" · ");
	return `
  <div class="card ${running ? "on" : ""} ${st.state === "crashed" ? "bad" : ""}" data-act="open" data-id="${s.id}" style="--kc:${k.color}">
    <div class="c-top">
      <span class="ktile">${k.glyph}</span>
      <div class="c-id"><div class="nm">${esc(s.name)}</div><div class="sub">${esc(sub)}</div></div>
      <div class="c-btns">
        ${running ? `<button class="ibtn sm" data-act="restart" data-id="${s.id}" title="${esc(t("act.restart"))}" aria-label="${esc(t("act.restart"))}">${I.redo}</button>` : ""}
        ${
			isActive(s.id)
				? `<button class="fab stop" data-act="stop" data-id="${s.id}" title="${esc(running ? t("act.stop") : t("act.cancelRestart"))}" aria-label="${esc(t("act.stop"))}">${I.stop}</button>`
				: `<button class="fab play" data-act="start" data-id="${s.id}" title="${esc(t("act.start"))}" aria-label="${esc(t("act.start"))}">${I.play}</button>`
		}
      </div>
    </div>
    <div class="cmd" title="${esc(s.command)}">${esc(s.command)}</div>
    <div class="c-foot">
      <div class="c-info">
        ${stateDot(s.id)}
        ${running ? `<div class="c-nums"><b data-m="mem:${s.id}">—</b><span data-m="cpu:${s.id}">—</span><span data-upt="${s.id}">—</span></div>` : ""}
      </div>
      ${running ? barsEl(`mem:${s.id}`, 26) : ""}
    </div>
  </div>`;
}

const waitFor = (stage) => Math.max(staggerMs, ...stage.map((s) => (s.waitAfter || 0) * 1000));
const fmtWait = (ms) => `${ms % 1000 ? (ms / 1000).toFixed(1).replace(".", ",") : ms / 1000} s`;

function renderOverview() {
	const keepTop = $("#main .page")?.scrollTop || 0;
	const list = filtered();
	const total = services.length;
	const running = services.filter((s) => getSt(s.id).state === "running").length;
	const active = services.filter((s) => isActive(s.id)).length;
	const failed = services.filter((s) => getSt(s.id).state === "crashed").length;

	let body;
	if (!total) {
		body = `<div class="empty">
      <div class="art"><i></i><i></i><i></i><i></i></div>
      <h2>${esc(t("empty.title"))}</h2>
      <p>${t("empty.text")}</p>
      <div class="btn-row"><button class="btn primary" data-act="new">${esc(t("btn.new"))}</button><button class="btn" data-act="settings">${esc(t("empty.openSettings"))}</button></div>
    </div>`;
	} else if (!list.length) {
		body = `<div class="empty"><h2>${esc(t("nf.title"))}</h2><p>${esc(t("nf.text"))}</p></div>`;
	} else if (ovMode === "active" && !list.some((s) => getSt(s.id).state !== "stopped")) {
		body = `<div class="empty">
      <div class="art"><i></i><i></i><i></i><i></i></div>
      <h2>${esc(t("active.title"))}</h2>
      <p>${esc(t("active.text"))}</p>
      <div class="btn-row"><button class="btn primary" data-act="startAll">${esc(t("ov.startAll"))}</button></div>
    </div>`;
	} else if (ovMode !== "stages") {
		const src = ovMode === "active" ? list.filter((s) => getSt(s.id).state !== "stopped") : list;
		body = groupsOf(src)
			.map(([g, items]) => {
				const run = items.filter((s) => getSt(s.id).state === "running").length;
				const col = collapsed.has(g),
					gk = esc(g);
				return `<section class="group-block">
        <div class="group-head">
          <button class="gh-title ${col ? "collapsed" : ""}" data-act="toggleGroup" data-group="${gk}" aria-expanded="${!col}">${I.chev}${esc(gLabel(g))}<span>${esc(t("group.runCount", { run, total: items.length }))}</span></button>
          <div class="actions">
            <button class="btn sm ghost" data-act="stopGroup" data-group="${gk}">${esc(t("group.stop"))}</button>
            ${ovMode === "active" ? "" : `<button class="btn sm" data-act="startGroup" data-group="${gk}">${esc(t("group.start"))}</button>`}
          </div>
        </div>
        <div class="collapsible ${col ? "closed" : ""}" data-group-body="${gk}"><div class="inner"><div class="grid">${items.map(cardHtml).join("")}</div></div></div>
      </section>`;
			})
			.join("");
	} else {
		const stages = stagesOf(list);
		body = `<div class="stages">${stages
			.map(
				(stage, i) => `
      <div class="stage">
        <div class="st-rail"><span class="st-n">${i + 1}</span><span class="st-line"></span></div>
        <div class="st-body">
          <div class="st-head">
            <h2>${esc(t("stage.title", { n: i + 1 }))}</h2>
            <span class="sub">${esc(stage.length === 1 ? t("stage.one") : t("stage.many", { n: stage.length }))}</span>
            <span class="grow"></span>
            <button class="btn sm" data-act="startStage" data-order="${stage[0].order}">${esc(t("stage.start"))}</button>
          </div>
          <div class="grid">${stage.map(cardHtml).join("")}</div>
          ${i < stages.length - 1 ? `<div class="st-wait">${t("stage.wait", { wait: fmtWait(waitFor(stage)) })}</div>` : ""}
        </div>
      </div>`,
			)
			.join("")}</div>`;
	}

	$("#main").innerHTML = `
    <div class="page">
      <div class="ov-head">
        <div>
          <h1>${esc(t("nav.overview"))}</h1>
          <p>${esc(total ? t("ov.sub", { running, total }) : t("ov.none"))}</p>
        </div>
        <div class="actions">
          ${
				total
					? `<div class="seg" role="tablist">
            <button class="${ovMode === "groups" ? "on" : ""}" data-act="mode" data-mode="groups">${esc(t("mode.groups"))}</button>
            <button class="${ovMode === "active" ? "on" : ""}" data-act="mode" data-mode="active">${esc(t("mode.active"))}</button>
            <button class="${ovMode === "stages" ? "on" : ""}" data-act="mode" data-mode="stages">${esc(t("mode.stages"))}</button>
          </div>`
					: ""
			}
          <button class="btn ghost" data-act="order" ${total ? "" : "disabled"}>${esc(t("ov.order"))}</button>
          <button class="btn danger" data-act="stopAll" ${active ? "" : "disabled"}>${esc(t("ov.stopAll"))}</button>
          <button class="btn primary" data-act="startAll" ${total ? "" : "disabled"}>${esc(t("ov.startAll"))}</button>
        </div>
      </div>
      ${
			total
				? `<div class="hero">
        <div class="h-main"><small>${esc(t("hero.mem"))}</small><div class="h-num" data-m="total:mem">0 MB</div></div>
        ${barsEl("total:mem", HIST)}
        <div class="h-stats">
          <div><b>${running}<i> / ${total}</i></b><small>${esc(t("hero.running"))}</small></div>
          <div><b data-m="total:cpu">0,0%</b><small>${esc(t("hero.cpu"))}</small></div>
          <div><b class="${failed ? "bad" : ""}">${failed}</b><small>${esc(t("hero.failed"))}</small></div>
        </div>
      </div>`
				: ""
		}
      ${body}
    </div>`;
	enhanceScroll();
	const pv = $("#main .page");
	if (pv && keepTop) {
		pv.parentElement._quiet = true;
		pv.scrollTop = keepTop;
		setTimeout(() => {
			pv.parentElement._quiet = false;
		}, 80);
	}
	updateStatsUI();
	tickUptime();
}

function renderDetail() {
	$("#main").innerHTML = `
    <div class="dh" id="dHead"></div>
    <div class="term-wrap">
      <div class="term-card">
        <div class="term-bar">
          <div class="tsearch">${I.search}<input id="tfilter" type="text" placeholder="${esc(t("term.filter"))}" autocomplete="off" spellcheck="false" value="${esc(termFilter)}" /></div>
          <span class="grow"></span>
          <label class="sw"><input type="checkbox" id="tTime" ${showTime ? "checked" : ""} /> ${esc(t("term.time"))}</label>
          <label class="sw"><input type="checkbox" id="tauto" ${autoscroll ? "checked" : ""} /> ${esc(t("term.follow"))}</label>
          <button class="btn sm" data-act="clear">${esc(t("term.clear"))}</button>
        </div>
        <div class="term ${showTime ? "" : "no-ts"}" id="term"></div>
      </div>
    </div>`;
	enhanceScroll();
	renderDetailHead();
	renderTerm();

	let tm;
	$("#tfilter").addEventListener("input", (e) => {
		clearTimeout(tm);
		tm = setTimeout(() => {
			termFilter = e.target.value.trim().toLowerCase();
			renderTerm();
		}, 150);
	});
	$("#tTime").addEventListener("change", (e) => {
		showTime = e.target.checked;
		localStorage.setItem("orq.time", showTime ? "1" : "0");
		$("#term").classList.toggle("no-ts", !showTime);
	});
	$("#tauto").addEventListener("change", (e) => {
		autoscroll = e.target.checked;
		if (autoscroll) {
			const term = $("#term");
			term.scrollTop = term.scrollHeight;
		}
	});
	$("#term").addEventListener(
		"scroll",
		(e) => {
			const el = e.target;
			const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
			if (atBottom !== autoscroll) {
				autoscroll = atBottom;
				const c = $("#tauto");
				if (c) {
					c.checked = atBottom;
				}
			}
		},
		{ passive: true },
	);
}

function renderDetailHead() {
	const s = byId(view);
	const head = $("#dHead");
	if (!s || !head) {
		return;
	}
	const st = getSt(s.id),
		k = kindOf(s.kind),
		running = st.state === "running";
	head.style.setProperty("--kc", k.color);
	const autoTxt = s.autoRestart
		? t("d.auto.on", {
				limit: s.maxRetries ? t("d.auto.upto", { n: s.maxRetries }) : t("d.auto.unlimited"),
				delay: s.restartDelay,
			})
		: t("d.auto.off");
	head.innerHTML = `
    <div class="dh-top">
      <span class="ktile lg">${k.glyph}</span>
      <div class="dh-id">
        <h1>${esc(s.name)}</h1>
        <div class="dsub">${stateDot(s.id)}<span>${esc(kindLabel(s.kind))}${s.group ? ` · ${esc(s.group)}` : ""}</span></div>
      </div>
      <span class="grow"></span>
      ${
			running
				? `<button class="btn" data-act="restart" data-id="${s.id}">${I.redo} ${esc(t("act.restart"))}</button>
           <button class="btn danger" data-act="stop" data-id="${s.id}">${I.stop} ${esc(t("act.stop"))}</button>`
				: st.state === "restarting"
					? `<button class="btn danger" data-act="stop" data-id="${s.id}">${I.stop} ${esc(t("act.cancelRestart"))}</button>`
					: `<button class="btn primary" data-act="start" data-id="${s.id}">${I.play} ${esc(t("act.start"))}</button>`
		}
      <button class="ibtn" data-act="edit" data-id="${s.id}" title="${esc(t("act.edit"))}" aria-label="${esc(t("act.edit"))}">${I.edit}</button>
      <button class="ibtn bad" data-act="del" data-id="${s.id}" title="${esc(t("act.delete"))}" aria-label="${esc(t("act.delete"))}">${I.trash}</button>
    </div>
    <div class="dh-meta">
      <div class="kv"><small>${esc(t("d.path"))}</small><code title="${esc(s.path)}">${esc(s.path)}</code></div>
      <div class="kv"><small>${esc(t("d.command"))}</small><code title="${esc(s.command)}">${esc(s.command)}</code></div>
      <div class="kv"><small>${esc(t("d.boot"))}</small><code>${esc(t("d.boot.order", { order: s.order }) + (s.waitAfter ? t("d.boot.wait", { wait: s.waitAfter }) : "") + (s.waitForExit ? t("d.boot.exit") : "") + (s.manual ? t("d.boot.manual") : ""))}</code></div>
      <div class="kv"><small>${esc(t("d.auto"))}</small><code>${esc(autoTxt)}</code></div>
    </div>
    <div class="d-stats">
      <div class="panel"><small>${esc(t("d.mem"))}</small><div class="val" data-m="mem:${s.id}">—</div>${barsEl(`mem:${s.id}`, HIST)}</div>
      <div class="panel"><small>${esc(t("d.cpu"))}</small><div class="val" data-m="cpu:${s.id}">—</div>${barsEl(`cpu:${s.id}`, HIST)}</div>
      <div class="panel list">
        <div class="row-kv"><small>${esc(t("d.uptime"))}</small><b data-upt="${s.id}">—</b></div>
        <div class="row-kv"><small>${esc(t("d.procs"))}</small><b data-m="procs:${s.id}">—</b></div>
        <div class="row-kv"><small>${esc(t("d.pid"))}</small><b>${st.pid ?? "—"}</b></div>
      </div>
    </div>`;
	updateStatsUI();
	tickUptime();
}

function renderMain() {
	if (view !== "overview" && !byId(view)) {
		view = "overview";
	}
	view === "overview" ? renderOverview() : renderDetail();
}
function renderAll() {
	renderSidebar();
	renderMain();
}

let refreshQueued = false;
function refresh() {
	if (refreshQueued) {
		return;
	}
	refreshQueued = true;
	requestAnimationFrame(() => {
		refreshQueued = false;
		renderSidebar();
		view === "overview" ? renderOverview() : renderDetailHead();
	});
}

function updateStatsUI() {
	let tm = 0,
		tc = 0;
	for (const id in stats) {
		tm += stats[id].mem;
		tc += stats[id].cpu;
	}
	document.querySelectorAll("[data-m]").forEach((el) => {
		const v = el.dataset.m,
			i = v.indexOf(":");
		const key = v.slice(0, i),
			id = v.slice(i + 1);
		if (key === "total") {
			el.textContent = id === "mem" ? fmtMem(tm) : pct(tc);
			return;
		}
		const running = getSt(id).state === "running";
		const s = running ? stats[id] : null;
		if (key === "sub") {
			el.textContent = !running ? stateLabel(id) : s ? `${fmtMem(s.mem)} · ${pct(s.cpu)}` : "…";
			return;
		}
		el.textContent = !s ? "—" : key === "cpu" ? pct(s.cpu) : key === "mem" ? fmtMem(s.mem) : s.procs;
	});
	drawBars();
}
function tickUptime() {
	const now = Date.now();
	document.querySelectorAll("[data-upt]").forEach((el) => {
		const st = getSt(el.dataset.upt);
		el.textContent = st.state === "running" ? fmtUp(now - st.startedAt) : "—";
	});
}
setInterval(tickUptime, 1000);

async function startService(id, quiet = false, auto = false) {
	const s = byId(id);
	const cur0 = getSt(id);
	if (!s || cur0.state === "running") {
		return;
	}
	clearTimeout(cur0.timer);
	cur0.timer = null;
	if (!auto) {
		cur0.retries = 0;
	}
	pushLog(id, t(auto ? "log.restarting" : "log.starting", { cmd: s.command, path: s.path }), "sys");
	try {
		await invoke("start_service", { service: s });
	} catch (e) {
		pushLog(id, `✖ ${e}`, "err");
		if (!quiet) {
			toast(`${s.name}: ${e}`, "bad");
		}
		const cur = getSt(id);
		cur.state = "crashed";
		cur.code = null;
		refresh();
	}
}

function stopService(id) {
	const st = getSt(id);
	if (st.state === "restarting") {
		clearTimeout(st.timer);
		st.timer = null;
		st.state = "stopped";
		pushLog(id, t("log.cancelled"), "sys");
		refresh();
		return Promise.resolve();
	}
	return invoke("stop_service", { id });
}

function stagesOf(list) {
	const m = new Map();
	for (const s of [...list].sort(byOrder)) {
		if (!m.has(s.order)) {
			m.set(s.order, []);
		}
		m.get(s.order).push(s);
	}
	return [...m.values()];
}

const exitWaiters = new Map();

async function runOne(s) {
	if (!s.waitForExit) {
		await startService(s.id, true);
		return getSt(s.id).state !== "crashed";
	}
	const done = new Promise((res) => exitWaiters.set(s.id, res));
	await startService(s.id, true);
	const st = getSt(s.id);
	if (st.state === "crashed" && st.code == null) {
		exitWaiters.delete(s.id);
		return false;
	}
	const r = await done;
	return r.code === 0 && !r.stopped;
}

let batchBusy = false;
async function startMany(list) {
	if (batchBusy) {
		return toast(t("toast.batchBusy"));
	}
	const todo = list.filter((s) => !isActive(s.id));
	if (!todo.length) {
		return;
	}
	batchBusy = true;
	const stages = stagesOf(todo);
	let aborted = null;
	try {
		for (let i = 0; i < stages.length; i++) {
			const oks = await Promise.all(stages[i].map(runOne));
			aborted = stages[i].find((s, k) => s.waitForExit && !oks[k]) || null;
			if (aborted) {
				break;
			}
			if (i < stages.length - 1) {
				const wait = waitFor(stages[i]);
				if (wait) {
					await sleep(wait);
				}
			}
		}
	} finally {
		batchBusy = false;
	}
	if (aborted) {
		return toast(t("toast.taskFail", { name: aborted.name }), "bad");
	}
	const failed = todo.filter((s) => getSt(s.id).state === "crashed" && getSt(s.id).code == null);
	if (failed.length) {
		toast(t("toast.batchFail", { n: failed.length }), "bad");
	}
}

function stopMany(list) {
	for (const s of [...list].sort(byOrder).reverse()) {
		if (isActive(s.id)) {
			stopService(s.id);
		}
	}
}

async function restartService(id) {
	await stopService(id);
	for (let i = 0; i < 100 && getSt(id).state === "running"; i++) {
		await sleep(100);
	}
	await startService(id);
}

function openView(v) {
	view = v;
	termFilter = "";
	autoscroll = true;
	renderSidebar();
	renderMain();
}

async function setLang(l) {
	if (!I18N[l] || l === lang) {
		return;
	}
	lang = l;
	localStorage.setItem("orq.lang", l);
	try {
		await invoke("set_lang", { lang: l });
	} catch {}
	applyStatic();
	renderAll();
	if (!$("#modalBack").hidden && $("#cfgOpen")) {
		openSettings();
	}
}

const actions = {
	open: (id) => openView(id),
	start: (id) => startService(id),
	stop: (id) => stopService(id),
	restart: (id) => restartService(id),
	edit: (id) => openEditor(id),
	del: (id) => confirmDelete(id),
	new: () => openEditor(),
	clear: () => {
		logs[view] = [];
		renderTerm();
	},
	startAll: () => startMany(services.filter((s) => !s.manual)),
	stopAll: () => stopMany(services),
	startGroup: (_, el) => startMany(services.filter((s) => groupName(s) === el.dataset.group)),
	stopGroup: (_, el) => stopMany(services.filter((s) => groupName(s) === el.dataset.group)),
	startStage: (_, el) => startMany(services.filter((s) => s.order === Number(el.dataset.order))),
	mode: (_, el) => {
		ovMode = el.dataset.mode;
		localStorage.setItem("orq.ov", ovMode);
		renderOverview();
	},
	toggleGroup: (_, el) => {
		const g = el.dataset.group;
		const closing = !collapsed.has(g);
		closing ? collapsed.add(g) : collapsed.delete(g);
		document.querySelectorAll("[data-group-body]").forEach((b) => {
			if (b.dataset.groupBody === g) {
				b.classList.toggle("closed", closing);
			}
		});
		document.querySelectorAll('[data-act="toggleGroup"]').forEach((h) => {
			if (h.dataset.group === g) {
				h.classList.toggle("collapsed", closing);
				h.setAttribute("aria-expanded", String(!closing));
			}
		});
	},
	theme: (_, __, e) => toggleTheme(e),
	settings: () => openSettings(),
	update: () => openUpdate(),
	io: () => openIO(),
	order: () => openOrder(),
	lang: (_, el) => setLang(el.dataset.lang),
	copyCfg: async () => {
		try {
			await navigator.clipboard.writeText(cfg.path);
			toast(t("toast.pathCopied"), "ok");
		} catch {
			toast(t("toast.copyFail"), "bad");
		}
	},
	close: () => closeModal(),
};

document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-act]");
	if (!el) {
		return;
	}
	const fn = actions[el.dataset.act];
	if (fn) {
		e.stopPropagation();
		fn(el.dataset.id, el, e);
	}
});

let closeTimer = null;
function showModal(html) {
	clearTimeout(closeTimer);
	closeTimer = null;
	const back = $("#modalBack");
	back.classList.remove("closing");
	$("#modal").innerHTML = html;
	back.hidden = false;
	enhanceScroll();
}
function closeModal() {
	const back = $("#modalBack");
	if (back.hidden || back.classList.contains("closing")) {
		return;
	}
	const finish = () => {
		closeTimer = null;
		back.hidden = true;
		back.classList.remove("closing");
		$("#modal").innerHTML = "";
	};
	if (prefersReducedMotion()) {
		finish();
		return;
	}
	back.classList.add("closing");
	closeTimer = setTimeout(finish, 150);
}
$("#modalBack").addEventListener("mousedown", (e) => {
	if (e.target.id === "modalBack") {
		closeModal();
	}
});
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && !$("#modalBack").hidden) {
		closeModal();
	}
});

function toPortable(dir) {
	const norm = (x) => x.replace(/\//g, "\\").replace(/\\+$/, "");
	const r = norm(cfg.root || ""),
		d = norm(dir);
	if (r && (d.toLowerCase() === r.toLowerCase() || d.toLowerCase().startsWith(`${r.toLowerCase()}\\`))) {
		return `{root}${d.slice(r.length)}`;
	}
	return dir;
}

function openEditor(id) {
	const s = id
		? byId(id)
		: {
				id: "",
				name: "",
				path: "",
				command: "",
				kind: "angular",
				group: "",
				env: "",
				order: Math.max(0, ...services.map((x) => x.order)) + 1,
				waitAfter: 0,
				autoRestart: false,
				maxRetries: 5,
				restartDelay: 5,
				waitForExit: false,
				manual: false,
			};
	let kind = s.kind;
	const groups = [...new Set(services.map((x) => (x.group || "").trim()).filter(Boolean))];
	showModal(`
    <div class="m-head">${esc(t(id ? "ed.title.edit" : "ed.title.new"))}</div>
    <div class="m-body">
      <div class="row2">
        <label class="field"><span>${esc(t("ed.name"))}</span><input id="fName" value="${esc(s.name)}" placeholder="${esc(t("ed.name.ph"))}" autocomplete="off" /></label>
        <label class="field"><span>${esc(t("ed.group"))}</span>
          <input id="fGroup" value="${esc(s.group)}" list="groupList" placeholder="${esc(t("ed.group.ph"))}" autocomplete="off" />
          <datalist id="groupList">${groups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
        </label>
      </div>
      <div class="field"><span>${esc(t("ed.kind"))}</span>
        <div class="chips" id="kindChips">
          ${Object.entries(KINDS)
				.map(
					([k, v]) =>
						`<button type="button" class="chip ${k === kind ? "on" : ""}" data-kind="${k}" style="--kc:${v.color}"><b>${v.glyph}</b>${esc(kindLabel(k))}</button>`,
				)
				.join("")}
        </div>
      </div>
      <label class="field"><span>${esc(t("ed.path"))}</span>
        <div class="path-row">
          <input id="fPath" class="mono" value="${esc(s.path)}" placeholder="${esc(t("ed.path.ph"))}" spellcheck="false" />
          <button class="btn" type="button" id="fBrowse">${esc(t("ed.browse"))}</button>
        </div>
        <small>${cfg.root ? t("ed.path.hint.root", { root: esc(cfg.root) }) : t("ed.path.hint.noroot")}</small>
      </label>
      <label class="field"><span>${esc(t("ed.cmd"))}</span>
        <input id="fCmd" class="mono" value="${esc(s.command)}" placeholder="${esc(kindOf(kind).hint)}" spellcheck="false" />
        <small>${t("ed.cmd.hint")}</small>
      </label>
      <label class="field"><span>${esc(t("ed.env"))}</span>
        <textarea id="fEnv" spellcheck="false" placeholder="SPRING_PROFILES_ACTIVE=dev&#10;PORT=8080">${esc(s.env)}</textarea>
        <small>${esc(t("ed.env.hint"))}</small>
      </label>
      <div class="divider"></div>
      <div class="row2">
        <label class="field"><span>${esc(t("ed.order"))}</span>
          <input id="fOrder" type="number" min="1" value="${s.order}" />
          <small>${esc(t("ed.order.hint"))}</small>
        </label>
        <label class="field"><span>${esc(t("ed.wait"))}</span>
          <div class="num"><input id="fWait" type="number" min="0" value="${s.waitAfter}" /><em>s</em></div>
          <small>${esc(t("ed.wait.hint"))}</small>
        </label>
      </div>
      <div class="divider"></div>
      <div class="box">
        <label class="sw strong"><input type="checkbox" id="fWaitExit" ${s.waitForExit ? "checked" : ""} /> ${esc(t("ed.waitExit"))}</label>
        <span class="hint">${esc(t("ed.waitExit.hint"))}</span>
        <label class="sw strong"><input type="checkbox" id="fManual" ${s.manual ? "checked" : ""} /> ${esc(t("ed.manual"))}</label>
        <span class="hint">${esc(t("ed.manual.hint"))}</span>
      </div>
      <div class="divider"></div>
      <div class="box">
        <label class="sw strong"><input type="checkbox" id="fAuto" ${s.autoRestart ? "checked" : ""} /> ${esc(t("ed.auto"))}</label>
        <div class="row2" id="autoOpts">
          <label class="field"><span>${esc(t("ed.max"))}</span>
            <input id="fMax" type="number" min="0" value="${s.maxRetries}" />
            <small>${esc(t("ed.max.hint"))}</small>
          </label>
          <label class="field"><span>${esc(t("ed.delay"))}</span>
            <div class="num"><input id="fDelay" type="number" min="1" value="${s.restartDelay}" /><em>s</em></div>
          </label>
        </div>
        <span class="hint">${esc(t("ed.auto.hint"))}</span>
      </div>
    </div>
    <div class="m-foot">
      <span class="grow"></span>
      <button class="btn ghost" data-act="close">${esc(t("ed.cancel"))}</button>
      <button class="btn primary" id="fSave">${esc(t(id ? "ed.save.edit" : "ed.save.new"))}</button>
    </div>`);

	let lastHint = KINDS[kind]?.hint ?? "";
	$("#kindChips").addEventListener("click", (e) => {
		const b = e.target.closest("[data-kind]");
		if (!b) {
			return;
		}
		kind = b.dataset.kind;
		for (const c of document.querySelectorAll("#kindChips .chip")) {
			c.classList.toggle("on", c === b);
		}
		const hint = kindOf(kind).hint;
		const cmd = $("#fCmd");
		if (!cmd.value.trim() || cmd.value === lastHint) {
			cmd.value = hint;
		}
		cmd.placeholder = hint;
		lastHint = hint;
	});
	const syncAuto = () => {
		const on = $("#fAuto").checked;
		$("#autoOpts").style.opacity = on ? 1 : 0.45;
		for (const i of $("#autoOpts").querySelectorAll("input")) {
			i.disabled = !on;
		}
	};
	$("#fAuto").addEventListener("change", syncAuto);
	syncAuto();
	$("#fBrowse").addEventListener("click", async () => {
		try {
			const dir = await openDialog({ directory: true, multiple: false, title: t("ed.pick") });
			if (dir) {
				$("#fPath").value = toPortable(dir);
			}
		} catch (e) {
			toast(t("err.picker", { e }), "bad");
		}
	});
	$("#fSave").addEventListener("click", async () => {
		const data = {
			id: s.id || crypto.randomUUID(),
			name: $("#fName").value.trim(),
			kind,
			path: $("#fPath").value.trim(),
			command: $("#fCmd").value.trim(),
			group: $("#fGroup").value.trim(),
			env: $("#fEnv").value,
			order: Math.max(1, parseInt($("#fOrder").value, 10) || 1),
			waitAfter: Math.max(0, parseInt($("#fWait").value, 10) || 0),
			autoRestart: $("#fAuto").checked,
			maxRetries: Math.max(0, parseInt($("#fMax").value, 10) || 0),
			restartDelay: Math.max(1, parseInt($("#fDelay").value, 10) || 5),
			waitForExit: $("#fWaitExit").checked,
			manual: $("#fManual").checked,
		};
		if (!data.name) {
			return toast(t("ed.err.name"), "bad");
		}
		if (!data.path) {
			return toast(t("ed.err.path"), "bad");
		}
		if (!data.command) {
			return toast(t("ed.err.cmd"), "bad");
		}
		const i = services.findIndex((x) => x.id === data.id);
		if (i >= 0) {
			services[i] = data;
		} else {
			services.push(data);
		}
		await persist();
		closeModal();
		if (i < 0) {
			view = data.id;
		}
		renderAll();
		toast(t(i >= 0 ? "ed.saved" : "ed.added"), "ok");
	});
	setTimeout(() => $("#fName")?.focus(), 30);
}

function confirmDelete(id) {
	const s = byId(id);
	if (!s) {
		return;
	}
	showModal(`
    <div class="m-head">${esc(t("del.title", { name: s.name }))}</div>
    <p class="m-sub">${esc((isActive(id) ? t("del.running") : "") + t("del.text"))}</p>
    <div class="m-foot">
      <span class="grow"></span>
      <button class="btn ghost" data-act="close">${esc(t("ed.cancel"))}</button>
      <button class="btn danger" id="fDel">${esc(t("del.confirm"))}</button>
    </div>`);
	$("#fDel").addEventListener("click", async () => {
		if (isActive(id)) {
			await stopService(id);
		}
		services = services.filter((x) => x.id !== id);
		delete logs[id];
		delete stats[id];
		delete status[id];
		delete hist[id];
		await persist();
		closeModal();
		view = "overview";
		renderAll();
	});
}

function openOrder() {
	const rows = [...services].sort(byOrder);
	showModal(`
    <div class="m-head">${esc(t("ord.title"))}</div>
    <p class="m-sub">${esc(t("ord.text"))}</p>
    <div class="m-body">
      <div class="ord-top">
        <span>${esc(t("ord.interval"))}</span>
        <div class="seg" id="stagSeg">${STAGGER.map((v) => `<button class="${v === staggerMs ? "on" : ""}" data-ms="${v}">${esc(staggerLabel(v))}</button>`).join("")}</div>
      </div>
      <div class="ord-list">
        <div class="ord-row ord-h"><span>${esc(t("ord.col.order"))}</span><span>${esc(t("ord.col.service"))}</span><span>${esc(t("ord.col.wait"))}</span></div>
        ${rows
			.map(
				(s) => `
          <div class="ord-row" data-id="${s.id}" style="--kc:${kindOf(s.kind).color}">
            <input type="number" min="1" class="o-ord" value="${s.order}" aria-label="${esc(t("ord.aria.order", { name: s.name }))}" />
            <span class="o-nm"><span class="ktile sm">${kindOf(s.kind).glyph}</span><span class="nm">${esc(s.name)}</span></span>
            <input type="number" min="0" class="o-wait" value="${s.waitAfter}" aria-label="${esc(t("ord.aria.wait", { name: s.name }))}" />
          </div>`,
			)
			.join("")}
      </div>
    </div>
    <div class="m-foot">
      <button class="btn ghost" id="oSeq">${esc(t("ord.seq"))}</button>
      <span class="grow"></span>
      <button class="btn ghost" data-act="close">${esc(t("ed.cancel"))}</button>
      <button class="btn primary" id="oSave">${esc(t("ord.save"))}</button>
    </div>`);

	$("#stagSeg").addEventListener("click", (e) => {
		const b = e.target.closest("[data-ms]");
		if (!b) {
			return;
		}
		staggerMs = Number(b.dataset.ms);
		localStorage.setItem("orq.stagger", staggerMs);
		for (const x of document.querySelectorAll("#stagSeg button")) {
			x.classList.toggle("on", x === b);
		}
	});
	$("#oSeq").addEventListener("click", () => {
		[...document.querySelectorAll(".ord-list .ord-row[data-id]")]
			.map((el, i) => ({ el, i, v: Number(el.querySelector(".o-ord").value) || 0 }))
			.sort((a, b) => a.v - b.v || a.i - b.i)
			.forEach((x, n) => {
				x.el.querySelector(".o-ord").value = n + 1;
				x.el.parentNode.appendChild(x.el);
			});
	});
	$("#oSave").addEventListener("click", async () => {
		document.querySelectorAll(".ord-row[data-id]").forEach((el) => {
			const s = byId(el.dataset.id);
			if (!s) {
				return;
			}
			s.order = Math.max(1, parseInt(el.querySelector(".o-ord").value, 10) || 1);
			s.waitAfter = Math.max(0, parseInt(el.querySelector(".o-wait").value, 10) || 0);
		});
		await persist();
		closeModal();
		renderAll();
		toast(t("ord.saved"), "ok");
	});
}

async function reloadFromDisk() {
	cfg = await invoke("get_config_info");
	try {
		services = (await invoke("load_services")).map(normalize);
	} catch (e) {
		services = [];
		toast(String(e), "bad");
	}
	view = "overview";
	renderAll();
}

function openSettings() {
	const jsonFilter = [{ name: t("set.pick.filter"), extensions: ["json"] }];
	showModal(`
    <div class="m-head">${esc(t("set.title"))}</div>
    <div class="m-body">
      <section class="sect">
        <div class="sect-h"><h3>${esc(t("set.lang"))}</h3>
          <div class="seg">${LANGS.map(([code, name]) => `<button class="${code === lang ? "on" : ""}" data-act="lang" data-lang="${code}">${esc(name)}</button>`).join("")}</div>
        </div>
      </section>

      <section class="sect">
        <div class="sect-h"><h3>${esc(t("set.file"))}</h3><span class="tag ${cfg.custom ? "on" : ""}">${esc(cfg.custom ? t("set.shared") : t("set.default"))}</span></div>
        <p class="sect-p">${esc(t("set.file.text"))}</p>
        <div class="pathbox"><code title="${esc(cfg.path)}">${esc(cfg.path)}</code><button class="ibtn sm" data-act="copyCfg" title="${esc(t("set.copyPath"))}" aria-label="${esc(t("set.copyPath"))}">${I.copy}</button></div>
        <div class="btn-row">
          <button class="btn" id="cfgOpen">${esc(t("set.useOther"))}</button>
          <button class="btn" id="cfgNew">${esc(t("set.createNew"))}</button>
          ${cfg.custom ? `<button class="btn ghost" id="cfgReset">${esc(t("set.reset"))}</button>` : ""}
        </div>
      </section>

      <section class="sect">
        <h3>${esc(t("set.root"))}</h3>
        <p class="sect-p">${t("set.root.text")}</p>
        <div class="path-row">
          <input id="cfgRoot" class="mono" value="${esc(cfg.root)}" placeholder="${esc(t("set.root.ph"))}" spellcheck="false" aria-label="${esc(t("set.root"))}" />
          <button class="btn" id="cfgRootBrowse">${esc(t("ed.browse"))}</button>
        </div>
      </section>

      <section class="sect">
        <h3>${esc(t("set.io"))}</h3>
        <p class="sect-p">${esc(t("set.io.text"))}</p>
        <div class="btn-row"><button class="btn" data-act="io">${esc(t("set.io.open"))}</button></div>
      </section>

      <section class="sect">
        <div class="sect-h"><h3>${esc(t("upd.sect"))}</h3><span class="tag">${esc(appInfo.version)}</span></div>
        <label class="sw"><input type="checkbox" id="updAuto" ${appInfo.autoUpdate ? "checked" : ""} /> ${esc(t("upd.auto"))}</label>
        <div class="btn-row">
          <button class="btn" id="updCheck">${esc(t("upd.check"))}</button>
          ${pendingUpdate ? `<button class="btn primary" data-act="update">${esc(t("upd.badge"))}</button>` : ""}
        </div>
      </section>
    </div>
    <div class="m-foot"><span class="grow"></span><button class="btn primary" data-act="close">${esc(t("set.done"))}</button></div>`);

	const guard = () => {
		if (anyActive()) {
			toast(t("set.guard"), "bad");
			return false;
		}
		return true;
	};

	$("#cfgOpen").addEventListener("click", async () => {
		if (!guard()) {
			return;
		}
		try {
			const f = await openDialog({
				multiple: false,
				directory: false,
				filters: jsonFilter,
				title: t("set.pick.file"),
			});
			if (!f) {
				return;
			}
			await invoke("set_config_path", { path: f });
			await reloadFromDisk();
			closeModal();
			toast(t("set.loaded"), "ok");
		} catch (e) {
			toast(String(e), "bad");
		}
	});
	$("#cfgNew").addEventListener("click", async () => {
		if (!guard()) {
			return;
		}
		try {
			const f = await saveDialog({
				defaultPath: "orchestra-servicos.json",
				filters: jsonFilter,
				title: t("set.create.title"),
			});
			if (!f) {
				return;
			}
			await invoke("set_config_path", { path: f });
			await persist();
			cfg = await invoke("get_config_info");
			closeModal();
			renderAll();
			toast(t("set.created"), "ok");
		} catch (e) {
			toast(String(e), "bad");
		}
	});
	$("#cfgReset")?.addEventListener("click", async () => {
		if (!guard()) {
			return;
		}
		try {
			await invoke("set_config_path", { path: null });
			await reloadFromDisk();
			closeModal();
			toast(t("set.resetDone"), "ok");
		} catch (e) {
			toast(String(e), "bad");
		}
	});

	const saveRoot = async (value) => {
		try {
			await invoke("set_root", { root: value });
			cfg.root = value.trim();
		} catch (e) {
			toast(String(e), "bad");
		}
	};
	$("#updAuto").addEventListener("change", async (e) => {
		appInfo.autoUpdate = e.target.checked;
		try {
			await invoke("set_auto_update", { enabled: appInfo.autoUpdate });
		} catch (err) {
			toast(String(err), "bad");
		}
	});
	$("#updCheck").addEventListener("click", async (e) => {
		const btn = e.currentTarget;
		btn.disabled = true;
		btn.textContent = t("upd.checking");
		const found = await checkUpdate(false);
		if (found) {
			openUpdate();
		} else {
			btn.disabled = false;
			btn.textContent = t("upd.check");
		}
	});

	$("#cfgRoot").addEventListener("change", (e) => saveRoot(e.target.value));
	$("#cfgRootBrowse").addEventListener("click", async () => {
		try {
			const dir = await openDialog({ directory: true, multiple: false, title: t("set.root.pick") });
			if (dir) {
				$("#cfgRoot").value = dir;
				await saveRoot(dir);
			}
		} catch (e) {
			toast(String(e), "bad");
		}
	});
}

let appInfo = { version: "", autoUpdate: true };
let pendingUpdate = null;

async function checkUpdate(silent) {
	try {
		pendingUpdate = await invoke("check_update");
	} catch (e) {
		if (!silent) {
			toast(String(e), "bad");
		}
		return null;
	}
	$("#btnUpdate").hidden = !pendingUpdate;
	if (!pendingUpdate && !silent) {
		toast(t("upd.none"), "ok");
	}
	return pendingUpdate;
}

function openUpdate() {
	const u = pendingUpdate;
	if (!u) {
		return;
	}
	showModal(`
    <div class="m-head">${esc(t("upd.title", { v: u.version }))}</div>
    <p class="m-sub">${esc(t("upd.text", { cur: u.current }))}${anyActive() ? ` ${esc(t("upd.running"))}` : ""}</p>
    <div class="m-body">
      ${u.notes ? `<section class="sect"><h3>${esc(t("upd.notes"))}</h3><pre class="upd-notes">${esc(u.notes)}</pre></section>` : ""}
      <div class="upd-bar" id="updBar" hidden><i id="updFill"></i></div>
    </div>
    <div class="m-foot">
      <button class="btn ghost" data-act="close" id="updLater">${esc(t("upd.later"))}</button>
      <span class="grow"></span>
      <button class="btn primary" id="updGo">${esc(t("upd.install"))}</button>
    </div>`);
	$("#updGo").addEventListener("click", async (e) => {
		const btn = e.currentTarget;
		btn.disabled = true;
		$("#updLater").disabled = true;
		$("#updBar").hidden = false;
		btn.textContent = t("upd.downloading", { p: "" });
		try {
			await invoke("install_update");
		} catch (err) {
			toast(String(err), "bad");
			btn.disabled = false;
			$("#updLater").disabled = false;
			btn.textContent = t("upd.install");
		}
	});
}

listen("update-progress", (e) => {
	const { got, total } = e.payload;
	const fill = $("#updFill"),
		btn = $("#updGo");
	if (!fill || !btn) {
		return;
	}
	const pct = total ? Math.min(100, Math.round((got / total) * 100)) : 0;
	fill.style.width = `${total ? pct : 100}%`;
	btn.textContent = t("upd.downloading", { p: total ? `${pct}%` : fmtMem(got) });
});

function openResume(list) {
	const rows = [...list].sort(byOrder);
	showModal(`
    <div class="m-head">${esc(t("res.title"))}</div>
    <p class="m-sub">${esc(t("res.text"))}</p>
    <div class="m-body">
      <div class="res-list">
        ${rows
			.map(
				(s) => `
          <label class="res-row" style="--kc:${kindOf(s.kind).color}">
            <span class="ktile sm">${kindOf(s.kind).glyph}</span>
            <span class="nm">${esc(s.name)}</span>
            <span class="grow"></span>
            <span class="sw"><input type="checkbox" checked data-id="${s.id}" aria-label="${esc(t("res.aria", { name: s.name }))}" /></span>
          </label>`,
			)
			.join("")}
      </div>
    </div>
    <div class="m-foot">
      <button class="btn ghost" id="resSkip">${esc(t("res.skip"))}</button>
      <span class="grow"></span>
      <button class="btn primary" id="resGo"></button>
    </div>`);

	const selected = () => [...document.querySelectorAll(".res-row input:checked")].map((i) => i.dataset.id);
	const sync = () => {
		const n = selected().length;
		const go = $("#resGo");
		go.textContent = n === 1 ? t("res.one") : t("res.many", { n });
		go.disabled = n === 0;
	};
	document.querySelector(".res-list").addEventListener("change", sync);
	sync();
	$("#resSkip").addEventListener("click", closeModal);
	$("#resGo").addEventListener("click", () => {
		const ids = new Set(selected());
		closeModal();
		startMany(services.filter((s) => ids.has(s.id)));
	});
}

function openIO() {
	showModal(`
    <div class="m-head">${esc(t("io.title"))}</div>
    <p class="m-sub">${esc(t("io.text"))}</p>
    <div class="m-body">
      <label class="field"><span>${esc(t("io.field"))}</span>
        <textarea id="ioText" spellcheck="false" style="height:280px">${esc(JSON.stringify({ version: 1, services }, null, 2))}</textarea>
      </label>
    </div>
    <div class="m-foot">
      <button class="btn ghost" id="ioCopy">${esc(t("io.copy"))}</button>
      <span class="grow"></span>
      <button class="btn ghost" data-act="close">${esc(t("io.close"))}</button>
      <button class="btn primary" id="ioImport">${esc(t("io.import"))}</button>
    </div>`);
	$("#ioCopy").addEventListener("click", async () => {
		try {
			await navigator.clipboard.writeText($("#ioText").value);
			toast(t("io.copied"), "ok");
		} catch {
			$("#ioText").select();
			toast(t("io.manual"));
		}
	});
	$("#ioImport").addEventListener("click", async () => {
		try {
			const parsed = JSON.parse($("#ioText").value);
			const arr = Array.isArray(parsed) ? parsed : parsed.services;
			if (!Array.isArray(arr)) {
				throw new Error(t("io.format"));
			}
			let n = 0;
			for (const x of arr) {
				if (!x?.name || !x.path || !x.command) {
					continue;
				}
				const item = normalize(x, services.length + n);
				const i = services.findIndex((s) => s.id === item.id);
				if (i >= 0) {
					services[i] = item;
				} else {
					services.push(item);
				}
				n++;
			}
			await persist();
			closeModal();
			renderAll();
			toast(t("io.imported", { n }), "ok");
		} catch (e) {
			toast(t("io.invalid", { e: e.message }), "bad");
		}
	});
}

listen("logs", (e) => {
	for (const l of e.payload) {
		const text = l.text.replace(ANSI, "");
		pushLog(l.id, text, classify(text, l.err));
	}
});

listen("status", (e) => {
	const p = e.payload,
		st = getSt(p.id),
		s = byId(p.id);
	if (p.running) {
		clearTimeout(st.timer);
		st.timer = null;
		delete hist[p.id];
		Object.assign(st, { state: "running", pid: p.pid, code: null, startedAt: Date.now() });
	} else {
		const waiter = exitWaiters.get(p.id);
		if (waiter) {
			exitWaiters.delete(p.id);
			waiter({ code: p.code, stopped: p.stopped });
		}
		const ranFor = st.startedAt ? Date.now() - st.startedAt : 0;
		const failed = !p.stopped && p.code !== 0;
		Object.assign(st, { pid: null, code: p.code });
		delete stats[p.id];
		pushTotals();
		if (!failed) {
			st.state = "stopped";
			pushLog(p.id, p.stopped ? t("log.stopped") : t("log.exit0"), "sys");
		} else {
			st.state = "crashed";
			pushLog(p.id, p.code != null ? t("log.exitCode", { code: p.code }) : t("log.exit"), "err");
			if (s?.autoRestart) {
				scheduleRestart(s, st, ranFor);
			}
		}
	}
	refresh();
});

function scheduleRestart(s, st, ranFor) {
	if (ranFor > 60000) {
		st.retries = 0;
	}
	const max = s.maxRetries || 0;
	if (max > 0 && st.retries >= max) {
		pushLog(s.id, t("log.limit", { n: max }), "err");
		toast(t("toast.limit", { name: s.name }), "bad");
		return;
	}
	st.retries++;
	const delay = Math.max(1, s.restartDelay || 5);
	st.state = "restarting";
	pushLog(s.id, t("log.restartIn", { s: delay, try: `${st.retries}${max ? `/${max}` : ""}` }), "warn");
	st.timer = setTimeout(() => {
		st.timer = null;
		startService(s.id, true, true);
	}, delay * 1000);
}

listen("stats", (e) => {
	for (const s of e.payload) {
		stats[s.id] = s;
		if (!hist[s.id]) {
			hist[s.id] = { cpu: [], mem: [] };
		}
		const h = hist[s.id];
		pushCap(h.cpu, s.cpu);
		pushCap(h.mem, s.mem);
	}
	pushTotals();
	updateStatsUI();
});

function applyServices(list) {
	const ids = new Set(list.map((s) => s.id));
	for (const s of services) {
		if (!ids.has(s.id) && isActive(s.id)) {
			stopService(s.id);
		}
	}
	services = list;
	renderAll();
}

let checking = false,
	lastBad = 0;
async function checkExternal() {
	if (checking || !$("#modalBack").hidden) {
		return;
	}
	checking = true;
	try {
		const m = await invoke("config_mtime");
		if (!m) {
			return;
		}
		if (!cfg.mtime) {
			cfg.mtime = m;
			return;
		}
		if (m !== cfg.mtime) {
			try {
				const list = (await invoke("load_services")).map(normalize);
				cfg.mtime = m;
				applyServices(list);
				toast(t("toast.reloaded"), "ok");
			} catch (e) {
				if (m !== lastBad) {
					lastBad = m;
					toast(t("toast.badFile", { e }), "bad");
				}
			}
		}
	} catch {
	} finally {
		checking = false;
	}
}
setInterval(() => {
	if (!document.hidden) {
		checkExternal();
	}
}, 4000);
window.addEventListener("focus", checkExternal);

enhanceScroll();
$("#navIc").innerHTML = I.grid;
$("#searchIc").innerHTML = I.search;
$("#btnSettings").innerHTML = I.sliders;
applyStatic();
applyTheme(
	localStorage.getItem("orq.theme") ||
		(window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark"),
);

$("#navOverview").addEventListener("click", () => openView("overview"));
$("#btnNew").addEventListener("click", () => openEditor());
$("#wMin").addEventListener("click", () => appWin.minimize());
$("#wMax").addEventListener("click", () => appWin.toggleMaximize());
$("#wClose").addEventListener("click", () => appWin.close());

let st0;
$("#search").addEventListener("input", (e) => {
	clearTimeout(st0);
	st0 = setTimeout(() => {
		search = e.target.value;
		renderSidebar();
		if (view === "overview") {
			renderOverview();
		}
	}, 120);
});

(async function init() {
	try {
		const saved = await invoke("get_lang");
		if (saved && I18N[saved]) {
			if (saved !== lang) {
				lang = saved;
				localStorage.setItem("orq.lang", lang);
				applyStatic();
			}
		} else {
			await invoke("set_lang", { lang });
		}
	} catch {}
	try {
		cfg = await invoke("get_config_info");
	} catch (e) {
		toast(t("toast.cfgErr", { e }), "bad");
	}
	try {
		services = (await invoke("load_services")).map(normalize);
		const running = await invoke("get_running");
		for (const r of running) {
			Object.assign(getSt(r.id), { state: "running", pid: r.pid, startedAt: Date.now() });
		}
	} catch (e) {
		toast(String(e), "bad");
	}
	renderAll();

	try {
		const ids = await invoke("take_last_session");
		const list = services.filter((s) => ids.includes(s.id) && !isActive(s.id));
		if (list.length) {
			openResume(list);
		}
	} catch {}

	try {
		appInfo = await invoke("get_app_info");
	} catch {}
	if (appInfo.autoUpdate) {
		setTimeout(() => checkUpdate(true), 4000);
		setInterval(
			() => {
				if (appInfo.autoUpdate) {
					checkUpdate(true);
				}
			},
			6 * 60 * 60 * 1000,
		);
	}
})();
