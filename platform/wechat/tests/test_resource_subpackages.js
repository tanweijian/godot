"use strict";

const assert = require("node:assert/strict");
const { createResourceSubpackageLoader } = require("../js/wechat_host_model.js");

const tests = [];

function test(name, fn) {
	tests.push({ name, fn });
}

function flush() {
	return new Promise((resolve) => setImmediate(resolve));
}

function groups() {
	return [
		{
			name: "levels",
			subpackage: "levels",
			root: "groups/levels/",
			pack: "groups/levels/pack.bin",
		},
	];
}

function deferredWx() {
	let options = null;
	let progress = null;
	const calls = [];
	return {
		calls,
		wx: {
			loadSubpackage(requested) {
				calls.push(requested.name);
				options = requested;
				return {
					onProgressUpdate(callback) {
						progress = callback;
					},
				};
			},
		},
		progress(percent) {
			progress({ progress: percent });
		},
		succeed() {
			options.success();
		},
		fail(message) {
			options.fail({ errMsg: message });
		},
	};
}

const levels = groups();

test("an unknown resource subpackage fails before WeChat downloads it", async () => {
	const calls = [];
	const events = [];
	const loader = createResourceSubpackageLoader({
		groups: levels,
		wx: {
			loadSubpackage(options) {
				calls.push(options.name);
			},
		},
		readFile() {
			throw new Error("readFile should not be called");
		},
	});
	const code = loader.load("audio", {
		progress() {
			events.push("progress");
		},
		success() {
			events.push("success");
		},
		failure(message) {
			events.push(message);
		},
	});
	assert.equal(code, 1);
	assert.deepEqual(calls, []);
	assert.deepEqual(events, ['WeChat resource subpackage "audio" is not in the package manifest.']);
});

test("progress is reported before success, and the pack is delivered only after the subpackage loads", async () => {
	const wx = deferredWx();
	const reads = [];
	const events = [];
	const loader = createResourceSubpackageLoader({
		groups: levels,
		wx: wx.wx,
		readFile(path) {
			reads.push(path);
			return Promise.resolve(Uint8Array.from([7, 8, 9]));
		},
	});
	const code = loader.load("levels", {
		progress(percent) {
			events.push("progress:" + percent);
		},
		success(bytes) {
			events.push("success:" + Array.from(bytes).join(","));
		},
		failure(message) {
			events.push("failure:" + message);
		},
	});
	assert.equal(code, 0);
	assert.deepEqual(wx.calls, ["levels"]);
	wx.progress(40);
	assert.deepEqual(reads, []);
	assert.deepEqual(events, ["progress:40"]);
	wx.succeed();
	await flush();
	assert.deepEqual(reads, ["groups/levels/pack.bin"]);
	assert.deepEqual(events, ["progress:40", "success:7,8,9"]);
});

test("a failed subpackage download does not read or deliver its resource pack", async () => {
	const wx = deferredWx();
	const reads = [];
	const events = [];
	const loader = createResourceSubpackageLoader({
		groups: levels,
		wx: wx.wx,
		readFile(path) {
			reads.push(path);
			return Promise.resolve(Uint8Array.from([1]));
		},
	});
	loader.load("levels", {
		progress() {
			events.push("progress");
		},
		success() {
			events.push("success");
		},
		failure(message) {
			events.push(message);
		},
	});
	wx.fail("download error");
	wx.progress(90);
	await flush();
	assert.deepEqual(reads, []);
	assert.equal(events.length, 1);
	assert.match(events[0], /Failed to load WeChat resource subpackage "levels"/);
	assert.match(events[0], /not mounted/);
	assert.equal(events.includes("success"), false);
});

test("a pack that cannot be read after download is not delivered", async () => {
	const wx = deferredWx();
	const events = [];
	const loader = createResourceSubpackageLoader({
		groups: levels,
		wx: wx.wx,
		readFile() {
			return Promise.reject(new Error("permission denied"));
		},
	});
	loader.load("levels", {
		success() {
			events.push("success");
		},
		failure(message) {
			events.push(message);
		},
	});
	wx.succeed();
	await flush();
	assert.deepEqual(events.filter((event) => event === "success"), []);
	assert.match(events.join("\n"), /could not be read/);
	assert.match(events.join("\n"), /not mounted/);
});

test("missing wx.loadSubpackage fails without reading the pack", async () => {
	const reads = [];
	let message = "";
	const loader = createResourceSubpackageLoader({
		groups: levels,
		wx: {},
		readFile(path) {
			reads.push(path);
		},
	});
	const code = loader.load("levels", {
		failure(detail) {
			message = detail;
		},
	});
	assert.equal(code, 2);
	assert.deepEqual(reads, []);
	assert.match(message, /wx.loadSubpackage is missing/);
	assert.match(message, /not mounted/);
});

(async () => {
	for (const item of tests) {
		try {
			await item.fn();
			console.log("ok " + item.name);
		} catch (error) {
			console.error("not ok " + item.name);
			console.error(error);
			process.exitCode = 1;
			return;
		}
	}
})();
