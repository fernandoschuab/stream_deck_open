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
	pathKind(p: string): Promise<PathKind>;
	isElectron(appPath: string): boolean;
	appNameFromPath(appPath: string): string;
	openItems(opts: OpenOptions): Promise<OpenResult>;
	pick(kind: PickKind, multiple: boolean, defaultLocation: string | undefined, lang: Lang): Promise<PickResult>;
	/** `onUpdate` é chamado se a lista devolvida estava velha e a nova ficou diferente. */
	listApps(force: boolean, lang: Lang, onUpdate?: (apps: AppInfo[]) => void): Promise<AppInfo[]>;
	getIcons(
		appPaths: string[],
		size: number,
		onBatch?: (icons: Record<string, string>) => void | Promise<void>,
	): Promise<Record<string, string>>;
	readSystemLanguage(): Promise<string | undefined>;
}
