"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAudioSession, createHost } = require("../js/wechat_host_model.js");

function test(name, fn) {
	return Promise.resolve()
		.then(fn)
		.then(() => {
			console.log("ok " + name);
		})
		.catch((error) => {
			console.error("not ok " + name);
			throw error;
		});
}

function capture(fn) {
	const errors = [];
	const warnings = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	console.error = (...args) => {
		errors.push(args.map(String).join(" "));
	};
	console.warn = (...args) => {
		warnings.push(args.map(String).join(" "));
	};
	try {
		return { result: fn(), errors, warnings };
	} finally {
		console.error = originalError;
		console.warn = originalWarn;
	}
}

function fakeContext() {
	const ctx = {
		state: "suspended",
		sampleRate: 44100,
		currentTime: 0,
		destination: {},
		calls: [],
		resume() {
			ctx.calls.push("resume");
			ctx.state = "running";
			return Promise.resolve();
		},
		suspend() {
			ctx.calls.push("suspend");
			ctx.state = "suspended";
			return Promise.resolve();
		},
		close() {
			ctx.calls.push("close");
			ctx.state = "closed";
			return Promise.resolve();
		},
		createScriptProcessor() {
			ctx.calls.push("createScriptProcessor");
			return { connect() {}, disconnect() {} };
		},
	};
	return ctx;
}

function fakeAudioWx() {
	const wx = {
		contexts: [],
		innerAudioCount: 0,
		handlers: {},
		createWebAudioContext() {
			const ctx = fakeContext();
			wx.contexts.push(ctx);
			return ctx;
		},
		createInnerAudioContext() {
			wx.innerAudioCount += 1;
			throw new Error("InnerAudio is not the Godot mix output");
		},
	};
	for (const name of ["onTouchStart", "onTouchMove", "onTouchEnd", "onTouchCancel", "onHide", "onShow", "onWindowResize", "onAudioInterruptionBegin", "onAudioInterruptionEnd"]) {
		wx[name] = (handler) => {
			wx.handlers[name] = handler;
		};
	}
	return wx;
}

function scheduler() {
	const pending = [];
	const cancelled = [];
	return {
		pending,
		cancelled,
		schedule(fn) {
			pending.push(fn);
			return pending.length;
		},
		cancel(id) {
			cancelled.push(id);
			pending[id - 1] = null;
		},
		run() {
			const queued = pending.slice();
			for (let i = 0; i < queued.length; i++) {
				if (queued[i]) {
					queued[i]();
				}
			}
		},
	};
}

const tests = [];

tests.push(test("godot output is one wechat webaudiocontext, not an inner audio player", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	const root = {};
	const opened = capture(() => session.attach(wx, root)).result;

	assert.equal(opened.ok, true);
	assert.equal(opened.output, "WebAudioContext");
	assert.equal(wx.contexts.length, 1);
	assert.equal(wx.innerAudioCount, 0);
	const ctx = new root.AudioContext({ sampleRate: 48000 });
	assert.equal(ctx, wx.contexts[0]);
	assert.equal(new root.webkitAudioContext(), ctx);
	assert.equal(ctx.destination.channelCount, 2);
	assert.equal(typeof ctx.createScriptProcessor, "function");
	assert.deepEqual(ctx.calls, []);
	assert.equal(session.isUnlocked(), false);
	assert.equal(session.context(), ctx);
	assert.equal(session.failure(), null);
}));

tests.push(test("a different requested mix rate is reported and then followed from the context", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	const root = {};
	const logged = capture(() => {
		session.attach(wx, root);
		return new root.AudioContext({ sampleRate: 48000 });
	});
	assert.equal(logged.result.sampleRate, 44100);
	assert.equal(logged.warnings.length, 1);
	assert.match(logged.warnings[0], /48000/);
	assert.match(logged.warnings[0], /44100/);
	assert.match(logged.warnings[0], /wx\.createWebAudioContext/);
}));

tests.push(test("the first tap unlocks playback and a rejected resume explains the gesture", async () => {
	const wx = fakeAudioWx();
	wx.createWebAudioContext = () => {
		const ctx = fakeContext();
		ctx.resume = () => {
			ctx.calls.push("resume");
			return Promise.reject(new Error("gesture required"));
		};
		wx.contexts.push(ctx);
		return ctx;
	};
	const session = createAudioSession(null, {});
	const root = {};
	capture(() => session.attach(wx, root));
	const unlocked = session.unlock();
	assert.equal(unlocked.ok, true);
	assert.equal(session.isUnlocked(), true);
	await Promise.resolve();
	const entry = session.diagnostics().find((item) => item.title === "Audio resume failed");
	assert.ok(entry);
	assert.match(entry.message, /user gesture/);
	assert.match(entry.message, /Tap the game/);
}));

