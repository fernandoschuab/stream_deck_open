import assert from "node:assert/strict";
import { normalizePath, filterStartMenuApps, planCalls, decodePsOutput, launch, appNameFromPath } from "./windows.js";
import { parseAppleLanguages } from "./mac.js";
const H = "C:\\Users\\Fer";
const env = { USERPROFILE: H, ProgramFiles: "C:\\Program Files" };
const n = (p) => normalizePath(p, H, env);
assert.equal(n('"C:\\Projetos\\API\\"'), "C:\\Projetos\\API");
assert.equal(n("C:/Projetos/Domus Admin/"), "C:\\Projetos\\Domus Admin");
assert.equal(n("~\\Projects\\x"), "C:\\Users\\Fer\\Projects\\x");
assert.equal(n("~/Projects/x"), "C:\\Users\\Fer\\Projects\\x");
assert.equal(n("%userprofile%\\Documents"), "C:\\Users\\Fer\\Documents");
assert.equal(n("%NOPE%\\x"), "%NOPE%\\x");
assert.equal(n("C:\\"), "C:\\");
assert.equal(n("C:"), "C:\\");
assert.equal(n("file:///C:/Users/Fer/Meus%20Projetos/"), "C:\\Users\\Fer\\Meus Projetos");
assert.equal(n("/C:/Users/Fer/x"), "C:\\Users\\Fer\\x");
assert.equal(n("\\\\servidor\\share\\pasta\\"), "\\\\servidor\\share\\pasta");
assert.equal(n("C:\\a\\..\\b\\.\\c"), "C:\\b\\c");
assert.equal(n("C:\\Pasta com ç e ã\\"), "C:\\Pasta com ç e ã");
assert.equal(n(""), "");
assert.equal(appNameFromPath("C:\\Program Files\\Code\\Code.exe"), "Code");
assert.deepEqual(planCalls(["a", "b"], 3, "separate"), [["a"], ["b"]]);
assert.deepEqual(planCalls(["a", "b"], 2, "together"), [["a", "b"]]);
assert.deepEqual(planCalls([], 0, "separate"), [[]]);
assert.deepEqual(planCalls([], 2, "together"), []);
const apps = filterStartMenuApps([
  { name: "Visual Studio Code", path: "C:\\VS\\Code.exe" },
  { name: "Uninstall Visual Studio Code", path: "C:\\VS\\unins000.exe" },
  { name: "Code (dup)", path: "c:\\vs\\code.exe" },
  { name: "Cursor", path: "C:\\Cursor\\Cursor.exe" },
  { name: "Desinstalar Foo", path: "C:\\Foo\\foo.exe" },
  { name: "Foo Updater", path: "C:\\Foo\\Update.exe" },
]);
assert.deepEqual(apps.map((a) => a.name), ["Visual Studio Code", "Cursor"]);
const enc = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
assert.deepEqual(decodePsOutput(enc({ ok: true, paths: ["C:\\Ação"] }) + "\r\n").paths, ["C:\\Ação"]);
assert.throws(() => decodePsOutput(enc({ ok: false, error: "boom" })), /boom/);
await launch(process.execPath, ["-e", "0", "C:\\x y"]);
await assert.rejects(launch("/nao/existe.exe", []));
assert.equal(parseAppleLanguages('(\n    "pt-BR",\n    "en-US"\n)\n'), "pt-BR");
console.log("WINDOWS UNIT OK");

/* ---------------------------------------------------------------- cache de ícones e de apps */
import fs from "node:fs";
import os from "node:os";
import pathMod from "node:path";
import { createIconCache, createAppCache } from "./common.js";

