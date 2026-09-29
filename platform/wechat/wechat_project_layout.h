/**************************************************************************/
/*  wechat_project_layout.h                                               */
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

#pragma once

#include "core/string/ustring.h"
#include "core/templates/vector.h"
#include "core/variant/variant.h"

// Decisions that are visible in the generated WeChat project. The Python
// assembler in platform/wechat/tests/project_layout.py must stay in lockstep.

namespace WeChatProjectLayout {

inline constexpr int64_t MAIN_PACKAGE_LIMIT_BYTES = 4 * 1024 * 1024;
inline constexpr char MIN_BASE_LIBRARY[] = "2.19.0";
inline constexpr char PREVIEW_APPID[] = "touristappid";
inline constexpr char RUNTIME_SUBPACKAGE_NAME[] = "godot-runtime";
inline constexpr char RUNTIME_SUBPACKAGE_ROOT[] = "godot-runtime";

struct RuntimeFile {
	String name;
	int64_t size = 0;
};

struct Plan {
	bool valid = false;
	String error;
	String configured_appid;
	String project_appid;
	String device_orientation;
	bool use_runtime_subpackage = false;
	Vector<String> main_files;
	Vector<String> runtime_files;
};

inline bool _is_hex(char32_t p_char) {
	return (p_char >= '0' && p_char <= '9') || (p_char >= 'a' && p_char <= 'f') || (p_char >= 'A' && p_char <= 'F');
}

inline bool is_valid_appid(const String &p_appid) {
	if (p_appid.is_empty() || p_appid == PREVIEW_APPID) {
		return true;
	}
	if (!p_appid.begins_with("wx") || p_appid.length() != 18) {
		return false;
	}
	for (int i = 2; i < p_appid.length(); i++) {
		if (!_is_hex(p_appid[i])) {
			return false;
		}
	}
	return true;
}

inline String project_appid(const String &p_appid) {
	return p_appid.is_empty() ? String(PREVIEW_APPID) : p_appid;
}

// Godot display/window/handheld/orientation. WeChat game.json only has portrait and landscape.
inline String device_orientation_from_godot(int p_orientation) {
	switch (p_orientation) {
		case 1: // Portrait.
		case 3: // Reverse portrait.
		case 5: // Sensor portrait.
			return "portrait";
		default:
			return "landscape";
	}
}

inline String invalid_appid_message(const String &p_appid) {
	return vformat("WeChat AppID \"%s\" is not valid. Leave it empty for local preview, or enter a wx-prefixed 16-character AppID.", p_appid);
}

inline String main_package_limit_message(int64_t p_main_bytes) {
	return vformat("The WeChat main package would be %d bytes, which exceeds the 4 MB limit (%d bytes). Move engine runtime files into the godot-runtime subpackage or reduce the files kept in the main package.", p_main_bytes, MAIN_PACKAGE_LIMIT_BYTES);
}

inline Plan plan_project(const String &p_appid, int p_godot_orientation, int64_t p_shell_without_subpackage, int64_t p_shell_with_subpackage, const Vector<RuntimeFile> &p_runtime_files) {
	Plan plan;
	plan.configured_appid = p_appid;
	plan.device_orientation = device_orientation_from_godot(p_godot_orientation);
	if (!is_valid_appid(p_appid)) {
		plan.error = invalid_appid_message(p_appid);
		return plan;
	}
	plan.project_appid = project_appid(p_appid);

	int64_t runtime_bytes = 0;
	for (int i = 0; i < p_runtime_files.size(); i++) {
		runtime_bytes += p_runtime_files[i].size;
	}

	if (p_shell_without_subpackage + runtime_bytes <= MAIN_PACKAGE_LIMIT_BYTES) {
		plan.use_runtime_subpackage = false;
	} else {
		plan.use_runtime_subpackage = true;
	}

	const int64_t shell_bytes = plan.use_runtime_subpackage ? p_shell_with_subpackage : p_shell_without_subpackage;
	const int64_t main_bytes = plan.use_runtime_subpackage ? shell_bytes : shell_bytes + runtime_bytes;
	if (main_bytes > MAIN_PACKAGE_LIMIT_BYTES) {
		plan.error = main_package_limit_message(main_bytes);
		return plan;
	}

	plan.main_files.push_back("game.js");
	plan.main_files.push_back("wechat_host_model.js");
	plan.main_files.push_back("game.json");
	plan.main_files.push_back("project.config.json");
	plan.main_files.push_back("project.private.config.json");
	plan.main_files.push_back("godot.wechat.json");
	for (int i = 0; i < p_runtime_files.size(); i++) {
		const String relative = plan.use_runtime_subpackage ? String(RUNTIME_SUBPACKAGE_ROOT) + "/" + p_runtime_files[i].name : p_runtime_files[i].name;
		if (plan.use_runtime_subpackage) {
			plan.runtime_files.push_back(relative);
		} else {
			plan.main_files.push_back(relative);
		}
	}
	if (plan.use_runtime_subpackage) {
		plan.runtime_files.push_back(String(RUNTIME_SUBPACKAGE_ROOT) + "/game.js");
	}
	plan.valid = true;
	return plan;
}

} // namespace WeChatProjectLayout
