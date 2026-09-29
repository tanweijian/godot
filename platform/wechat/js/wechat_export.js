// Runs outside the Emscripten MODULARIZE factory so WeChat require() can find it.
if (typeof GameGlobal !== "undefined") {
	GameGlobal.Godot = Godot;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = Godot;
}
