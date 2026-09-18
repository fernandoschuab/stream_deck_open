import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type PropertyInspectorDidAppearEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { letterIcon, sleep } from "../lib/common";
import { sendToPI } from "../lib/piChannel";
import { type Lang, type LangPref, resolveLang } from "../lib/i18n";
import { type PickKind, platform } from "../lib/platform";

export type OpenSettings = {
	appPath?: string;
	appName?: string;
	paths?: string[];
	mode?: "separate" | "together";
	newInstance?: boolean;
	delay?: number;
	useAppIcon?: boolean;
};

type PiMessage =
	| { cmd: "hello" }
	| { cmd: "setLanguage"; lang: LangPref }
	| { cmd: "listApps"; force?: boolean; icons?: boolean }
	| { cmd: "pick"; kind: PickKind; multiple?: boolean; defaultLocation?: string; reqId?: string }
	| { cmd: "checkPaths"; paths: string[] }
	| { cmd: "appInfo"; appPath: string }
	| { cmd: "run" };

const log = streamDeck.logger.createScope("OpenWith");

type GlobalSettings = { language?: LangPref };

const normalizePref = (v: unknown): LangPref => (v === "pt" || v === "en" || v === "es" ? v : "auto");

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			},
		);
	});
}

@action({ UUID: "com.fernandoschuab.openwith.open" })
export class OpenWith extends SingletonAction<OpenSettings> {
	/** Último app aplicado como imagem, por instância da tecla. */
	private readonly appliedImage = new Map<string, string>();

	private langPref: LangPref = "auto";
	private systemLang?: string;
	private langReady?: Promise<void>;
	constructor() {
		super();
		// A UI grava o idioma direto nas configurações globais; acompanhamos as mudanças aqui.
		streamDeck.settings.onDidReceiveGlobalSettings<GlobalSettings>((ev) => {
			this.langPref = normalizePref(ev.settings?.language);
		});
	}

	override async onPropertyInspectorDidAppear(ev: PropertyInspectorDidAppearEvent<OpenSettings>): Promise<void> {
		await this.sendEnv(ev.action.id);
	}

	/**
	 * Manda o ambiente assim que possível: a interface fica esperando por ele para
	 * pedir ícone e conferir as pastas. Se o idioma demorar (PowerShell no Windows),
	 * envia com o que já se sabe e repete quando o idioma chegar.
	 */
	private async sendEnv(context: string): Promise<void> {
		const ready = this.loadLanguage();
		const inTime = await Promise.race([ready.then(() => true), sleep(400).then(() => false)]);
		await sendToPI(context, this.envPayload());
		if (!inTime) void ready.then(() => sendToPI(context, this.envPayload())).catch(() => undefined);
	}

	/** Aquece os caches (lista de apps e ícones) em segundo plano, logo após o plugin subir. */
	async prewarm(): Promise<void> {
		try {
			const t0 = Date.now();
			await this.loadLanguage();
			const icons = (list: { path: string }[]) => platform.getIcons(list.map((a) => a.path), 64);
			// Se a lista estava velha, a varredura nova também tem os ícones gerados.
			const apps = await platform.listApps(false, this.lang, (updated) => void icons(updated));
			const listed = Date.now() - t0;
			await icons(apps);
			log.info(`Prewarm: ${apps.length} apps (lista ${listed}ms, ícones ${Date.now() - t0 - listed}ms)`);
		} catch (err) {
			log.warn("Prewarm failed", err);
		}
	}

	/** Carrega (uma vez) o idioma do macOS e a preferência salva nas configurações globais. */
	private loadLanguage(): Promise<void> {
		this.langReady ??= (async () => {
			const [sys, g] = await Promise.all([
				platform.readSystemLanguage(),
				withTimeout(streamDeck.settings.getGlobalSettings<GlobalSettings>(), 1500).catch((e) => {
					log.warn("Could not read global settings", e);
					return undefined;
				}),
			]);
			this.systemLang = sys;
			if (g?.language) this.langPref = normalizePref(g.language);
			log.info(`Language: system=${sys ?? "?"} streamDeck=${this.sdLang ?? "?"} pref=${this.langPref} -> ${this.lang}`);
		})();
		return this.langReady;
	}

	private get sdLang(): string | undefined {
		try {
			return streamDeck.info?.application?.language;
		} catch {
			return undefined;
		}
	}

	private get lang(): Lang {
		return resolveLang(this.langPref, this.systemLang, this.sdLang);
	}

	private envPayload(): JsonValue {
		return {
			type: "env",
			home: platform.home,
			platform: platform.id,
			lang: this.lang,
			langPref: this.langPref,
			autoLang: resolveLang("auto", this.systemLang, this.sdLang),
		};
	}

