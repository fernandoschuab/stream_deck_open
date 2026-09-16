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
