"use strict";

const assert = require("node:assert/strict");
const { createHost } = require("../js/wechat_host_model.js");

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

function tick() {
	return new Promise((resolve) => setImmediate(resolve));
}

function capture(fn) {
	const errors = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	const record = (...args) => {
		errors.push(args.map(String).join(" "));
	};
	console.error = record;
	console.warn = record;
	try {
		return Promise.resolve()
			.then(fn)
			.then((result) => ({ result, errors }))
			.finally(() => {
				console.error = originalError;
				console.warn = originalWarn;
			});
	} catch (error) {
		console.error = originalError;
		console.warn = originalWarn;
		throw error;
	}
}

function bytesOf(value) {
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	return new Uint8Array(0);
}

async function readBody(response) {
	assert.ok(response.body, "Godot reads the response body through a stream reader");
	const reader = response.body.getReader();
	const chunks = [];
	let done = false;
	while (!done) {
		const next = await reader.read();
		done = next.done;
		if (next.value) {
			chunks.push(bytesOf(next.value));
		}
	}
	const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const body = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.length;
	}
	return body;
}

function headerMap(response) {
	const headers = {};
	assert.equal(typeof response.headers.forEach, "function");
	response.headers.forEach((value, name) => {
		headers[String(name).toLowerCase()] = String(value);
	});
	return headers;
}

function hostWith(wx) {
	const root = {};
	const host = createHost();
	host.bind(root, wx);
	return root;
}

function touchWx(extra) {
	const wx = Object.assign(
		{
			onTouchStart() {},
			onTouchMove() {},
			onTouchEnd() {},
			onTouchCancel() {},
			onHide() {},
			onShow() {},
			onWindowResize() {},
		},
		extra,
	);
	return wx;
}

function socketTask() {
	const task = {
		sent: [],
		closed: null,
		listeners: { open: [], message: [], error: [], close: [] },
		onOpen(fn) {
			task.listeners.open.push(fn);
		},
		onMessage(fn) {
			task.listeners.message.push(fn);
		},
		onError(fn) {
			task.listeners.error.push(fn);
		},
		onClose(fn) {
			task.listeners.close.push(fn);
		},
		send(options) {
			task.sent.push(options);
		},
		close(options) {
			task.closed = options;
		},
		emit(name, event) {
			for (const fn of task.listeners[name]) {
				fn(event);
			}
		},
	};
	return task;
}

const tests = [];

tests.push(test("an HTTP request completes through wx.request for a configured domain", async () => {
	const calls = [];
	let aborted = 0;
	const wx = touchWx({
		request(options) {
			calls.push(options);
			options.success({
				statusCode: 201,
				header: { "Content-Type": "text/plain", "X-Trace": "ready" },
				cookies: ["session=abc"],
				data: new TextEncoder().encode("pong").buffer,
			});
			return {
				abort() {
					aborted += 1;
				},
			};
		},
	});
	const root = hostWith(wx);
	const backing = new Uint8Array([9, 1, 2, 3, 4]);
	const body = backing.subarray(1, 4);
	const response = await root.fetch("https://api.example.com:443/v1/ping?x=1", {
		method: "POST",
		headers: [
			["Content-Type", "application/octet-stream"],
			["X-Trace", "1"],
			["Referer", "https://evil.example"],
		],
		body,
	});

	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, "https://api.example.com/v1/ping?x=1");
	assert.equal(calls[0].method, "POST");
	assert.equal(calls[0].responseType, "arraybuffer");
	assert.notEqual(String(calls[0].dataType).toLowerCase(), "json");
	assert.deepEqual(bytesOf(calls[0].data), Uint8Array.of(1, 2, 3));
	assert.notEqual(calls[0].data, body.buffer);
	assert.equal(calls[0].header["content-type"] || calls[0].header["Content-Type"], "application/octet-stream");
	assert.equal(calls[0].header["X-Trace"] || calls[0].header["x-trace"], "1");
	assert.equal(calls[0].header.Referer, undefined);
	assert.equal(calls[0].header.referer, undefined);
	assert.equal(response.status, 201);
	const headers = headerMap(response);
	assert.equal(headers["content-type"], "text/plain");
	assert.equal(headers["x-trace"], "ready");
	assert.equal(headers["set-cookie"], "session=abc");
	assert.deepEqual(await readBody(response), new TextEncoder().encode("pong"));
	response.abort();
	assert.equal(aborted, 1);
}));

tests.push(test("a decoded WeChat body is not presented as gzip to Godot", async () => {
	const wx = touchWx({
		request(options) {
			options.success({
				statusCode: 200,
				header: {
					"content-encoding": "gzip",
					"content-length": "3",
					"content-type": "text/html",
				},
					data: new TextEncoder().encode("<html>").buffer,
			});
			return { abort() {} };
		},
	});
	const root = hostWith(wx);
	const response = await root.fetch("https://www.qq.com/");
	const headers = headerMap(response);
	assert.equal(headers["content-encoding"], undefined);
	assert.equal(headers["content-length"], undefined);
	assert.equal(headers["content-type"], "text/html");
	assert.equal(new TextDecoder().decode(await readBody(response)), "<html>");
}));

tests.push(test("a JSON request is sent as text and a non-default port is preserved", async () => {
	const calls = [];
	const wx = touchWx({
		request(options) {
			calls.push(options);
			options.success({ statusCode: 200, header: { "content-type": "application/json" }, data: new TextEncoder().encode("{}").buffer });
			return { abort() {} };
		},
	});
	const root = hostWith(wx);
	const response = await root.fetch("https://cdn.example.com:8443/items", {
		method: "PUT",
		headers: [["Content-Type", "application/json"]],
		body: new TextEncoder().encode('{"n":1}'),
	});
	assert.equal(calls[0].url, "https://cdn.example.com:8443/items");
	assert.equal(calls[0].method, "PUT");
	assert.equal(calls[0].data, '{"n":1}');
	assert.equal(response.status, 200);
	assert.deepEqual(await readBody(response), new TextEncoder().encode("{}"));
}));

