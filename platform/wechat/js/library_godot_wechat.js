/**************************************************************************/
/*  library_godot_wechat.js                                               */
/**************************************************************************/
/*                         This file is part of:                          */
/*                             GODOT ENGINE                               */
/*                        https://godotengine.org                         */
/**************************************************************************/
/* Copyright (c) 2014-present Godot Engine contributors (see AUTHORS.md). */
/* Copyright (c) 2007-2014 Juan Linietsky, Ariel Manzur.                  */
/*                                                                        */
/* Permission is hereby granted, free of charge, to any person obtaining  */
/* a copy of this software and associated documentation files (the        */
/* "Software"), to deal in the Software without restriction, including    */
/* without limitation the rights to use, copy, modify, merge, publish,    */
/* distribute, sublicense, and/or sell copies of the Software, and to     */
/* permit persons to whom the Software is furnished to do so, subject to  */
/* the following conditions:                                              */
/*                                                                        */
/* The above copyright notice and this permission notice shall be         */
/* included in all copies or substantial portions of the Software.        */
/*                                                                        */
/* THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,        */
/* EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF     */
/* MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. */
/* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY   */
/* CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,   */
/* TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE      */
/* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.                 */
/**************************************************************************/

const GodotWeChat = {
	$GodotWeChat__deps: ['$GodotRuntime'],
	$GodotWeChat: {
		host: function () {
			const root = typeof GameGlobal !== 'undefined' ? GameGlobal : window;
			return root.GodotWeChatHost || null;
		},
	},

	godot_js_display_safe_area_get__deps: ['$GodotWeChat', '$GodotRuntime'],
	godot_js_display_safe_area_get__proxy: 'sync',
	godot_js_display_safe_area_get__sig: 'vi',
	godot_js_display_safe_area_get: function (p_rect) {
		const host = GodotWeChat.host();
		const area = host ? host.currentSafeArea() : { x: 0, y: 0, width: 0, height: 0 };
		GodotRuntime.setHeapValue(p_rect, area.x | 0, 'i32');
		GodotRuntime.setHeapValue(p_rect + 4, area.y | 0, 'i32');
		GodotRuntime.setHeapValue(p_rect + 8, area.width | 0, 'i32');
		GodotRuntime.setHeapValue(p_rect + 12, area.height | 0, 'i32');
	},

	godot_js_wechat_lifecycle_cb__deps: ['$GodotWeChat', '$GodotRuntime', '$GodotAudio'],
	godot_js_wechat_lifecycle_cb__proxy: 'sync',
	godot_js_wechat_lifecycle_cb__sig: 'vi',
	godot_js_wechat_lifecycle_cb: function (p_callback) {
		const func = GodotRuntime.get_func(p_callback);
		const host = GodotWeChat.host();
		if (!host) {
			return;
		}
		host.setLifecycleHandler(function (foreground) {
			func(foreground ? 1 : 0);
		});
		if (typeof host.setAudioContextReplacedHandler === 'function') {
			host.setAudioContextReplacedHandler(function (context) {
				if (typeof GodotAudio.retargetContext === 'function') {
					GodotAudio.retargetContext(context);
				}
			});
		}
	},

	godot_js_wechat_load_resource_subpackage__deps: ['$GodotWeChat', '$GodotRuntime', '$FS'],
	godot_js_wechat_load_resource_subpackage__proxy: 'sync',
	godot_js_wechat_load_resource_subpackage__sig: 'iii',
	godot_js_wechat_load_resource_subpackage: function (p_name, p_callback) {
		const name = GodotRuntime.parseString(p_name);
		const callback = GodotRuntime.get_func(p_callback);
		const host = GodotWeChat.host();
		function emit(event, progress, detail) {
			const namePtr = GodotRuntime.allocString(name);
			const detailPtr = detail ? GodotRuntime.allocString(String(detail)) : 0;
			callback(namePtr, event, progress | 0, detailPtr);
		}
		if (!host || typeof host.loadResourceSubpackage !== 'function') {
			emit(0, 0, 'WeChat resource subpackage loading is unavailable. The resource pack was not mounted.');
			return 2;
		}
		return host.loadResourceSubpackage(name, {
			progress: function (percent) {
				emit(1, percent, '');
			},
			success: function (bytes) {
				try {
					const dir = '/wechat-packs';
					const path = dir + '/' + name + '.bin';
					if (!FS.analyzePath(dir).exists) {
						FS.mkdir(dir);
					}
					FS.writeFile(path, bytes);
					emit(2, 100, path);
				} catch (error) {
					emit(0, 0, 'WeChat resource subpackage "' + name + '" loaded, but its resource pack could not be written for mounting: ' + error);
				}
			},
			failure: function (message) {
				emit(0, 0, message);
			},
		});
	},
};

autoAddDeps(GodotWeChat, '$GodotWeChat');
mergeInto(LibraryManager.library, GodotWeChat);
