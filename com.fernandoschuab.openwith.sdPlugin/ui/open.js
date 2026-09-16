/* Property Inspector — Abrir Com
 * Protocolo padrão do Stream Deck (connectElgatoStreamDeckSocket), sem dependências. */
(function () {
	"use strict";

	const $ = (id) => document.getElementById(id);
	const el = (tag, cls, html) => {
		const n = document.createElement(tag);
		if (cls) n.className = cls;
		if (html != null) n.innerHTML = html;
		return n;
	};
	const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

	/* ------------------------------------------------------------ estado */
	let ws = null;
	let ctx = null;
	let actionUUID = null;
	const state = {
		settings: {},
		home: "",
		apps: [],
		appsLoaded: false,
		appsLoading: false,
		icons: {},
		pathStatus: {},
		filter: "",
		active: 0,
		niAuto: false,
		lang: "en",
		langPref: "auto",
		autoLang: null,
		gotGlobal: false,
		gotEnv: false,
		platform: /win/i.test(navigator.platform || navigator.userAgent || "") ? "windows" : "mac",
	};
	const isWin = () => state.platform === "windows";

	/* ------------------------------------------------------------ i18n */
	const DICT = window.OW_I18N || {};
	const LANGS = ["pt", "en", "es"];
	const toLang = (code) => {
		const b = String(code || "").toLowerCase().split(/[-_]/)[0];
		return LANGS.includes(b) ? b : null;
	};
	function t(key, vars) {
		const d = DICT[state.lang] || DICT.en || {};
		let str = d[key] != null ? d[key] : (DICT.en && DICT.en[key]) != null ? DICT.en[key] : key;
		if (vars) for (const k in vars) str = str.split("{" + k + "}").join(vars[k]);
		return str;
	}
	function applyI18n() {
		document.documentElement.lang = state.lang === "pt" ? "pt-BR" : state.lang;
		document.querySelectorAll("[data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
		document.querySelectorAll("[data-i18n-html]").forEach((n) => (n.innerHTML = t(n.dataset.i18nHtml)));
		document.querySelectorAll("[data-i18n-ph]").forEach((n) => {
			const k = n.dataset.i18nPh;
			n.placeholder = t(isWin() && k === "pathPh" ? "pathPhWin" : k);
		});
		document.body.classList.toggle("platform-windows", isWin());
		document.querySelectorAll("[data-i18n-title]").forEach((n) => (n.title = t(n.dataset.i18nTitle)));
		const sel = $("langSel");
		if (sel) {
			const autoName = state.autoLang && DICT[state.autoLang] ? DICT[state.autoLang].langName : "—";
			sel.options[0].textContent = t("langAuto", { lang: autoName });
			sel.value = state.langPref;
		}
		renderAll();
		if (!$("appPop").hidden) renderAppList();
	}
	function setLang(pref, auto) {
		state.langPref = LANGS.includes(pref) ? pref : "auto";
		if (auto) state.autoLang = auto;
		state.lang = state.langPref !== "auto" ? state.langPref : state.autoLang || "en";
		applyI18n();
	}

	const LS_KEY = "openwith.autoLang";
	function cachedAutoLang() {
		try { return toLang(localStorage.getItem(LS_KEY)); } catch (e) { return null; }
	}
	function cacheAutoLang(l) {
		try { localStorage.setItem(LS_KEY, l); } catch (e) { /* ignore */ }
	}
	/** Palpite inicial (antes da resposta do plugin): cache > idiomas do navegador > idioma do Stream Deck. */
	function guessLang(sdLang) {
		const cached = cachedAutoLang();
		if (cached) return cached;
		const list = [].concat(navigator.languages || [], navigator.language || []);
		for (const l of list) {
			const g = toLang(l);
			if (g) return g;
		}
		return toLang(sdLang) || "en";
	}

	const DEFAULTS = { paths: [], mode: "separate", newInstance: false, delay: 300, useAppIcon: true };
	/** Configurações da tecla com os padrões (cópia profunda: nada compartilhado entre leituras). */
	const withDefaults = (s) => {
		const out = Object.assign({}, DEFAULTS, JSON.parse(JSON.stringify(s || {})));
		out.paths = Array.isArray(out.paths) ? out.paths.filter((p) => typeof p === "string") : [];
		return out;
	};
	const S = () => state.settings;

	/* ------------------------------------------------------------ conexão */
	window.connectElgatoStreamDeckSocket = function (port, uuid, registerEvent, info, actionInfo) {
		ctx = uuid;
		try {
			const inf = typeof info === "string" ? JSON.parse(info) : info;
			state.lang = state.autoLang = guessLang(inf && inf.application && inf.application.language);
			const plat = inf && inf.application && inf.application.platform;
			if (plat) state.platform = /win/i.test(plat) ? "windows" : "mac";
		} catch (e) { /* ignore */ }
		try {
			const ai = typeof actionInfo === "string" ? JSON.parse(actionInfo) : actionInfo;
			actionUUID = ai.action;
			state.settings = withDefaults(ai.payload && ai.payload.settings);
		} catch (e) {
			state.settings = withDefaults();
		}
		applyI18n();

		ws = new WebSocket("ws://127.0.0.1:" + port);
		ws.onopen = () => {
			ws.send(JSON.stringify({ event: registerEvent, uuid }));
			send({ event: "getGlobalSettings", context: ctx });
			// O plugin pode ainda não conhecer esta tecla (ex.: tecla recém-colada);
			// repete o "hello" até receber o ambiente.
			let tries = 0;
			const hello = () => {
				if (state.gotEnv) return;
				if (tries++ >= 25) {
					toast(t("noPlugin"), "err");
					return;
				}
				send({ event: "sendToPlugin", action: actionUUID, context: ctx, payload: { cmd: "hello" } });
				setTimeout(hello, tries < 10 ? 500 : 1500);
			};
			hello();
			checkPaths();
			if (S().appPath && !state.icons[S().appPath]) toPlugin({ cmd: "appInfo", appPath: S().appPath });
		};
		ws.onmessage = (m) => {
			let msg;
			try { msg = JSON.parse(m.data); } catch { return; }
			if (msg.event === "didReceiveSettings") {
				state.settings = withDefaults(msg.payload.settings);
				renderAll();
			} else if (msg.event === "didReceiveGlobalSettings") {
				const g = (msg.payload && msg.payload.settings) || {};
				state.gotGlobal = true;
				setLang(g.language);
			} else if (msg.event === "sendToPropertyInspector") {
				onPluginMessage(msg.payload || {});
			}
		};
	};

	function send(obj) {
		if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
	}
	/** Pedidos feitos antes de o plugin responder ficam na fila (senão seriam perdidos). */
	const queue = [];
	function toPlugin(payload) {
		if (!state.gotEnv && payload.cmd !== "hello") {
			queue.push(payload);
			return;
		}
		send({ event: "sendToPlugin", action: actionUUID, context: ctx, payload });
	}
	function flushQueue() {
		while (queue.length) toPlugin(queue.shift());
	}

	let saveTimer = 0;
	function save(immediate) {
		clearTimeout(saveTimer);
		const go = () => send({ event: "setSettings", context: ctx, payload: S() });
		if (immediate) go();
		else saveTimer = setTimeout(go, 120);
		renderPreview();
	}

	function checkPaths() {
		const paths = S().paths || [];
		if (paths.length) toPlugin({ cmd: "checkPaths", paths });
	}

	/* ------------------------------------------------------------ mensagens do plugin */
	const pending = {};
	function onPluginMessage(p) {
		switch (p.type) {
			case "env":
				state.home = p.home || "";
				state.gotEnv = true;
				if (p.platform) state.platform = p.platform === "windows" ? "windows" : "mac";
				if (p.autoLang) {
					state.autoLang = toLang(p.autoLang) || state.autoLang;
					cacheAutoLang(state.autoLang);
				}
				setLang(state.gotGlobal ? state.langPref : p.langPref || state.langPref);
				flushQueue();
				break;
			case "apps":
				state.apps = p.apps || [];
				state.appsLoaded = true;
				state.appsLoading = false;
				$("appReload").classList.remove("spin");
				renderAppList();
				break;
			case "icons":
				Object.assign(state.icons, p.icons || {});
				updateListIcons(p.icons || {});
				if (S().appPath && p.icons && p.icons[S().appPath]) renderApp();
				break;
			case "appInfo":
				if (p.icon) state.icons[p.app.path] = p.icon;
				renderApp();
				break;
			case "picked":
				setBusy(p.kind, false);
				if (p.kind === "app") {
					if (p.app) {
						if (p.icon) state.icons[p.app.path] = p.icon;
						if (!state.apps.some((a) => a.path === p.app.path)) state.apps.push(p.app);
						chooseApp(p.app);
					}
				} else if (p.paths && p.paths.length) {
					addPaths(p.paths);
				}
				break;
			case "pathStatus":
				Object.assign(state.pathStatus, p.status || {});
				renderPaths();
				break;
			case "ran":
				setTestBusy(false);
				break;
			case "error":
				if (p.cmd === "pick") ["folder", "file", "app"].forEach((k) => setBusy(k, false));
				if (p.cmd === "run") setTestBusy(false);
				toast(t("error", { msg: p.message }), "err");
				break;
		}
	}

	/* ------------------------------------------------------------ util de exibição */
	function tilde(p) {
		const h = state.home;
		if (!h) return p;
		if (isWin()) {
			const lp = p.toLowerCase();
			const lh = h.toLowerCase();
			if (lp === lh || lp.startsWith(lh + "\\")) return "~" + p.slice(h.length);
			return p;
		}
		if (p === h || p.startsWith(h + "/")) return "~" + p.slice(h.length);
		return p;
	}
	const isRoot = (p) => p === "/" || /^[A-Za-z]:[\\/]?$/.test(p) || /^\\\\[^\\]+\\[^\\]+\\?$/.test(p);
	function splitPath(p) {
		const clean = isRoot(p) ? p : p.replace(/[\\/]+$/, "");
		const i = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
		if (i < 0 || isRoot(clean)) return { name: clean, dir: "" };
		let dir = clean.slice(0, i);
		if (!dir) dir = clean.charAt(0) === "\\" ? "\\" : "/";
		else if (/^[A-Za-z]:$/.test(dir)) dir += "\\";
		return { name: clean.slice(i + 1) || clean, dir };
	}
	function hue(name) {
		let h = 0;
		for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
		return h;
	}
	function avatar(name) {
		const h = hue(name || "?");
		const a = el("span", "avatar");
		a.style.background = `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 70% 42%))`;
		a.textContent = (name || "?").trim().charAt(0).toUpperCase();
		return a;
	}
	function iconNode(app, cls) {
		const src = state.icons[app.path];
		if (src) {
			const img = el("img");
			img.src = src;
			img.alt = "";
			img.draggable = false;
			return img;
		}
		const a = avatar(app.name);
		if (cls) a.classList.add(cls);
		return a;
	}

	const FOLDER_SVG =
		'<svg viewBox="0 0 20 20"><path fill="#5aa9f5" d="M2 5.2C2 4.5 2.5 4 3.2 4h4.1l1.6 1.6h7.9c.7 0 1.2.5 1.2 1.2v8c0 .7-.5 1.2-1.2 1.2H3.2C2.5 16 2 15.5 2 14.8z"/><path fill="#8cc7ff" d="M2 7.4c0-.6.5-1 1-1h14c.6 0 1 .4 1 1v7.4c0 .7-.5 1.2-1.2 1.2H3.2C2.5 16 2 15.5 2 14.8z"/></svg>';
	const FILE_SVG =
		'<svg viewBox="0 0 20 20"><path fill="#d9d9d9" d="M5 2.5h6.5L15.5 6.5V16.3c0 .7-.5 1.2-1.2 1.2H5.2c-.7 0-1.2-.5-1.2-1.2V3.7c0-.7.5-1.2 1.2-1.2z"/><path fill="#a9a9a9" d="M11.5 2.5v3c0 .6.4 1 1 1h3z"/><path stroke="#9a9a9a" stroke-width="1" d="M6.5 10h6M6.5 12.5h6M6.5 15h4"/></svg>';
	const MISSING_SVG =
		'<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.5" fill="#ff7a7a"/><path stroke="#2d2d2d" stroke-width="1.8" stroke-linecap="round" d="M10 6v5M10 13.8v.2"/></svg>';

	/* ------------------------------------------------------------ app */
	function renderApp() {
		const s = S();
		const btn = $("appBtn");
		const iconBox = $("appIcon");
		iconBox.innerHTML = "";
		if (s.appPath) {
			const name = s.appName || splitPath(s.appPath).name.replace(/\.app$/i, "");
			btn.classList.remove("is-empty");
			$("appName").textContent = name;
			$("appSub").textContent = "‎" + tilde(s.appPath);
			iconBox.appendChild(iconNode({ name, path: s.appPath }));
		} else {
			btn.classList.add("is-empty");
			$("appName").textContent = t("chooseApp");
			$("appSub").textContent = t("chooseAppSub");
			const ph = el("span", "avatar placeholder", '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>');
			iconBox.appendChild(ph);
		}
	}

	function openPop() {
		$("appPop").hidden = false;
		$("appBtn").setAttribute("aria-expanded", "true");
		state.filter = "";
		$("appSearch").value = "";
		if (!state.appsLoaded && !state.appsLoading) loadApps(false);
		renderAppList(true);
		setTimeout(() => $("appSearch").focus(), 0);
	}
	function closePop(focusBtn) {
		$("appPop").hidden = true;
		$("appBtn").setAttribute("aria-expanded", "false");
		if (focusBtn) $("appBtn").focus();
	}
	function loadApps(force) {
		state.appsLoading = true;
		$("appReload").classList.add("spin");
		toPlugin({ cmd: "listApps", force: !!force });
		renderAppList();
	}

	function filteredApps() {
		const q = fold(state.filter.trim());
		if (!q) return state.apps;
		const starts = [];
		const contains = [];
		for (const a of state.apps) {
			const n = fold(a.name);
			if (n.startsWith(q)) starts.push(a);
			else if (n.includes(q)) contains.push(a);
		}
		return starts.concat(contains);
	}

	function highlight(name) {
		const q = fold(state.filter.trim());
		if (!q) return esc(name);
		const i = fold(name).indexOf(q);
		if (i < 0) return esc(name);
		return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + q.length)) + "</mark>" + esc(name.slice(i + q.length));
	}

	function renderAppList(scrollToSelected) {
		const ul = $("appList");
		ul.innerHTML = "";
		if (!state.appsLoaded) {
			for (let i = 0; i < 6; i++) {
				const li = el("li", "skeleton", '<span class="ico"></span><span class="nm" style="max-width:' + (40 + ((i * 37) % 45)) + '%"></span>');
				ul.appendChild(li);
			}
			return;
		}
		const list = filteredApps();
		if (!list.length) {
			ul.appendChild(el("li", "msg", t("noApps")));
			return;
		}
		if (state.active >= list.length) state.active = list.length - 1;
		if (state.active < 0) state.active = 0;
		list.forEach((a, i) => {
			const li = el("li");
			li.setAttribute("role", "option");
			li.dataset.path = a.path;
			li.dataset.index = i;
			if (a.path === S().appPath) li.classList.add("selected");
			if (i === state.active) li.classList.add("active");
			const ico = el("span", "ico");
			ico.appendChild(iconNode(a));
			li.appendChild(ico);
			li.appendChild(el("span", "nm", highlight(a.name)));
			if (a.electron && !isWin()) li.appendChild(el("span", "tag", "Electron"));
			li.appendChild(el("span", "check", '<svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7"/></svg>'));
			li.title = a.path;
			li.addEventListener("mousemove", () => setActive(i, false));
			li.addEventListener("click", () => chooseApp(a));
			ul.appendChild(li);
		});
		if (scrollToSelected && S().appPath && !state.filter) {
			const idx = list.findIndex((a) => a.path === S().appPath);
			if (idx >= 0) setActive(idx, true, "center");
		}
	}

	function updateListIcons(icons) {
		const ul = $("appList");
		for (const path in icons) {
			const li = ul.querySelector('li[data-path="' + CSS.escape(path) + '"] .ico');
			if (li) {
				li.innerHTML = "";
				const img = el("img");
				img.src = icons[path];
				img.alt = "";
				li.appendChild(img);
			}
		}
	}

	function setActive(i, scroll, block) {
		const ul = $("appList");
		const items = ul.querySelectorAll("li[data-path]");
		if (!items.length) return;
		i = Math.max(0, Math.min(items.length - 1, i));
		if (i === state.active && !scroll) return;
		const prev = ul.querySelector("li.active");
		if (prev) prev.classList.remove("active");
		state.active = i;
		items[i].classList.add("active");
		if (scroll) items[i].scrollIntoView({ block: block || "nearest" });
	}

	function chooseApp(app) {
		const s = S();
		const changed = s.appPath !== app.path;
		s.appPath = app.path;
		s.appName = app.name;
		if (changed) {
			s.newInstance = isWin() ? false : !!app.electron;
			state.niAuto = !isWin();
		}
		save(true);
		closePop(true);
		renderAll();
		if (!state.icons[app.path]) toPlugin({ cmd: "appInfo", appPath: app.path });
	}

	/* ------------------------------------------------------------ caminhos */
	function cleanPath(p) {
		let out = String(p).trim().replace(/^["']|["']$/g, "");
		if (/^file:\/\//i.test(out)) {
			try {
				const u = new URL(out);
				out = decodeURIComponent(u.pathname);
				if (isWin()) {
					out = out.replace(/^\/([A-Za-z]:)/, "$1").replace(/\//g, "\\");
					if (u.host) out = "\\\\" + u.host + out;
				}
			} catch (e) { /* ignore */ }
		}
		if (isWin()) {
			out = out.replace(/\//g, "\\");
			if (!isRoot(out)) out = out.replace(/\\+$/, "");
			return out;
		}
		out = out.replace(/\\ /g, " "); // "Working\ Files" colado do Terminal
		if (out.length > 1) out = out.replace(/\/+$/, "");
		return out;
	}

	function addPaths(list) {
		const s = S();
		s.paths = s.paths || [];
		let added = 0;
		for (const raw of list) {
			const p = cleanPath(raw);
			const dup = s.paths.some((x) => (isWin() ? x.toLowerCase() === p.toLowerCase() : x === p));
			if (p && !dup) {
				s.paths.push(p);
				added++;
			}
		}
		if (added) {
			save(true);
			renderPaths();
			renderOptions();
			checkPaths();
			toast(added === 1 ? t("addedOne") : t("addedMany", { n: added }), "ok");
		} else if (list.length) {
			toast(t("duplicate"));
		}
	}

	function removePath(i) {
		const s = S();
		s.paths.splice(i, 1);
		save(true);
		renderPaths();
		renderOptions();
	}

	function movePath(from, to) {
		const s = S();
		if (to < 0 || to >= s.paths.length || from === to) return;
		const [it] = s.paths.splice(from, 1);
		s.paths.splice(to, 0, it);
		save(true);
		renderPaths();
	}

	let dragFrom = -1;
	function renderPaths() {
		const s = S();
		const paths = s.paths || [];
		const ul = $("pathList");
		ul.innerHTML = "";
		$("pathEmpty").hidden = paths.length > 0;
		$("pathCount").textContent = paths.length ? (paths.length === 1 ? t("itemOne") : t("itemMany", { n: paths.length })) : "";

		paths.forEach((p, i) => {
			const st = state.pathStatus[p];
			const missing = st && !st.exists;
			const { name, dir } = splitPath(p);
			const li = el("li", "path-item" + (missing ? " missing" : ""));
			li.draggable = true;
			li.title = p;

			li.appendChild(el("span", "handle", '<svg viewBox="0 0 10 16"><circle cx="3" cy="3" r="1.2"/><circle cx="7" cy="3" r="1.2"/><circle cx="3" cy="8" r="1.2"/><circle cx="7" cy="8" r="1.2"/><circle cx="3" cy="13" r="1.2"/><circle cx="7" cy="13" r="1.2"/></svg>'));
			if (paths.length > 1) li.appendChild(el("span", "num", String(i + 1)));
			const isDir = st ? st.dir : !/\.[a-z0-9]{1,6}$/i.test(name);
			li.appendChild(el("span", "kind", missing ? MISSING_SVG : isDir ? FOLDER_SVG : FILE_SVG));

			const txt = el("span", "path-text");
			txt.appendChild(el("span", "path-name", esc(name)));
			txt.appendChild(el("span", "path-dir", missing ? esc(t("notFound")) : "‎" + esc(tilde(dir))));
			li.appendChild(txt);

			const acts = el("span", "path-actions");
			const up = el("button", "icon-btn", '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>');
			up.type = "button";
			up.title = t("up");
			up.disabled = i === 0;
			up.onclick = () => movePath(i, i - 1);
			const down = el("button", "icon-btn", '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>');
			down.type = "button";
			down.title = t("down");
			down.disabled = i === paths.length - 1;
			down.onclick = () => movePath(i, i + 1);
			const del = el("button", "icon-btn del", '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>');
			del.type = "button";
			del.title = t("remove");
			del.onclick = () => removePath(i);
			if (paths.length > 1) {
				acts.appendChild(up);
				acts.appendChild(down);
			}
			acts.appendChild(del);
			li.appendChild(acts);

			li.addEventListener("dragstart", (e) => {
				dragFrom = i;
				li.classList.add("dragging");
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", String(i));
			});
			li.addEventListener("dragend", () => {
				dragFrom = -1;
				ul.querySelectorAll(".path-item").forEach((n) => n.classList.remove("dragging", "drop-before", "drop-after"));
			});
			li.addEventListener("dragover", (e) => {
				if (dragFrom < 0) return;
				e.preventDefault();
				const r = li.getBoundingClientRect();
				const after = e.clientY > r.top + r.height / 2;
				li.classList.toggle("drop-after", after);
				li.classList.toggle("drop-before", !after);
			});
			li.addEventListener("dragleave", () => li.classList.remove("drop-before", "drop-after"));
			li.addEventListener("drop", (e) => {
				e.preventDefault();
				if (dragFrom < 0) return;
				const after = li.classList.contains("drop-after");
				let to = i + (after ? 1 : 0);
				if (dragFrom < to) to--;
				movePath(dragFrom, to);
			});
			ul.appendChild(li);
		});
		renderPreview();
	}

	/* ------------------------------------------------------------ opções */
	function renderOptions() {
		const s = S();
		const multi = (s.paths || []).length > 1;
		const seg = $("modeSeg");
		seg.classList.toggle("disabled", !multi);
		seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === (s.mode || "separate"))));
		$("delayOpt").hidden = !(multi && (s.mode || "separate") === "separate");
		$("delay").value = s.delay != null ? s.delay : 300;
		$("delayOut").textContent = $("delay").value + " ms";
		$("newInstance").checked = !!s.newInstance;
		$("niOpt").hidden = isWin();
		$("useAppIcon").checked = s.useAppIcon !== false;

		const hint = $("niHint");
		if (state.niAuto) {
			hint.textContent = s.newInstance ? t("niAutoOn") : t("niAutoOff");
			hint.classList.add("auto");
		} else {
			hint.textContent = t("niHint");
			hint.classList.remove("auto");
		}
		renderPreview();
	}

	function shq(p) {
		return /^[\w@%+=:,./-]+$/.test(p) ? p : "'" + p.replace(/'/g, "'\\''") + "'";
	}
	/** Aspas do PowerShell ('...' com '' para escapar). */
	const psq = (p) => "'" + String(p).replace(/'/g, "''") + "'";
	/** Argumento dentro de -ArgumentList: aspas duplas quando há espaços. */
	const psArg = (p) => psq(/[\s"]/.test(p) ? '"' + p.replace(/"/g, '\\"') + '"' : p);

	function renderPreview() {
		const s = S();
		const pre = $("cmdPreview");
		if (!s.appPath) {
			pre.textContent = t("cmdNoApp");
			return;
		}
		const paths = (s.paths || []).filter((p) => !(state.pathStatus[p] && !state.pathStatus[p].exists));
		const separate = (s.mode || "separate") !== "together" && paths.length > 1;
		const d = Number(s.delay != null ? s.delay : 300);
		const groups = !paths.length ? [[]] : separate ? paths.map((p) => [p]) : [paths];
		let build;
		let pause;
		if (isWin()) {
			build = (ps) => "Start-Process " + psq(s.appPath) + (ps.length ? " -ArgumentList " + ps.map(psArg).join(", ") : "");
			pause = "Start-Sleep -Milliseconds " + d;
		} else {
			const app = shq(s.appPath);
			build = (ps) => (s.newInstance ? "open -n -a " + app + (ps.length ? " --args " + ps.map(shq).join(" ") : "") : "open -a " + app + (ps.length ? " " + ps.map(shq).join(" ") : ""));
			pause = "sleep " + d / 1000;
		}
		const lines = [];
		groups.forEach((g, i) => {
			if (i && d > 0) lines.push(pause);
			lines.push(build(g));
		});
		pre.textContent = lines.join("\n");
	}

	function renderAll() {
		renderApp();
		renderPaths();
		renderOptions();
	}

	/* ------------------------------------------------------------ feedback */
	let toastTimer = 0;
	function toast(text, kind) {
		const t = $("toast");
		t.textContent = text;
		t.className = "toast" + (kind ? " " + kind : "");
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (t.hidden = true), kind === "err" ? 5000 : 1800);
	}

	const busyBtn = { folder: "addFolders", file: "addFiles", app: "appOther" };
	function setBusy(kind, on) {
		const b = $(busyBtn[kind]);
		if (!b) return;
		b.classList.toggle("busy", on);
		const span = b.querySelector("span");
		if (span) span.textContent = on ? t(isWin() ? "explorerBusy" : "finderBusy") : t(span.dataset.i18n);
	}
	function setTestBusy(on) {
		const b = $("testBtn");
		b.classList.toggle("busy", on);
		b.querySelector("span").textContent = on ? t("testing") : t("test");
	}

	function lastDir() {
		const p = (S().paths || []).slice(-1)[0];
		return p ? splitPath(p).dir : undefined;
	}

	/* ------------------------------------------------------------ eventos */
	document.addEventListener("DOMContentLoaded", () => {
		$("appBtn").addEventListener("click", () => ($("appPop").hidden ? openPop() : closePop(false)));
		$("appBtn").addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown" && $("appPop").hidden) {
				e.preventDefault();
				openPop();
			}
		});
		$("appSearch").addEventListener("input", (e) => {
			state.filter = e.target.value;
			state.active = 0;
			renderAppList();
			$("appList").scrollTop = 0;
		});
		$("appSearch").addEventListener("keydown", (e) => {
			const list = filteredApps();
			if (e.key === "ArrowDown") { e.preventDefault(); setActive(state.active + 1, true); }
			else if (e.key === "ArrowUp") { e.preventDefault(); setActive(state.active - 1, true); }
			else if (e.key === "PageDown") { e.preventDefault(); setActive(state.active + 8, true); }
			else if (e.key === "PageUp") { e.preventDefault(); setActive(state.active - 8, true); }
			else if (e.key === "Enter") { e.preventDefault(); if (list[state.active]) chooseApp(list[state.active]); }
			else if (e.key === "Escape") { e.preventDefault(); closePop(true); }
		});
		$("appReload").addEventListener("click", () => loadApps(true));
		$("appOther").addEventListener("click", () => {
			setBusy("app", true);
			toPlugin({ cmd: "pick", kind: "app", multiple: false });
		});
		document.addEventListener("mousedown", (e) => {
			if (!$("appPop").hidden && !$("appPop").contains(e.target) && !$("appBtn").contains(e.target)) closePop(false);
		});

		$("addFolders").addEventListener("click", () => {
			setBusy("folder", true);
			toPlugin({ cmd: "pick", kind: "folder", multiple: true, defaultLocation: lastDir() });
		});
		$("addFiles").addEventListener("click", () => {
			setBusy("file", true);
			toPlugin({ cmd: "pick", kind: "file", multiple: true, defaultLocation: lastDir() });
		});
		$("addManual").addEventListener("click", () => {
			const row = $("manualRow");
			row.hidden = !row.hidden;
			$("addManual").classList.toggle("on", !row.hidden);
			if (!row.hidden) $("manualInput").focus();
		});
		$("manualRow").addEventListener("submit", (e) => {
			e.preventDefault();
			const v = $("manualInput").value;
			const parts = v.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
			if (!parts.length) return;
			addPaths(parts);
			$("manualInput").value = "";
		});
		$("manualInput").addEventListener("paste", (e) => {
			const text = (e.clipboardData || window.clipboardData).getData("text");
			if (/\r?\n/.test(text.trim())) {
				e.preventDefault();
				addPaths(text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
			}
		});
		$("manualInput").addEventListener("keydown", (e) => {
			if (e.key === "Escape") { $("manualRow").hidden = true; $("addManual").classList.remove("on"); }
		});

		$("modeSeg").addEventListener("click", (e) => {
			const b = e.target.closest("button[data-mode]");
			if (!b) return;
			S().mode = b.dataset.mode;
			save();
			renderOptions();
		});
		$("delay").addEventListener("input", (e) => {
			S().delay = Number(e.target.value);
			$("delayOut").textContent = e.target.value + " ms";
			save();
		});
		$("newInstance").addEventListener("change", (e) => {
			S().newInstance = e.target.checked;
			state.niAuto = false;
			save();
			renderOptions();
		});
		$("useAppIcon").addEventListener("change", (e) => {
			S().useAppIcon = e.target.checked;
			save();
		});
		$("testBtn").addEventListener("click", () => {
			if (!S().appPath) {
				toast(t("chooseFirst"), "err");
				openPop();
				return;
			}
			save(true);
			setTestBusy(true);
			setTimeout(() => toPlugin({ cmd: "run" }), 150);
			setTimeout(() => setTestBusy(false), 8000);
		});

		// Arrastar do Finder para a lista (quando o host expõe o caminho).
		const drop = document.querySelector(".pi");
		drop.addEventListener("dragover", (e) => {
			if (dragFrom < 0 && e.dataTransfer && [...e.dataTransfer.types].some((t) => t === "Files" || t === "text/uri-list")) e.preventDefault();
		});
		drop.addEventListener("drop", (e) => {
			if (dragFrom >= 0) return;
			e.preventDefault();
			const out = [];
			const uris = e.dataTransfer.getData("text/uri-list");
			if (uris) uris.split(/\r?\n/).filter((u) => u && !u.startsWith("#")).forEach((u) => out.push(u));
			if (!out.length) for (const f of e.dataTransfer.files || []) if (f.path) out.push(f.path);
			if (out.length) addPaths(out);
			else toast(t("dropFail"));
		});

		$("langSel").addEventListener("change", (e) => {
			setLang(e.target.value);
			send({ event: "setGlobalSettings", context: ctx, payload: { language: state.langPref } });
			toPlugin({ cmd: "setLanguage", lang: state.langPref });
		});

		if (!ctx) applyI18n();
	});

	window.__openWithPI = { state, onPluginMessage, t }; // para testes
})();
