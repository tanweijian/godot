/**
 * WeChat window, touch, lifecycle, and file mapping.
 *
 * Touch conversion matches Godot's web input path: CSS pixels in, canvas
 * buffer pixels out. Safe area uses that same buffer pixel space.
 *
 * Packaged code-package files stay read-only. user:// is the Godot /userfs
 * mount persisted under the WeChat user-data directory.
 */
"use strict";

function positive(value) {
	return typeof value === "number" && isFinite(value) && value > 0 ? value : 0;
}

function hasWindowSize(info) {
	return !!info && (positive(info.windowWidth) > 0 || positive(info.screenWidth) > 0 || positive(info.windowHeight) > 0 || positive(info.screenHeight) > 0);
}

function finite(value, fallback) {
	return typeof value === "number" && isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function cssRect(metrics) {
	return {
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		width: metrics.width,
		height: metrics.height,
		right: metrics.width,
		bottom: metrics.height,
	};
}

function bufferSize(metrics) {
	return {
		width: Math.max(1, Math.floor(metrics.width * metrics.ratio)),
		height: Math.max(1, Math.floor(metrics.height * metrics.ratio)),
	};
}

function touchToGodot(clientX, clientY, rect, bufferWidth, bufferHeight) {
	var scaleX = bufferWidth / rect.width;
	var scaleY = bufferHeight / rect.height;
	return {
		x: (clientX - rect.x) * scaleX,
		y: (clientY - rect.y) * scaleY,
	};
}

function safeAreaPixels(metrics) {
	var buffer = bufferSize(metrics);
	var safe = metrics.safeArea;
	if (!safe || typeof safe.left !== "number" || typeof safe.top !== "number") {
		return { x: 0, y: 0, width: buffer.width, height: buffer.height };
	}
	var screenTop = finite(metrics.screenTop, 0);
	var left = clamp(finite(safe.left, 0), 0, metrics.width);
	var right = clamp(typeof safe.right === "number" ? safe.right : left + finite(safe.width, metrics.width), 0, metrics.width);
	var top = clamp(finite(safe.top, 0) - screenTop, 0, metrics.height);
	var bottom = clamp((typeof safe.bottom === "number" ? safe.bottom : top + finite(safe.height, metrics.height)) - screenTop, 0, metrics.height);
	if (right < left) {
		right = left;
	}
	if (bottom < top) {
		bottom = top;
	}
	var x = Math.floor(left * metrics.ratio);
	var y = Math.floor(top * metrics.ratio);
	var x2 = Math.floor(right * metrics.ratio);
	var y2 = Math.floor(bottom * metrics.ratio);
	return { x: x, y: y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}

function metricsFromInfo(info) {
	info = info || {};
	var width = positive(info.windowWidth) || positive(info.screenWidth) || 480;
	var height = positive(info.windowHeight) || positive(info.screenHeight) || 854;
	var ratio = positive(info.pixelRatio) || 1;
	var metrics = {
		width: width,
		height: height,
		ratio: ratio,
		screenWidth: positive(info.screenWidth) || width,
		screenHeight: positive(info.screenHeight) || height,
		screenTop: finite(info.screenTop, 0),
		safeArea: info.safeArea || null,
	};
	metrics.touchToGodot = touchToGodot;
	metrics.safeAreaPixels = function () {
		return safeAreaPixels(metrics);
	};
	return metrics;
}

function readWindowInfo(wx) {
	if (!wx) {
		return {};
	}
	var info = {};
	var gotWindow = false;
	if (typeof wx.getWindowInfo === "function") {
		try {
			info = wx.getWindowInfo() || {};
			gotWindow = true;
		} catch (error) {
			console.error("[Godot] wx.getWindowInfo failed: " + error);
		}
	}
	if (typeof wx.getSystemInfoSync !== "function") {
		return info || {};
	}
	if (gotWindow && info.safeArea && info.pixelRatio && info.windowWidth && info.windowHeight) {
		return info;
	}
	try {
		var system = wx.getSystemInfoSync() || {};
		if (!gotWindow) {
			return system;
		}
		if (!info.safeArea && system.safeArea) {
			info.safeArea = system.safeArea;
		}
		if (!info.pixelRatio && system.pixelRatio) {
			info.pixelRatio = system.pixelRatio;
		}
		if (!info.windowWidth && system.windowWidth) {
			info.windowWidth = system.windowWidth;
		}
		if (!info.windowHeight && system.windowHeight) {
			info.windowHeight = system.windowHeight;
		}
		if (!info.screenWidth && system.screenWidth) {
			info.screenWidth = system.screenWidth;
		}
		if (!info.screenHeight && system.screenHeight) {
			info.screenHeight = system.screenHeight;
		}
		if (typeof info.screenTop !== "number" && typeof system.screenTop === "number") {
			info.screenTop = system.screenTop;
		}
	} catch (error) {
		console.error("[Godot] wx.getSystemInfoSync failed: " + error);
	}
	return info || {};
}

function touchPoint(touch) {
	var x = touch.clientX;
	var y = touch.clientY;
	if (typeof x !== "number") {
		x = typeof touch.pageX === "number" ? touch.pageX : touch.x || 0;
	}
	if (typeof y !== "number") {
		y = typeof touch.pageY === "number" ? touch.pageY : touch.y || 0;
	}
	return {
		identifier: touch.identifier || 0,
		clientX: x,
		clientY: y,
	};
}

function changedTouchEvent(wxEvent) {
	var changed = (wxEvent && (wxEvent.changedTouches || wxEvent.touches)) || [];
	var touches = [];
	for (var i = 0; i < changed.length; i++) {
		touches.push(touchPoint(changed[i]));
	}
	return {
		changedTouches: touches,
		cancelable: false,
		preventDefault: function () {},
		stopPropagation: function () {},
	};
}

function isIOSEnvironment(environment) {
	environment = environment || {};
	var text = [environment.platform, environment.system, environment.model].join(" ").toLowerCase();
	return text.indexOf("ios") >= 0 || text.indexOf("iphone") >= 0 || text.indexOf("ipad") >= 0;
}

function compatibility3DFailure(title, message) {
	return { ok: false, title: title, message: message, degradations: [] };
}

function compileProbeStage(gl, type, source) {
	var shader = gl.createShader(type);
	if (!shader) {
		return { ok: false, shader: null, log: "createShader returned null" };
	}
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	var status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
	return { ok: !!status, shader: shader, log: gl.getShaderInfoLog(shader) || "" };
}

function probeCompatibility3D(gl, environment) {
	if (!gl) {
		return compatibility3DFailure(
			"WebGL 2 unavailable",
			"Canvas.getContext('webgl2') returned null. The Compatibility renderer requires WebGL 2, which WeChat documents from base library 2.24.0. Raise the Developer Tools base library and, on iOS, enable high-performance mode."
		);
	}
	var attributes = null;
	try {
		attributes = typeof gl.getContextAttributes === "function" ? gl.getContextAttributes() : null;
	} catch (error) {
		return compatibility3DFailure(
			"Depth buffer unavailable",
			"Reading the WebGL 2 context attributes failed: " + error + ". A Compatibility 3D mesh needs a depth buffer. WeChat documents context attributes for webgl, not webgl2. Set the base library to 2.24.0 or newer and enable iOS high-performance mode."
		);
	}
	if (!attributes || attributes.depth !== true) {
		return compatibility3DFailure(
			"Depth buffer unavailable",
			"This WebGL 2 context has no depth buffer, so a Compatibility mesh cannot render and the project would otherwise stay blank. WeChat documents context attributes for webgl, not webgl2. Set Developer Tools Details > Local Settings > Base library to 2.24.0 or newer, update the WeChat client, and on iOS enable high-performance mode (iOS 15+) or high-performance+ mode."
		);
	}
	if (typeof gl.createShader !== "function" || typeof gl.createProgram !== "function") {
		return compatibility3DFailure(
			"Shader compiler unavailable",
			"This WebGL 2 context cannot compile a shader. Compatibility 3D requires a WebGL 2 shader compiler from base library 2.24.0. On iOS enable high-performance mode."
		);
	}
	var vertexSource = "#version 300 es\nvoid main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }\n";
	var fragmentSource = "#version 300 es\nprecision mediump float;\nout vec4 frag_color;\nvoid main() { frag_color = vec4(1.0, 0.45, 0.12, 1.0); }\n";
	var vertex;
	var fragment;
	var program = null;
	try {
		vertex = compileProbeStage(gl, gl.VERTEX_SHADER, vertexSource);
		fragment = compileProbeStage(gl, gl.FRAGMENT_SHADER, fragmentSource);
		if (!vertex.ok || !fragment.ok) {
			var log = vertex.log || fragment.log || "shader compilation failed";
			return compatibility3DFailure(
				"Shader compiler unavailable",
				"A minimal Compatibility shader failed to compile: " + log + ". The Compatibility renderer needs a working WebGL 2 shader compiler. Set the base library to 2.24.0 or newer. On iOS enable high-performance mode (iOS 15+) or high-performance+ mode."
			);
		}
		program = gl.createProgram();
		gl.attachShader(program, vertex.shader);
		gl.attachShader(program, fragment.shader);
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			var linkLog = gl.getProgramInfoLog(program) || "program link failed";
			return compatibility3DFailure(
				"Shader compiler unavailable",
				"A minimal Compatibility shader failed to link: " + linkLog + ". Set the base library to 2.24.0 or newer and enable iOS high-performance mode."
			);
		}
	} catch (error) {
		return compatibility3DFailure(
			"Shader compiler unavailable",
			"Compiling a Compatibility shader threw: " + error + ". Set the base library to 2.24.0 or newer and enable iOS high-performance mode."
		);
	} finally {
		if (vertex && vertex.shader && gl.deleteShader) {
			gl.deleteShader(vertex.shader);
		}
		if (fragment && fragment.shader && gl.deleteShader) {
			gl.deleteShader(fragment.shader);
		}
		if (program && gl.deleteProgram) {
			gl.deleteProgram(program);
		}
	}
	var degradations = [];
	if (!attributes.stencil) {
		degradations.push({
			title: "Stencil unavailable",
			message: "Stencil is unavailable on this WebGL 2 context. CanvasItem clipping, some masks, and stencil-reading shaders will be skipped instead of crashing. WeChat often leaves stencil false even when depth is present. Remove stencil-dependent materials if those effects are blank.",
		});
	}
	var floatBuffer = null;
	try {
		floatBuffer = gl.getExtension("EXT_color_buffer_float");
	} catch (error) {
		floatBuffer = null;
	}
	if (!floatBuffer) {
		degradations.push({
			title: "Float color buffers unavailable",
			message: "EXT_color_buffer_float is missing. HDR, glow, and some post-processing will be skipped. A standard-material Compatibility scene does not need this extension.",
		});
	}
	if (typeof gl.drawArraysInstanced !== "function") {
		degradations.push({
			title: "Instancing unavailable",
			message: "drawArraysInstanced is missing, so GPU instancing is unavailable. MultiMesh draws will be skipped or submitted one at a time instead of crashing. Reduce instancing if meshes flicker.",
		});
	}
	if (isIOSEnvironment(environment)) {
		degradations.push({
			title: "iOS WebGL 2 limits",
			message: "iOS WebGL 2 needs high-performance mode on iOS 15 or newer, or high-performance+ mode. WeChat does not guarantee every WebGL 2 feature. If meshes flicker or disappear, reduce instanced draws and uniform count.",
		});
	}
	return { ok: true, title: "", message: "", degradations: degradations };
}

function diagnoseRendererMessage(text) {
	if (!text) {
		return null;
	}
	var message = String(text);
	if (message.indexOf("did not draw the lit mesh") >= 0) {
		return {
			fatal: true,
			title: "Compatibility 3D blank",
			message: message + " The Compatibility renderer started but the lit mesh is not visible. Check the shader log above. On iOS enable high-performance mode (iOS 15+) or high-performance+ mode. Confirm startup reported a depth buffer, and keep rendering/renderer/rendering_method at gl_compatibility.",
		};
	}
	if (message.indexOf("shader compilation failed") >= 0 || message.indexOf("Program linking failed") >= 0 || message.indexOf("No OpenGL vertex shader") >= 0 || message.indexOf("No OpenGL fragment shader") >= 0 || message.indexOf("No OpenGL program link") >= 0) {
		return {
			fatal: true,
			title: "Shader failed",
			message: message + " Remove the custom shader or the unsupported feature (compute, multiview, cubemap arrays, samplerCubeArray). Forward+, Mobile, and Vulkan shaders cannot run here. Set rendering/renderer/rendering_method to gl_compatibility.",
		};
	}
	if (message.indexOf("MSAA is not supported") >= 0) {
		return {
			fatal: false,
			title: "MSAA unavailable",
			message: message + " The scene still renders without multisampling. Turn off viewport MSAA to silence this.",
		};
	}
	if (message.indexOf("GPUParticles are not supported") >= 0) {
		return {
			fatal: false,
			title: "GPUParticles unavailable",
			message: message + " Replace GPUParticles3D with CPUParticles3D.",
		};
	}
	if (message.indexOf("Dual paraboloid") >= 0 || message.indexOf("not supported in the Compatibility renderer") >= 0 || message.indexOf("not supported in OpenGL renderer") >= 0) {
		return {
			fatal: false,
			title: "Renderer feature unavailable",
			message: message + " That feature was skipped. Use a Compatibility-supported alternative, such as CubeMap shadows instead of dual paraboloid shadows, and keep the project on gl_compatibility.",
		};
	}
	if (message.indexOf("Unable to initialize WebGL") >= 0) {
		return {
			fatal: true,
			title: "WebGL 2 unavailable",
			message: message + " The Compatibility renderer requires WebGL 2 from WeChat base library 2.24.0. On iOS enable high-performance mode.",
		};
	}
	return null;
}

function samplePerformance(reading) {
	reading = reading || {};
	var frameCount = reading.frameCount;
	var elapsedMs = reading.elapsedMs;
	var fps = null;
	if (typeof frameCount === "number" && typeof elapsedMs === "number" && elapsedMs > 0 && frameCount >= 0) {
		fps = Math.round((frameCount * 1000) / elapsedMs);
	}
	var memoryBytes = typeof reading.memoryBytes === "number" && isFinite(reading.memoryBytes) && reading.memoryBytes >= 0 ? Math.round(reading.memoryBytes) : null;
	return {
		fps: fps,
		memoryBytes: memoryBytes,
		memoryLabel: reading.memoryLabel || (memoryBytes === null ? "unavailable" : "bytes"),
		guaranteed: false,
		note: "Device baseline only. WeChat Compatibility 3D does not promise a minimum frame rate or memory limit.",
	};
}

function readPerformanceSample(wx, performanceObject, startedMs, frameCount, nowMs) {
	var memoryBytes = null;
	var memoryLabel = "unavailable";
	if (performanceObject && performanceObject.memory && typeof performanceObject.memory.usedJSHeapSize === "number") {
		memoryBytes = performanceObject.memory.usedJSHeapSize;
		memoryLabel = "usedJSHeapSize";
	}
	if (memoryBytes === null && wx && typeof wx.getPerformance === "function") {
		try {
			var manager = wx.getPerformance();
			if (manager && manager.memory && typeof manager.memory.usedJSHeapSize === "number") {
				memoryBytes = manager.memory.usedJSHeapSize;
				memoryLabel = "wx.getPerformance";
			}
		} catch (error) {
			console.error("[Godot] wx.getPerformance failed: " + error);
		}
	}
	return samplePerformance({
		frameCount: frameCount,
		elapsedMs: nowMs - startedMs,
		memoryBytes: memoryBytes,
		memoryLabel: memoryLabel,
	});
}

function createHost() {
	var runtimeToken = { kind: "godot-wechat-runtime" };
	var metrics = metricsFromInfo({});
	var foreground = true;
	var lifecycle = null;
	var root = null;
	var engineOwnsCanvas = false;

	function applyMetrics(target) {
		target.devicePixelRatio = metrics.ratio;
		target.innerWidth = metrics.width;
		target.innerHeight = metrics.height;
		target.screen = {
			width: metrics.screenWidth,
			height: metrics.screenHeight,
			availWidth: metrics.screenWidth,
			availHeight: metrics.screenHeight,
		};
		target.ontouchstart = null;
	}

	function decorateCanvas(canvas) {
		if (!canvas.__godotWeChatInput) {
			canvas.__godotWeChatInput = true;
			canvas.__godotWeChatListeners = {};
			canvas.addEventListener = function (type, listener) {
				var list = canvas.__godotWeChatListeners[type] || (canvas.__godotWeChatListeners[type] = []);
				if (list.indexOf(listener) === -1) {
					list.push(listener);
				}
			};
			canvas.removeEventListener = function (type, listener) {
				var list = canvas.__godotWeChatListeners[type] || [];
				var index = list.indexOf(listener);
				if (index >= 0) {
					list.splice(index, 1);
				}
			};
		}
		if (typeof canvas.focus !== "function") {
			canvas.focus = function () {};
		}
		canvas.getBoundingClientRect = function () {
			return cssRect(metrics);
		};
		return canvas;
	}

	function dispatch(canvas, type, event) {
		var list = (canvas && canvas.__godotWeChatListeners && canvas.__godotWeChatListeners[type]) || [];
		for (var i = 0; i < list.length; i++) {
			list[i].call(canvas, event);
		}
	}

	function canvasFor(target) {
		return target && target.__godotWeChatCanvas ? target.__godotWeChatCanvas : null;
	}

	var host = {
		runtimeToken: function () {
			return runtimeToken;
		},
		isForeground: function () {
			return foreground;
		},
		currentMetrics: function () {
			return metrics;
		},
		currentSafeArea: function () {
			return safeAreaPixels(metrics);
		},
		cssRect: function () {
			return cssRect(metrics);
		},
		applyInfo: function (target, info) {
			root = target || root;
			metrics = metricsFromInfo(info);
			if (root) {
				applyMetrics(root);
			}
			return metrics;
		},
		prepareCanvas: function (canvas) {
			var buffer = bufferSize(metrics);
			if (!canvas.id) {
				canvas.id = "canvas";
			}
			if (canvas.width !== buffer.width) {
				canvas.width = buffer.width;
			}
			if (canvas.height !== buffer.height) {
				canvas.height = buffer.height;
			}
			if (!canvas.style) {
				canvas.style = {};
			}
			canvas.style.width = metrics.width + "px";
			canvas.style.height = metrics.height + "px";
			canvas.style.position = "absolute";
			canvas.style.top = "0px";
			canvas.style.left = "0px";
			return decorateCanvas(canvas);
		},
		decorateCanvas: decorateCanvas,
		dispatchTouch: function (type, wxEvent) {
			dispatch(canvasFor(root), type, changedTouchEvent(wxEvent));
		},
		setLifecycleHandler: function (handler) {
			engineOwnsCanvas = true;
			lifecycle = handler;
			if (!foreground && lifecycle) {
				lifecycle(false);
			}
		},
		hide: function () {
			if (!foreground) {
				return;
			}
			foreground = false;
			if (lifecycle) {
				lifecycle(false);
			}
		},
		refresh: function (info) {
			if (!hasWindowSize(info) || !root) {
				return;
			}
			host.applyInfo(root, info);
			// Once Godot has created the GL context, it owns canvas.width.
			// Changing it here skips GodotDisplayScreen._updateGL.
			if (engineOwnsCanvas) {
				return;
			}
			var canvas = canvasFor(root);
			if (canvas) {
				host.prepareCanvas(canvas);
			}
		},
		show: function (info) {
			host.refresh(info);
			if (foreground) {
				return;
			}
			foreground = true;
			if (lifecycle) {
				lifecycle(true);
			}
		},
		bind: function (target, wx) {
			root = target || root;
			if (root && typeof root.ontouchstart === "undefined") {
				root.ontouchstart = null;
			}
			if (!wx || wx.__godotWeChatBound === host) {
				return;
			}
			wx.__godotWeChatBound = host;
			function listen(name, handler) {
				if (typeof wx[name] !== "function") {
					console.error("[Godot] " + name + " is missing. Touch, display, and lifecycle need this WeChat host API.");
					return;
				}
				wx[name](handler);
			}
			listen("onTouchStart", function (event) {
				dispatch(canvasFor(root), "touchstart", changedTouchEvent(event));
			});
			listen("onTouchMove", function (event) {
				dispatch(canvasFor(root), "touchmove", changedTouchEvent(event));
			});
			listen("onTouchEnd", function (event) {
				dispatch(canvasFor(root), "touchend", changedTouchEvent(event));
			});
			listen("onTouchCancel", function (event) {
				dispatch(canvasFor(root), "touchcancel", changedTouchEvent(event));
			});
			listen("onHide", function () {
				host.hide();
			});
			listen("onShow", function () {
				host.show(readWindowInfo(wx));
			});
			listen("onWindowResize", function () {
				host.refresh(readWindowInfo(wx));
			});
		},
	};
	return host;
}

var USER_DATA_MOUNT = "/userfs";

function userDataMounts() {
	return [USER_DATA_MOUNT];
}

function errorDetail(error) {
	if (!error) {
		return "unknown file error";
	}
	if (typeof error === "string") {
		return error;
	}
	if (error.errMsg) {
		return String(error.errMsg);
	}
	if (error.message) {
		return String(error.message);
	}
	return String(error);
}

function fileFailure(action, path, error, errorName) {
	var message = "[Godot] " + action + " failed for \"" + path + "\": " + errorDetail(error) + " (" + errorName + ")";
	console.error(message);
	return { ok: false, error: errorName, message: message };
}

function isMissingFileError(error) {
	var text = errorDetail(error).toLowerCase();
	return text.indexOf("no such file") >= 0 || text.indexOf("not found") >= 0 || text.indexOf("not exist") >= 0;
}

function classifyFileError(action, path, error) {
	var text = errorDetail(error).toLowerCase();
	var errorName = "FAILED";
	if (text.indexOf("no such file") >= 0 || text.indexOf("not found") >= 0 || text.indexOf("not exist") >= 0) {
		errorName = "ERR_FILE_NOT_FOUND";
	} else if (text.indexOf("already exist") >= 0 || text.indexOf("file exists") >= 0) {
		errorName = "ERR_ALREADY_EXISTS";
	} else if (text.indexOf("permission") >= 0 || text.indexOf("denied") >= 0 || text.indexOf("read only") >= 0 || text.indexOf("read-only") >= 0) {
		errorName = "ERR_FILE_NO_PERMISSION";
	} else if (text.indexOf("storage limit") >= 0 || text.indexOf("maximum size") >= 0 || text.indexOf("no space") >= 0 || text.indexOf("quota") >= 0) {
		errorName = "ERR_FILE_CANT_WRITE";
	} else if (action === "read") {
		errorName = "ERR_FILE_CANT_READ";
	} else if (action === "write") {
		errorName = "ERR_FILE_CANT_WRITE";
	} else if (action === "mkdir") {
		errorName = "ERR_CANT_CREATE";
	}
	if (errorName === "ERR_ALREADY_EXISTS") {
		return { ok: false, error: errorName, message: errorDetail(error) };
	}
	return fileFailure(action, path, error, errorName);
}

function isDirectoryStat(stat) {
	if (!stat) {
		return false;
	}
	if (typeof stat.isDirectory === "function") {
		return !!stat.isDirectory();
	}
	if (typeof stat.isDirectory === "boolean") {
		return stat.isDirectory;
	}
	if (typeof stat.mode === "number") {
		return (stat.mode & 61440) === 16384;
	}
	return false;
}

function toBytes(data) {
	if (data == null) {
		return new Uint8Array(0);
	}
	if (data instanceof Uint8Array) {
		return new Uint8Array(data);
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}
	if (typeof data === "string") {
		var encoded = new Uint8Array(data.length);
		for (var i = 0; i < data.length; i++) {
			encoded[i] = data.charCodeAt(i) & 255;
		}
		return encoded;
	}
	if (Array.isArray(data)) {
		return new Uint8Array(data);
	}
	return new Uint8Array(0);
}

function cleanRelative(path) {
	if (path == null) {
		return null;
	}
	var parts = String(path).split("/");
	var clean = [];
	for (var i = 0; i < parts.length; i++) {
		if (parts[i] === "" || parts[i] === ".") {
			continue;
		}
		if (parts[i] === "..") {
			return null;
		}
		clean.push(parts[i]);
	}
	return clean.join("/");
}

function parentRelative(path) {
	var index = path.lastIndexOf("/");
	if (index < 0) {
		return "";
	}
	return path.slice(0, index);
}

function joinHostPath(root, child) {
	if (!child) {
		return root;
	}
	if (root.charAt(root.length - 1) === "/") {
		root = root.slice(0, -1);
	}
	if (child.charAt(0) === "/") {
		return root + child;
	}
	return root + "/" + child;
}

function engineErrno(errorName) {
	if (errorName === "ERR_FILE_NOT_FOUND") {
		return 44;
	}
	if (errorName === "ERR_FILE_NO_PERMISSION") {
		return 69;
	}
	if (errorName === "ERR_ALREADY_EXISTS") {
		return 20;
	}
	if (errorName === "ERR_FILE_BAD_PATH") {
		return 28;
	}
	if (errorName === "ERR_FILE_CANT_WRITE") {
		return 51;
	}
	return 29;
}

function relativeToMount(mountPoint, fullPath) {
	if (fullPath === mountPoint) {
		return "";
	}
	var prefix = mountPoint.charAt(mountPoint.length - 1) === "/" ? mountPoint : mountPoint + "/";
	if (fullPath.indexOf(prefix) !== 0) {
		return null;
	}
	return cleanRelative(fullPath.slice(prefix.length));
}

function createUserDataStore(hostFs, userDataPath) {
	var base = String(userDataPath || "");
	while (base.charAt(base.length - 1) === "/") {
		base = base.slice(0, -1);
	}
	var root = base + "/godot/userfs";

	function hostPath(relative) {
		return relative ? root + "/" + relative : root;
	}

	function ensureDir(relative) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null) {
			return fileFailure("mkdir", relative, "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		var target = hostPath(cleaned);
		try {
			var stat = hostFs.statSync(target);
			if (isDirectoryStat(stat)) {
				return { ok: true, error: "ERR_ALREADY_EXISTS" };
			}
			return fileFailure("mkdir", cleaned || root, "path is not a directory", "ERR_CANT_CREATE");
		} catch (error) {
			if (!isMissingFileError(error)) {
				return classifyFileError("mkdir", cleaned || root, error);
			}
		}
		var parent = parentRelative(cleaned);
		if (cleaned && parent !== cleaned) {
			var made = ensureDir(parent);
			if (!made.ok) {
				return made;
			}
		}
		try {
			hostFs.mkdirSync(target, true);
			return { ok: true };
		} catch (error) {
			var failed = classifyFileError("mkdir", cleaned || root, error);
			if (failed.error === "ERR_ALREADY_EXISTS") {
				return { ok: true, error: "ERR_ALREADY_EXISTS" };
			}
			return failed;
		}
	}

	function write(relative, data) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null || cleaned === "") {
			return fileFailure("write", relative, "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		var parent = parentRelative(cleaned);
		var made = ensureDir(parent);
		if (!made.ok) {
			return made;
		}
		try {
			var bytes = toBytes(data);
			hostFs.writeFileSync(hostPath(cleaned), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
			return { ok: true };
		} catch (error) {
			return classifyFileError("write", cleaned, error);
		}
	}

	function read(relative) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null || cleaned === "") {
			return fileFailure("read", relative, "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		try {
			return { ok: true, data: toBytes(hostFs.readFileSync(hostPath(cleaned))) };
		} catch (error) {
			return classifyFileError("read", cleaned, error);
		}
	}

	function remove(relative) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null || cleaned === "") {
			return fileFailure("remove", relative, "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		try {
			hostFs.unlinkSync(hostPath(cleaned));
			return { ok: true };
		} catch (error) {
			return classifyFileError("remove", cleaned, error);
		}
	}

	function removeDir(relative) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null || cleaned === "") {
			return fileFailure("remove", relative, "cannot remove the user data root", "ERR_FILE_NO_PERMISSION");
		}
		try {
			hostFs.rmdirSync(hostPath(cleaned));
			return { ok: true };
		} catch (error) {
			return classifyFileError("remove", cleaned, error);
		}
	}

	function rename(fromRelative, toRelative) {
		var from = cleanRelative(fromRelative);
		var to = cleanRelative(toRelative);
		if (from == null || to == null || from === "" || to === "") {
			return fileFailure("rename", String(fromRelative) + " -> " + String(toRelative), "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		var made = ensureDir(parentRelative(to));
		if (!made.ok) {
			return made;
		}
		try {
			hostFs.renameSync(hostPath(from), hostPath(to));
			return { ok: true };
		} catch (error) {
			return classifyFileError("rename", from + " -> " + to, error);
		}
	}

	function list(relative) {
		var cleaned = cleanRelative(relative);
		if (cleaned == null) {
			return fileFailure("list", relative, "path escapes the user data directory", "ERR_FILE_BAD_PATH");
		}
		try {
			var names = hostFs.readdirSync(hostPath(cleaned));
			var entries = [];
			for (var i = 0; i < names.length; i++) {
				if (names[i] === "." || names[i] === "..") {
					continue;
				}
				var child = cleaned ? cleaned + "/" + names[i] : names[i];
				var stat = hostFs.statSync(hostPath(child));
				entries.push({ name: names[i], directory: isDirectoryStat(stat) });
			}
			entries.sort(function (left, right) {
				return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
			});
			return { ok: true, entries: entries };
		} catch (error) {
			return classifyFileError("list", cleaned || root, error);
		}
	}

	function load() {
		var prepared = ensureDir("");
		if (!prepared.ok) {
			return prepared;
		}
		var dirs = [];
		var files = [];
		function walk(relative) {
			var listed = list(relative);
			if (!listed.ok) {
				return listed;
			}
			for (var i = 0; i < listed.entries.length; i++) {
				var entry = listed.entries[i];
				var child = relative ? relative + "/" + entry.name : entry.name;
				if (entry.directory) {
					dirs.push(child);
					var nested = walk(child);
					if (nested) {
						return nested;
					}
				} else {
					var contents = read(child);
					if (!contents.ok) {
						return contents;
					}
					files.push({ path: child, data: contents.data });
				}
			}
			return null;
		}
		var failed = walk("");
		if (failed) {
			return failed;
		}
		return { ok: true, dirs: dirs, files: files };
	}

	return {
		makeDir: function (relative) {
			var result = ensureDir(relative);
			if (result.ok) {
				return { ok: true };
			}
			return result;
		},
		write: write,
		read: read,
		remove: remove,
		removeDir: removeDir,
		rename: rename,
		list: list,
		load: load,
	};
}

function createPackageAccess(hostFs) {
	function rejectWrite(action, path) {
		return fileFailure(action, path, "code package resources are read-only in a WeChat Mini Game", "ERR_FILE_NO_PERMISSION");
	}

	function readFailure(path, error) {
		var detail = errorDetail(error);
		if (detail.indexOf("subpackage") < 0) {
			detail += " If the file is in a subpackage, load that subpackage before starting the engine, and keep ignoreDevUnusedFiles disabled.";
		}
		return classifyFileError("read", path, detail);
	}

	function read(path) {
		try {
			return { ok: true, data: toBytes(hostFs.readFileSync(path)) };
		} catch (error) {
			return readFailure(path, error);
		}
	}

	return {
		read: read,
		readAsync: function (path) {
			if (hostFs && typeof hostFs.readFile === "function") {
				return new Promise(function (resolve, reject) {
					hostFs.readFile({
						filePath: path,
						success: function (result) {
							resolve(toBytes(result && result.data));
						},
						fail: function (error) {
							reject(new Error(readFailure(path, error).message));
						},
					});
				});
			}
			var syncResult = read(path);
			if (!syncResult.ok) {
				return Promise.reject(new Error(syncResult.message));
			}
			return Promise.resolve(syncResult.data);
		},
		write: function (path) {
			return rejectWrite("write", path);
		},
		remove: function (path) {
			return rejectWrite("remove", path);
		},
		rename: function (path) {
			return rejectWrite("rename", path);
		},
		makeDir: function (path) {
			return rejectWrite("mkdir", path);
		},
	};
}

function snapshotNode(FS, node) {
	if (FS && FS.filesystems && FS.filesystems.MEMFS && FS.filesystems.MEMFS.getFileDataAsTypedArray) {
		return new Uint8Array(FS.filesystems.MEMFS.getFileDataAsTypedArray(node));
	}
	var size = node && node.usedBytes ? node.usedBytes : 0;
	var bytes = new Uint8Array(size);
	if (!node || !node.contents || !size) {
		return bytes;
	}
	if (node.contents.subarray) {
		bytes.set(node.contents.subarray(0, size));
		return bytes;
	}
	for (var i = 0; i < size; i++) {
		bytes[i] = node.contents[i];
	}
	return bytes;
}

function restoreNode(node, bytes) {
	node.contents = bytes;
	node.usedBytes = bytes.length;
}

function mountUserData(FS, store, mountPoint) {
	var populating = false;

	function throwResult(result) {
		throw new FS.ErrnoError(engineErrno(result.error));
	}

	function nodePath(node) {
		if (FS.getPath) {
			return FS.getPath(node);
		}
		return node && node.path ? node.path : "";
	}

	var filesystem = {
		mount: function (mount) {
			var node = FS.filesystems.MEMFS.mount(mount);
			if (!node.path) {
				node.path = mount.mountpoint || mountPoint;
			}
			var memfsNodeOps = node.node_ops;
			node.node_ops = Object.assign({}, memfsNodeOps);
			node.node_ops.mknod = function (parent, name, mode, dev) {
				var full = nodePath(parent) + "/" + name;
				var relative = relativeToMount(mountPoint, full);
				if (!populating && relative && !FS.isDir(mode)) {
					var createdOnHost = store.write(relative, new Uint8Array(0));
					if (!createdOnHost.ok) {
						throwResult(createdOnHost);
					}
				}
				var created = memfsNodeOps.mknod(parent, name, mode, dev);
				created.node_ops = node.node_ops;
				created.path = full;
				created.memfs_stream_ops = created.stream_ops;
				created.stream_ops = Object.assign({}, created.stream_ops);
				created.stream_ops.write = function (stream, buffer, offset, length, position, canOwn) {
					var previous = snapshotNode(FS, stream.node);
					var written = created.memfs_stream_ops.write(stream, buffer, offset, length, position, canOwn);
					if (populating) {
						return written;
					}
					var filePath = stream.path || nodePath(stream.node);
					var fileRelative = relativeToMount(mountPoint, filePath);
					if (fileRelative == null) {
						return written;
					}
					var persisted = store.write(fileRelative, snapshotNode(FS, stream.node));
					if (!persisted.ok) {
						restoreNode(stream.node, previous);
						throwResult(persisted);
					}
					return written;
				};
				if (created.memfs_stream_ops && created.memfs_stream_ops.close) {
					created.stream_ops.close = function (stream) {
						return created.memfs_stream_ops.close(stream);
					};
				}
				return created;
			};
			node.node_ops.mkdir = function (parent, name) {
				var full = nodePath(parent) + "/" + name;
				var relative = relativeToMount(mountPoint, full);
				if (!populating && relative) {
					var made = store.makeDir(relative);
					if (!made.ok) {
						throwResult(made);
					}
				}
				var created = memfsNodeOps.mkdir(parent, name);
				created.node_ops = node.node_ops;
				created.path = full;
				return created;
			};
			node.node_ops.unlink = function (parent, name) {
				var full = nodePath(parent) + "/" + name;
				var relative = relativeToMount(mountPoint, full);
				if (!populating && relative) {
					var removed = store.remove(relative);
					if (!removed.ok && removed.error !== "ERR_FILE_NOT_FOUND") {
						throwResult(removed);
					}
				}
				return memfsNodeOps.unlink(parent, name);
			};
			node.node_ops.rmdir = function (parent, name) {
				var full = nodePath(parent) + "/" + name;
				var relative = relativeToMount(mountPoint, full);
				if (!populating && relative) {
					var removed = store.removeDir(relative);
					if (!removed.ok) {
						throwResult(removed);
					}
				}
				return memfsNodeOps.rmdir(parent, name);
			};
			node.node_ops.rename = function (oldNode, newDir, newName) {
				var from = nodePath(oldNode);
				var to = nodePath(newDir) + "/" + newName;
				var fromRelative = relativeToMount(mountPoint, from);
				var toRelative = relativeToMount(mountPoint, to);
				if (!populating && fromRelative && toRelative) {
					var renamed = store.rename(fromRelative, toRelative);
					if (!renamed.ok) {
						throwResult(renamed);
					}
				}
				return memfsNodeOps.rename(oldNode, newDir, newName);
			};
			if (memfsNodeOps.setattr) {
				node.node_ops.setattr = function (target, attr) {
					var previous = snapshotNode(FS, target);
					memfsNodeOps.setattr(target, attr);
					if (populating || !attr || typeof attr.size !== "number") {
						return;
					}
					var relative = relativeToMount(mountPoint, nodePath(target));
					if (!relative) {
						return;
					}
					var persisted = store.write(relative, snapshotNode(FS, target));
					if (!persisted.ok) {
						restoreNode(target, previous);
						throwResult(persisted);
					}
				};
			}
			return node;
		},
	};

	FS.mkdirTree(mountPoint);
	FS.mount(filesystem, {}, mountPoint);
	populating = true;
	var loaded = store.load();
	if (!loaded.ok) {
		populating = false;
		return loaded;
	}
	for (var dirIndex = 0; dirIndex < loaded.dirs.length; dirIndex++) {
		FS.mkdirTree(mountPoint + "/" + loaded.dirs[dirIndex]);
	}
	for (var fileIndex = 0; fileIndex < loaded.files.length; fileIndex++) {
		var file = loaded.files[fileIndex];
		var enginePath = mountPoint + "/" + file.path;
		var slash = enginePath.lastIndexOf("/");
		if (slash > 0) {
			FS.mkdirTree(enginePath.slice(0, slash));
		}
		FS.writeFile(enginePath, file.data);
	}
	populating = false;
	return { ok: true };
}

function createGodotFiles(wx) {
	var userDataPath = wx && wx.env && typeof wx.env.USER_DATA_PATH === "string" ? wx.env.USER_DATA_PATH : "";
	var manager = wx && typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
	var available = !!(userDataPath && manager);
	var store = available ? createUserDataStore(manager, userDataPath) : null;
	return {
		isAvailable: function () {
			return available;
		},
		init: function (FS, godotFS, paths) {
			if (!available) {
				return new Error("WeChat user data directory is unavailable. user:// saves will not persist. wx.env.USER_DATA_PATH and wx.getFileSystemManager() are required.");
			}
			if (!Array.isArray(paths) || !paths.length) {
				return null;
			}
			for (var i = 0; i < paths.length; i++) {
				var mounted = mountUserData(FS, store, paths[i]);
				if (!mounted.ok) {
					try {
						FS.unmount(paths[i]);
					} catch (error) {
						// The mount did not complete.
					}
					return new Error(mounted.message || "Could not load WeChat user data.");
				}
			}
			return null;
		},
		sync: function () {
			return null;
		},
		deinit: function () {},
	};
}

var api = {
	bufferSize: bufferSize,
	changedTouchEvent: changedTouchEvent,
	createGodotFiles: createGodotFiles,
	createHost: createHost,
	createPackageAccess: createPackageAccess,
	createUserDataStore: createUserDataStore,
	cssRect: cssRect,
	diagnoseRendererMessage: diagnoseRendererMessage,
	metricsFromInfo: metricsFromInfo,
	probeCompatibility3D: probeCompatibility3D,
	readPerformanceSample: readPerformanceSample,
	readWindowInfo: readWindowInfo,
	safeAreaPixels: safeAreaPixels,
	samplePerformance: samplePerformance,
	touchToGodot: touchToGodot,
	userDataMounts: userDataMounts,
};

if (typeof module === "object" && module && module.exports) {
	module.exports = api;
}
