import streamDeck, {
	action,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import {
	appNameFromPath,
	getIcons,
	HOME,
	isElectron,
	letterIcon,
	listApps,
	openItems,
	pathKind,
	pick,
	type PickKind,
} from "../lib/mac";

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
	| { cmd: "listApps"; force?: boolean }
	| { cmd: "pick"; kind: PickKind; multiple?: boolean; defaultLocation?: string; reqId?: string }
	| { cmd: "checkPaths"; paths: string[] }
	| { cmd: "appInfo"; appPath: string }
	| { cmd: "run" };

const log = streamDeck.logger.createScope("OpenWith");

@action({ UUID: "com.fernandoschuab.openwith.open" })
export class OpenWith extends SingletonAction<OpenSettings> {
	/** Último app aplicado como imagem, por instância da tecla. */
	private readonly appliedImage = new Map<string, string>();

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
			log.warn("Nenhum programa configurado.");
			await act.showAlert();
			return;
		}
		try {
			const { missing, calls } = await openItems({
				app: s.appPath,
				paths: s.paths ?? [],
				mode: s.mode ?? "separate",
				newInstance: s.newInstance ?? false,
				delay: Math.max(0, Math.min(10_000, Number(s.delay ?? 300))),
			});
			log.info(`Executado: ${JSON.stringify(calls)}`);
			if (missing.length) {
				log.warn(`Caminhos não encontrados: ${missing.join(", ")}`);
				await act.showAlert();
			} else {
				await act.showOk();
			}
		} catch (err) {
			log.error("Falha ao abrir", err);
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
		const icons = await getIcons([s.appPath!], 144);
		const img = icons[s.appPath!] ?? letterIcon(s.appName || appNameFromPath(s.appPath!));
		// Confere se as configurações não mudaram enquanto o ícone era gerado.
		if (this.appliedImage.get(act.id) === key) await act.setImage(img);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OpenSettings>): Promise<void> {
		const msg = ev.payload as PiMessage;
		if (!msg || typeof msg !== "object" || !("cmd" in msg)) return;
		const send = (payload: JsonValue) => streamDeck.ui.sendToPropertyInspector(payload);

		try {
			switch (msg.cmd) {
				case "hello":
					await send({ type: "env", home: HOME });
					break;

				case "listApps": {
					const apps = await listApps(!!msg.force);
					await send({ type: "apps", apps });
					void getIcons(
						apps.map((a) => a.path),
						64,
						(icons) => send({ type: "icons", icons }),
					).catch((e) => log.error("Ícones", e));
					break;
				}

				case "appInfo": {
					const icons = await getIcons([msg.appPath], 64);
					await send({
						type: "appInfo",
						app: { name: appNameFromPath(msg.appPath), path: msg.appPath, electron: isElectron(msg.appPath) },
						icon: icons[msg.appPath] ?? null,
					});
					break;
				}

				case "pick": {
					const paths = await pick(msg.kind, msg.multiple ?? true, msg.defaultLocation);
					const payload: Record<string, JsonValue> = { type: "picked", kind: msg.kind, paths, reqId: msg.reqId ?? null };
					if (msg.kind === "app" && paths[0]) {
						const icons = await getIcons([paths[0]], 64);
						payload.app = { name: appNameFromPath(paths[0]), path: paths[0], electron: isElectron(paths[0]) };
						payload.icon = icons[paths[0]] ?? null;
					}
					await send(payload);
					break;
				}

				case "checkPaths": {
					const status: Record<string, { exists: boolean; dir: boolean }> = {};
					for (const p of msg.paths ?? []) status[p] = pathKind(p);
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
			log.error(`Comando ${msg.cmd} falhou`, err);
			await send({ type: "error", cmd: msg.cmd, message: err instanceof Error ? err.message : String(err) });
		}
	}
}

