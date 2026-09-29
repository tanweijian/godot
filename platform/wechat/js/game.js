/**
 * WeChat Mini Game startup shell.
 *
 * Placeholders are replaced by the exporter. String placeholders are JSON
 * literals, including quotes.
 */
var GODOT_MIN_BASE_LIBRARY = ___GODOT_MIN_BASE_LIBRARY___;
var GODOT_RUNTIME_SUBPACKAGE = ___GODOT_RUNTIME_SUBPACKAGE___;
var GODOT_WASM_PATH = ___GODOT_WASM_PATH___;
var GODOT_JS_PATH = ___GODOT_JS_PATH___;
var GODOT_PCK_PATH = ___GODOT_PCK_PATH___;
var GODOT_REVISION = ___GODOT_REVISION___;
var GODOT_EMSCRIPTEN = ___GODOT_EMSCRIPTEN_VERSION___;
var GODOT_PROJECT_NAME = ___GODOT_PROJECT_NAME___;
var WeChatHost = require("./wechat_host_model.js");

function godotWeChatRoot() {
	return typeof GameGlobal !== "undefined" ? GameGlobal : (typeof window !== "undefined" ? window : globalThis);
}

function godotWeChatHost() {
	var root = godotWeChatRoot();
	if (!root.GodotWeChatHost) {
		root.GodotWeChatHost = WeChatHost.createHost();
	}
	return root.GodotWeChatHost;
}

var godotWeChatReported = {};

function godotWeChatFail(title, message) {
	var text = "[Godot] " + title + ": " + message;
	console.error(text);
	if (typeof wx !== "undefined" && wx.showModal) {
		var content = String(message);
		if (content.length > 900) {
			content = content.slice(0, 900) + "... See the console for the full log.";
		}
		wx.showModal({
			title: title,
			content: content,
			showCancel: false,
		});
	}
}

function godotWeChatReport(diagnosis) {
	if (!diagnosis) {
		return;
	}
	var key = diagnosis.title + ":" + diagnosis.fatal;
	if (godotWeChatReported[key]) {
		return;
	}
	godotWeChatReported[key] = true;
	if (diagnosis.fatal) {
		godotWeChatFail(diagnosis.title, diagnosis.message);
		return;
	}
	console.warn("[Godot] " + diagnosis.title + ": " + diagnosis.message);
}

function godotWeChatCompareVersion(left, right) {
	var leftParts = String(left).split(".");
	var rightParts = String(right).split(".");
	var count = Math.max(leftParts.length, rightParts.length);
	var i;
	for (i = 0; i < count; i++) {
		var leftNumber = parseInt(leftParts[i] || "0", 10);
		var rightNumber = parseInt(rightParts[i] || "0", 10);
		if (isNaN(leftNumber)) {
			leftNumber = 0;
		}
		if (isNaN(rightNumber)) {
			rightNumber = 0;
		}
		if (leftNumber > rightNumber) {
			return 1;
		}
		if (leftNumber < rightNumber) {
			return -1;
		}
	}
	return 0;
}

function godotWeChatSdkVersion() {
	try {
		if (wx.getAppBaseInfo) {
			var appBase = wx.getAppBaseInfo();
			if (appBase && appBase.SDKVersion) {
				return appBase.SDKVersion;
			}
		}
	} catch (error) {
		console.error("[Godot] wx.getAppBaseInfo failed: " + error);
	}
	try {
		if (wx.getSystemInfoSync) {
			var system = wx.getSystemInfoSync();
			if (system && system.SDKVersion) {
				return system.SDKVersion;
			}
		}
	} catch (error) {
		console.error("[Godot] wx.getSystemInfoSync failed: " + error);
	}
	return "";
}

function godotWeChatApplyWindowMetrics() {
	var root = godotWeChatRoot();
	var info = WeChatHost.readWindowInfo(typeof wx !== "undefined" ? wx : null);
	return godotWeChatHost().applyInfo(root, info);
}

function godotWeChatPrepareCanvas() {
	var canvas = wx.createCanvas();
	var root = godotWeChatRoot();
	root.__godotWeChatCanvas = canvas;
	return godotWeChatHost().prepareCanvas(canvas);
}

function godotWeChatReleaseProbeContext(context) {
	if (!context || typeof context.getExtension !== "function") {
		return;
	}
	try {
		var lose = context.getExtension("WEBGL_lose_context");
		if (lose && lose.loseContext) {
			lose.loseContext();
		}
	} catch (error) {
		console.error("[Godot] releasing the WebGL probe context failed: " + error);
	}
}

