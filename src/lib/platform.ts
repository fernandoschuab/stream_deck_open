import { macPlatform } from "./mac";
import type { Platform } from "./types";
import { windowsPlatform } from "./windows";

/** Escolhe a implementação do sistema atual. OPENWITH_PLATFORM força uma delas (testes). */
function select(): Platform {
	const forced = process.env.OPENWITH_PLATFORM;
	if (forced === "windows") return windowsPlatform;
	if (forced === "mac") return macPlatform;
	return process.platform === "win32" ? windowsPlatform : macPlatform;
}

export const platform: Platform = select();
export type { AppInfo, PickKind, Platform } from "./types";
