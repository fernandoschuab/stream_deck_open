import { type ExecFileOptions, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AppInfo } from "./types";

/** Pasta raiz do plugin (…/com.fernandoschuab.openwith.sdPlugin). */
export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SCRIPTS_DIR = path.join(PLUGIN_DIR, "scripts");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** setTimeout curto (mantém o processo vivo até o lote sair). */
const timer = (fn: () => void, ms: number): NodeJS.Timeout => setTimeout(fn, ms);

/** Existe? (sem bloquear o event loop, ao contrário de existsSync) */
export async function exists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

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

export type IconCacheOptions = {
	/** Quantos ícones por chamada do gerador (osascript / PowerShell). */
	chunkSize?: number;
	/** Quantos geradores ao mesmo tempo. */
	concurrency?: number;
	/** Espera antes de disparar, para juntar pedidos próximos num lote só. */
	coalesceMs?: number;
	/** Intervalo de envio dos lotes prontos para a interface. */
	flushMs?: number;
};

/**
 * Cache de ícones (memória + disco) comum aos dois sistemas.
 *
 * Pedidos feitos ao mesmo tempo (várias teclas aparecendo, lista de apps aberta)
 * são juntados num único lote e o número de processos externos fica limitado:
 * sem isso, cada tecla abria o seu próprio `osascript`/PowerShell ao mesmo tempo.
 */
export function createIconCache(
	cacheDir: string,
	generate: (jobs: IconJob[]) => Promise<void>,
	opts: number | IconCacheOptions = {},
): (
	appPaths: string[],
	size: number,
	onBatch?: (icons: Record<string, string>) => void | Promise<void>,
) => Promise<Record<string, string>> {
	const o: IconCacheOptions = typeof opts === "number" ? { chunkSize: opts } : opts;
	const chunkSize = o.chunkSize ?? 24;
	const concurrency = o.concurrency ?? 2;
	const coalesceMs = o.coalesceMs ?? 40;
	const flushMs = o.flushMs ?? 120;

	const mem = new Map<string, string>(); // arquivo de cache -> data URL
	const waiting = new Map<string, { job: IconJob; resolvers: Array<(v: string | undefined) => void> }>();
	const queue: string[] = [];
	let pending: NodeJS.Timeout | undefined;
	let running = 0;
	let dirReady: Promise<unknown> | undefined;

	async function fileFor(appPath: string, size: number): Promise<{ out: string; exists: boolean }> {
		let mtime = 0;
		let ok = false;
		try {
			mtime = (await fs.stat(appPath)).mtimeMs;
			ok = true;
		} catch {
			/* app sumiu: fica sem ícone */
		}
		const key = createHash("sha1").update(`${appPath}|${mtime}|${size}`).digest("hex");
		return { out: path.join(cacheDir, `${key}.png`), exists: ok };
	}

	function schedule(ms: number): void {
		if (pending) return;
		pending = timer(() => {
			pending = undefined;
			pump();
		}, ms);
	}

	function pump(): void {
		while (queue.length && running < concurrency) {
			const outs = queue.splice(0, chunkSize);
			const jobs = outs.map((out) => waiting.get(out)?.job).filter((j): j is IconJob => !!j);
			if (!jobs.length) continue;
			running++;
			void runChunk(jobs).finally(() => {
				running--;
				if (queue.length) schedule(0);
			});
		}
	}

	async function runChunk(jobs: IconJob[]): Promise<void> {
		try {
			await generate(jobs);
		} catch {
			/* segue: o que não foi gerado fica sem ícone */
		}
		await Promise.all(
			jobs.map(async (j) => {
				const data = await readDataUrl(j.out);
				if (data) mem.set(j.out, data);
				const entry = waiting.get(j.out);
				waiting.delete(j.out);
				for (const r of entry?.resolvers ?? []) r(data);
			}),
		);
	}

	/** Gera (ou espera quem já está gerando) o ícone de um app. `front`: pedido da tela, fura a fila. */
	function enqueue(job: IconJob, front: boolean): Promise<string | undefined> {
		const entry = waiting.get(job.out);
		if (entry) return new Promise((r) => entry.resolvers.push(r));
		const fresh = { job, resolvers: [] as Array<(v: string | undefined) => void> };
		waiting.set(job.out, fresh);
		if (front) queue.unshift(job.out);
		else queue.push(job.out);
		schedule(front ? 0 : coalesceMs);
		return new Promise((r) => fresh.resolvers.push(r));
	}

	return async (appPaths, size, onBatch) => {
		dirReady ??= fs.mkdir(cacheDir, { recursive: true }).catch(() => undefined);
		await dirReady;

		const result: Record<string, string> = {};
		const ready: Record<string, string> = {};
		const todo: IconJob[] = [];
		const seen = new Set<string>();

		await Promise.all(
			[...new Set(appPaths)].map(async (app) => {
				const { out, exists: ok } = await fileFor(app, size);
				const cached = mem.get(out) ?? (await readDataUrl(out));
				if (cached) {
					mem.set(out, cached);
					ready[app] = cached;
				} else if (ok && !seen.has(out)) {
					seen.add(out);
					todo.push({ app, out, size });
				}
			}),
		);

		Object.assign(result, ready);
		// Envia o que já estava pronto em lotes pequenos (uma mensagem só com centenas
		// de ícones deixa a interface presa enquanto chega).
		if (onBatch) {
			const entries = Object.entries(ready);
			for (let i = 0; i < entries.length; i += chunkSize) await onBatch(Object.fromEntries(entries.slice(i, i + chunkSize)));
		}

		// Poucos ícones = pedido da tela (ícone da tecla, app escolhido): passa na frente
		// de um aquecimento em andamento.
		const front = todo.length <= 4;
		let batch: Record<string, string> = {};
		let flushing: NodeJS.Timeout | undefined;
		const flush = async () => {
			flushing = undefined;
			if (!Object.keys(batch).length) return;
			const out = batch;
			batch = {};
			if (onBatch) await onBatch(out);
		};

		await Promise.all(
			todo.map(async (job) => {
				const data = await enqueue(job, front);
				if (!data) return;
				result[job.app] = data;
				batch[job.app] = data;
				if (Object.keys(batch).length >= chunkSize) await flush();
				else if (!flushing) flushing = timer(() => void flush(), flushMs);
			}),
		);
		if (flushing) clearTimeout(flushing);
		await flush();
		return result;
	};
}