function godotWeChatProbeWebGL2() {
	var probe = wx.createCanvas();
	var context = null;
	try {
		context = probe.getContext("webgl2");
	} catch (error) {
		godotWeChatFail(
			"WebGL 2 unavailable",
			"Creating a WebGL 2 context threw an error: " + error + ". The Compatibility renderer requires WebGL 2. WeChat canvas exposes webgl2 from base library 2.24.0. Set Developer Tools Details > Local Settings > Base library to 2.24.0 or newer."
		);
		return false;
	}
	var environment = {};
	try {
		if (wx.getSystemInfoSync) {
			environment = wx.getSystemInfoSync() || {};
		}
	} catch (error) {
		console.error("[Godot] wx.getSystemInfoSync failed: " + error);
	}
	var report = WeChatHost.probeCompatibility3D(context, environment);
	godotWeChatReleaseProbeContext(context);
	if (!report.ok) {
		godotWeChatFail(report.title, report.message);
		return false;
	}
	var i;
	for (i = 0; i < report.degradations.length; i++) {
		console.warn("[Godot] " + report.degradations[i].title + ": " + report.degradations[i].message);
	}
	return true;
}

function godotWeChatReadPackageFile(path) {
	return new Promise(function (resolve, reject) {
		var fs = wx.getFileSystemManager();
		fs.readFile({
			filePath: path,
			success: function (result) {
				resolve(result.data);
			},
			fail: function (error) {
				var detail = error && error.errMsg ? error.errMsg : error;
				reject(new Error("Could not read packaged file \"" + path + "\": " + detail + ". If the file is in a subpackage, load that subpackage before starting the engine, and keep ignoreDevUnusedFiles disabled."));
			},
		});
	});
}

function godotWeChatLoadRuntimeSubpackage() {
	if (!GODOT_RUNTIME_SUBPACKAGE) {
		return Promise.resolve();
	}
	if (!wx.loadSubpackage) {
		return Promise.reject(new Error("wx.loadSubpackage is missing. WeChat base library 2.1.0 or newer is required to load the engine runtime subpackage."));
	}
	return new Promise(function (resolve, reject) {
		console.log("[Godot] loading engine runtime subpackage " + GODOT_RUNTIME_SUBPACKAGE);
		var task = wx.loadSubpackage({
			name: GODOT_RUNTIME_SUBPACKAGE,
			success: function () {
				console.log("[Godot] engine runtime subpackage loaded");
				resolve();
			},
			fail: function (error) {
				var detail = error && error.errMsg ? error.errMsg : error;
				reject(new Error("Failed to load engine runtime subpackage \"" + GODOT_RUNTIME_SUBPACKAGE + "\": " + detail + ". Check game.json subpackages and that the main package stays within 4 MB."));
			},
		});
		if (task && task.onProgressUpdate) {
			task.onProgressUpdate(function (progress) {
				console.log("[Godot] runtime subpackage " + progress.progress + "%");
			});
		}
	});
}

function godotWeChatRuntimeError(message) {
	var error = new Error(message);
	error.name = "RuntimeError";
	Object.setPrototypeOf(error, godotWeChatRuntimeError.prototype);
	return error;
}
godotWeChatRuntimeError.prototype = Object.create(Error.prototype);
godotWeChatRuntimeError.prototype.constructor = godotWeChatRuntimeError;

function godotWeChatEnsureWebAssembly() {
	var root = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : this);
	if (typeof root.WebAssembly !== "object" && typeof WXWebAssembly === "object") {
		root.WebAssembly = WXWebAssembly;
		console.log("[Godot] using WXWebAssembly as WebAssembly");
	}
	if (typeof root.WebAssembly !== "object") {
		godotWeChatFail(
			"WebAssembly unavailable",
			"Neither WebAssembly nor WXWebAssembly is available. WeChat base library 2.13.0 or newer is required."
		);
		return false;
	}
	// WXWebAssembly has no RuntimeError. Emscripten's trap handler uses
	// `instanceof WebAssembly.RuntimeError` and throws if that constructor is missing.
	if (typeof root.WebAssembly.RuntimeError !== "function") {
		root.WebAssembly.RuntimeError = godotWeChatRuntimeError;
	}
	return true;
}