tests.push(test("an unconfigured or invalid request domain surfaces an actionable error", async () => {
	const calls = [];
	const wx = touchWx({
		request(options) {
			calls.push(options);
			options.fail({ errMsg: "request:fail url not in domain list", errno: 600002 });
			return { abort() {} };
		},
	});
	const root = hostWith(wx);
	const logged = await capture(() =>
		assert.rejects(root.fetch("https://missing.example.com:443/v1"), (error) => {
			const message = String(error && error.message ? error.message : error);
				assert.match(message, /https:\/\/missing\.example\.com/);
			assert.doesNotMatch(message, /https:\/\/missing\.example\.com:443/);
			assert.match(message, /request合法域名/);
			assert.match(message, /微信公众平台 > 开发 > 开发管理 > 开发设置 > 服务器域名/);
			assert.match(message, /443/);
			assert.match(message, /cannot configure or verify/);
			assert.match(message, /urlCheck/);
			return true;
		}),
	);
	assert.equal(calls[0].url, "https://missing.example.com/v1");
	assert.match(logged.errors.join("\n"), /request合法域名/);
}));

tests.push(test("a request host without wx.request fails before pretending to use a browser", async () => {
	const root = hostWith(touchWx({}));
	await assert.rejects(root.fetch("https://api.example.com/v1"), (error) => {
		const message = String(error && error.message ? error.message : error);
		assert.match(message, /wx\.request/);
		assert.match(message, /2\.19\.0/);
		return true;
	});
}));

tests.push(test("a WebSocket can connect, exchange messages, close, and keep connections independent", async () => {
	const tasks = [];
	const wx = touchWx({
		connectSocket(options) {
			const task = socketTask();
			task.options = options;
			tasks.push(task);
			return task;
		},
	});
	const root = hostWith(wx);
	const first = new root.WebSocket("wss://realtime.example.com/room", ["game"]);
	const second = new root.WebSocket("wss://realtime.example.com/other");
	assert.equal(first.readyState, first.CONNECTING);
	assert.equal(tasks[0].options.url, "wss://realtime.example.com/room");
	assert.deepEqual(tasks[0].options.protocols, ["game"]);
	assert.equal(tasks[1].options.url, "wss://realtime.example.com/other");

	let opened = "";
	first.onopen = () => {
		opened = first.protocol;
	};
	tasks[0].emit("open", { header: { "Sec-WebSocket-Protocol": "game" } });
	assert.equal(first.readyState, first.OPEN);
	assert.equal(opened, "game");
	assert.equal(second.readyState, second.CONNECTING);

	first.send("ping");
	assert.equal(tasks[0].sent[0].data, "ping");
	assert.equal(first.bufferedAmount, 4);
	tasks[0].sent[0].success();
	assert.equal(first.bufferedAmount, 0);

	const binary = new Uint8Array([7, 8, 9]).buffer;
	first.send(binary);
	assert.deepEqual(bytesOf(tasks[0].sent[1].data), Uint8Array.of(7, 8, 9));
	tasks[0].sent[1].success();

	const messages = [];
	first.onmessage = (event) => messages.push(event.data);
	second.onmessage = () => {
		throw new Error("the other socket received a message");
	};
	tasks[0].emit("message", { data: "pong" });
	tasks[0].emit("message", { data: new Uint8Array([4]).buffer });
	assert.equal(messages[0], "pong");
	assert.ok(messages[1] instanceof ArrayBuffer);
	assert.deepEqual(bytesOf(messages[1]), Uint8Array.of(4));

	let closed = null;
	first.onclose = (event) => {
		closed = event;
	};
	first.close(1000, "done");
	assert.equal(first.readyState, first.CLOSING);
	assert.equal(tasks[0].closed.code, 1000);
	assert.equal(tasks[0].closed.reason, "done");
	tasks[0].emit("close", { code: 1000, reason: "done" });
	assert.equal(first.readyState, first.CLOSED);
	assert.equal(closed.code, 1000);
	assert.equal(closed.reason, "done");
	assert.equal(second.readyState, second.CONNECTING);
}));

tests.push(test("an unconfigured WebSocket domain reports an actionable close reason", async () => {
	const wx = touchWx({
		connectSocket(options) {
			options.fail({ errMsg: "connectSocket:fail url not in domain list", errno: 600002 });
			return socketTask();
		},
	});
	const root = hostWith(wx);
	const socket = new root.WebSocket("wss://missing.example.com/room");
	const events = [];
	socket.onerror = () => events.push("error");
	socket.onclose = (event) => events.push(event);
	await tick();
	assert.deepEqual(events.map((event) => (typeof event === "string" ? event : "close")), ["error", "close"]);
	const message = events[1].reason;
	assert.equal(socket.readyState, socket.CLOSED);
	assert.match(message, /wss:\/\/missing\.example\.com/);
	assert.match(message, /socket合法域名/);
	assert.match(message, /微信公众平台 > 开发 > 开发管理 > 开发设置 > 服务器域名/);
	assert.match(message, /cannot configure or verify/);
	assert.match(message, /urlCheck/);
	assert.doesNotMatch(message, /wss:\/\/missing\.example\.com:\d+/);
}));

Promise.all(tests).catch((error) => {
	console.error(error);
	process.exit(1);
});
