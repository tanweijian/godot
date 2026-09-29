"use strict";

const assert = require("node:assert/strict");
const {
	diagnoseRendererMessage,
	probeCompatibility3D,
	readPerformanceSample,
	samplePerformance,
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

const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;

function fakeGL(options) {
	const settings = options || {};
	const shaders = new Map();
	let next = 1;
	return {
		COMPILE_STATUS: COMPILE_STATUS,
		LINK_STATUS: LINK_STATUS,
		VERTEX_SHADER: 0x8b31,
		FRAGMENT_SHADER: 0x8b30,
		getContextAttributes: () => settings.attributes || null,
		getExtension: (name) => (settings.extensions && settings.extensions[name] ? { name: name } : null),
		createShader: (type) => {
			const id = next++;
			shaders.set(id, { type: type, ok: settings.compileOk !== false });
			return id;
		},
		shaderSource: () => {},
		compileShader: () => {
			if (settings.compileThrows) {
				throw new Error(settings.compileThrows);
			}
		},
		getShaderParameter: (id, pname) => (pname === COMPILE_STATUS ? shaders.get(id).ok : 0),
		getShaderInfoLog: () => settings.infoLog || "",
		deleteShader: () => {},
		createProgram: () => 7,
		attachShader: () => {},
		linkProgram: () => {},
		getProgramParameter: (program, pname) => (pname === LINK_STATUS ? settings.compileOk !== false : 0),
		getProgramInfoLog: () => settings.infoLog || "",
		deleteProgram: () => {},
		drawArraysInstanced: settings.instanced === false ? undefined : function () {},
	};
}

test("a WebGL 2 context without a depth buffer cannot render a Compatibility mesh", () => {
	const report = probeCompatibility3D(fakeGL({ attributes: { depth: false, stencil: false }, extensions: { EXT_color_buffer_float: true } }), {});
	assert.equal(report.ok, false);
	assert.equal(report.title, "Depth buffer unavailable");
	assert.match(report.message, /depth buffer/);
	assert.match(report.message, /2\.24\.0/);
	assert.match(report.message, /high-performance/);
});

test("a missing WebGL 2 context is reported before the engine starts", () => {
	const report = probeCompatibility3D(null, {});
	assert.equal(report.ok, false);
	assert.match(report.message, /webgl2/);
	assert.match(report.message, /2\.24\.0/);
});

test("a shader compiler failure includes the driver log and does not start a blank project", () => {
	const report = probeCompatibility3D(fakeGL({
		attributes: { depth: true, stencil: true },
		compileOk: false,
		infoLog: "ERROR: 0:1: 'layout' : syntax error",
	}), {});
	assert.equal(report.ok, false);
	assert.equal(report.title, "Shader compiler unavailable");
	assert.match(report.message, /syntax error/);
	assert.match(report.message, /2\.24\.0/);
	assert.match(report.message, /high-performance/);
});

test("a working depth buffer and shader compiler still reports missing optional features", () => {
	const report = probeCompatibility3D(fakeGL({
		attributes: { depth: true, stencil: false },
		extensions: {},
		instanced: false,
	}), { platform: "ios", system: "iOS 16.1" });
	assert.equal(report.ok, true);
	assert.equal(report.degradations.length, 4);
	assert.match(report.degradations[0].message, /Stencil/);
	assert.match(report.degradations[0].message, /skipped/);
	assert.match(report.degradations[1].message, /EXT_color_buffer_float/);
	assert.match(report.degradations[1].message, /standard-material/);
	assert.match(report.degradations[2].message, /instancing/);
	assert.match(report.degradations[3].message, /high-performance/);
});

test("engine shader failures become an actionable WeChat diagnostic", () => {
	const diagnosis = diagnoseRendererMessage("scene.glsl: Fragment shader compilation failed:\nERROR: 0:3: '' : compilation terminated");
	assert.equal(diagnosis.fatal, true);
	assert.equal(diagnosis.title, "Shader failed");
	assert.match(diagnosis.message, /Fragment shader compilation failed/);
	assert.match(diagnosis.message, /gl_compatibility/);
});

test("unsupported Compatibility features degrade instead of failing the project", () => {
	const msaa = diagnoseRendererMessage("MSAA is not supported on this device.");
	assert.equal(msaa.fatal, false);
	assert.match(msaa.message, /without multisampling/);

	const particles = diagnoseRendererMessage("Due to driver bugs, GPUParticles are not supported on Adreno 3XX devices. Please use CPUParticles instead.");
	assert.equal(particles.fatal, false);
	assert.match(particles.message, /CPUParticles/);

	const shadows = diagnoseRendererMessage("Dual paraboloid shadow mode not supported in the Compatibility renderer. Please use CubeMap shadow mode instead.");
	assert.equal(shadows.fatal, false);
	assert.match(shadows.message, /CubeMap/);
});

test("ordinary engine logs are not turned into renderer failures", () => {
	assert.equal(diagnoseRendererMessage("[Godot] engine main started"), null);
	assert.equal(diagnoseRendererMessage(""), null);
});

test("a blank Compatibility frame is a fatal diagnostic, not a silent success", () => {
	const diagnosis = diagnoseRendererMessage("[Godot] compatibility 3d did not draw the lit mesh");
	assert.equal(diagnosis.fatal, true);
	assert.match(diagnosis.message, /high-performance/);
});

test("frame rate and memory are recorded without a universal FPS guarantee", () => {
	const sample = samplePerformance({ frameCount: 120, elapsedMs: 2000, memoryBytes: 80 * 1024 * 1024, memoryLabel: "usedJSHeapSize" });
	assert.equal(sample.fps, 60);
	assert.equal(sample.memoryBytes, 83886080);
	assert.equal(sample.memoryLabel, "usedJSHeapSize");
	assert.equal(sample.guaranteed, false);
	assert.match(sample.note, /does not promise/);
});

test("a device without counters still records an unavailable baseline", () => {
	const sample = readPerformanceSample({}, {}, 0, 0, 0);
	assert.equal(sample.fps, null);
	assert.equal(sample.memoryBytes, null);
	assert.equal(sample.guaranteed, false);
	assert.match(sample.note, /does not promise/);
});

test("WeChat performance memory is recorded when the host exposes it", () => {
	const wx = {
		getPerformance: () => ({ memory: { usedJSHeapSize: 4096 } }),
	};
	const sample = readPerformanceSample(wx, {}, 1000, 30, 2000);
	assert.equal(sample.fps, 30);
	assert.equal(sample.memoryBytes, 4096);
	assert.equal(sample.memoryLabel, "wx.getPerformance");
	assert.equal(sample.guaranteed, false);
});
