import type { Lang } from "./i18n";

export type PlatformId = "mac" | "windows";
export type AppInfo = { name: string; path: string; electron: boolean };
export type PickKind = "folder" | "file" | "app";
export type PickResult = { paths: string[]; names?: Record<string, string> };
export type PathKind = { exists: boolean; dir: boolean };

export type OpenOptions = {
	app: string;
	paths: string[];
	mode: "separate" | "together";
	newInstance: boolean;
	delay: number;
};

export type OpenResult = { missing: string[]; calls: string[][] };

/** O que cada sistema operacional precisa fornecer. */
export interface Platform {
	readonly id: PlatformId;
	readonly home: string;
	normalizePath(p: string): string;
	pathKind(p: string): PathKind;
	isElectron(appPath: string): boolean;
	appNameFromPath(appPath: string): string;
	openItems(opts: OpenOptions): Promise<OpenResult>;
	pick(kind: PickKind, multiple: boolean, defaultLocation: string | undefined, lang: Lang): Promise<PickResult>;
	listApps(force: boolean, lang: Lang): Promise<AppInfo[]>;
	getIcons(
		appPaths: string[],
		size: number,
		onBatch?: (icons: Record<string, string>) => void | Promise<void>,
	): Promise<Record<string, string>>;
	readSystemLanguage(): Promise<string | undefined>;
}