/**
 * Lista de apps com cache em memória e em disco.
 * Devolve na hora o que já tem e atualiza em segundo plano quando está velho
 * (varrer /Applications ou ler o Menu Iniciar leva tempo).
 */
export function createAppCache(
	cacheFile: string,
	scan: (lang: string) => Promise<AppInfo[]>,
	ttlMs = 10 * 60_000,
): (force: boolean, lang: string, onUpdate?: (apps: AppInfo[]) => void) => Promise<AppInfo[]> {
	type Entry = { at: number; lang: string; apps: AppInfo[] };
	let mem: Entry | undefined;
	let fromDisk: Promise<Entry | undefined> | undefined;
	let refreshing: Promise<AppInfo[]> | undefined;

	const same = (a: AppInfo[], b: AppInfo[]) => a.length === b.length && a.every((x, i) => x.path === b[i]?.path && x.name === b[i]?.name);

	async function readDisk(): Promise<Entry | undefined> {
		try {
			const raw = JSON.parse(await fs.readFile(cacheFile, "utf8")) as Entry;
			if (!Array.isArray(raw?.apps) || !raw.apps.length) return undefined;
			return { at: Number(raw.at) || 0, lang: String(raw.lang ?? ""), apps: raw.apps };
		} catch {
			return undefined;
		}
	}

	async function writeDisk(entry: Entry): Promise<void> {
		try {
			await fs.mkdir(path.dirname(cacheFile), { recursive: true });
			await fs.writeFile(cacheFile, JSON.stringify(entry), "utf8");
		} catch {
			/* cache é só otimização */
		}
	}

	function refresh(lang: string): Promise<AppInfo[]> {
		refreshing ??= scan(lang)
			.then((apps) => {
				mem = { at: Date.now(), lang, apps };
				void writeDisk(mem);
				return apps;
			})
			.finally(() => {
				refreshing = undefined;
			});
		return refreshing;
	}

	return async (force, lang, onUpdate) => {
		if (!mem) {
			fromDisk ??= readDisk();
			const d = await fromDisk;
			if (d && !mem) mem = d;
		}
		const usable = mem && mem.lang === lang ? mem : undefined;
		if (!force && usable && Date.now() - usable.at < ttlMs) return usable.apps;
		if (!force && usable) {
			// Lista velha: entrega agora e atualiza em segundo plano.
			const old = usable.apps;
			void refresh(lang)
				.then((apps) => {
					if (onUpdate && !same(old, apps)) onUpdate(apps);
				})
				.catch(() => undefined);
			return old;
		}
		return refresh(lang);
	};
}