const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), "openwith-cache-"));
const fakeApp = (name) => {
  const p = pathMod.join(tmpDir, name);
  fs.writeFileSync(p, "app");
  return p;
};
const writePng = (out) => fs.writeFileSync(out, Buffer.alloc(300, 7));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Vários pedidos ao mesmo tempo viram uma chamada só (várias teclas aparecendo juntas).
{
  const calls = [];
  const icons = createIconCache(pathMod.join(tmpDir, "c1"), async (jobs) => {
    calls.push(jobs.length);
    await wait(20);
    for (const j of jobs) writePng(j.out);
  }, { chunkSize: 24, concurrency: 2, coalesceMs: 30 });
  const apps = Array.from({ length: 8 }, (_, i) => fakeApp(`k${i}.app`));
  const res = await Promise.all(apps.map((a) => icons([a], 144)));
  assert.equal(calls.length, 1, `esperava 1 chamada do gerador, veio ${calls.join("+")}`);
  assert.equal(calls[0], 8);
  for (let i = 0; i < apps.length; i++) assert.ok(res[i][apps[i]].startsWith("data:image/png;base64,"));
  // Segunda vez: vem do cache, sem gerar nada.
  await icons(apps, 144);
  assert.equal(calls.length, 1, "o cache em memória deveria evitar nova geração");
}

// 2) Muitos ícones: lotes limitados e no máximo 2 geradores ao mesmo tempo.
{
  let running = 0;
  let peak = 0;
  const sizes = [];
  const icons = createIconCache(pathMod.join(tmpDir, "c2"), async (jobs) => {
    running++;
    peak = Math.max(peak, running);
    sizes.push(jobs.length);
    await wait(15);
    for (const j of jobs) writePng(j.out);
    running--;
  }, { chunkSize: 10, concurrency: 2, coalesceMs: 5, flushMs: 5 });
  const apps = Array.from({ length: 45 }, (_, i) => fakeApp(`m${i}.app`));
  const batches = [];
  const res = await icons(apps, 64, (b) => batches.push(Object.keys(b).length));
  assert.equal(Object.keys(res).length, 45);
  assert.ok(peak <= 2, `geradores simultâneos: ${peak}`);
  assert.ok(sizes.every((n) => n <= 10), `lote grande demais: ${sizes}`);
  assert.ok(batches.length >= 2, "os ícones deveriam chegar em lotes, não de uma vez só");
}

// 3) Cache em disco entre execuções (instância nova não regera).
{
  const dir = pathMod.join(tmpDir, "c3");
  const app = fakeApp("disco.app");
  let gen = 0;
  const mk = () => createIconCache(dir, async (jobs) => { gen++; for (const j of jobs) writePng(j.out); }, { coalesceMs: 1 });
  await mk()([app], 64);
  await mk()([app], 64);
  assert.equal(gen, 1, "o PNG em disco deveria ser reaproveitado");
}

// 4) Lista de apps: entrega a lista velha na hora e avisa quando a nova fica pronta.
{
  const file = pathMod.join(tmpDir, "apps.json");
  let scans = 0;
  const scan = async () => {
    scans++;
    await wait(30);
    return scans === 1 ? [{ name: "A", path: "/A", electron: false }] : [{ name: "A", path: "/A", electron: false }, { name: "B", path: "/B", electron: false }];
  };
  const list = createAppCache(file, scan, 50);
  assert.equal((await list(false, "pt")).length, 1);
  assert.equal(scans, 1);
  await wait(60); // agora está velha
  let updated = null;
  const t0 = Date.now();
  const again = await list(false, "pt", (apps) => (updated = apps));
  assert.equal(again.length, 1, "a lista velha deve voltar na hora");
  assert.ok(Date.now() - t0 < 20, "não deveria esperar a varredura");
  await wait(80);
  assert.equal(updated?.length, 2, "a lista nova deveria chegar depois");
  // Instância nova aproveita o arquivo em disco, sem varrer.
  let scans2 = 0;
  const list2 = createAppCache(file, async () => { scans2++; return []; }, 60_000);
  assert.equal((await list2(false, "pt")).length, 2);
  assert.equal(scans2, 0, "deveria vir do cache em disco");
}
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("CACHE UNIT OK");
