"use strict";

// Loads the built WeChat template and checks that an engine write to /userfs
// is still readable after a second initFS. Skips when the template is absent.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createGodotFiles, createUserDataStore, userDataMounts } = require("../js/wechat_host_model.js");

const ROOT = path.resolve(__dirname, "../../..");
const JS = path.join(ROOT, "bin/godot.wechat.template_release.wasm32.nothreads.js");
const WASM = path.join(ROOT, "bin/godot.wechat.template_release.wasm32.nothreads.wasm");

function createMemoryHostFs() {
	const nodes = new Map();
	nodes.set("", { directory: true });
	const writes = [];
	const reads = [];

	function partsOf(filePath) {
		return String(filePath).split("/").filter((part) => part.length > 0);
	}

	function parentPath(filePath) {
		const parts = partsOf(filePath);
		parts.pop();
		return parts.join("/");
	}

	return {
		writes,
		reads,
		mkdirSync(filePath) {
			const key = partsOf(filePath).join("/");
			let current = "";
			for (const part of partsOf(filePath)) {
				current = current ? current + "/" + part : part;
				if (!nodes.has(current)) {
					nodes.set(current, { directory: true });
				}
			}
			nodes.set(key, nodes.get(key).directory ? nodes.get(key) : { directory: true });
		},
		readdirSync(filePath) {
			const key = partsOf(filePath).join("/");
			const prefix = key ? key + "/" : "";
			const names = [];
			for (const candidate of nodes.keys()) {
				if (!candidate.startsWith(prefix) || candidate === key) {
					continue;
				}
				const rest = candidate.slice(prefix.length);
				if (!rest.includes("/")) {
					names.push(rest);
				}
			}
			return names;
		},
		statSync(filePath) {
			const node = nodes.get(partsOf(filePath).join("/"));
			if (!node) {
				const error = new Error("statSync:fail no such file or directory " + filePath);
				error.errMsg = error.message;
				throw error;
			}
			return {
				isDirectory() {
					return !!node.directory;
				},
				isFile() {
					return !node.directory;
				},
			};
		},
		readFileSync(filePath) {
			const node = nodes.get(partsOf(filePath).join("/"));
			if (!node || node.directory) {
				const error = new Error("readFileSync:fail no such file or directory " + filePath);
				error.errMsg = error.message;
				throw error;
			}
			reads.push(filePath);
			return node.data.buffer.slice(node.data.byteOffset, node.data.byteOffset + node.data.byteLength);
		},
		writeFileSync(filePath, data) {
			const key = partsOf(filePath).join("/");
			if (parentPath(key) && !nodes.has(parentPath(key))) {
				const error = new Error("writeFileSync:fail no such file or directory " + filePath);
				error.errMsg = error.message;
				throw error;
			}
			const copy = Uint8Array.from(new Uint8Array(data));
			nodes.set(key, { directory: false, data: copy });
			writes.push({ path: filePath, data: Array.from(copy) });
		},
		unlinkSync() {},
		rmdirSync() {},
		renameSync() {},
		accessSync(filePath) {
			if (!nodes.has(partsOf(filePath).join("/"))) {
				const error = new Error("accessSync:fail no such file or directory " + filePath);
				error.errMsg = error.message;
				throw error;
			}
		},
	};
}

function browserContext() {
	const context = {
		console,
		WebAssembly,
		Uint8Array,
		Uint16Array,
		Uint32Array,
		Int8Array,
		Int16Array,
		Int32Array,
		Float32Array,
		Float64Array,
		BigInt64Array,
		BigUint64Array,
		ArrayBuffer,
		DataView,
		TextDecoder,
		TextEncoder,
		URL,
		crypto: globalThis.crypto,
		performance,
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		queueMicrotask,
		atob: (value) => Buffer.from(value, "base64").toString("binary"),
		btoa: (value) => Buffer.from(value, "binary").toString("base64"),
	};
	context.window = context;
	context.self = context;
	context.globalThis = context;
	context.GameGlobal = context;
	context.document = { currentScript: { src: "https://minigame.local/godot.js" } };
	context.navigator = { userAgent: "WeChatMiniGame", language: "zh_CN", languages: ["zh_CN"] };
	vm.createContext(context);
	return context;
}

async function boot(context, wasm) {
	const factory = context.Godot;
	const module = await factory({
		noInitialRun: true,
		noExitRuntime: true,
		thisProgram: "/godot",
		wasmBinary: wasm,
		print: () => {},
		printErr: (text) => {
			throw new Error(String(text));
		},
		locateFile: (file) => file,
	});
	if (typeof module.initFS !== "function" || typeof module.copyToFS !== "function") {
		throw new Error("built template did not export initFS/copyToFS");
	}
	const failure = await module.initFS(userDataMounts());
	if (failure) {
		throw new Error(failure.message || String(failure));
	}
	return module;
}

async function main() {
	if (!fs.existsSync(JS) || !fs.existsSync(WASM)) {
		console.log("skip built template is not present");
		return;
	}
	const host = createMemoryHostFs();
	const wx = {
		env: { USER_DATA_PATH: "wxfile://usr" },
		getFileSystemManager() {
			return host;
		},
	};
	const context = browserContext();
	context.wx = wx;
	context.GodotWeChatFiles = createGodotFiles(wx);
	vm.runInContext(fs.readFileSync(JS, "utf8"), context, { filename: JS });
	const wasm = fs.readFileSync(WASM);
	const first = await boot(context, wasm);
	const save = Uint8Array.from([4, 5, 6, 7, 8]);
	first.copyToFS("/userfs/Game/save.dat", save);

	const persisted = host.writes.filter((entry) => entry.path.endsWith("/Game/save.dat"));
	assert.ok(persisted.length > 0, "engine write did not reach the WeChat user-data directory");
	assert.deepEqual(persisted[persisted.length - 1].data, [4, 5, 6, 7, 8]);

	const restartedContext = browserContext();
	restartedContext.wx = wx;
	restartedContext.GodotWeChatFiles = createGodotFiles(wx);
	vm.runInContext(fs.readFileSync(JS, "utf8"), restartedContext, { filename: JS });
	await boot(restartedContext, wasm);
	const reread = createUserDataStore(host, "wxfile://usr").read("Game/save.dat");
	assert.equal(reread.ok, true);
	assert.deepEqual(Array.from(reread.data), [4, 5, 6, 7, 8]);
	assert.ok(host.reads.some((entry) => entry.endsWith("/Game/save.dat")), "restart did not read the saved file back from WeChat storage");
	console.log("ok built engine persists /userfs/Game/save.dat across initFS");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
