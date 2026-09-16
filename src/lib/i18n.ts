import { execFile } from "node:child_process";

export const LANGS = ["pt", "en", "es"] as const;
export type Lang = (typeof LANGS)[number];
export type LangPref = Lang | "auto";

const STRINGS = {
	pt: {
		pickFolders: "Escolha uma ou mais pastas",
		pickFolder: "Escolha uma pasta",
		pickFiles: "Escolha um ou mais arquivos",
		pickFile: "Escolha um arquivo",
		pickApp: "Escolha o programa",
	},
	en: {
		pickFolders: "Choose one or more folders",
		pickFolder: "Choose a folder",
		pickFiles: "Choose one or more files",
		pickFile: "Choose a file",
		pickApp: "Choose the application",
	},
	es: {
		pickFolders: "Elige una o más carpetas",
		pickFolder: "Elige una carpeta",
		pickFiles: "Elige uno o más archivos",
		pickFile: "Elige un archivo",
		pickApp: "Elige el programa",
	},
} satisfies Record<Lang, Record<string, string>>;

export type StringKey = keyof (typeof STRINGS)["en"];

export function toLang(code: string | undefined | null): Lang | undefined {
	const base = String(code ?? "").toLowerCase().split(/[-_]/)[0];
	return (LANGS as readonly string[]).includes(base) ? (base as Lang) : undefined;
}

/** Idioma principal do macOS (defaults read -g AppleLanguages). */
export function readSystemLanguage(): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], { timeout: 3000 }, (err, stdout) => {
			if (err) return resolve(undefined);
			const m = /"?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*)"?/.exec(String(stdout).replace(/[()\s,]+/g, " "));
			resolve(m?.[1]);
		});
	});
}

/** Resolve o idioma efetivo: preferência > macOS > Stream Deck > inglês. */
export function resolveLang(pref: LangPref | undefined, system?: string, streamDeck?: string): Lang {
	if (pref && pref !== "auto" && toLang(pref)) return pref;
	return toLang(system) ?? toLang(streamDeck) ?? "en";
}

export function tr(lang: Lang, key: StringKey): string {
	return STRINGS[lang]?.[key] ?? STRINGS.en[key];
}
