import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createIconCache, run, SCRIPTS_DIR, sleep } from "./common";
import { type Lang, tr } from "./i18n";
import type { AppInfo, OpenOptions, PickKind, PickResult, Platform } from "./types";

/**
 * Implementação Windows: executa o .exe com as pastas como argumentos, seletor nativo
 * (IFileOpenDialog), atalhos do Menu Iniciar e ícones do Shell — via PowerShell + C#.
 */

const w = path.win32;
const HOME = os.homedir();
const SYSTEM_ROOT = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const POWERSHELL = w.join(SYSTEM_ROOT, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const PS_SCRIPT = path.join(SCRIPTS_DIR, "win", "openwith.ps1");
const LOCAL_APPDATA = process.env.LOCALAPPDATA || w.join(HOME, "AppData", "Local");
// Fora do Windows (só em testes) usa o separador do sistema para não criar pastas com "\\" no nome.
const ICON_CACHE = (process.platform === "win32" ? w : path).join(LOCAL_APPDATA, "com.fernandoschuab.openwith", "icons");
export const EXPLORER = w.join(SYSTEM_ROOT, "explorer.exe");

/* ------------------------------------------------------------------ */
/* Caminhos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Normaliza um caminho do Windows: remove aspas, aceita file:///, %VARIAVEIS%, "~\",
 * barras normais e remove a barra final (exceto em "C:\").
 */
export function normalizePath(p: string, home = HOME, env: NodeJS.ProcessEnv = process.env): string {
	let out = String(p ?? "").trim().replace(/^["']|["']$/g, "");
	if (!out) return "";
	if (/^file:\/\//i.test(out)) {
		try {
			const u = new URL(out);
			out = decodeURIComponent(u.pathname);
			if (u.host) out = `\\\\${u.host}${out}`; // file://servidor/compartilhamento
		} catch {
			/* ignore */
		}
	}
	out = out.replace(/%([^%\\/]+)%/g, (m, name: string) => {
		const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
		return key ? String(env[key]) : m;
	});
	if (out === "~") out = home;
	else if (/^~[\\/]/.test(out)) out = w.join(home, out.slice(2));
	out = out.replace(/\//g, "\\");
	if (/^\\[A-Za-z]:/.test(out)) out = out.slice(1); // "/C:/x" vindo de URL
	if (/^[A-Za-z]:$/.test(out)) out += "\\";
	out = w.normalize(out);
	if (!/^[A-Za-z]:\\$/.test(out) && !/^\\\\[^\\]+\\[^\\]+\\?$/.test(out)) out = out.replace(/\\+$/, "");
	return out;
}

export function appNameFromPath(appPath: string): string {
	return w.basename(appPath).replace(/\.(exe|cmd|bat)$/i, "");
}

export function isElectron(appPath: string): boolean {
	const dir = w.dirname(appPath);
	return (
		existsSync(w.join(dir, "resources", "app.asar")) ||
		existsSync(w.join(dir, "resources", "app", "package.json")) ||
		existsSync(w.join(dir, "LICENSES.chromium.html"))
	);
}

/* ------------------------------------------------------------------ */
/* Abrir                                                               */
/* ------------------------------------------------------------------ */

/** Aspas no estilo do cmd.exe (para .cmd/.bat). */
function cmdQuote(s: string): string {
	return `"${s.replace(/"/g, '""')}"`;
}

/** Ambiente limpo para o programa: sem variáveis do Node do plugin que confundem apps Electron. */
function childEnv(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const k of Object.keys(env)) {
		if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_CHANNEL_FD|NODE_UNIQUE_ID)$/i.test(k)) delete env[k];
	}
	return env;
}

/** Inicia o programa desacoplado do plugin; resolve quando o processo foi criado. */
export function launch(exe: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const env = childEnv();
		let child;
		if (/\.(cmd|bat)$/i.test(exe)) {
			// Node não executa .cmd/.bat sem shell; montamos a linha para o cmd.exe.
			const line = [exe, ...args].map(cmdQuote).join(" ");
			child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
				windowsVerbatimArguments: true,
				cwd: w.dirname(exe),
				env,
			});
		} else {
			child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false, cwd: w.dirname(exe), env });
		}
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

/** Lista das chamadas (argumentos de cada execução) para os caminhos existentes. */
export function planCalls(existing: string[], total: number, mode: OpenOptions["mode"]): string[][] {
	if (total === 0) return [[]];
	if (mode === "together") return existing.length ? [existing] : [];
	return existing.map((p) => [p]);
}

async function openItems(opts: OpenOptions) {
	const all = opts.paths.map((p) => normalizePath(p)).filter(Boolean);
	const existing = all.filter((p) => existsSync(p));
	const missing = all.filter((p) => !existsSync(p));
	const exe = normalizePath(opts.app);
	if (!existsSync(exe)) throw new Error(`Application not found: ${exe}`);

	const calls = planCalls(existing, all.length, opts.mode);
	for (let i = 0; i < calls.length; i++) {
		if (i > 0 && opts.delay > 0) await sleep(opts.delay);
		await launch(exe, calls[i]);
	}
	return { missing, calls: calls.map((c) => [exe, ...c]) };
}

/* ------------------------------------------------------------------ */
/* PowerShell                                                          */
/* ------------------------------------------------------------------ */

type PsResult = { ok: boolean; error?: string } & Record<string, unknown>;

