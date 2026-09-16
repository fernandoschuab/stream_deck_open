// Reproduz copiar/colar uma tecla: várias ordens de eventos do Stream Deck.
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import path from "node:path";

const SDP = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../com.fernandoschuab.openwith.sdPlugin");
const UUID = "com.fernandoschuab.openwith";
const ACTION = `${UUID}.open`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const info = { application: { font: "x", language: "en", platform: "mac", platformVersion: "15.0", version: "7.1.0.21000" }, colors: {}, devicePixelRatio: 2, devices: [{ id: "DEV", name: "SD", size: { columns: 5, rows: 3 }, type: 0 }], plugin: { uuid: UUID, version: "1.1.0.0" } };
const settings = { appPath: "/Applications/X.app", appName: "X", paths: ["/tmp"], useAppIcon: false };
const wa = (ctx, row) => ({ event: "willAppear", action: ACTION, context: ctx, device: "DEV", payload: { settings, coordinates: { column: 0, row }, controller: "Keypad", isInMultiAction: false } });
const pa = (ctx) => ({ event: "propertyInspectorDidAppear", action: ACTION, context: ctx, device: "DEV" });
const pd = (ctx) => ({ event: "propertyInspectorDidDisappear", action: ACTION, context: ctx, device: "DEV" });
const hello = (ctx) => ({ event: "sendToPlugin", action: ACTION, context: ctx, payload: { cmd: "hello" } });

const scenarios = {
	"A: willAppear, disappear old, appear new, hello": [wa("K2", 1), pd("K1"), pa("K2"), hello("K2")],
	"B: appear new BEFORE willAppear": [pd("K1"), pa("K2"), hello("K2"), wa("K2", 1)],
	"C: appear new, then disappear old": [wa("K2", 1), pa("K2"), pd("K1"), hello("K2")],
	"D: hello before appear": [wa("K2", 1), pd("K1"), hello("K2"), pa("K2")],
	"E: no disappear for old, appear new": [wa("K2", 1), pa("K2"), hello("K2")],
	"F: pasted twice appear/disappear new": [wa("K2", 1), pa("K2"), pd("K2"), pa("K2"), pd("K1"), hello("K2")],
	"G: appear old again after new (stack)": [wa("K2", 1), pa("K1"), pa("K2"), pd("K1"), hello("K2")],
};

let failed = 0;
for (const [name, steps] of Object.entries(scenarios)) {
	const wss = new WebSocketServer({ port: 0 });
	const got = [];
	let sock;
	wss.on("connection", (ws) => {
		sock = ws;
		ws.on("message", (d) => {
			const m = JSON.parse(d);
			got.push(m);
			if (m.event === "getGlobalSettings") ws.send(JSON.stringify({ event: "didReceiveGlobalSettings", id: m.id, payload: { settings: {} } }));
		});
	});
	const child = spawn(process.execPath, ["bin/plugin.js", "-port", String(wss.address().port), "-pluginUUID", UUID, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)], { cwd: SDP, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, OPENWITH_PLATFORM: "mac" } });
	let err = "";
	child.stderr.on("data", (d) => (err += d));
	while (!sock) await wait(20);
	await wait(100);
	const send = (o) => sock.send(JSON.stringify(o));
	send(wa("K1", 0));
	send(pa("K1"));
	send(hello("K1"));
	await wait(400);
	got.length = 0;
	for (const s of steps) {
		send(s);
		await wait(80);
	}
	// PI repete o hello (como a UI faz)
	for (let i = 0; i < 3 && !got.some((m) => m.event === "sendToPropertyInspector" && m.context === "K2"); i++) {
		await wait(600);
		send(hello("K2"));
	}
	await wait(500);
	const toPI = got.filter((m) => m.event === "sendToPropertyInspector").map((m) => `${m.context}:${m.payload?.type}`);
	const ok = toPI.some((x) => x === "K2:env");
	if (!ok) failed++;
	console.log(`${ok ? "OK  " : "FAIL"} ${name}  ->  ${toPI.join(", ") || "(nada)"}${err ? "  STDERR: " + err.slice(0, 200) : ""}`);
	child.kill();
	wss.close();
}
if (failed) {
	console.error(`${failed} cenário(s) falharam`);
	process.exit(1);
}
console.log("PASTE OK");
