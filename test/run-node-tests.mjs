// Roda os testes de Node: unidade (src/lib) + ponta a ponta do plugin (mac e windows simulados).
// Uso: npm run build && node test/run-node-tests.mjs
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openwith-unit-"));

// 1) Compila src/lib para ESM puro e corrige os imports relativos (.js).
execFileSync(
	path.join(root, "node_modules", ".bin", "tsc"),
	["src/lib/platform.ts", "--outDir", tmp, "--module", "ES2022", "--target", "ES2022", "--moduleResolution", "Bundler", "--types", "node", "--skipLibCheck"],
	{ cwd: root, stdio: "inherit" },
);
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
for (const f of fs.readdirSync(tmp).filter((f) => f.endsWith(".js"))) {
	const p = path.join(tmp, f);
	fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/from "\.\/([\w-]+)";/g, 'from "./$1.js";'));
}
fs.copyFileSync(path.join(root, "test", "unit.mjs"), path.join(tmp, "unit.mjs"));

const step = (name, cmd, args, opts = {}) => {
	console.log(`\n▶ ${name}`);
	const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
	if (r.status !== 0) {
		console.error(`✖ ${name}`);
		process.exit(1);
	}
};

step("unit", process.execPath, [path.join(tmp, "unit.mjs")]);
// Pasta temporária para o cache de ícones do "Windows" simulado (senão vira uma pasta dentro do plugin).
const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), "openwith-lad-"));
step("e2e windows (simulado)", process.execPath, [path.join(root, "test", "plugin_e2e.mjs")], {
	env: { ...process.env, E2E_PLATFORM: "windows", LOCALAPPDATA: localAppData, LC_ALL: "pt_BR.UTF-8", LANG: "pt_BR.UTF-8" },
});
step("colar tecla copiada (ordens de eventos)", process.execPath, [path.join(root, "test", "paste_repro.mjs")]);
step("e2e mac", process.execPath, [path.join(root, "test", "plugin_e2e.mjs")], {
	env: { ...process.env, E2E_PLATFORM: "mac", E2E_EXPECT_LANG: process.env.E2E_EXPECT_LANG_MAC || "" },
});
console.log("\n✔ node tests OK");
