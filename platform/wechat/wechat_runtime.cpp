/**************************************************************************/
/*  wechat_runtime.cpp                                                    */
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

#include "wechat_runtime.h"

#include "platform/web/godot_js.h"

#include "core/config/engine.h"
#include "core/config/project_settings.h"
#include "core/string/print_string.h"

#include <cstdlib>

WeChat *WeChat::singleton = nullptr;

static WeChat *wechat_singleton = nullptr;

extern "C" WASM_EXPORT void wechat_subpackage_callback(const char *p_name, int p_event, int p_progress, const char *p_detail) {
	const String name = p_name ? String::utf8(p_name) : String();
	const String detail = p_detail ? String::utf8(p_detail) : String();
	if (p_name) {
		free(const_cast<char *>(p_name));
	}
	if (p_detail) {
		free(const_cast<char *>(p_detail));
	}
	if (WeChat::get_singleton()) {
		WeChat::get_singleton()->handle_subpackage_event(name, p_event, p_progress, detail);
	}
}

void WeChat::_bind_methods() {
	ClassDB::bind_method(D_METHOD("load_resource_subpackage", "name"), &WeChat::load_resource_subpackage);
	ADD_SIGNAL(MethodInfo("resource_subpackage_progress", PropertyInfo(Variant::STRING, "name"), PropertyInfo(Variant::FLOAT, "progress")));
	ADD_SIGNAL(MethodInfo("resource_subpackage_loaded", PropertyInfo(Variant::STRING, "name")));
	ADD_SIGNAL(MethodInfo("resource_subpackage_failed", PropertyInfo(Variant::STRING, "name"), PropertyInfo(Variant::STRING, "message")));
}

WeChat *WeChat::get_singleton() {
	return singleton;
}

WeChat::WeChat() {
	ERR_FAIL_COND_MSG(singleton != nullptr, "WeChat singleton already exists.");
	singleton = this;
}

WeChat::~WeChat() {
	if (singleton == this) {
		singleton = nullptr;
	}
}

Error WeChat::load_resource_subpackage(const String &p_name) {
	if (p_name.is_empty()) {
		emit_signal(SNAME("resource_subpackage_failed"), p_name, String("WeChat resource subpackage name is empty."));
		return ERR_INVALID_PARAMETER;
	}
	if (mounted.has(p_name)) {
		emit_signal(SNAME("resource_subpackage_loaded"), p_name);
		return OK;
	}
	if (loading.has(p_name)) {
		return ERR_BUSY;
	}
	const CharString name_utf8 = p_name.utf8();
	const int code = godot_js_wechat_load_resource_subpackage(name_utf8.get_data(), &wechat_subpackage_callback);
	if (code != 0) {
		if (code == 1) {
			return ERR_DOES_NOT_EXIST;
		}
		if (code == 2) {
			return ERR_UNAVAILABLE;
		}
		if (code == 3) {
			return ERR_BUSY;
		}
		return FAILED;
	}
	if (!mounted.has(p_name)) {
		loading.insert(p_name);
	}
	return OK;
}

void WeChat::handle_subpackage_event(const String &p_name, int p_event, int p_progress, const String &p_detail) {
	if (p_event == 1) {
		emit_signal(SNAME("resource_subpackage_progress"), p_name, (double)p_progress);
		return;
	}
	loading.erase(p_name);
	if (p_event == 2) {
		if (mounted.has(p_name)) {
			emit_signal(SNAME("resource_subpackage_loaded"), p_name);
			return;
		}
		const bool mounted_pack = !p_detail.is_empty() && bool(ProjectSettings::get_singleton()->call(SNAME("load_resource_pack"), p_detail, false, 0));
		if (!mounted_pack) {
			const String message = vformat("WeChat resource subpackage \"%s\" loaded, but its resource pack \"%s\" could not be mounted. res:// files in that package are not available.", p_name, p_detail);
			print_line(message);
			emit_signal(SNAME("resource_subpackage_failed"), p_name, message);
			return;
		}
		mounted.insert(p_name);
		print_line(vformat("WeChat resource subpackage \"%s\" loaded and mounted.", p_name));
		emit_signal(SNAME("resource_subpackage_loaded"), p_name);
		return;
	}
	const String message = p_detail.is_empty() ? vformat("Failed to load WeChat resource subpackage \"%s\". Its resource pack was not mounted.", p_name) : p_detail;
	print_line(message);
	emit_signal(SNAME("resource_subpackage_failed"), p_name, message);
}

void register_wechat_runtime() {
	GDREGISTER_CLASS(WeChat);
	wechat_singleton = memnew(WeChat);
	Engine::get_singleton()->add_singleton(Engine::Singleton("WeChat", wechat_singleton));
}

void unregister_wechat_runtime() {
	if (wechat_singleton) {
		memdelete(wechat_singleton);
		wechat_singleton = nullptr;
	}
}
