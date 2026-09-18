import { existsSync, promises as fs, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createAppCache, createIconCache, exists, type IconJob, readDataUrl, run, SCRIPTS_DIR, sleep } from "./common";
import { tr } from "./i18n";
import type { AppInfo, OpenOptions, PickKind, Platform } from "./types";

/** Implementação macOS: `open`, seletores JXA, /Applications e ícones via NSWorkspace. */

const HOME = os.homedir();
const MAC_SCRIPTS = SCRIPTS_DIR; // pick.js e icons.js ficam na raiz de scripts/
const CACHE_DIR = path.join(HOME, "Library", "Caches", "com.fernandoschuab.openwith");
const ICON_CACHE = path.join(CACHE_DIR, "icons");
const APPS_CACHE = path.join(CACHE_DIR, "apps.json");

/** Expande "~", aceita "Working\ Files" colado do Terminal e remove barra final. */
export function normalizePath(p: string): string {
	let out = p.trim().replace(/^["']|["']$/g, "");
	if (/^file:\/\//i.test(out)) {
		try {
			out = decodeURIComponent(new URL(out).pathname);
		} catch {
			/* ignore */
		}
	}
	if (out === "~") out = HOME;
	else if (out.startsWith("~/")) out = path.posix.join(HOME, out.slice(2));
	out = out.replace(/\\ /g, " ");
	if (out.length > 1) out = out.replace(/\/+$/, "");
	return out;
}

export function isElectron(appPath: string): boolean {
	return existsSync(path.join(appPath, "Contents", "Frameworks", "Electron Framework.framework"));
}

export function appNameFromPath(appPath: string): string {
	return path.basename(appPath).replace(/\.app$/i, "");
}

/** Monta os argumentos do `open` para um conjunto de caminhos. */
export function buildOpenArgs(app: string, paths: string[], newInstance: boolean): string[] {
	const appArg = ["-a", app];
	if (newInstance) {
		return paths.length ? ["-n", ...appArg, "--args", ...paths] : ["-n", ...appArg];
	}
	return [...appArg, ...paths];
}

async function openItems(opts: OpenOptions) {
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

let picking = false;
async function pick(kind: PickKind, multiple: boolean, defaultLocation: string | undefined, lang: Parameters<typeof tr>[0]) {
	if (picking) return { paths: [] };
	picking = true;
	try {
		const prompts: Record<PickKind, string> = {
			folder: tr(lang, multiple ? "pickFolders" : "pickFolder"),
			file: tr(lang, multiple ? "pickFiles" : "pickFile"),
			app: tr(lang, "pickApp"),
		};
		let loc = defaultLocation ? normalizePath(defaultLocation) : undefined;
		if (loc && existsSync(loc) && !statSync(loc).isDirectory()) loc = path.dirname(loc);
		if (loc && !existsSync(loc)) loc = undefined;
		const arg = JSON.stringify({ kind, multiple, prompt: prompts[kind], defaultLocation: loc });
		const out = await run("/usr/bin/osascript", ["-l", "JavaScript", path.join(MAC_SCRIPTS, "pick.js"), arg]);
		const res = JSON.parse(out.trim()) as { ok: boolean; paths?: string[]; error?: string };
		if (!res.ok) throw new Error(res.error ?? "Picker failed");
		return { paths: (res.paths ?? []).map(normalizePath) };
	} finally {
		picking = false;
	}
}

const APP_ROOTS = ["/Applications", path.join(HOME, "Applications"), "/System/Applications", "/System/Applications/Utilities"];

/** Varre uma pasta em busca de .app (as subpastas em paralelo). */
async function scanDir(dir: string, depth: number, found: Map<string, AppInfo>): Promise<void> {
	let entries: import("node:fs").Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	const deeper: Promise<void>[] = [];
	for (const e of entries) {
		if (e.name.startsWith(".")) continue;
		const full = path.join(dir, e.name);
		if (e.name.toLowerCase().endsWith(".app")) {
			const name = appNameFromPath(full);
			if (!found.has(name.toLowerCase())) found.set(name.toLowerCase(), { name, path: full, electron: false });
		} else if (depth > 0 && (e.isDirectory() || e.isSymbolicLink())) {
			deeper.push(scanDir(full, depth - 1, found));
		}
	}
	await Promise.all(deeper);
}

async function scanApps(): Promise<AppInfo[]> {
	const found = new Map<string, AppInfo>();
	const finder = "/System/Library/CoreServices/Finder.app";
	if (await exists(finder)) found.set("finder", { name: "Finder", path: finder, electron: false });
	await Promise.all(APP_ROOTS.map((root) => scanDir(root, root === "/Applications" ? 2 : 1, found)));
	const apps = [...found.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
	// A marca de Electron custa um acesso a disco por app: em paralelo, e só uma vez por varredura.
	await Promise.all(apps.map(async (a) => (a.electron = await exists(path.join(a.path, "Contents", "Frameworks", "Electron Framework.framework")))));
	return apps;
}

const listApps = createAppCache(APPS_CACHE, scanApps);

/** Fallback: converte o .icns do bundle com `sips`. */
async function sipsFallback(job: IconJob): Promise<void> {
	try {
		const plist = path.join(job.app, "Contents", "Info.plist");
		let iconName = (await run("/usr/bin/plutil", ["-extract", "CFBundleIconFile", "raw", "-o", "-", plist], 5000)).trim();
		if (!iconName) return;
		if (!iconName.toLowerCase().endsWith(".icns")) iconName += ".icns";
		const icns = path.join(job.app, "Contents", "Resources", iconName);
		if (!existsSync(icns)) return;
		await run("/usr/bin/sips", ["-s", "format", "png", "-Z", String(job.size), icns, "--out", job.out], 10_000);
	} catch {
		/* sem ícone */
	}
}

const getIcons = createIconCache(ICON_CACHE, async (jobs) => {
	try {
		await run("/usr/bin/osascript", ["-l", "JavaScript", path.join(MAC_SCRIPTS, "icons.js"), JSON.stringify(jobs)], 60_000);
	} catch {
		/* cai no fallback */
	}
	for (const j of jobs) if (!(await readDataUrl(j.out))) await sipsFallback(j);
});

/** Idioma principal do macOS (defaults read -g AppleLanguages). */
export function parseAppleLanguages(stdout: string): string | undefined {
	const m = /"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?/.exec(String(stdout).replace(/[()\s,]+/g, " "));
	return m?.[1];
}

async function readSystemLanguage(): Promise<string | undefined> {
	try {
		return parseAppleLanguages(await run("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], 3000));
	} catch {
		return undefined;
	}
}

export const macPlatform: Platform = {
	id: "mac",
	home: HOME,
	normalizePath,
	async pathKind(p) {
		try {
			const st = await fs.stat(normalizePath(p));
			return { exists: true, dir: st.isDirectory() && !/\.app$/i.test(p) };
		} catch {
			return { exists: false, dir: false };
		}
	},
	isElectron,
	appNameFromPath,
	openItems,
	pick,
	listApps: (force, lang, onUpdate) => listApps(force, lang, onUpdate),
	getIcons,
	readSystemLanguage,
};