function godotWeChatEnsureDocument() {
	var root = typeof GameGlobal !== "undefined" ? GameGlobal : (typeof globalThis !== "undefined" ? globalThis : this);
	function screenCanvas() {
		return root.__godotWeChatCanvas || null;
	}
	var doc = {
		querySelector: function (selector) {
			return selector === "#canvas" || selector === "canvas" ? screenCanvas() : null;
		},
	};
	root.document = doc;
	try {
		document = doc;
	} catch (error) {
		// WeChat may expose a non-assignable document. The engine patch
		// looks up the canvas from GameGlobal when that happens.
	}
	if (typeof window === "object") {
		window.document = doc;
	}
	if (typeof doc.getElementById !== "function") {
		doc.getElementById = function (id) {
			return id === "canvas" ? screenCanvas() : null;
		};
	}
	if (typeof doc.getElementsByTagName !== "function") {
		doc.getElementsByTagName = function (tag) {
			var canvas = screenCanvas();
			return tag === "canvas" && canvas ? [canvas] : [];
		};
	}
	if (typeof doc.createElement !== "function") {
		doc.createElement = function (tag) {
			if (tag === "canvas" && typeof wx !== "undefined" && wx.createCanvas) {
				return wx.createCanvas();
			}
			return { style: {}, appendChild: function () {}, setAttribute: function () {}, addEventListener: function () {}, removeEventListener: function () {}, remove: function () {} };
		};
	}
	if (typeof doc.addEventListener !== "function") {
		doc.addEventListener = function () {};
	}
	if (typeof doc.removeEventListener !== "function") {
		doc.removeEventListener = function () {};
	}
	if (!doc.body) {
		doc.body = { appendChild: function () {}, style: {} };
	}
	if (!doc.head) {
		doc.head = { appendChild: function () {} };
	}
	if (typeof doc.exitFullscreen !== "function") {
		doc.exitFullscreen = function () { return Promise.resolve(); };
	}
	if (typeof doc.exitPointerLock !== "function") {
		doc.exitPointerLock = function () {};
	}
}

function godotWeChatStartEngine() {
	if (!godotWeChatEnsureWebAssembly()) {
		return Promise.reject(new Error("WebAssembly is not available"));
	}
	godotWeChatEnsureDocument();
	var factory = require(GODOT_JS_PATH);
	if (factory && factory.default) {
		factory = factory.default;
	}
	if (typeof factory !== "function" && typeof GameGlobal !== "undefined" && typeof GameGlobal.Godot === "function") {
		factory = GameGlobal.Godot;
	}
	if (typeof factory !== "function") {
		return Promise.reject(new Error("The Godot WebAssembly loader at \"" + GODOT_JS_PATH + "\" did not export a factory. Rebuild the single-threaded, non-SIMD WeChat template."));
	}
	var canvas = (typeof GameGlobal !== "undefined" && GameGlobal.__godotWeChatCanvas) || null;
	console.log("[Godot] instantiating single-threaded non-SIMD WASM from " + GODOT_WASM_PATH);
	var created = factory({
		canvas: canvas,
		thisProgram: "/godot",
		noExitRuntime: true,
		print: function () {
			console.log.apply(console, arguments);
		},
		printErr: function () {
			console.error.apply(console, arguments);
			var text = Array.prototype.map.call(arguments, String).join(" ");
			godotWeChatReport(WeChatHost.diagnoseRendererMessage(text));
		},
		locateFile: function (path) {
			var slash = path.lastIndexOf("/");
			var file = slash >= 0 ? path.slice(slash + 1) : path;
			var slashInWasm = GODOT_WASM_PATH.lastIndexOf("/");
			var root = slashInWasm >= 0 ? GODOT_WASM_PATH.slice(0, slashInWasm + 1) : "";
			return root + file;
		},
		instantiateWasm: function (imports, onSuccess) {
			if (typeof WXWebAssembly === "undefined" || !WXWebAssembly.instantiate) {
				godotWeChatFail(
					"WebAssembly unavailable",
					"WXWebAssembly.instantiate is missing. WeChat base library 2.13.0 or newer is required to load the Godot runtime from the code package."
				);
				return {};
			}
			WXWebAssembly.instantiate(GODOT_WASM_PATH, imports).then(function (result) {
				onSuccess(result.instance, result.module);
			}).catch(function (error) {
				var detail = error && error.message ? error.message : error;
				godotWeChatFail(
					"WASM startup failed",
					"Could not instantiate \"" + GODOT_WASM_PATH + "\": " + detail + ". Use the Godot WeChat template built single-threaded without SIMD, and confirm the file is included in the code package."
				);
			});
			return {};
		},
	});
	return Promise.resolve(created).then(function (module) {
		if (!module || typeof module.initConfig !== "function" || typeof module.callMain !== "function") {
			throw new Error("The Godot runtime loaded but did not expose initConfig/callMain. The WeChat template must be the modularized Emscripten build.");
		}
		module.initConfig({
			canvas: canvas,
			canvasResizePolicy: 2,
			locale: "zh_CN",
			virtualKeyboard: false,
			persistentDrops: false,
			godotPoolSize: 1,
			focusCanvas: false,
		});
		var ready = module.initFS ? module.initFS([]) : Promise.resolve();
		return Promise.resolve(ready).then(function () {
			return module;
		});
	}).then(function (module) {
		return godotWeChatReadPackageFile(GODOT_PCK_PATH).then(function (buffer) {
			module.copyToFS("/game.pck", buffer);
			console.log("[Godot] starting Compatibility renderer");
			module.callMain(["--main-pack", "/game.pck"]);
			console.log("[Godot] engine main started");
			godotWeChatRecordBaseline();
		});
	});
}