	override async onWillAppear(ev: WillAppearEvent<OpenSettings>): Promise<void> {
		if (ev.action.isKey()) await this.refreshImage(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<OpenSettings>): Promise<void> {
		if (ev.action.isKey()) await this.refreshImage(ev.action, ev.payload.settings);
	}

	override onWillDisappear(ev: WillDisappearEvent<OpenSettings>): void {
		this.appliedImage.delete(ev.action.id);
	}

	override async onKeyDown(ev: KeyDownEvent<OpenSettings>): Promise<void> {
		await this.execute(ev.action, ev.payload.settings);
	}

	private async execute(act: KeyAction<OpenSettings>, s: OpenSettings): Promise<void> {
		if (!s.appPath) {
			log.warn("No application configured.");
			await act.showAlert();
			return;
		}
		try {
			const { missing, calls } = await platform.openItems({
				app: s.appPath,
				paths: s.paths ?? [],
				mode: s.mode ?? "separate",
				newInstance: s.newInstance ?? false,
				delay: Math.max(0, Math.min(10_000, Number(s.delay ?? 300))),
			});
			log.info(`Executed: ${JSON.stringify(calls)}`);
			if (missing.length) {
				log.warn(`Paths not found: ${missing.join(", ")}`);
				await act.showAlert();
			} else {
				await act.showOk();
			}
		} catch (err) {
			log.error("Failed to open", err);
			await act.showAlert();
		}
	}

	private async refreshImage(act: KeyAction<OpenSettings>, s: OpenSettings): Promise<void> {
		const wantIcon = s.useAppIcon !== false && !!s.appPath;
		const key = wantIcon ? s.appPath! : "";
		if (this.appliedImage.get(act.id) === key) return;
		this.appliedImage.set(act.id, key);

		if (!wantIcon) {
			await act.setImage();
			return;
		}
		const icons = await platform.getIcons([s.appPath!], 144);
		const img = icons[s.appPath!] ?? letterIcon(s.appName || platform.appNameFromPath(s.appPath!));
		// Confere se as configurações não mudaram enquanto o ícone era gerado.
		if (this.appliedImage.get(act.id) === key) await act.setImage(img);
	}

	/** Ícones da lista de apps, em lotes, conforme ficam prontos. */
	private async sendIcons(apps: { path: string }[], send: (p: JsonValue) => Promise<void>): Promise<void> {
		const t0 = Date.now();
		try {
			const icons = await platform.getIcons(
				apps.map((a) => a.path),
				64,
				(batch) => send({ type: "icons", icons: batch }),
			);
			log.info(`Ícones: ${Object.keys(icons).length}/${apps.length} em ${Date.now() - t0}ms`);
		} catch (err) {
			log.error("Icons", err);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OpenSettings>): Promise<void> {
		const msg = ev.payload as PiMessage;
		if (!msg || typeof msg !== "object" || !("cmd" in msg)) return;
		const context = ev.action.id;
		const send = (payload: JsonValue) => sendToPI(context, payload);

		try {
			switch (msg.cmd) {
				case "hello":
					await this.sendEnv(context);
					break;

				case "setLanguage": {
					await this.loadLanguage();
					// A UI já gravou nas configurações globais; aqui só atualizamos a memória.
					this.langPref = normalizePref(msg.lang);
					await send(this.envPayload());
					break;
				}

				case "listApps": {
					const t0 = Date.now();
					await this.loadLanguage();
					const wantIcons = msg.icons !== false;
					// A lista velha vai na hora; se a nova varredura mudar algo, a interface recebe de novo.
					const apps = await platform.listApps(!!msg.force, this.lang, (updated) => {
						void send({ type: "apps", apps: updated });
						if (wantIcons) void this.sendIcons(updated, send);
					});
					await send({ type: "apps", apps });
					log.info(`listApps: ${apps.length} apps em ${Date.now() - t0}ms (ícones: ${wantIcons ? "sim" : "não"})`);
					if (wantIcons) void this.sendIcons(apps, send);
					break;
				}

				case "appInfo": {
					const icons = await platform.getIcons([msg.appPath], 64);
					await send({
						type: "appInfo",
						app: { name: platform.appNameFromPath(msg.appPath), path: msg.appPath, electron: platform.isElectron(msg.appPath) },
						icon: icons[msg.appPath] ?? null,
					});
					break;
				}

				case "pick": {
					await this.loadLanguage();
					const { paths, names } = await platform.pick(msg.kind, msg.multiple ?? true, msg.defaultLocation, this.lang);
					const payload: Record<string, JsonValue> = { type: "picked", kind: msg.kind, paths, reqId: msg.reqId ?? null };
					if (msg.kind === "app" && paths[0]) {
						const app = paths[0];
						const icons = await platform.getIcons([app], 64);
						payload.app = {
							name: names?.[app] || platform.appNameFromPath(app),
							path: app,
							electron: platform.isElectron(app),
						};
						payload.icon = icons[app] ?? null;
					}
					await send(payload);
					break;
				}

				case "checkPaths": {
					const status: Record<string, { exists: boolean; dir: boolean }> = {};
					// Em paralelo: um caminho de rede lento não pode segurar os outros.
					await Promise.all((msg.paths ?? []).map(async (p) => (status[p] = await platform.pathKind(p))));
					await send({ type: "pathStatus", status });
					break;
				}

				case "run": {
					if (ev.action.isKey()) {
						const settings = await ev.action.getSettings();
						await this.execute(ev.action, settings);
						await send({ type: "ran" });
					}
					break;
				}
			}
		} catch (err) {
			log.error(`Command ${msg.cmd} failed`, err);
			await send({ type: "error", cmd: msg.cmd, message: err instanceof Error ? err.message : String(err) });
		}
	}
}

