import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pasta raiz do plugin (…/com.fernandoschuab.openwith.sdPlugin). */
const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");
const ICON_CACHE = path.join(os.homedir(), "Library", "Caches", "com.fernandoschuab.openwith", "icons");

export const HOME = os.homedir();

export type AppInfo = { name: string; path: string; electron: boolean };

function run(file: string, args: string[], timeoutMs = 0): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
			if (err) reject(Object.assign(err, { stderr: String(stderr) }));
			else resolve(String(stdout));
		});
	});
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Expande "~" e remove barra final. */
export function normalizePath(p: string): string {
	let out = p.trim().replace(/^["']|["']$/g, "");
	if (out === "~") out = HOME;
	else if (out.startsWith("~/")) out = path.join(HOME, out.slice(2));
	// Aceita caminhos colados do Terminal com espaços escapados ("Working\ Files").
	out = out.replace(/\\ /g, " ");
	if (out.length > 1) out = out.replace(/\/+$/, "");
	return out;
}

export function pathKind(p: string): { exists: boolean; dir: boolean } {
	try {
		const st = statSync(normalizePath(p));
		return { exists: true, dir: st.isDirectory() && !/\.app$/i.test(p) };
	} catch {
		return { exists: false, dir: false };
	}
}

export function isElectron(appPath: string): boolean {
	return existsSync(path.join(appPath, "Contents", "Frameworks", "Electron Framework.framework"));
}

export function appNameFromPath(appPath: string): string {
	return path.basename(appPath).replace(/\.app$/i, "");
}

/* ------------------------------------------------------------------ */
/* Abrir                                                               */
/* ------------------------------------------------------------------ */

export type OpenOptions = {
	app: string;
	paths: string[];
	mode: "separate" | "together";
	newInstance: boolean;
	delay: number;
};

/** Monta os argumentos do `open` para um conjunto de caminhos. */
export function buildOpenArgs(app: string, paths: string[], newInstance: boolean): string[] {
	const appArg = ["-a", app];
	if (newInstance) {
		return paths.length ? ["-n", ...appArg, "--args", ...paths] : ["-n", ...appArg];
	}
	return [...appArg, ...paths];
}

/** Executa os `open` em sequência. Retorna os caminhos que não existem (ignorados). */
export async function openItems(opts: OpenOptions): Promise<{ missing: string[]; calls: string[][] }> {
	const all = opts.paths.map(normalizePath).filter(Boolean);
	const existing = all.filter((p) => existsSync(p));
	const missing = all.filter((p) => !existsSync(p));

	// Usa o caminho do .app quando existe; senão tenta pelo nome (open -a "Nome").
	const app = existsSync(opts.app) ? opts.app : appNameFromPath(opts.app);

	const calls: string[][] = [];
	if (all.length === 0) {
		calls.push(buildOpenArgs(app, [], opts.newInstance));
	} else if (opts.mode === "together") {
		if (existing.length) calls.push(buildOpenArgs(app, existing, opts.newInstance));
	} else {
		for (const p of existing) calls.push(buildOpenArgs(app, [p], opts.newInstance));
	}

	for (let i = 0; i < calls.length; i++) {
		if (i > 0 && opts.delay > 0) await sleep(opts.delay);
		await run("/usr/bin/open", calls[i], 30_000);
	}
	return { missing, calls };
}

/* ------------------------------------------------------------------ */
/* Seletores nativos (Finder)                                          */
/* ------------------------------------------------------------------ */

export type PickKind = "folder" | "file" | "app";
let picking = false;

export async function pick(kind: PickKind, multiple: boolean, defaultLocation?: string): Promise<string[]> {
	if (picking) return [];
	picking = true;
	try {
		const prompts: Record<PickKind, string> = {
			folder: multiple ? "Escolha uma ou mais pastas" : "Escolha uma pasta",
			file: multiple ? "Escolha um ou mais arquivos" : "Escolha um arquivo",
			app: "Escolha o programa",
		};
		let loc = defaultLocation ? normalizePath(defaultLocation) : undefined;
		if (loc && existsSync(loc) && !statSync(loc).isDirectory()) loc = path.dirname(loc);
		if (loc && !existsSync(loc)) loc = undefined;
		const arg = JSON.stringify({ kind, multiple, prompt: prompts[kind], defaultLocation: loc });
		const out = await run("/usr/bin/osascript", ["-l", "JavaScript", path.join(SCRIPTS_DIR, "pick.js"), arg]);
		const res = JSON.parse(out.trim()) as { ok: boolean; paths?: string[]; error?: string };
		if (!res.ok) throw new Error(res.error ?? "Falha no seletor");
		return (res.paths ?? []).map(normalizePath);
	} finally {
		picking = false;
	}
}

/* ------------------------------------------------------------------ */
/* Lista de apps                                                       */
/* ------------------------------------------------------------------ */

const APP_ROOTS = [
	"/Applications",
	path.join(HOME, "Applications"),
	"/System/Applications",
	"/System/Applications/Utilities",
	"/System/Library/CoreServices/Finder.app/..",
];

async function scanDir(dir: string, depth: number, found: Map<string, AppInfo>): Promise<void> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const full = path.join(dir, e.name);
		if (e.name.toLowerCase().endsWith(".app")) {
			const name = appNameFromPath(full);
			if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, path: full, electron: isElectron(full) });
		} else if (depth > 0 && (e.isDirectory() || e.isSymbolicLink())) {
			await scanDir(full, depth - 1, found);
		}
	}
}

