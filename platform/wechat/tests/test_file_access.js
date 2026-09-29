"use strict";

const assert = require("node:assert/strict");
const {
	createGodotFiles,
	createPackageAccess,
	createUserDataStore,
	userDataMounts,
} = require("../js/wechat_host_model.js");

function test(name, fn) {
	try {
		fn();
		console.log("ok " + name);
	} catch (error) {
		console.error("not ok " + name);
		throw error;
	}
}

function bytes(values) {
	return Uint8Array.from(values);
}

function capture(fn) {
	const errors = [];
	const original = console.error;
	console.error = (...args) => {
		errors.push(args.map(String).join(" "));
	};
	try {
		return { result: fn(), errors };
	} finally {
		console.error = original;
	}
}

function createMemoryHostFs() {
	const nodes = new Map();
	nodes.set("", { directory: true });

	function partsOf(path) {
		return String(path).split("/").filter((part) => part.length > 0);
	}

	function parentPath(path) {
		const parts = partsOf(path);
		parts.pop();
		return parts.join("/");
	}

	function ensureParents(path) {
		const parts = partsOf(path);
		let current = "";
		for (let i = 0; i < parts.length - 1; i++) {
			current = current ? current + "/" + parts[i] : parts[i];
			if (!nodes.has(current)) {
				nodes.set(current, { directory: true });
			}
		}
	}

	const fs = {
		failWrites: false,
		mkdirSync(path, recursive) {
			const key = partsOf(path).join("/");
			if (nodes.has(key) && nodes.get(key).directory) {
				const error = new Error("mkdirSync:fail file already exists " + path);
				error.errMsg = error.message;
				throw error;
			}
			if (recursive) {
				ensureParents(path + "/child");
			} else if (parentPath(key) && !nodes.has(parentPath(key))) {
				const error = new Error("mkdirSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
			nodes.set(key, { directory: true });
		},
		readdirSync(path) {
			const key = partsOf(path).join("/");
			if (!nodes.has(key) || !nodes.get(key).directory) {
				const error = new Error("readdirSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
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
		statSync(path) {
			const key = partsOf(path).join("/");
			const node = nodes.get(key);
			if (!node) {
				const error = new Error("statSync:fail no such file or directory " + path);
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
				size: node.directory ? 0 : node.data.length,
			};
		},
		readFileSync(path) {
			const key = partsOf(path).join("/");
			const node = nodes.get(key);
			if (!node || node.directory) {
				const error = new Error("readFileSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
			return node.data.buffer.slice(node.data.byteOffset, node.data.byteOffset + node.data.byteLength);
		},
		writeFileSync(path, data) {
			if (fs.failWrites) {
				const error = new Error("writeFileSync:fail the maximum size of the file storage limit is exceeded");
				error.errMsg = error.message;
				throw error;
			}
			const key = partsOf(path).join("/");
			if (parentPath(key) && !nodes.has(parentPath(key))) {
				const error = new Error("writeFileSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
			const copy = bytes(new Uint8Array(data));
			nodes.set(key, { directory: false, data: copy });
		},
		unlinkSync(path) {
			const key = partsOf(path).join("/");
			const node = nodes.get(key);
			if (!node || node.directory) {
				const error = new Error("unlinkSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
			nodes.delete(key);
		},
		rmdirSync(path) {
			const key = partsOf(path).join("/");
			const node = nodes.get(key);
			if (!node || !node.directory) {
				const error = new Error("rmdirSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
			const prefix = key ? key + "/" : "";
			for (const candidate of nodes.keys()) {
				if (candidate.startsWith(prefix) && candidate !== key) {
					const error = new Error("rmdirSync:fail directory not empty " + path);
					error.errMsg = error.message;
					throw error;
				}
			}
			nodes.delete(key);
		},
		renameSync(from, to) {
			const fromKey = partsOf(from).join("/");
			const toKey = partsOf(to).join("/");
			if (!nodes.has(fromKey)) {
				const error = new Error("renameSync:fail no such file or directory " + from);
				error.errMsg = error.message;
				throw error;
			}
			const moving = [];
			for (const [candidate, node] of nodes) {
				if (candidate === fromKey || candidate.startsWith(fromKey + "/")) {
					moving.push([candidate, node]);
				}
			}
			for (const [candidate] of moving) {
				nodes.delete(candidate);
			}
			for (const [candidate, node] of moving) {
				const relocated = toKey + candidate.slice(fromKey.length);
				nodes.set(relocated, node);
			}
		},
		accessSync(path) {
			const key = partsOf(path).join("/");
			if (!nodes.has(key)) {
				const error = new Error("accessSync:fail no such file or directory " + path);
				error.errMsg = error.message;
				throw error;
			}
		},
	};
	return fs;
}

function fakeWx(hostFs) {
	return {
		env: { USER_DATA_PATH: "wxfile://usr" },
		getFileSystemManager() {
			return hostFs;
		},
	};
}

function createStubEngineFs() {
	function memfsMount(mount) {
		const root = {
			path: mount.mountpoint,
			contents: {},
			mount,
		};
		const nodeOps = {
			mknod(parent, name, mode) {
				const node = {
					name,
					parent,
					mode,
					contents: new Uint8Array(0),
					usedBytes: 0,
					path: parent.path + "/" + name,
				};
				node.stream_ops = {
					write(stream, buffer, offset, length, position) {
						const next = new Uint8Array(Math.max(stream.node.usedBytes, position + length));
						next.set(stream.node.contents.subarray(0, stream.node.usedBytes));
						next.set(buffer.subarray(offset, offset + length), position);
						stream.node.contents = next;
						stream.node.usedBytes = Math.max(stream.node.usedBytes, position + length);
						return length;
					},
					close() {},
				};
				parent.contents[name] = node;
				node.node_ops = nodeOps;
				return node;
			},
			mkdir(parent, name) {
				const node = {
					name,
					parent,
					contents: {},
					path: parent.path + "/" + name,
					node_ops: nodeOps,
				};
				parent.contents[name] = node;
				return node;
			},
			unlink(parent, name) {
				delete parent.contents[name];
			},
			rmdir(parent, name) {
				delete parent.contents[name];
			},
			rename(oldNode, newDir, newName) {
				delete oldNode.parent.contents[oldNode.name];
				oldNode.name = newName;
				oldNode.parent = newDir;
				oldNode.path = newDir.path + "/" + newName;
				newDir.contents[newName] = oldNode;
			},
			setattr(node, attr) {
				if (typeof attr.size !== "number") {
					return;
				}
				const next = new Uint8Array(attr.size);
				next.set(node.contents.subarray(0, Math.min(attr.size, node.usedBytes)));
				node.contents = next;
				node.usedBytes = attr.size;
			},
		};
		root.node_ops = nodeOps;
		return root;
	}

	return {
		written: new Map(),
		mounted: null,
		mkdirTree() {},
		mount(filesystem, opts, point) {
			this.mounted = filesystem.mount({ mountpoint: point, opts });
		},
		writeFile(path, data) {
			this.written.set(path, bytes(data));
		},
		filesystems: { MEMFS: { mount: memfsMount } },
		getPath(node) {
			return node.path || "";
		},
		isDir(mode) {
			return (mode & 61440) === 16384;
		},
		ErrnoError: class ErrnoError extends Error {
			constructor(errno) {
				super("errno " + errno);
				this.errno = errno;
			}
		},
	};
}

test("user data mounts at the godot user directory", () => {
	assert.deepEqual(userDataMounts(), ["/userfs"]);
	assert.equal(createGodotFiles(null).isAvailable(), false);
	assert.equal(createGodotFiles({}).isAvailable(), false);
});

test("a save written to user data is readable after restart", () => {
	const host = createMemoryHostFs();
	const first = createUserDataStore(host, "wxfile://usr");
	const save = bytes([4, 5, 6, 7, 8]);
	assert.deepEqual(first.write("Game/save.dat", save), { ok: true });

	const restarted = createUserDataStore(host, "wxfile://usr");
	const loaded = restarted.read("Game/save.dat");
	assert.equal(loaded.ok, true);
	assert.deepEqual(Array.from(loaded.data), [4, 5, 6, 7, 8]);
});

test("ordinary user directory operations survive restart", () => {
	const host = createMemoryHostFs();
	const first = createUserDataStore(host, "wxfile://usr");
	assert.equal(first.makeDir("saves/slot").ok, true);
	assert.equal(first.write("saves/slot/a.dat", bytes([1, 255, 10])).ok, true);
	assert.equal(first.rename("saves/slot/a.dat", "saves/slot/b.dat").ok, true);
	const listed = first.list("saves/slot");
	assert.equal(listed.ok, true);
	assert.deepEqual(listed.entries, [{ name: "b.dat", directory: false }]);

	const restarted = createUserDataStore(host, "wxfile://usr");
	assert.deepEqual(Array.from(restarted.read("saves/slot/b.dat").data), [1, 255, 10]);
	assert.equal(restarted.read("saves/slot/a.dat").error, "ERR_FILE_NOT_FOUND");
	assert.equal(restarted.remove("saves/slot/b.dat").ok, true);
	assert.equal(restarted.removeDir("saves/slot").ok, true);
	const root = restarted.list("");
	assert.equal(root.ok, true);
	assert.deepEqual(root.entries, [{ name: "saves", directory: true }]);
});

test("missing user files and storage failures are reported and logged", () => {
	const host = createMemoryHostFs();
	const store = createUserDataStore(host, "wxfile://usr");
	assert.equal(store.write("Game/save.dat", bytes([1, 2, 3, 4])).ok, true);

	const missing = capture(() => store.read("Game/missing.dat"));
	assert.equal(missing.result.ok, false);
	assert.equal(missing.result.error, "ERR_FILE_NOT_FOUND");
	assert.equal(missing.errors.length, 1);
	assert.match(missing.errors[0], /Game\/missing\.dat/);
	assert.match(missing.errors[0], /ERR_FILE_NOT_FOUND/);

	host.failWrites = true;
	const denied = capture(() => store.write("Game/save.dat", bytes([9, 9, 9, 9])));
	assert.equal(denied.result.ok, false);
	assert.equal(denied.result.error, "ERR_FILE_CANT_WRITE");
	assert.match(denied.errors[0], /storage limit/);
	assert.match(denied.errors[0], /ERR_FILE_CANT_WRITE/);
	host.failWrites = false;
	assert.deepEqual(Array.from(store.read("Game/save.dat").data), [1, 2, 3, 4]);
});

test("packaged resources stay readable and reject modification", () => {
	const host = createMemoryHostFs();
	host.writeFileSync("/game.bin", bytes([10, 20, 30, 40]));
	const packaged = createPackageAccess(host);
	const read = packaged.read("/game.bin");
	assert.equal(read.ok, true);
	assert.deepEqual(Array.from(read.data), [10, 20, 30, 40]);

	const write = capture(() => packaged.write("/game.bin", bytes([1])));
	const removed = capture(() => packaged.remove("/game.bin"));
	assert.equal(write.result.error, "ERR_FILE_NO_PERMISSION");
	assert.equal(removed.result.error, "ERR_FILE_NO_PERMISSION");
	assert.match(write.errors[0], /read-only/);
	assert.deepEqual(Array.from(packaged.read("/game.bin").data), [10, 20, 30, 40]);

	const missing = capture(() => packaged.read("/missing.bin"));
	assert.equal(missing.result.error, "ERR_FILE_NOT_FOUND");
	assert.match(missing.errors[0], /missing\.bin/);
});

test("engine startup reloads the persisted user save", () => {
	const host = createMemoryHostFs();
	createUserDataStore(host, "wxfile://usr").write("Game/save.dat", bytes([4, 5, 6, 7]));
	const fs = createStubEngineFs();
	const files = createGodotFiles(fakeWx(host));
	assert.equal(files.isAvailable(), true);
	assert.equal(files.init(fs, {}, userDataMounts()), null);
	assert.deepEqual(Array.from(fs.written.get("/userfs/Game/save.dat")), [4, 5, 6, 7]);
});

test("an engine write through userfs persists across restart", () => {
	const host = createMemoryHostFs();
	const fs = createStubEngineFs();
	const files = createGodotFiles(fakeWx(host));
	assert.equal(files.init(fs, {}, ["/userfs"]), null);
	const game = fs.mounted.node_ops.mkdir(fs.mounted, "Game");
	const save = fs.mounted.node_ops.mknod(game, "save.dat", 33188, 0);
	const payload = bytes([9, 8, 7, 6]);
	save.stream_ops.write({ node: save, path: "/userfs/Game/save.dat" }, payload, 0, payload.length, 0);

	const restarted = createStubEngineFs();
	assert.equal(createGodotFiles(fakeWx(host)).init(restarted, {}, ["/userfs"]), null);
	assert.deepEqual(Array.from(restarted.written.get("/userfs/Game/save.dat")), [9, 8, 7, 6]);
});

test("a failed engine write leaves the previous user save in place", () => {
	const host = createMemoryHostFs();
	const fs = createStubEngineFs();
	const files = createGodotFiles(fakeWx(host));
	files.init(fs, {}, ["/userfs"]);
	const game = fs.mounted.node_ops.mkdir(fs.mounted, "Game");
	const save = fs.mounted.node_ops.mknod(game, "save.dat", 33188, 0);
	const original = bytes([1, 2, 3, 4]);
	save.stream_ops.write({ node: save, path: "/userfs/Game/save.dat" }, original, 0, original.length, 0);

	host.failWrites = true;
	const logged = capture(() => {
		const replacement = bytes([9, 9, 9, 9]);
		assert.throws(() => {
			save.stream_ops.write({ node: save, path: "/userfs/Game/save.dat" }, replacement, 0, replacement.length, 0);
		}, /errno 51/);
	});
	assert.match(logged.errors.join("\n"), /ERR_FILE_CANT_WRITE/);
	assert.deepEqual(Array.from(save.contents.subarray(0, save.usedBytes)), [1, 2, 3, 4]);

	host.failWrites = false;
	const restarted = createUserDataStore(host, "wxfile://usr");
	assert.deepEqual(Array.from(restarted.read("Game/save.dat").data), [1, 2, 3, 4]);
});
