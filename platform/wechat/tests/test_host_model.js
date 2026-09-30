"use strict";

const assert = require("node:assert/strict");
const { createHost, metricsFromInfo, readWindowInfo } = require("../js/wechat_host_model.js");

function test(name, fn) {
	try {
		fn();
		console.log("ok " + name);
	} catch (error) {
		console.error("not ok " + name);
		throw error;
	}
}

test("logical window metrics drive the canvas buffer and css rect", () => {
	const root = {};
	const host = createHost();
	const metrics = host.applyInfo(root, {
		windowWidth: 390,
		windowHeight: 844,
		pixelRatio: 3,
		screenWidth: 390,
		screenHeight: 844,
	});
	const canvas = { style: {} };
	host.prepareCanvas(canvas);

	assert.equal(metrics.width, 390);
	assert.equal(metrics.height, 844);
	assert.equal(metrics.ratio, 3);
	assert.equal(root.devicePixelRatio, 3);
	assert.equal(root.innerWidth, 390);
	assert.equal(root.innerHeight, 844);
	assert.equal(root.screen.width, 390);
	assert.equal(root.screen.height, 844);
	assert.equal(canvas.width, 1170);
	assert.equal(canvas.height, 2532);
	assert.deepEqual(canvas.getBoundingClientRect(), {
		x: 0,
		y: 0,
		left: 0,
		top: 0,
		width: 390,
		height: 844,
		right: 390,
		bottom: 844,
	});
});

test("touch points map into godot canvas pixels", () => {
	const metrics = metricsFromInfo({
		windowWidth: 390,
		windowHeight: 844,
		pixelRatio: 3,
		screenWidth: 390,
		screenHeight: 844,
	});
	const rect = { x: 0, y: 0, width: metrics.width, height: metrics.height };
	const first = metrics.touchToGodot(195, 422, rect, 1170, 2532);
	const second = metrics.touchToGodot(10, 20, rect, 1170, 2532);
	assert.equal(first.x, 585);
	assert.equal(first.y, 1266);
	assert.equal(second.x, 30);
	assert.equal(second.y, 60);

	const offset = metrics.touchToGodot(30, 10, { x: 10, y: 5, width: 100, height: 200 }, 200, 400);
	assert.equal(offset.x, 40);
	assert.equal(offset.y, 10);
});

test("multi-touch events keep every changed point", () => {
	const root = {};
	const host = createHost();
	host.applyInfo(root, { windowWidth: 390, windowHeight: 844, pixelRatio: 3, screenWidth: 390, screenHeight: 844 });
	const canvas = { style: {} };
	host.prepareCanvas(canvas);
	root.__godotWeChatCanvas = canvas;
	const seen = [];
	canvas.addEventListener("touchstart", (event) => {
		seen.push(event.changedTouches.map((touch) => [touch.identifier, touch.clientX, touch.clientY]));
	});
	const wx = fakeWx();
	host.bind(root, wx);
	wx.handlers.onTouchStart({
		changedTouches: [
			{ identifier: 0, clientX: 195, clientY: 422 },
			{ identifier: 4, clientX: 10, clientY: 20 },
		],
	});
	assert.deepEqual(seen, [[[0, 195, 422], [4, 10, 20]]]);
});

test("safe area is reported in the same pixels as the window", () => {
	const host = createHost();
	host.applyInfo({}, {
		windowWidth: 390,
		windowHeight: 844,
		pixelRatio: 3,
		screenWidth: 390,
		screenHeight: 844,
		safeArea: { left: 0, top: 47, right: 390, bottom: 810, width: 390, height: 763 },
	});
	assert.deepEqual(host.currentSafeArea(), { x: 0, y: 141, width: 1170, height: 2289 });

	host.applyInfo({}, {
		windowWidth: 390,
		windowHeight: 844,
		pixelRatio: 2,
		screenWidth: 390,
		screenHeight: 844,
		screenTop: 12,
		safeArea: { left: 0, top: 59, right: 390, bottom: 800, width: 390, height: 741 },
	});
	assert.deepEqual(host.currentSafeArea(), { x: 0, y: 94, width: 780, height: 1482 });

	host.applyInfo({}, {
		windowWidth: 390,
		windowHeight: 844,
		pixelRatio: 1,
		screenWidth: 390,
		screenHeight: 844,
		safeArea: { left: 0, top: 0, right: 390, bottom: 900, width: 390, height: 900 },
	});
	assert.deepEqual(host.currentSafeArea(), { x: 0, y: 0, width: 390, height: 844 });

	host.applyInfo({}, { windowWidth: 390, windowHeight: 844, pixelRatio: 3, screenWidth: 390, screenHeight: 844 });
	assert.deepEqual(host.currentSafeArea(), { x: 0, y: 0, width: 1170, height: 2532 });
});

