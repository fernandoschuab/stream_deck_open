// Gera PNGs dos ícones de apps via NSWorkspace (JXA).
// Uso: osascript -l JavaScript icons.js '[{"app":"/Applications/X.app","out":"/tmp/x.png","size":64}]'
ObjC.import("AppKit");

function run(argv) {
	var jobs = JSON.parse(argv[0] || "[]");
	var ws = $.NSWorkspace.sharedWorkspace;
	var results = [];
	for (var i = 0; i < jobs.length; i++) {
		var j = jobs[i];
		try {
			var s = j.size;
			var img = ws.iconForFile($(j.app));
			var rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
				null, s, s, 8, 4, true, false, $("NSDeviceRGBColorSpace"), 0, 0
			);
			rep.setSize($.NSMakeSize(s, s));
			$.NSGraphicsContext.saveGraphicsState;
			var ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
			$.NSGraphicsContext.setCurrentContext(ctx);
			ctx.setImageInterpolation(3); // NSImageInterpolationHigh
			// operation 2 = NSCompositingOperationSourceOver
			img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, s, s), $.NSMakeRect(0, 0, 0, 0), 2, 1.0);
			$.NSGraphicsContext.restoreGraphicsState;
			// 4 = NSBitmapImageFileTypePNG
			var png = rep.representationUsingTypeProperties(4, $());
			results.push(!png.isNil() && png.writeToFileAtomically($(j.out), true));
		} catch (e) {
			results.push(false);
		}
	}
	return JSON.stringify(results);
}