let appsCache: { at: number; apps: AppInfo[] } | undefined;

export async function listApps(force = false): Promise<AppInfo[]> {
	if (!force && appsCache && Date.now() - appsCache.at < 60_000) return appsCache.apps;
	const found = new Map<string, AppInfo>();
	for (const root of APP_ROOTS) {
		const r = path.resolve(root);
		// Da pasta CoreServices só interessa o Finder.
		if (r === "/System/Library/CoreServices") {
			const finder = path.join(r, "Finder.app");
			if (existsSync(finder)) found.set("finder", { name: "Finder", path: finder, electron: false });
			continue;
		}
		await scanDir(r, r === "/Applications" ? 2 : 1, found);
	}
	const apps = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
	appsCache = { at: Date.now(), apps };
	return apps;
}

/* ------------------------------------------------------------------ */
/* Ícones                                                              */
/* ------------------------------------------------------------------ */

const iconMem = new Map<string, string>();

function iconFile(appPath: string, size: number): string {
	let mtime = 0;
	try {
		mtime = statSync(appPath).mtimeMs;
	} catch {
		/* ignore */
	}
	const key = createHash("sha1").update(`${appPath}|${mtime}|${size}`).digest("hex");
	return path.join(ICON_CACHE, `${key}.png`);
}

async function readDataUrl(file: string): Promise<string | undefined> {
	try {
		const buf = await fs.readFile(file);
		if (buf.length < 100) return undefined;
		return `data:image/png;base64,${buf.toString("base64")}`;
	} catch {
		return undefined;
	}
}

/**
 * Gera (com cache em disco e memória) ícones PNG dos apps via NSWorkspace.
 * `onBatch` é chamado a cada lote pronto.
 */
export async function getIcons(
	appPaths: string[],
	size: number,
	onBatch?: (icons: Record<string, string>) => void | Promise<void>,
): Promise<Record<string, string>> {
	await fs.mkdir(ICON_CACHE, { recursive: true });
	const result: Record<string, string> = {};
	const ready: Record<string, string> = {};
	const todo: { app: string; out: string }[] = [];

	for (const app of appPaths) {
		const out = iconFile(app, size);
		const memKey = out;
		const mem = iconMem.get(memKey);
		if (mem) {
			ready[app] = mem;
			continue;
		}
		const disk = existsSync(out) ? await readDataUrl(out) : undefined;
		if (disk) {
			iconMem.set(memKey, disk);
			ready[app] = disk;
		} else if (existsSync(app)) {
			todo.push({ app, out });
		}
	}
	Object.assign(result, ready);
	if (Object.keys(ready).length && onBatch) await onBatch(ready);

	const CHUNK = 24;
	for (let i = 0; i < todo.length; i += CHUNK) {
		const chunk = todo.slice(i, i + CHUNK);
		try {
			await run(
				"/usr/bin/osascript",
				["-l", "JavaScript", path.join(SCRIPTS_DIR, "icons.js"), JSON.stringify(chunk.map((c) => ({ ...c, size })))],
				60_000,
			);
		} catch {
			/* segue para o fallback abaixo */
		}
		const batch: Record<string, string> = {};
		for (const c of chunk) {
			let data = await readDataUrl(c.out);
			if (!data) data = await sipsFallback(c.app, c.out, size);
			if (data) {
				iconMem.set(c.out, data);
				batch[c.app] = data;
			}
		}
		Object.assign(result, batch);
		if (Object.keys(batch).length && onBatch) await onBatch(batch);
	}
	return result;
}

/** Fallback: converte o .icns do bundle com `sips`. */
async function sipsFallback(appPath: string, out: string, size: number): Promise<string | undefined> {
	try {
		const plist = path.join(appPath, "Contents", "Info.plist");
		let iconName = (await run("/usr/bin/plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist], 5000)).trim();
		if (!iconName) return undefined;
		if (!iconName.toLowerCase().endsWith(".icns")) iconName += ".icns";
		const icns = path.join(appPath, "Contents", "Resources", iconName);
		if (!existsSync(icns)) return undefined;
		await run("/usr/bin/sips", ["-s", "format", "png", "-Z", String(size), icns, "--out", out], 10_000);
		return await readDataUrl(out);
	} catch {
		return undefined;
	}
}

/** Ícone genérico (SVG) com a inicial do app, usado quando não há ícone. */
export function letterIcon(name: string, size = 144): string {
	const letter = (name.trim()[0] ?? "?").toUpperCase();
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,58%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},70%,42%)"/></linearGradient></defs>
<rect x="16" y="16" width="112" height="112" rx="26" fill="url(#g)"/>
<text x="72" y="92" font-family="-apple-system,Helvetica,Arial" font-size="56" font-weight="600" text-anchor="middle" fill="#fff">${letter.replace(/[<&>]/g, "")}</text></svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}