tests.push(test("resume and suspend exceptions stay on the audio session", () => {
	const wx = fakeAudioWx();
	wx.createWebAudioContext = () => {
		const ctx = fakeContext();
		ctx.resume = () => {
			throw new Error("resume blocked");
		};
		ctx.suspend = () => {
			throw new Error("suspend blocked");
		};
		wx.contexts.push(ctx);
		return ctx;
	};
	const session = createAudioSession(null, {});
	const logged = capture(() => {
		session.attach(wx, {});
		session.unlock();
		session.onBackground();
	});
	const titles = session.diagnostics().map((entry) => entry.title);
	assert.deepEqual(titles, ["Audio resume failed", "Audio suspend failed"]);
	assert.match(logged.errors[0], /resume blocked/);
	assert.match(logged.errors[1], /suspend blocked/);
	assert.match(logged.errors[1], /background/);
}));

tests.push(test("background suspends and foreground resumes only after the gesture", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	capture(() => session.attach(wx, {}));
	const ctx = wx.contexts[0];

	const locked = capture(() => {
		session.onBackground();
		return session.onForeground();
	});
	assert.deepEqual(ctx.calls, ["suspend"]);
	assert.equal(locked.result.waitingForGesture, true);
	assert.match(locked.warnings.join("\n"), /first tap/);

	capture(() => session.unlock());
	assert.ok(ctx.calls.includes("resume"));
	ctx.calls = [];
	session.onBackground();
	session.onBackground();
	const returned = session.onForeground();
	assert.equal(returned.ok, true);
	assert.deepEqual(ctx.calls, ["suspend", "resume"]);
}));

tests.push(test("a tap while backgrounded waits until the game is visible again", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	capture(() => session.attach(wx, {}));
	const ctx = wx.contexts[0];
	session.onBackground();
	ctx.calls = [];
	session.unlock();
	assert.deepEqual(ctx.calls, []);
	assert.equal(session.isUnlocked(), true);
	session.onForeground();
	assert.deepEqual(ctx.calls, ["resume"]);
}));

tests.push(test("an audio interruption pauses playback and resumes after it ends", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	capture(() => session.attach(wx, {}));
	const ctx = wx.contexts[0];
	session.unlock();
	ctx.calls = [];
	session.onInterruptionBegin();
	session.unlock();
	assert.deepEqual(ctx.calls, ["suspend"]);
	session.onInterruptionEnd();
	assert.deepEqual(ctx.calls, ["suspend", "resume"]);
}));

tests.push(test("an interruption that ends in the background does not resume", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {});
	capture(() => session.attach(wx, {}));
	const ctx = wx.contexts[0];
	session.unlock();
	session.onBackground();
	ctx.calls = [];
	session.onInterruptionBegin();
	session.onInterruptionEnd();
	assert.deepEqual(ctx.calls, ["suspend"]);
}));

tests.push(test("missing or broken webaudiocontext setup explains the base library", () => {
	const missing = createAudioSession(null, {});
	const missingLog = capture(() => missing.attach({}, {}));
	assert.equal(missingLog.result.ok, false);
	assert.equal(missing.failure().title, "WebAudioContext unavailable");
	assert.match(missingLog.result.message, /wx\.createWebAudioContext/);
	assert.match(missingLog.result.message, /2\.19\.0/);
	assert.match(missingLog.result.message, /createInnerAudioContext/);
	assert.equal(missingLog.errors.length, 1);

	const throwing = fakeAudioWx();
	throwing.createWebAudioContext = () => {
		throw new Error("not implemented");
	};
	const failed = createAudioSession(null, {});
	const failedLog = capture(() => failed.attach(throwing, {}));
	assert.equal(failedLog.result.ok, false);
	assert.match(failedLog.result.message, /not implemented/);
	assert.match(failedLog.result.message, /2\.19\.0/);
	assert.equal(failed.context(), null);

	const incomplete = fakeAudioWx();
	incomplete.createWebAudioContext = () => ({ state: "suspended" });
	const invalid = createAudioSession(null, {});
	const invalidLog = capture(() => invalid.attach(incomplete, {}));
	assert.equal(invalidLog.result.ok, false);
	assert.match(invalidLog.result.message, /createScriptProcessor/);
	assert.equal(invalidLog.result.output, undefined);
}));

tests.push(test("ios 17.5 high performance mode recreates the context after background", () => {
	const wx = fakeAudioWx();
	const clock = scheduler();
	const session = createAudioSession(null, {
		environment: { sdkVersion: "2.25.3", system: "iOS 17.5.1", iosHighPerformanceMode: true },
		schedule: clock.schedule,
		cancelSchedule: clock.cancel,
		iosResumeDelayMs: 2000,
	});
	const replaced = [];
	session.setContextReplacedHandler((context) => {
		replaced.push(context);
	});
	const root = { isIOSHighPerformanceMode: true };
	capture(() => session.attach(wx, root));
	assert.equal(clock.pending.length, 1);
	const first = wx.contexts[0];
	session.unlock();
	assert.ok(first.calls.includes("resume"));
	session.onBackground();
	assert.ok(clock.cancelled.length >= 1);
	clock.run();
	assert.equal(first.calls.includes("resume") ? first.calls.filter((call) => call === "resume").length : 0, 1);

	session.onForeground();
	assert.equal(wx.contexts.length, 2);
	assert.ok(first.calls.includes("close"));
	assert.equal(replaced.length, 1);
	assert.equal(replaced[0], wx.contexts[1]);
	assert.equal(session.context(), wx.contexts[1]);
	assert.equal(session.generation(), 2);
	assert.ok(wx.contexts[1].calls.includes("resume"));
	assert.equal(wx.innerAudioCount, 0);
}));