function godotWeChatRecordBaseline() {
	var started = Date.now();
	var frames = 0;
	function tick() {
		frames += 1;
		var now = Date.now();
		if (now - started < 2000) {
			if (typeof requestAnimationFrame === "function") {
				requestAnimationFrame(tick);
			} else {
				setTimeout(tick, 16);
			}
			return;
		}
		var performanceObject = typeof performance !== "undefined" ? performance : null;
		var sample = WeChatHost.readPerformanceSample(typeof wx !== "undefined" ? wx : null, performanceObject, started, frames, now);
		var recorded = WeChatHost.samplePerformance({
			frameCount: frames,
			elapsedMs: now - started,
			memoryBytes: sample.memoryBytes,
			memoryLabel: sample.memoryLabel,
		});
		console.log("[Godot] baseline hostFps=" + recorded.fps + " memoryBytes=" + recorded.memoryBytes + " label=" + recorded.memoryLabel + " guaranteed=false");
		console.log("[Godot] " + recorded.note);
	}
	tick();
}

function godotWeChatBoot() {
	console.log("[Godot] WeChat Mini Game startup");
	console.log("[Godot] project=" + GODOT_PROJECT_NAME + " revision=" + GODOT_REVISION + " emscripten=" + GODOT_EMSCRIPTEN + " threads=no simd=no");
	if (typeof wx === "undefined") {
		godotWeChatFail(
			"WeChat host missing",
			"wx is not defined. Open this directory as a WeChat Mini Game project in WeChat Developer Tools. Do not open it as a browser page."
		);
		return;
	}
	var sdkVersion = godotWeChatSdkVersion();
	if (!sdkVersion) {
		godotWeChatFail(
			"Base library unknown",
			"Could not read the WeChat base library version from wx.getAppBaseInfo or wx.getSystemInfoSync. Update WeChat Developer Tools and set Details > Local Settings > Base library to 2.19.0 or newer."
		);
		return;
	}
	console.log("[Godot] base library " + sdkVersion);
	if (godotWeChatCompareVersion(sdkVersion, GODOT_MIN_BASE_LIBRARY) < 0) {
		godotWeChatFail(
			"Base library too old",
			"This project requires WeChat base library " + GODOT_MIN_BASE_LIBRARY + " or newer. Found " + sdkVersion + ". In Developer Tools, set Details > Local Settings > Base library to " + GODOT_MIN_BASE_LIBRARY + " or newer, or update the WeChat client."
		);
		return;
	}
	if (wx.onMemoryWarning) {
		wx.onMemoryWarning(function (warning) {
			var level = warning && warning.level;
			console.warn("[Godot] memory warning level=" + level + ". This is a device baseline signal, not a crash. Reduce texture size or scene complexity if the client closes the game. guaranteed=false");
		});
	}
	godotWeChatApplyWindowMetrics();
	godotWeChatPrepareCanvas();
	godotWeChatHost().bind(godotWeChatRoot(), wx);
	if (!godotWeChatProbeWebGL2()) {
		return;
	}
	godotWeChatLoadRuntimeSubpackage().then(function () {
		return godotWeChatStartEngine();
	}).catch(function (error) {
		var detail = error && error.message ? error.message : error;
		godotWeChatFail("Startup failed", String(detail));
	});
}

godotWeChatBoot();
