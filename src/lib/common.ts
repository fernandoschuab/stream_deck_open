import { type ExecFileOptions, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, promises as fs, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Pasta raiz do plugin (…/com.fernandoschuab.openwith.sdPlugin). */
export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function run(file: string, args: string[], timeoutMs = 0, extra: ExecFileOptions = {}): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{ timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", ...extra },
			(err, stdout, stderr) => {
				if (err) reject(Object.assign(err, { stderr: String(stderr) }));
				else resolve(String(stdout));
			},
		);
	});
}

/** Ícone genérico (SVG) com a inicial do app, usado quando não há ícone. */
export function letterIcon(name: string, size = 144): string {
	const letter = (name.trim()[0] ?? "?").toUpperCase();
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 144 144">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,58%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},70%,42%)"/></linearGradient></defs>
<rect x="16" y="16" width="112" height="112" rx="26" fill="url(#g)"/>
<text x="72" y="92" font-family="-apple-system,Segoe UI,Helvetica,Arial" font-size="56" font-weight="600" text-anchor="middle" fill="#fff">${letter.replace(/[<&>]/g, "")}</text></svg>`;
	return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

export async function readDataUrl(file: string): Promise<string | undefined> {
	try {
		const buf = await fs.readFile(file);
		if (buf.length < 100) return undefined;
		return `data:image/png;base64,${buf.toString("base64")}`;
	} catch {
		return undefined;
	}
}

export type IconJob = { app: string; out: string; size: number };

/**
 * Cache de ícones (disco + memória) comum aos dois sistemas.
 * `generate` recebe um lote de ícones que faltam e deve gravar os PNGs em `out`.
 */
export function createIconCache(
	cacheDir: string,
	generate: (jobs: IconJob[]) => Promise<void>,
	chunkSize = 24,
): (
	appPaths: string[],
	size: number,
	onBatch?: (icons: Record<string, string>) => void | Promise<void>,
) => Promise<Record<string, string>> {
	const mem = new Map<string, string>();

	const fileFor = (appPath: string, size: number) => {
		let mtime = 0;
		try {
			mtime = statSync(appPath).mtimeMs;
		} catch {
			/* ignore */
		}
		const key = createHash("sha1").update(`${appPath}|${mtime}|${size}`).digest("hex");
		return path.join(cacheDir, `${key}.png`);
	};

	return async (appPaths, size, onBatch) => {
		await fs.mkdir(cacheDir, { recursive: true });
		const result: Record<string, string> = {};
		const ready: Record<string, string> = {};
		const todo: IconJob[] = [];

		for (const app of appPaths) {
			const out = fileFor(app, size);
			const cached = mem.get(out) ?? (existsSync(out) ? await readDataUrl(out) : undefined);
			if (cached) {
				mem.set(out, cached);
				ready[app] = cached;
			} else if (existsSync(app)) {
				todo.push({ app, out, size });
			}
		}
		Object.assign(result, ready);
		if (Object.keys(ready).length && onBatch) await onBatch(ready);

		for (let i = 0; i < todo.length; i += chunkSize) {
			const chunk = todo.slice(i, i + chunkSize);
			try {
				await generate(chunk);
			} catch {
				/* segue: o que não foi gerado fica sem ícone */
			}
			const batch: Record<string, string> = {};
			for (const c of chunk) {
				const data = await readDataUrl(c.out);
				if (data) {
					mem.set(c.out, data);
					batch[c.app] = data;
				}
			}
			Object.assign(result, batch);
			if (Object.keys(batch).length && onBatch) await onBatch(batch);
		}
		return result;
	};
}