tests.push(test("the ios startup resume waits out a background transition", () => {
	const wx = fakeAudioWx();
	const clock = scheduler();
	const session = createAudioSession(null, {
		environment: { sdkVersion: "3.0.0", system: "iOS 16.0", iosHighPerformanceMode: true },
		schedule: clock.schedule,
		cancelSchedule: clock.cancel,
	});
	capture(() => session.attach(wx, {}));
	const ctx = wx.contexts[0];
	session.onBackground();
	clock.run();
	assert.deepEqual(ctx.calls, ["suspend"]);
	session.onForeground();
	assert.equal(wx.contexts.length, 1);
	assert.equal(ctx.calls.includes("close"), false);
}));

tests.push(test("a context replacement failure is reported without losing the new context", () => {
	const wx = fakeAudioWx();
	const session = createAudioSession(null, {
		environment: { sdkVersion: "3.0.0", system: "iOS 18.0", iosHighPerformanceMode: true },
		schedule() {
			return 1;
		},
		cancelSchedule() {},
	});
	session.setContextReplacedHandler(() => {
		throw new Error("mix graph rejected the new context");
	});
	capture(() => session.attach(wx, {}));
	session.unlock();
	session.onBackground();
	const logged = capture(() => session.onForeground());
	assert.equal(logged.result.ok, true);
	assert.equal(session.context(), wx.contexts[1]);
	assert.match(logged.errors.join("\n"), /Audio output reconnect failed/);
	assert.match(logged.errors.join("\n"), /iOS 17\.5/);
}));

tests.push(test("host touch, lifecycle, and interruption drive the same webaudiocontext", () => {
	const root = {};
	const host = createHost();
	const wx = fakeAudioWx();
	const logged = capture(() => host.bind(root, wx));
	assert.equal(logged.errors.length, 0);
	const ctx = new root.AudioContext();
	assert.equal(ctx, host.audioSession().context());

	wx.handlers.onTouchStart({ changedTouches: [] });
	assert.ok(ctx.calls.includes("resume"));
	ctx.calls = [];
	wx.handlers.onHide();
	wx.handlers.onHide();
	assert.deepEqual(ctx.calls, ["suspend"]);
	wx.handlers.onShow();
	assert.deepEqual(ctx.calls, ["suspend", "resume"]);
	ctx.calls = [];
	wx.handlers.onAudioInterruptionBegin();
	wx.handlers.onAudioInterruptionEnd();
	assert.deepEqual(ctx.calls, ["suspend", "resume"]);
	assert.equal(wx.innerAudioCount, 0);
	assert.equal(typeof host.setAudioContextReplacedHandler, "function");
}));

tests.push(test("audioWorklet without AudioWorkletNode does not hide the script processor", () => {
	const wx = fakeAudioWx();
	const original = wx.createWebAudioContext;
	wx.createWebAudioContext = () => {
		const ctx = original();
		ctx.audioWorklet = { addModule() { return Promise.resolve(); } };
		return ctx;
	};
	const session = createAudioSession(null, {});
	const root = {};
	capture(() => session.attach(wx, root));
	const ctx = new root.AudioContext();
	assert.equal(ctx.audioWorklet, undefined);
	assert.equal(typeof ctx.createScriptProcessor, "function");
	assert.equal(wx.innerAudioCount, 0);
}));

tests.push(test("the sample project uses godot players for the stream and the sample", () => {
	const script = fs.readFileSync(path.join(__dirname, "audio", "main.gd"), "utf8");
	assert.match(script, /AudioStreamGenerator/);
	assert.match(script, /AudioStreamWAV/);
	assert.match(script, /AudioStreamPlayer/);
	assert.match(script, /PLAYBACK_TYPE_SAMPLE/);
	assert.match(script, /Sfx/);
	assert.doesNotMatch(script, /createInnerAudioContext|createWebAudioContext|JavaScriptBridge/);
}));

tests.push(test("a host without webaudiocontext still runs and names the missing api", () => {
	const host = createHost();
	const wx = fakeAudioWx();
	delete wx.createWebAudioContext;
	const logged = capture(() => host.bind({}, wx));
	assert.equal(host.audioSession().failure().title, "WebAudioContext unavailable");
	assert.match(logged.errors.join("\n"), /2\.19\.0/);
	wx.handlers.onTouchStart({ changedTouches: [] });
	wx.handlers.onHide();
	wx.handlers.onShow();
	assert.equal(host.isForeground(), true);
}));

Promise.all(tests).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
