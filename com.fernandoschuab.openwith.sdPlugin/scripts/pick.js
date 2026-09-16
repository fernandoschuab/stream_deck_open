// Seletor nativo do macOS (JXA). Uso: osascript -l JavaScript pick.js '{"kind":"folder","multiple":true}'
function run(argv) {
	var opts = JSON.parse(argv[0] || "{}");
	var app = Application.currentApplication();
	app.includeStandardAdditions = true;
	app.activate(); // traz o diálogo para frente

	var params = {
		withPrompt: opts.prompt || "Escolha",
		multipleSelectionsAllowed: !!opts.multiple,
		showingPackageContents: false,
		invisibles: false
	};
	if (opts.defaultLocation) params.defaultLocation = Path(opts.defaultLocation);

	try {
		var r;
		if (opts.kind === "folder") {
			r = app.chooseFolder(params);
		} else if (opts.kind === "app") {
			params.multipleSelectionsAllowed = false;
			params.ofType = ["com.apple.application-bundle"];
			if (!opts.defaultLocation) params.defaultLocation = Path("/Applications");
			r = app.chooseFile(params);
		} else {
			r = app.chooseFile(params);
		}
		var list = Array.isArray(r) ? r : [r];
		var paths = list.map(function (x) { return x.toString(); });
		return JSON.stringify({ ok: true, paths: paths });
	} catch (e) {
		if (e && e.errorNumber === -128) return JSON.stringify({ ok: true, paths: [] }); // cancelado
		return JSON.stringify({ ok: false, error: String(e) });
	}
}