/** Executa um comando do openwith.ps1. Entrada e saída trafegam em Base64 (UTF-8). */
async function ps<T extends PsResult>(cmd: string, arg: unknown, timeoutMs: number): Promise<T> {
	const b64 = Buffer.from(JSON.stringify(arg ?? {}), "utf8").toString("base64");
	const exe = existsSync(POWERSHELL) ? POWERSHELL : "powershell.exe";
	const out = await run(
		exe,
		["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-STA", "-File", PS_SCRIPT, "-Cmd", cmd, "-Arg", b64],
		timeoutMs,
		{ windowsHide: true },
	);
	return decodePsOutput<T>(out);
}

export function decodePsOutput<T extends PsResult>(out: string): T {
	const b64 = String(out).replace(/[^A-Za-z0-9+/=]/g, "");
	const res = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as T;
	if (!res.ok) throw new Error(res.error || `PowerShell command failed`);
	return res;
}

/* ------------------------------------------------------------------ */
/* Seletores                                                           */
/* ------------------------------------------------------------------ */

let picking = false;
async function pick(kind: PickKind, multiple: boolean, defaultLocation: string | undefined, lang: Lang): Promise<PickResult> {
	if (picking) return { paths: [] };
	picking = true;
	try {
		const title =
			kind === "folder"
				? tr(lang, multiple ? "pickFolders" : "pickFolder")
				: kind === "file"
					? tr(lang, multiple ? "pickFiles" : "pickFile")
					: tr(lang, "pickApp");
		let initialDir = defaultLocation ? normalizePath(defaultLocation) : "";
		try {
			if (initialDir && existsSync(initialDir) && !statSync(initialDir).isDirectory()) initialDir = w.dirname(initialDir);
		} catch {
			initialDir = "";
		}
		if (initialDir && !existsSync(initialDir)) initialDir = "";
		if (!initialDir && kind === "app") initialDir = process.env.ProgramFiles || "C:\\Program Files";

		const res = await ps<PsResult & { paths?: string[]; names?: Record<string, string> }>(
			"pick",
			{
				kind,
				multiple: kind === "app" ? false : multiple,
				title,
				initialDir,
				filterName: kind === "app" ? tr(lang, "programsFilter") : "",
				filterSpec: kind === "app" ? "*.exe;*.cmd;*.bat" : "",
			},
			0,
		);
		const paths = (res.paths ?? []).map((p) => normalizePath(p)).filter(Boolean);
		const names: Record<string, string> = {};
		for (const [k, v] of Object.entries(res.names ?? {})) if (v) names[normalizePath(k)] = String(v);
		return { paths, names };
	} finally {
		picking = false;
	}
}

/* ------------------------------------------------------------------ */
/* Lista de apps (Menu Iniciar)                                        */
/* ------------------------------------------------------------------ */

const JUNK_NAME = /(uninstall|desinstal|remove|readme|leia-me|help|ajuda|ayuda|documenta|manual|website|site da web|release notes|license|licen[cç]a|support|suporte|soporte|changelog|what's new)/i;
const JUNK_EXE = /^(unins\d*|uninstall.*|setup|update|updater|crashpad_handler|helper)\.exe$/i;

export function filterStartMenuApps(raw: { name: string; path: string }[]): { name: string; path: string }[] {
	const seen = new Set<string>();
	const out: { name: string; path: string }[] = [];
	for (const a of raw) {
		if (!a?.path || !a?.name) continue;
		const key = a.path.toLowerCase();
		if (seen.has(key)) continue;
		if (JUNK_NAME.test(a.name) || JUNK_EXE.test(w.basename(a.path))) continue;
		seen.add(key);
		out.push({ name: a.name, path: a.path });
	}
	return out;
}

let appsCache: { at: number; lang: Lang; apps: AppInfo[] } | undefined;
async function listApps(force: boolean, lang: Lang): Promise<AppInfo[]> {
	if (!force && appsCache && appsCache.lang === lang && Date.now() - appsCache.at < 60_000) return appsCache.apps;
	let raw: { name: string; path: string }[] = [];
	try {
		const res = await ps<PsResult & { apps?: { name: string; path: string }[] }>("apps", {}, 45_000);
		raw = Array.isArray(res.apps) ? res.apps : res.apps ? [res.apps as unknown as { name: string; path: string }] : [];
	} catch {
		raw = [];
	}
	const list = filterStartMenuApps(raw).filter((a) => a.path.toLowerCase() !== EXPLORER.toLowerCase());
	const apps: AppInfo[] = list.map((a) => ({ name: a.name, path: a.path, electron: isElectron(a.path) }));
	if (existsSync(EXPLORER)) apps.push({ name: tr(lang, "fileExplorer"), path: EXPLORER, electron: false });
	apps.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
	appsCache = { at: Date.now(), lang, apps };
	return apps;
}

/* ------------------------------------------------------------------ */
/* Ícones e idioma                                                     */
/* ------------------------------------------------------------------ */

const getIcons = createIconCache(
	ICON_CACHE,
	async (jobs) => {
		await ps("icons", { jobs }, 90_000);
	},
	40,
);

async function readSystemLanguage(): Promise<string | undefined> {
	try {
		const res = await ps<PsResult & { ui?: string; culture?: string }>("lang", {}, 10_000);
		return res.ui || res.culture || undefined;
	} catch {
		try {
			return Intl.DateTimeFormat().resolvedOptions().locale;
		} catch {
			return undefined;
		}
	}
}

export const windowsPlatform: Platform = {
	id: "windows",
	home: HOME,
	normalizePath: (p) => normalizePath(p),
	pathKind(p) {
		try {
			const st = statSync(normalizePath(p));
			return { exists: true, dir: st.isDirectory() };
		} catch {
			return { exists: false, dir: false };
		}
	},
	isElectron,
	appNameFromPath,
	openItems,
	pick,
	listApps,
	getIcons,
	readSystemLanguage,
};
