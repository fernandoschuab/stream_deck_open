// Teste ponta a ponta do backend: um "Stream Deck" falso via WebSocket executa bin/plugin.js.
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import path from "node:path";
import assert from "node:assert/strict";

const SDP = path.resolve("../com.fernandoschuab.openwith.sdPlugin");
const UUID = "com.fernandoschuab.openwith";
const ACTION = `${UUID}.open`;
const wss = new WebSocketServer({ port: 0 });
const port = wss.address().port;
const got = [];
let sock;
const send = (o) => sock.send(JSON.stringify(o));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 4000) => {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		const f = got.find(pred);
		if (f) return f;
		await wait(25);
	}
	throw new Error("timeout waiting; got=" + JSON.stringify(got.map((g) => g.event + ":" + JSON.stringify(g.payload ?? {})), null, 1));
};

wss.on("connection", (ws) => {
	sock = ws;
	ws.on("message", (d) => {
		const m = JSON.parse(d);
		got.push(m);
		if (m.event === "getGlobalSettings") send({ event: "didReceiveGlobalSettings", id: m.id, payload: { settings: {} } });
	});
});

const info = {
	application: { font: "x", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.21000" },
	colors: {}, devicePixelRatio: 2,
	devices: [{ id: "DEV", name: "SD", size: { columns: 5, rows: 3 }, type: 0 }],
	plugin: { uuid: UUID, version: "1.0.0.0" },
};
const child = spawn(process.execPath, ["bin/plugin.js", "-port", String(port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { cwd: SDP, stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => (stderr += d));

try {
	await waitFor((m) => m.event === "registerPlugin");
	const ctx = "KEY1";
	send({ event: "willAppear", action: ACTION, context: ctx, device: "DEV", payload: { settings: { useAppIcon: false }, coordinates: { column: 0, row: 0 }, controller: "Keypad", isInMultiAction: false } });
	await wait(100);

	// 1) A UI manda "hello" ANTES do propertyInspectorDidAppear (a corrida que perdia a resposta).
	send({ event: "sendToPlugin", action: ACTION, context: ctx, payload: { cmd: "hello" } });
	await wait(400);
	assert.equal(got.filter((m) => m.event === "sendToPropertyInspector").length, 0, "nada deveria sair antes do didAppear");
	send({ event: "propertyInspectorDidAppear", action: ACTION, context: ctx, device: "DEV" });
	const env1 = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "env");
	console.log("env1", env1.payload);
	assert.equal(env1.payload.autoLang, "pt");
	assert.equal(env1.payload.lang, "pt");

	// 2) UI grava preferência (global) e avisa o plugin.
	got.length = 0;
	send({ event: "didReceiveGlobalSettings", payload: { settings: { language: "es" } } });
	send({ event: "sendToPlugin", action: ACTION, context: ctx, payload: { cmd: "setLanguage", lang: "es" } });
	const env2 = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "env");
	console.log("env2", env2.payload);
	assert.equal(env2.payload.lang, "es");
	assert.equal(env2.payload.langPref, "es");
	assert.ok(!got.some((m) => m.event === "setGlobalSettings"), "plugin não deve regravar as configurações globais");

	// 3) Preferência alterada só pelas configurações globais.
	got.length = 0;
	send({ event: "didReceiveGlobalSettings", payload: { settings: { language: "auto" } } });
	await wait(100);
	send({ event: "sendToPlugin", action: ACTION, context: ctx, payload: { cmd: "hello" } });
	const env3 = await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload?.type === "env");
	assert.equal(env3.payload.lang, "pt");
	console.log("PLUGIN E2E OK");
} catch (e) {
	console.error(e.message, "\nstderr:", stderr);
	process.exitCode = 1;
} finally {
	child.kill();
	wss.close();
}
