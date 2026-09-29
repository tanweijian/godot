/**
 * Narrow host bridge for Emscripten's WebGL entry.
 *
 * This is not a browser DOM/BOM emulator. It only supplies the canvas, window
 * metrics, and no-op listeners that the engine touches while creating a WebGL 2
 * context. Calls that need a later WeChat host API should fail visibly in the
 * dedicated libraries for those tickets.
 */
(function () {
	var root = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : this);
	if (typeof document === "object" && document && typeof document.querySelector !== "function") {
		document.querySelector = function (selector) {
			var canvas = root.__godotWeChatCanvas;
			return selector === "#canvas" || selector === "canvas" ? canvas : null;
		};
			document.getElementById = function (id) {
			return id === "canvas" ? root.__godotWeChatCanvas : null;
		};
	}
	if (typeof AudioWorkletNode === "undefined") {
		root.AudioWorkletNode = function AudioWorkletNode() {
			this.connect = function () {};
			this.disconnect = function () {};
			this.port = { postMessage: function () {}, onmessage: null };
		};
	}
	// Emscripten aborts with "no native wasm support detected" unless the
	// global WebAssembly object exists. WeChat exposes WXWebAssembly instead.
	if (typeof root.WebAssembly !== "object" && typeof WXWebAssembly === "object") {
		root.WebAssembly = WXWebAssembly;
	}
	if (typeof root.WebAssembly === "object" && typeof root.WebAssembly.RuntimeError !== "function") {
		function WeChatWasmRuntimeError(message) {
			var error = new Error(message);
			error.name = "RuntimeError";
			Object.setPrototypeOf(error, WeChatWasmRuntimeError.prototype);
			return error;
		}
		WeChatWasmRuntimeError.prototype = Object.create(Error.prototype);
		WeChatWasmRuntimeError.prototype.constructor = WeChatWasmRuntimeError;
		root.WebAssembly.RuntimeError = WeChatWasmRuntimeError;
	}
	if (typeof root.window === "undefined") {
		root.window = root;
	}
	if (typeof root.self === "undefined") {
		root.self = root;
	}
	if (typeof root.navigator === "undefined") {
		root.navigator = {
			userAgent: "WeChatMiniGame",
			language: "zh_CN",
			languages: ["zh_CN"],
			platform: "",
			getGamepads: function () {
				return [];
			},
		};
	} else if (typeof root.navigator.getGamepads !== "function") {
		root.navigator.getGamepads = function () {
			return [];
		};
	}
	if (typeof root.devicePixelRatio !== "number") {
		root.devicePixelRatio = 1;
	}
	if (typeof root.innerWidth !== "number") {
		root.innerWidth = 480;
	}
	if (typeof root.innerHeight !== "number") {
		root.innerHeight = 854;
	}
	if (!root.screen) {
		root.screen = { width: root.innerWidth, height: root.innerHeight, availWidth: root.innerWidth, availHeight: root.innerHeight };
	}
	if (typeof root.alert !== "function") {
		root.alert = function (message) {
			console.error("[Godot] " + message);
			if (typeof wx !== "undefined" && wx.showModal) {
				wx.showModal({ title: "Godot", content: String(message), showCancel: false });
			}
		};
	}
	if (typeof root.requestAnimationFrame !== "function" && typeof wx !== "undefined" && wx.requestAnimationFrame) {
		root.requestAnimationFrame = function (callback) {
			return wx.requestAnimationFrame(callback);
		};
		root.cancelAnimationFrame = function (id) {
			if (wx.cancelAnimationFrame) {
				wx.cancelAnimationFrame(id);
			}
		};
	}
	if (typeof root.performance === "undefined") {
		root.performance = { now: function () { return Date.now(); } };
	}
	if (typeof root.location === "undefined") {
		root.location = { href: "wechat://minigame/", pathname: "/", protocol: "wechat:", search: "", hostname: "minigame" };
	}

	function decorateCanvas(canvas) {
		if (!canvas) {
			return canvas;
		}
		if (!canvas.id) {
			canvas.id = "canvas";
		}
		if (!canvas.style) {
			canvas.style = {};
		}
		if (typeof canvas.addEventListener !== "function") {
			canvas.addEventListener = function () {};
		}
		if (typeof canvas.removeEventListener !== "function") {
			canvas.removeEventListener = function () {};
		}
		if (typeof canvas.focus !== "function") {
			canvas.focus = function () {};
		}
		if (typeof canvas.getBoundingClientRect !== "function") {
			canvas.getBoundingClientRect = function () {
				return { left: 0, top: 0, width: canvas.width || 0, height: canvas.height || 0, right: canvas.width || 0, bottom: canvas.height || 0 };
			};
		}
		return canvas;
	}

	function ensureCanvas() {
		if (root.__godotWeChatCanvas) {
			return decorateCanvas(root.__godotWeChatCanvas);
		}
		if (typeof wx === "undefined" || !wx.createCanvas) {
			return null;
		}
		root.__godotWeChatCanvas = decorateCanvas(wx.createCanvas());
		return root.__godotWeChatCanvas;
	}

	if (!root.document || typeof root.document !== "object") {
		root.document = {};
	}
	if (typeof root.document.querySelector !== "function" || typeof root.document.getElementById !== "function") {
		root.document = {
			getElementById: function (id) {
				return id === "canvas" ? ensureCanvas() : null;
			},
			querySelector: function (selector) {
				return selector === "#canvas" || selector === "canvas" ? ensureCanvas() : null;
			},
			querySelectorAll: function () {
				return [];
			},
			getElementsByTagName: function (tag) {
				if (tag === "canvas") {
					var canvas = ensureCanvas();
					return canvas ? [canvas] : [];
				}
				return [];
			},
			createElement: function (tag) {
				if (tag === "canvas") {
					if (root.__godotWeChatCanvas) {
						return decorateCanvas(root.__godotWeChatCanvas);
					}
					if (typeof wx !== "undefined" && wx.createCanvas) {
						return decorateCanvas(wx.createCanvas());
					}
				}
				return {
					style: {},
					appendChild: function () {},
					setAttribute: function () {},
					addEventListener: function () {},
					removeEventListener: function () {},
					remove: function () {},
					insertAdjacentElement: function () {},
				};
			},
			addEventListener: function () {},
			removeEventListener: function () {},
			exitPointerLock: function () {},
			exitFullscreen: function () {
				return Promise.resolve();
			},
			body: { appendChild: function () {}, style: {}, clientWidth: root.innerWidth, clientHeight: root.innerHeight },
			head: { appendChild: function () {} },
			documentElement: { style: {} },
			activeElement: null,
			fullscreenElement: null,
			pointerLockElement: null,
			visibilityState: "visible",
			hidden: false,
			title: "",
			currentScript: null,
		};
	}
	root.GodotWeChatHost = { ensureCanvas: ensureCanvas };
})();
