/**
 * WeChat window, touch, and lifecycle mapping.
 *
 * Touch conversion matches Godot's web input path: CSS pixels in, canvas
 * buffer pixels out. Safe area uses that same buffer pixel space.
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

var api = {
	bufferSize: bufferSize,
	changedTouchEvent: changedTouchEvent,
	createHost: createHost,
	cssRect: cssRect,
	diagnoseRendererMessage: diagnoseRendererMessage,
	metricsFromInfo: metricsFromInfo,
	probeCompatibility3D: probeCompatibility3D,
	readPerformanceSample: readPerformanceSample,
	readWindowInfo: readWindowInfo,
	safeAreaPixels: safeAreaPixels,
	samplePerformance: samplePerformance,
	touchToGodot: touchToGodot,
};

if (typeof module === "object" && module && module.exports) {
	module.exports = api;
}
