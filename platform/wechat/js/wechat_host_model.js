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
	metricsFromInfo: metricsFromInfo,
	readWindowInfo: readWindowInfo,
	safeAreaPixels: safeAreaPixels,
	touchToGodot: touchToGodot,
};

if (typeof module === "object" && module && module.exports) {
	module.exports = api;
}
