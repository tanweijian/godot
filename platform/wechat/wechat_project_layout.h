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

inline constexpr int64_t TOTAL_PACKAGE_LIMIT_20_BYTES = 20 * 1024 * 1024;
inline constexpr int64_t TOTAL_PACKAGE_LIMIT_30_BYTES = 30 * 1024 * 1024;
inline constexpr char RESOURCE_SUBPACKAGE_ENTRY[] = "console.log(\"[Godot] resource subpackage loaded\");\n";
inline constexpr char RESOURCE_SUBPACKAGE_DIR[] = "groups";

struct Plan {
	bool valid = false;
	String error;
	String configured_appid;
	String project_appid;
	String device_orientation;
	bool use_runtime_subpackage = false;
	int64_t main_package_bytes = 0;
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
	plan.main_package_bytes = main_bytes;
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

struct ResourceFile {
	String path;
	int64_t size = 0;
};

struct MeasuredPack {
	String name;
	int64_t bytes = 0;
};

struct ResourceGroupPlan {
	String name;
	String subpackage;
	String root;
	String pack;
	Vector<String> resources;
	Vector<String> patterns;
	int64_t pack_bytes = 0;
};

struct ResourceAssignment {
	bool valid = false;
	String error;
	Vector<ResourceGroupPlan> groups;
	Vector<String> main_resources;
};

struct SubpackageEntry {
	String name;
	String root;
};

struct PackagePlan {
	bool valid = false;
	String error;
	Plan project;
	Vector<ResourceGroupPlan> groups;
	Vector<String> main_resources;
	int64_t main_package_bytes = 0;
	int64_t total_package_bytes = 0;
	int64_t total_budget_bytes = 0;
};

inline int64_t resource_subpackage_entry_bytes() {
	return String(RESOURCE_SUBPACKAGE_ENTRY).utf8().length();
}

inline int64_t total_budget_limit(bool p_budget_30mb) {
	return p_budget_30mb ? TOTAL_PACKAGE_LIMIT_30_BYTES : TOTAL_PACKAGE_LIMIT_20_BYTES;
}

inline String total_package_limit_message(int64_t p_total, int64_t p_limit, bool p_budget_30mb) {
	if (p_budget_30mb) {
		return vformat("The WeChat project would be %d bytes, which exceeds the selected total package budget of %d bytes (30 MB). Reduce the main package, engine runtime, or resource subpackages.", p_total, p_limit);
	}
	return vformat("The WeChat project would be %d bytes, which exceeds the selected total package budget of %d bytes (20 MB). Reduce packaged files, or select the 30 MB budget only if this project is eligible.", p_total, p_limit);
}

inline bool is_valid_group_name(const String &p_name) {
	if (p_name.is_empty()) {
		return false;
	}
	for (int i = 0; i < p_name.length(); i++) {
		const char32_t c = p_name[i];
		const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
		if (!ok) {
			return false;
		}
	}
	return true;
}

inline bool path_matches_pattern(const String &p_path, const String &p_pattern) {
	const String path = p_path.replace("\\", "/");
	const String pattern = p_pattern.replace("\\", "/");
	return path.matchn(pattern) || path.trim_prefix("res://").matchn(pattern);
}

inline bool must_stay_in_main_package(const String &p_path, const String &p_main_scene) {
	if (p_path == "res://project.godot" || p_path == "res://project.binary") {
		return true;
	}
	if (p_path.begins_with("res://.godot/")) {
		return true;
	}
	return !p_main_scene.is_empty() && p_path == p_main_scene;
}

inline String invalid_group_name_message(const String &p_name) {
	return vformat("WeChat resource group name \"%s\" is not valid. Use letters, digits, underscore, or hyphen.", p_name);
}

inline String reserved_group_name_message(const String &p_name) {
	return vformat("WeChat resource group \"%s\" is reserved for the engine runtime subpackage.", p_name);
}

inline String duplicate_group_message(const String &p_name) {
	return vformat("WeChat resource group \"%s\" is assigned more than once.", p_name);
}

inline String missing_group_pattern_message(const String &p_line) {
	return vformat("WeChat resource group line \"%s\" is missing a resource pattern. Use \"levels:res://levels/*\".", p_line.strip_edges());
}

inline Vector<String> _split_patterns(const String &p_patterns) {
	Vector<String> patterns;
	const Vector<String> parts = p_patterns.split(",");
	for (int i = 0; i < parts.size(); i++) {
		const String pattern = parts[i].strip_edges().replace("\\", "/");
		if (!pattern.is_empty()) {
			patterns.push_back(pattern);
		}
	}
	return patterns;
}

// Syntax only. File matching happens in assign_resource_groups.
inline String validate_resource_group_text(const String &p_text) {
	Vector<String> names;
	const Vector<String> lines = p_text.replace("\r\n", "\n").replace("\r", "\n").split("\n");
	for (int i = 0; i < lines.size(); i++) {
		const String line = lines[i].strip_edges();
		if (line.is_empty() || line.begins_with("#")) {
			continue;
		}
		const int colon = line.find(":");
		if (colon <= 0) {
			return missing_group_pattern_message(line);
		}
		const String name = line.substr(0, colon).strip_edges();
		if (name == RUNTIME_SUBPACKAGE_NAME) {
			return reserved_group_name_message(name);
		}
		if (!is_valid_group_name(name)) {
			return invalid_group_name_message(name);
		}
		for (int j = 0; j < names.size(); j++) {
			if (names[j] == name) {
				return duplicate_group_message(name);
			}
		}
		names.push_back(name);
		if (_split_patterns(line.substr(colon + 1)).is_empty()) {
			return missing_group_pattern_message(line);
		}
	}
	return String();
}

inline bool _group_matches(const ResourceGroupPlan &p_group, const String &p_path) {
	for (int i = 0; i < p_group.patterns.size(); i++) {
		if (path_matches_pattern(p_path, p_group.patterns[i])) {
			return true;
		}
	}
	return false;
}

inline int64_t _measured_pack_bytes(const Vector<MeasuredPack> &p_measured, const String &p_name, int64_t p_fallback) {
	for (int i = 0; i < p_measured.size(); i++) {
		if (p_measured[i].name == p_name) {
			return p_measured[i].bytes;
		}
	}
	return p_fallback;
}

inline ResourceAssignment assign_resource_groups(const String &p_text, const Vector<ResourceFile> &p_files, const String &p_main_scene) {
	ResourceAssignment assignment;
	const String syntax_error = validate_resource_group_text(p_text);
	if (!syntax_error.is_empty()) {
		assignment.error = syntax_error;
		return assignment;
	}

	const Vector<String> lines = p_text.replace("\r\n", "\n").replace("\r", "\n").split("\n");
	for (int i = 0; i < lines.size(); i++) {
		const String line = lines[i].strip_edges();
		if (line.is_empty() || line.begins_with("#")) {
			continue;
		}
		const int colon = line.find(":");
		ResourceGroupPlan group;
		group.name = line.substr(0, colon).strip_edges();
		group.subpackage = group.name;
		group.root = String(RESOURCE_SUBPACKAGE_DIR) + "/" + group.name + "/";
		group.pack = String(RESOURCE_SUBPACKAGE_DIR) + "/" + group.name + "/pack.bin";
		group.patterns = _split_patterns(line.substr(colon + 1));
		assignment.groups.push_back(group);
	}

	for (int file_index = 0; file_index < p_files.size(); file_index++) {
		const String path = p_files[file_index].path.replace("\\", "/");
		int matched = -1;
		for (int group_index = 0; group_index < assignment.groups.size(); group_index++) {
			if (!_group_matches(assignment.groups[group_index], path)) {
				continue;
			}
			if (matched != -1) {
				assignment.error = vformat("Resource \"%s\" is assigned to both WeChat resource groups \"%s\" and \"%s\". Each project resource can belong to only one package group.", path, assignment.groups[matched].name, assignment.groups[group_index].name);
				assignment.groups.clear();
				assignment.main_resources.clear();
				return assignment;
			}
			matched = group_index;
		}
		if (matched == -1) {
			assignment.main_resources.push_back(path);
			continue;
		}
		if (must_stay_in_main_package(path, p_main_scene)) {
			assignment.error = vformat("Resource \"%s\" must stay in the WeChat main package. Remove it from resource group \"%s\".", path, assignment.groups[matched].name);
			assignment.groups.clear();
			assignment.main_resources.clear();
			return assignment;
		}
		assignment.groups.write[matched].resources.push_back(path);
		assignment.groups.write[matched].pack_bytes += p_files[file_index].size;
	}

	for (int i = 0; i < assignment.groups.size(); i++) {
		if (assignment.groups[i].resources.is_empty()) {
			assignment.error = vformat("WeChat resource group \"%s\" does not match any exported project resource. Check the pattern \"%s\".", assignment.groups[i].name, assignment.groups[i].patterns[0]);
			assignment.groups.clear();
			assignment.main_resources.clear();
			return assignment;
		}
	}
	if (!assignment.groups.is_empty() && assignment.main_resources.is_empty()) {
		assignment.error = "The WeChat main package would contain no project resources. Keep the main scene, project.binary, and startup files out of resource groups.";
		assignment.groups.clear();
		return assignment;
	}
	assignment.valid = true;
	return assignment;
}

// Every relative path this export will write. A previous output file that is not in this list is still uploaded by WeChat.
inline Vector<String> planned_output_files(const Plan &p_plan, const Vector<ResourceGroupPlan> &p_groups) {
	Vector<String> planned;
	for (int i = 0; i < p_plan.main_files.size(); i++) {
		planned.push_back(p_plan.main_files[i].replace("\\", "/"));
	}
	for (int i = 0; i < p_plan.runtime_files.size(); i++) {
		planned.push_back(p_plan.runtime_files[i].replace("\\", "/"));
	}
	for (int i = 0; i < p_groups.size(); i++) {
		planned.push_back(p_groups[i].pack.replace("\\", "/"));
		const String root = p_groups[i].root.replace("\\", "/");
		planned.push_back(root.ends_with("/") ? root + "game.js" : root + "/game.js");
	}
	return planned;
}

// Dropped groups and other previous export files are not in the size plan. If they remain, WeChat counts them in the main package.
inline Vector<String> stale_uploaded_files(const Vector<String> &p_existing, const Vector<String> &p_planned) {
	Vector<String> stale;
	for (int i = 0; i < p_existing.size(); i++) {
		const String existing = p_existing[i].replace("\\", "/");
		bool kept = false;
		for (int j = 0; j < p_planned.size(); j++) {
			if (existing == p_planned[j].replace("\\", "/")) {
				kept = true;
				break;
			}
		}
		if (!kept) {
			stale.push_back(existing);
		}
	}
	return stale;
}

inline Array resource_group_manifest(const Vector<ResourceGroupPlan> &p_groups) {
	Array manifest;
	for (int i = 0; i < p_groups.size(); i++) {
		Dictionary entry;
		entry["name"] = p_groups[i].name;
		entry["subpackage"] = p_groups[i].subpackage;
		entry["root"] = p_groups[i].root;
		entry["pack"] = p_groups[i].pack;
		Array resources;
		for (int j = 0; j < p_groups[i].resources.size(); j++) {
			resources.push_back(p_groups[i].resources[j]);
		}
		entry["resources"] = resources;
		manifest.push_back(entry);
	}
	return manifest;
}

inline Vector<SubpackageEntry> subpackage_entries(bool p_runtime_subpackage, const Vector<ResourceGroupPlan> &p_groups) {
	Vector<SubpackageEntry> entries;
	if (p_runtime_subpackage) {
		SubpackageEntry runtime;
		runtime.name = RUNTIME_SUBPACKAGE_NAME;
		runtime.root = String(RUNTIME_SUBPACKAGE_ROOT) + "/";
		entries.push_back(runtime);
	}
	for (int i = 0; i < p_groups.size(); i++) {
		SubpackageEntry entry;
		entry.name = p_groups[i].subpackage;
		entry.root = p_groups[i].root;
		entries.push_back(entry);
	}
	return entries;
}

inline PackagePlan plan_resource_packages(const String &p_appid, int p_godot_orientation, int64_t p_shell_without_subpackage, int64_t p_shell_with_subpackage, const Vector<RuntimeFile> &p_runtime_files, const String &p_groups, const Vector<ResourceFile> &p_resources, const String &p_main_scene, bool p_budget_30mb, const Vector<MeasuredPack> &p_measured) {
	PackagePlan package;
	package.total_budget_bytes = total_budget_limit(p_budget_30mb);
	const ResourceAssignment assignment = assign_resource_groups(p_groups, p_resources, p_main_scene);
	if (!assignment.valid) {
		package.error = assignment.error;
		return package;
	}
	package.groups = assignment.groups;
	package.main_resources = assignment.main_resources;
	for (int i = 0; i < package.groups.size(); i++) {
		package.groups.write[i].pack_bytes = _measured_pack_bytes(p_measured, package.groups[i].name, package.groups[i].pack_bytes);
	}

	package.project = plan_project(p_appid, p_godot_orientation, p_shell_without_subpackage, p_shell_with_subpackage, p_runtime_files);
	if (!package.project.valid) {
		package.error = package.project.error;
		package.main_package_bytes = package.project.main_package_bytes;
		return package;
	}

	int64_t runtime_bytes = 0;
	for (int i = 0; i < p_runtime_files.size(); i++) {
		runtime_bytes += p_runtime_files[i].size;
	}
	int64_t group_bytes = 0;
	for (int i = 0; i < package.groups.size(); i++) {
		group_bytes += package.groups[i].pack_bytes + resource_subpackage_entry_bytes();
	}
	const int64_t runtime_extra = package.project.use_runtime_subpackage ? runtime_bytes : 0;
	package.main_package_bytes = package.project.main_package_bytes;
	package.total_package_bytes = package.main_package_bytes + runtime_extra + group_bytes;
	if (package.total_package_bytes > package.total_budget_bytes) {
		package.error = total_package_limit_message(package.total_package_bytes, package.total_budget_bytes, p_budget_30mb);
		return package;
	}
	package.valid = true;
	return package;
}

} // namespace WeChatProjectLayout
