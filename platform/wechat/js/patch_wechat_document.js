// Emscripten calls document.querySelector and document.getElementById.
// WeChat's host document has neither, and replacing the global binding does
// not stick. Define the methods on the object the engine actually calls.
(function () {
	var root = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : window);
	function screenCanvas() {
		return root.__godotWeChatCanvas || null;
	}
	var methods = {
		querySelector: function (selector) {
			return selector === "#canvas" || selector === "canvas" ? screenCanvas() : null;
		},
		getElementById: function (id) {
			return id === "canvas" ? screenCanvas() : null;
		},
		getElementsByTagName: function (tag) {
			var canvas = screenCanvas();
			return tag === "canvas" && canvas ? [canvas] : [];
		},
		createElement: function (tag) {
			if (tag === "canvas" && typeof wx !== "undefined" && wx.createCanvas) {
				return wx.createCanvas();
			}
			return {
				style: {},
				appendChild: function () {},
				setAttribute: function () {},
				addEventListener: function () {},
				removeEventListener: function () {},
				remove: function () {},
			};
		},
		addEventListener: function () {},
		removeEventListener: function () {},
		exitPointerLock: function () {},
		exitFullscreen: function () {
			return Promise.resolve();
		},
	};
	var host = typeof document !== "undefined" ? document : null;
	if (host) {
		Object.keys(methods).forEach(function (name) {
			if (typeof host[name] === "function") {
				return;
			}
			try {
				Object.defineProperty(host, name, { configurable: true, writable: true, value: methods[name] });
			} catch (error) {
				try {
					host[name] = methods[name];
				} catch (assignError) {
					// Leave the missing method for the canvas lookup below.
				}
			}
		});
		if (!host.body) {
			try {
				host.body = { appendChild: function () {}, style: {} };
			} catch (error) {
				// Body is only needed by browser-only helpers.
			}
		}
		if (!host.head) {
			try {
				host.head = { appendChild: function () {} };
			} catch (error) {
				// Head is only needed by the window-icon helper.
			}
		}
	}
})();

findEventTarget = function (target) {
	target = maybeCStringToJsString(target);
	var root = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : window);
	var canvas = root.__godotWeChatCanvas || null;
	if (target == 1) {
		return root.document || canvas;
	}
	if (target == 2) {
		return root;
	}
	if (target === "#canvas" || target === "canvas" || target === ".emscripten") {
		return canvas;
	}
	var doc = root.document;
	if (doc && typeof doc.querySelector === "function") {
		var found = doc.querySelector(target);
		if (found) {
			return found;
		}
	}
	return canvas;
};
findCanvasEventTarget = findEventTarget;