test("missing window info falls back to the 480 by 854 logical viewport", () => {
	const metrics = metricsFromInfo({});
	assert.equal(metrics.width, 480);
	assert.equal(metrics.height, 854);
	assert.equal(metrics.ratio, 1);
	assert.deepEqual(metrics.safeAreaPixels(), { x: 0, y: 0, width: 480, height: 854 });
});

test("window info does not call getSystemInfoSync when a newer API exists", () => {
	let called = false;
	const merged = readWindowInfo({
		getWindowInfo() {
			return { windowWidth: 390, windowHeight: 844 };
		},
		getDeviceInfo() {
			return { pixelRatio: 2, system: "iOS 17.5" };
		},
		getSystemInfoSync() {
			called = true;
			return { windowWidth: 100, pixelRatio: 9 };
		},
	});
	assert.equal(called, false);
	assert.equal(merged.windowWidth, 390);
	assert.equal(merged.pixelRatio, 2);
	assert.equal(merged.system, "iOS 17.5");

	const legacy = readWindowInfo({
		getSystemInfoSync() {
			return {
				windowWidth: 11,
				windowHeight: 22,
				pixelRatio: 1,
				safeArea: { left: 0, top: 1, right: 2, bottom: 3 },
				screenTop: 4,
			};
		},
	});
	assert.equal(legacy.windowWidth, 11);
	assert.equal(legacy.windowHeight, 22);
	assert.equal(legacy.safeArea.top, 1);
	assert.equal(legacy.screenTop, 4);
});

test("hiding pauses once and showing resumes without replacing the runtime", () => {
	const root = {};
	const host = createHost();
	host.applyInfo(root, { windowWidth: 390, windowHeight: 844, pixelRatio: 3, screenWidth: 390, screenHeight: 844 });
	const canvas = { style: {} };
	host.prepareCanvas(canvas);
	const token = host.runtimeToken();
	const events = [];
	host.setLifecycleHandler((foreground) => {
		events.push(foreground);
	});

	host.hide();
	host.hide();
	host.show();
	host.show();

	assert.deepEqual(events, [false, true]);
	assert.equal(host.runtimeToken(), token);
	assert.equal(host.isForeground(), true);
	assert.equal(root.innerWidth, 390);
	assert.equal(canvas.width, 1170);
});

test("a hide that happens before the engine attaches is delivered when the handler connects", () => {
	const host = createHost();
	host.hide();
	let seen = "missing";
	host.setLifecycleHandler((foreground) => {
		seen = foreground;
	});
	assert.equal(seen, false);
	assert.equal(host.isForeground(), false);
});

test("a resize without window size does not replace the current metrics", () => {
	const root = {};
	const host = createHost();
	host.applyInfo(root, { windowWidth: 390, windowHeight: 844, pixelRatio: 2, screenWidth: 390, screenHeight: 844 });
	host.refresh({});
	host.refresh(null);
	assert.equal(root.innerWidth, 390);
	assert.equal(root.innerHeight, 844);
});

test("wx hide show and resize drive the same host", () => {
	const root = {};
	const host = createHost();
	const canvas = { style: {} };
	root.__godotWeChatCanvas = canvas;
	let width = 390;
	const wx = fakeWx();
	wx.getWindowInfo = () => ({ windowWidth: width, windowHeight: 844, pixelRatio: 2, screenWidth: width, screenHeight: 844 });
	host.bind(root, wx);
	host.prepareCanvas(canvas);
	width = 200;
	wx.handlers.onWindowResize();
	assert.equal(root.innerWidth, 200);
	assert.equal(canvas.width, 400);

	const events = [];
	host.setLifecycleHandler((foreground) => {
		events.push(foreground);
	});
	wx.handlers.onHide();
	wx.handlers.onHide();
	width = 844;
	wx.handlers.onShow();
	wx.handlers.onWindowResize();

	assert.deepEqual(events, [false, true]);
	assert.equal(root.innerWidth, 844);
	assert.equal(root.devicePixelRatio, 2);
	assert.equal(canvas.width, 400);
	assert.equal(host.isForeground(), true);
});

function fakeWx() {
	const wx = { handlers: {} };
	for (const name of ["onTouchStart", "onTouchMove", "onTouchEnd", "onTouchCancel", "onHide", "onShow", "onWindowResize"]) {
		wx[name] = (handler) => {
			wx.handlers[name] = handler;
		};
	}
	return wx;
}
