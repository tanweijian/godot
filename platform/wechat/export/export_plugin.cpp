/**************************************************************************/
/*  export_plugin.cpp                                                     */
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

#include "export_plugin.h"

#include "logo_svg.gen.h"

#include "platform/wechat/wechat_project_layout.h"

#include "core/io/dir_access.h"
#include "core/io/file_access.h"
#include "core/io/json.h"
#include "core/io/pck_packer.h"
#include "core/io/resource_uid.h"
#include "core/io/zip_io.h"
#include "core/string/print_string.h"
#include "core/templates/hash_map.h"
#include "core/templates/hash_set.h"
#include "editor/editor_node.h"
#include "editor/editor_string_names.h"
#include "editor/export/editor_export.h"
#include "editor/file_system/editor_paths.h"
#include "editor/settings/editor_settings.h"
#include "editor/themes/editor_scale.h"
#include "scene/resources/image_texture.h"

#include "modules/modules_enabled.gen.h"
#include "modules/svg/image_loader_svg.h"

namespace {

String _js_literal(const String &p_value) {
	return JSON::stringify(p_value);
}

String _substitute(String p_text, const HashMap<String, String> &p_replaces) {
	for (const KeyValue<String, String> &kv : p_replaces) {
		p_text = p_text.replace(kv.key, kv.value);
	}
	return p_text;
}

void _collect_relative_files(const String &p_root, const String &p_relative, Vector<String> &r_files) {
	const String current = p_relative.is_empty() ? p_root : p_root.path_join(p_relative);
	Ref<DirAccess> dir = DirAccess::open(current);
	if (dir.is_null()) {
		return;
	}
	dir->list_dir_begin();
	String name = dir->get_next();
	Vector<String> subdirs;
	while (!name.is_empty()) {
		if (name != "." && name != "..") {
			const String relative = p_relative.is_empty() ? name : p_relative.path_join(name);
			if (dir->current_is_dir()) {
				subdirs.push_back(relative.replace("\\", "/"));
			} else {
				r_files.push_back(relative.replace("\\", "/"));
			}
		}
		name = dir->get_next();
	}
	dir->list_dir_end();
	for (int i = 0; i < subdirs.size(); i++) {
		_collect_relative_files(p_root, subdirs[i], r_files);
	}
}

Error _write_text(const String &p_path, const String &p_text) {
	Ref<FileAccess> file = FileAccess::open(p_path, FileAccess::WRITE);
	if (file.is_null()) {
		return ERR_FILE_CANT_WRITE;
	}
	file->store_string(p_text);
	return OK;
}

int64_t _file_size(const String &p_path) {
	Ref<FileAccess> file = FileAccess::open(p_path, FileAccess::READ);
	if (file.is_null()) {
		return -1;
	}
	return file->get_length();
}

String _read_text(const String &p_path) {
	Ref<FileAccess> file = FileAccess::open(p_path, FileAccess::READ);
	if (file.is_null()) {
		return String();
	}
	return file->get_as_text();
}

Dictionary _network_timeout() {
	Dictionary timeout;
	timeout["request"] = 60000;
	timeout["connectSocket"] = 60000;
	timeout["uploadFile"] = 60000;
	timeout["downloadFile"] = 60000;
	return timeout;
}

String _game_json(const String &p_orientation, const Vector<WeChatProjectLayout::SubpackageEntry> &p_subpackages) {
	Dictionary game;
	game["deviceOrientation"] = p_orientation;
	game["showStatusBar"] = false;
	game["networkTimeout"] = _network_timeout();
	if (!p_subpackages.is_empty()) {
		Array subpackages;
		for (int i = 0; i < p_subpackages.size(); i++) {
			Dictionary entry;
			entry["name"] = p_subpackages[i].name;
			entry["root"] = p_subpackages[i].root;
			subpackages.push_back(entry);
		}
		game["subpackages"] = subpackages;
	}
	return JSON::stringify(game, "\t", false, true);
}

String _project_config(const String &p_appid, const String &p_project_name, bool p_subpackage) {
	Array include;
	Dictionary wasm_suffix;
	wasm_suffix["type"] = "suffix";
	wasm_suffix["value"] = ".wasm";
	include.push_back(wasm_suffix);
	Dictionary br_suffix;
	br_suffix["type"] = "suffix";
	br_suffix["value"] = ".br";
	include.push_back(br_suffix);
	Dictionary pck_suffix;
	pck_suffix["type"] = "suffix";
	pck_suffix["value"] = ".bin";
	include.push_back(pck_suffix);
	Dictionary js_file;
	js_file["type"] = "file";
	js_file["value"] = p_subpackage ? String(WeChatProjectLayout::RUNTIME_SUBPACKAGE_ROOT) + "/godot.js" : "godot.js";
	include.push_back(js_file);

	Dictionary pack_options;
	pack_options["ignore"] = Array();
	pack_options["include"] = include;

	Array babel_ignore;
	babel_ignore.push_back("godot.js");
	babel_ignore.push_back(String(WeChatProjectLayout::RUNTIME_SUBPACKAGE_ROOT) + "/godot.js");
	Dictionary babel;
	babel["ignore"] = babel_ignore;
	babel["disablePlugins"] = Array();
	babel["outputPath"] = "";

	Dictionary setting;
	setting["urlCheck"] = false;
	setting["es6"] = false;
	setting["enhance"] = false;
	setting["postcss"] = false;
	setting["minified"] = false;
	setting["newFeature"] = true;
	setting["coverView"] = true;
	setting["nodeModules"] = false;
	setting["autoAudits"] = false;
	setting["checkInvalidKey"] = true;
	setting["uploadWithSourceMap"] = false;
	setting["compileHotReLoad"] = false;
	setting["useMultiFrameRuntime"] = true;
	setting["useApiHook"] = true;
	setting["useApiHostProcess"] = false;
	setting["babelSetting"] = babel;
	setting["useIsolateContext"] = false;
	setting["ignoreDevUnusedFiles"] = false;
	setting["ignoreUploadUnusedFiles"] = false;

	Dictionary config;
	config["description"] = "Godot WeChat Mini Game";
	config["packOptions"] = pack_options;
	config["setting"] = setting;
	config["compileType"] = "minigame";
	config["libVersion"] = "latest";
	config["appid"] = p_appid;
	config["projectname"] = p_project_name;
	config["condition"] = Dictionary();
	return JSON::stringify(config, "\t", false, true);
}

String _private_config() {
	Dictionary setting;
	setting["urlCheck"] = false;
	setting["ignoreDevUnusedFiles"] = false;
	Dictionary config;
	config["libVersion"] = "latest";
	config["setting"] = setting;
	return JSON::stringify(config, "\t", false, true);
}

String _manifest_json(const WeChatProjectLayout::Plan &p_plan, const String &p_project_name, int p_orientation, const String &p_revision, const String &p_emscripten, const Vector<WeChatProjectLayout::ResourceGroupPlan> &p_groups, int64_t p_budget_bytes, const WeChatProjectLayout::NetworkDomains &p_network) {
	Dictionary manifest;
	manifest["format"] = 1;
	manifest["projectName"] = p_project_name;
	manifest["configuredAppId"] = p_plan.configured_appid;
	manifest["appId"] = p_plan.project_appid;
	manifest["deviceOrientation"] = p_plan.device_orientation;
	manifest["godotOrientation"] = p_orientation;
	manifest["minBaseLibrary"] = WeChatProjectLayout::MIN_BASE_LIBRARY;
	manifest["mainPackageLimitBytes"] = WeChatProjectLayout::MAIN_PACKAGE_LIMIT_BYTES;
	manifest["totalPackageBudgetBytes"] = p_budget_bytes;
	manifest["resourceGroups"] = WeChatProjectLayout::resource_group_manifest(p_groups);
	manifest["runtimeSubpackage"] = p_plan.use_runtime_subpackage ? String(WeChatProjectLayout::RUNTIME_SUBPACKAGE_NAME) : String();
	Array request_domains;
	for (int i = 0; i < p_network.request_domains.size(); i++) {
		request_domains.push_back(p_network.request_domains[i]);
	}
	Array socket_domains;
	for (int i = 0; i < p_network.socket_domains.size(); i++) {
		socket_domains.push_back(p_network.socket_domains[i]);
	}
	manifest["requestDomains"] = request_domains;
	manifest["socketDomains"] = socket_domains;
	manifest["networkAllowlistReminder"] = p_network.reminder;
	manifest["renderer"] = "gl_compatibility";
	manifest["threads"] = false;
	manifest["simd"] = false;
	manifest["godotRevision"] = p_revision;
	manifest["emscriptenVersion"] = p_emscripten;
	Array main_files;
	for (int i = 0; i < p_plan.main_files.size(); i++) {
		main_files.push_back(p_plan.main_files[i]);
	}
	Array runtime_files;
	for (int i = 0; i < p_plan.runtime_files.size(); i++) {
		runtime_files.push_back(p_plan.runtime_files[i]);
	}
	manifest["mainFiles"] = main_files;
	manifest["runtimeFiles"] = runtime_files;
	return JSON::stringify(manifest, "\t", false, true);
}

struct ShellTexts {
	String game_js;
	String game_json;
	String project_config;
	String private_config;
	String manifest;
	int64_t bytes = 0;
};

struct CapturedProject {
	String root;
	HashMap<String, String> staged;
	Vector<WeChatProjectLayout::ResourceFile> resources;
};

Vector<String> _split_filter(const String &p_filter) {
	Vector<String> filters;
	const Vector<String> parts = p_filter.split(",");
	for (int i = 0; i < parts.size(); i++) {
		const String filter = parts[i].strip_edges();
		if (!filter.is_empty()) {
			filters.push_back(filter);
		}
	}
	return filters;
}

bool _encrypt_path(const String &p_path, const Vector<String> &p_in, const Vector<String> &p_ex) {
	bool encrypt = false;
	for (int i = 0; i < p_in.size(); i++) {
		if (p_path.matchn(p_in[i]) || p_path.trim_prefix("res://").matchn(p_in[i])) {
			encrypt = true;
			break;
		}
	}
	for (int i = 0; i < p_ex.size(); i++) {
		if (p_path.matchn(p_ex[i]) || p_path.trim_prefix("res://").matchn(p_ex[i])) {
			encrypt = false;
			break;
		}
	}
	return encrypt;
}

Error _capture_project_file(void *p_userdata, const String &p_path, const Vector<uint8_t> &p_data, int, int, const Vector<String> &, const Vector<String> &, const Vector<uint8_t> &, uint64_t) {
	CapturedProject *captured = static_cast<CapturedProject *>(p_userdata);
	String res_path = p_path.simplify_path();
	if (res_path.begins_with("uid://")) {
		res_path = ResourceUID::uid_to_path(res_path).simplify_path();
	}
	const String relative = res_path.trim_prefix("res://");
	const String dest = captured->root.path_join(relative);
	Ref<DirAccess> dir = DirAccess::create(DirAccess::ACCESS_FILESYSTEM);
	if (dir->make_dir_recursive(dest.get_base_dir()) != OK) {
		return ERR_CANT_CREATE;
	}
	Ref<FileAccess> out = FileAccess::open(dest, FileAccess::WRITE);
	if (out.is_null()) {
		return ERR_FILE_CANT_WRITE;
	}
	out->store_buffer(p_data.ptr(), p_data.size());
	captured->staged[res_path] = dest;
	WeChatProjectLayout::ResourceFile file;
	file.path = res_path;
	file.size = p_data.size();
	captured->resources.push_back(file);
	return OK;
}

Error _write_resource_pack(const String &p_path, const CapturedProject &p_captured, const HashSet<String> &p_include, bool p_encrypt, bool p_enc_dir, const String &p_key, const Vector<String> &p_in, const Vector<String> &p_ex) {
	Ref<DirAccess> dir = DirAccess::create(DirAccess::ACCESS_FILESYSTEM);
	if (dir->make_dir_recursive(p_path.get_base_dir()) != OK) {
		return ERR_CANT_CREATE;
	}
	Ref<PCKPacker> packer;
	packer.instantiate();
	const String key = p_key.is_empty() ? String("0000000000000000000000000000000000000000000000000000000000000000") : p_key;
	Error err = packer->pck_start(p_path, 32, key, p_encrypt && p_enc_dir);
	if (err != OK) {
		return err;
	}
	int added = 0;
	for (const KeyValue<String, String> &file : p_captured.staged) {
		if (!p_include.has(file.key)) {
			continue;
		}
		err = packer->add_file(file.key, file.value, p_encrypt && _encrypt_path(file.key, p_in, p_ex));
		if (err != OK) {
			return err;
		}
		added++;
	}
	if (added == 0) {
		return ERR_FILE_NOT_FOUND;
	}
	return packer->flush(false);
}

ShellTexts _build_shell(const String &p_template, const WeChatProjectLayout::Plan &p_plan, const String &p_project_name, int p_orientation, const String &p_revision, const String &p_emscripten, const String &p_wasm_name, const Vector<WeChatProjectLayout::ResourceGroupPlan> &p_groups, int64_t p_budget_bytes, const WeChatProjectLayout::NetworkDomains &p_network) {
	const String root = p_plan.use_runtime_subpackage ? String(WeChatProjectLayout::RUNTIME_SUBPACKAGE_ROOT) + "/" : String();
	HashMap<String, String> replaces;
	replaces["___GODOT_MIN_BASE_LIBRARY___"] = _js_literal(WeChatProjectLayout::MIN_BASE_LIBRARY);
	replaces["___GODOT_RUNTIME_SUBPACKAGE___"] = _js_literal(p_plan.use_runtime_subpackage ? String(WeChatProjectLayout::RUNTIME_SUBPACKAGE_NAME) : String());
	replaces["___GODOT_WASM_PATH___"] = _js_literal(root + p_wasm_name);
	replaces["___GODOT_JS_PATH___"] = _js_literal(root + "godot.js");
	// .pck is not in the WeChat code-package whitelist; readFile returns permission denied.
	replaces["___GODOT_PCK_PATH___"] = _js_literal(root + "game.bin");
	replaces["___GODOT_REVISION___"] = _js_literal(p_revision);
	replaces["___GODOT_EMSCRIPTEN_VERSION___"] = _js_literal(p_emscripten);
	replaces["___GODOT_PROJECT_NAME___"] = _js_literal(p_project_name);
	replaces["___GODOT_RESOURCE_GROUPS___"] = JSON::stringify(WeChatProjectLayout::resource_group_manifest(p_groups));
	Array request_domains;
	for (int i = 0; i < p_network.request_domains.size(); i++) {
		request_domains.push_back(p_network.request_domains[i]);
	}
	Array socket_domains;
	for (int i = 0; i < p_network.socket_domains.size(); i++) {
		socket_domains.push_back(p_network.socket_domains[i]);
	}
	replaces["___GODOT_REQUEST_DOMAINS___"] = JSON::stringify(request_domains);
	replaces["___GODOT_SOCKET_DOMAINS___"] = JSON::stringify(socket_domains);

	ShellTexts shell;
	shell.game_js = _substitute(p_template, replaces);
	shell.game_json = _game_json(p_plan.device_orientation, WeChatProjectLayout::subpackage_entries(p_plan.use_runtime_subpackage, p_groups));
	shell.project_config = _project_config(p_plan.project_appid, p_project_name, p_plan.use_runtime_subpackage);
	shell.private_config = _private_config();
	shell.manifest = _manifest_json(p_plan, p_project_name, p_orientation, p_revision, p_emscripten, p_groups, p_budget_bytes, p_network);
	shell.bytes = shell.game_js.utf8().length() + shell.game_json.utf8().length() + shell.project_config.utf8().length() + shell.private_config.utf8().length() + shell.manifest.utf8().length();
	if (p_plan.use_runtime_subpackage) {
		shell.bytes += String("console.log(\"[Godot] engine runtime subpackage loaded\");\n").utf8().length();
	}
	return shell;
}

} // namespace

String EditorExportPlatformWeChat::_template_name(bool p_debug) const {
	return p_debug ? "wechat_debug.zip" : "wechat_release.zip";
}

String EditorExportPlatformWeChat::_find_template(const Ref<EditorExportPreset> &p_preset, bool p_debug, String &r_error) const {
	String custom = p_preset.is_valid() ? String(p_preset->get(p_debug ? "custom_template/debug" : "custom_template/release")).strip_edges() : String();
	if (!custom.is_empty()) {
		if (FileAccess::exists(custom)) {
			return custom;
		}
		r_error += vformat(TTR("Custom WeChat template not found: \"%s\"."), custom) + "\n";
		return String();
	}

	String error;
	for (int pass = 0; pass < 2; pass++) {
		const bool debug_variant = pass == 0 ? p_debug : !p_debug;
		String official = find_export_template(_template_name(debug_variant), &error);
		if (!official.is_empty()) {
			return official;
		}
		const String suffix = debug_variant ? "template_debug" : "template_release";
		const String bin_dir = OS::get_singleton()->get_executable_path().get_base_dir();
		Vector<String> candidates;
		candidates.push_back(bin_dir.path_join("godot.wechat." + suffix + ".wasm32.nothreads.zip"));
		candidates.push_back(bin_dir.path_join("godot.wechat." + suffix + ".wasm32.zip"));
		candidates.push_back(bin_dir.path_join("godot.wechat." + suffix + ".double.wasm32.nothreads.zip"));
		candidates.push_back(bin_dir.path_join("godot.wechat." + suffix + ".double.wasm32.zip"));
		for (int i = 0; i < candidates.size(); i++) {
			if (FileAccess::exists(candidates[i])) {
				return candidates[i];
			}
		}
	}
	r_error += error;
	return String();
}

String EditorExportPlatformWeChat::_project_dir_from_path(const String &p_path) const {
	const String file_name = p_path.get_file();
	if (file_name == "project.config.json" || file_name == "game.json") {
		return p_path.get_base_dir();
	}
	return p_path.get_basename();
}

String EditorExportPlatformWeChat::_configured_appid(const Ref<EditorExportPreset> &p_preset) const {
	return String(p_preset->get("wechat/appid")).strip_edges();
}

String EditorExportPlatformWeChat::_find_devtools_cli() const {
	String configured = EDITOR_GET("export/wechat/devtools_cli");
	configured = configured.strip_edges();
	if (!configured.is_empty() && FileAccess::exists(configured)) {
		return configured;
	}
	String from_env = OS::get_singleton()->get_environment("WECHAT_DEVTOOLS_CLI").strip_edges();
	if (!from_env.is_empty() && FileAccess::exists(from_env)) {
		return from_env;
	}
#ifdef WINDOWS_ENABLED
	Vector<String> defaults;
	defaults.push_back("C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat");
	defaults.push_back("C:/Program Files/Tencent/微信web开发者工具/cli.bat");
	for (int i = 0; i < defaults.size(); i++) {
		if (FileAccess::exists(defaults[i])) {
			return defaults[i];
		}
	}
#endif
	return String();
}

void EditorExportPlatformWeChat::get_preset_features(const Ref<EditorExportPreset> &p_preset, List<String> *r_features) const {
	r_features->push_back("wechat");
	r_features->push_back("wasm32");
	r_features->push_back("nothreads");
	r_features->push_back("web");
}

void EditorExportPlatformWeChat::get_export_options(List<ExportOption> *r_options) const {
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "custom_template/debug", PROPERTY_HINT_GLOBAL_FILE, "*.zip"), ""));
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "custom_template/release", PROPERTY_HINT_GLOBAL_FILE, "*.zip"), ""));
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "wechat/appid"), ""));
	r_options->push_back(ExportOption(PropertyInfo(Variant::INT, "wechat/total_package_budget", PROPERTY_HINT_ENUM, "20 MB (default),30 MB (eligible projects)"), 0));
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "wechat/resource_groups", PROPERTY_HINT_MULTILINE_TEXT), ""));
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "wechat/request_domains", PROPERTY_HINT_MULTILINE_TEXT), ""));
	r_options->push_back(ExportOption(PropertyInfo(Variant::STRING, "wechat/socket_domains", PROPERTY_HINT_MULTILINE_TEXT), ""));
}

bool EditorExportPlatformWeChat::get_export_option_visibility(const EditorExportPreset *p_preset, const String &p_option) const {
	if (p_option == "custom_template/debug" || p_option == "custom_template/release") {
		return p_preset->are_advanced_options_enabled();
	}
	return true;
}

String EditorExportPlatformWeChat::get_name() const {
	return "WeChat Mini Game";
}

String EditorExportPlatformWeChat::get_os_name() const {
	return "WeChat";
}

Ref<Texture2D> EditorExportPlatformWeChat::get_logo() const {
	return logo;
}

bool EditorExportPlatformWeChat::has_valid_export_configuration(const Ref<EditorExportPreset> &p_preset, String &r_error, bool &r_missing_templates, bool p_debug) const {
#ifdef MODULE_MONO_ENABLED
	r_error += TTR("Exporting to WeChat Mini Game is not supported in the C#/.NET editor build.") + "\n";
	return false;
#else
	String error;
	String debug_template = _find_template(p_preset, true, error);
	String release_template = _find_template(p_preset, false, error);
	const bool valid = p_debug ? !debug_template.is_empty() : !release_template.is_empty();
	r_missing_templates = debug_template.is_empty() && release_template.is_empty();
	if (!valid && !error.is_empty()) {
		r_error = error;
	}
	return valid || !r_missing_templates;
#endif
}

bool EditorExportPlatformWeChat::has_valid_project_configuration(const Ref<EditorExportPreset> &p_preset, String &r_error) const {
	const String appid = _configured_appid(p_preset);
	if (!WeChatProjectLayout::is_valid_appid(appid)) {
		r_error = WeChatProjectLayout::invalid_appid_message(appid);
		return false;
	}
	const String renderer = String(get_project_setting(p_preset, "rendering/renderer/rendering_method"));
	if (renderer != "gl_compatibility") {
		r_error = TTR("WeChat Mini Game requires the Compatibility renderer and WebGL 2. Set rendering/renderer/rendering_method to gl_compatibility, or set rendering/renderer/rendering_method.web to gl_compatibility.");
		return false;
	}
	const String group_error = WeChatProjectLayout::validate_resource_group_text(String(p_preset->get("wechat/resource_groups")));
	if (!group_error.is_empty()) {
		r_error = group_error;
		return false;
	}
	const WeChatProjectLayout::NetworkDomains network = WeChatProjectLayout::plan_network_domains(String(p_preset->get("wechat/request_domains")), String(p_preset->get("wechat/socket_domains")));
	if (!network.valid) {
		r_error = network.error;
		return false;
	}
	return true;
}

List<String> EditorExportPlatformWeChat::get_binary_extensions(const Ref<EditorExportPreset> &p_preset) const {
	List<String> list;
	list.push_back("json");
	return list;
}

Error EditorExportPlatformWeChat::export_project(const Ref<EditorExportPreset> &p_preset, bool p_debug, const String &p_path, BitField<EditorExportPlatform::DebugFlags> p_flags) {
	ExportNotifier notifier(*this, p_preset, p_debug, p_path, p_flags);

	String config_error;
	if (!has_valid_project_configuration(p_preset, config_error)) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), config_error);
		return ERR_INVALID_PARAMETER;
	}

	String template_error;
	const String template_path = _find_template(p_preset, p_debug, template_error);
	if (template_path.is_empty()) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Prepare Templates"), template_error.is_empty() ? TTR("WeChat export template not found. Build platform=wechat or install wechat_debug.zip/wechat_release.zip.") : template_error);
		return ERR_FILE_NOT_FOUND;
	}

	const String project_dir = _project_dir_from_path(p_path);
	Ref<DirAccess> dir = DirAccess::create(DirAccess::ACCESS_FILESYSTEM);
	if (dir->make_dir_recursive(project_dir) != OK) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not create WeChat project directory: \"%s\"."), project_dir));
		return ERR_CANT_CREATE;
	}

	const String staging = EditorPaths::get_singleton()->get_temp_dir().path_join("wechat-export");
	if (dir->dir_exists(staging)) {
		Ref<DirAccess> staging_dir = DirAccess::open(staging);
		if (staging_dir.is_valid()) {
			staging_dir->erase_contents_recursive();
		}
	}
	if (dir->make_dir_recursive(staging) != OK) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not create staging directory: \"%s\"."), staging));
		return ERR_CANT_CREATE;
	}

	Ref<FileAccess> io_fa;
	zlib_filefunc_def io = zipio_create_io(&io_fa);
	unzFile pkg = unzOpen2(template_path.utf8().get_data(), &io);
	if (!pkg) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Prepare Templates"), vformat(TTR("Could not open template for export: \"%s\"."), template_path));
		return ERR_FILE_NOT_FOUND;
	}
	if (unzGoToFirstFile(pkg) != UNZ_OK) {
		unzClose(pkg);
		add_message(EXPORT_MESSAGE_ERROR, TTR("Prepare Templates"), vformat(TTR("Invalid export template: \"%s\"."), template_path));
		return ERR_FILE_CORRUPT;
	}
	do {
		unz_file_info info;
		char fname[16384];
		unzGetCurrentFileInfo(pkg, &info, fname, 16384, nullptr, 0, nullptr, 0);
		String file = String::utf8(fname);
		if (file.ends_with("/")) {
			continue;
		}
		Vector<uint8_t> data;
		data.resize(info.uncompressed_size);
		unzOpenCurrentFile(pkg);
		unzReadCurrentFile(pkg, data.ptrw(), data.size());
		unzCloseCurrentFile(pkg);
		const String dest = staging.path_join(file.get_file());
		Ref<FileAccess> out = FileAccess::open(dest, FileAccess::WRITE);
		if (out.is_null()) {
			unzClose(pkg);
			add_message(EXPORT_MESSAGE_ERROR, TTR("Prepare Templates"), vformat(TTR("Could not write file: \"%s\"."), dest));
			return ERR_FILE_CANT_WRITE;
		}
		out->store_buffer(data.ptr(), data.size());
	} while (unzGoToNextFile(pkg) == UNZ_OK);
	unzClose(pkg);

	const String shell_template = _read_text(staging.path_join("game.js"));
	const String host_model = _read_text(staging.path_join("wechat_host_model.js"));
	const String wasm_name = FileAccess::exists(staging.path_join("godot.wasm.br")) ? String("godot.wasm.br") : String("godot.wasm");
	if (shell_template.is_empty() || host_model.is_empty() || !FileAccess::exists(staging.path_join(wasm_name)) || !FileAccess::exists(staging.path_join("godot.js"))) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Prepare Templates"), TTR("WeChat template must contain game.js, wechat_host_model.js, godot.js, and godot.wasm or godot.wasm.br."));
		return ERR_FILE_CORRUPT;
	}

	const String group_text = String(p_preset->get("wechat/resource_groups"));
	const bool budget_30 = int(p_preset->get("wechat/total_package_budget")) == 1;
	const int64_t budget_bytes = WeChatProjectLayout::total_budget_limit(budget_30);
	const String main_scene = String(get_project_setting(p_preset, "application/run/main_scene"));
	const String pck_path = staging.path_join("game.bin");
	Vector<WeChatProjectLayout::ResourceGroupPlan> resource_groups;
	Vector<WeChatProjectLayout::ResourceFile> resource_files;
	Vector<WeChatProjectLayout::MeasuredPack> measured_packs;
	if (!group_text.strip_edges().is_empty()) {
		CapturedProject captured;
		captured.root = staging.path_join("loose");
		const Error capture_error = export_project_files(p_preset, p_debug, _capture_project_file, nullptr, &captured);
		if (capture_error != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), TTR("Could not read project resources for WeChat package groups."));
			return capture_error;
		}
		const WeChatProjectLayout::ResourceAssignment assignment = WeChatProjectLayout::assign_resource_groups(group_text, captured.resources, main_scene);
		if (!assignment.valid) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), assignment.error);
			return ERR_INVALID_PARAMETER;
		}
		resource_groups = assignment.groups;
		resource_files = captured.resources;
		const bool encrypt = p_preset->get_enc_pck();
		const String key = encrypt ? p_preset->get_script_encryption_key() : String();
		const Vector<String> enc_in = _split_filter(p_preset->get_enc_in_filter());
		const Vector<String> enc_ex = _split_filter(p_preset->get_enc_ex_filter());
		HashSet<String> main_files;
		for (int i = 0; i < assignment.main_resources.size(); i++) {
			main_files.insert(assignment.main_resources[i]);
		}
		Error pack_error = _write_resource_pack(pck_path, captured, main_files, encrypt, p_preset->get_enc_directory(), key, enc_in, enc_ex);
		if (pack_error != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write file: \"%s\"."), pck_path));
			return pack_error;
		}
		for (int i = 0; i < resource_groups.size(); i++) {
			HashSet<String> group_files;
			for (int j = 0; j < resource_groups[i].resources.size(); j++) {
				group_files.insert(resource_groups[i].resources[j]);
			}
			const String group_pack = staging.path_join(resource_groups[i].pack);
			pack_error = _write_resource_pack(group_pack, captured, group_files, encrypt, p_preset->get_enc_directory(), key, enc_in, enc_ex);
			if (pack_error != OK) {
				add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write file: \"%s\"."), group_pack));
				return pack_error;
			}
			WeChatProjectLayout::MeasuredPack measured;
			measured.name = resource_groups[i].name;
			measured.bytes = _file_size(group_pack);
			if (measured.bytes < 0) {
				add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not read runtime file: \"%s\"."), group_pack));
				return ERR_FILE_CANT_READ;
			}
			measured_packs.push_back(measured);
		}
	} else {
		Error pack_error = save_pack(p_preset, p_debug, pck_path);
		if (pack_error != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write file: \"%s\"."), pck_path));
			return pack_error;
		}
	}

	Vector<String> runtime_names;
	runtime_names.push_back("godot.js");
	runtime_names.push_back(wasm_name);
	runtime_names.push_back("game.bin");
	if (FileAccess::exists(staging.path_join("godot.audio.worklet.js"))) {
		runtime_names.push_back("godot.audio.worklet.js");
	}
	if (FileAccess::exists(staging.path_join("godot.audio.position.worklet.js"))) {
		runtime_names.push_back("godot.audio.position.worklet.js");
	}

	Vector<WeChatProjectLayout::RuntimeFile> runtime_files;
	for (int i = 0; i < runtime_names.size(); i++) {
		WeChatProjectLayout::RuntimeFile file;
		file.name = runtime_names[i];
		file.size = _file_size(staging.path_join(runtime_names[i]));
		if (file.size < 0) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not read runtime file: \"%s\"."), runtime_names[i]));
			return ERR_FILE_CANT_READ;
		}
		runtime_files.push_back(file);
	}

	String revision;
	String emscripten_version;
	const String build_info_text = _read_text(staging.path_join("wechat-build.json"));
	if (!build_info_text.is_empty()) {
		Ref<JSON> json;
		json.instantiate();
		if (json->parse(build_info_text) == OK && json->get_data().get_type() == Variant::DICTIONARY) {
			Dictionary info = json->get_data();
			revision = info.get("godotRevision", "");
			emscripten_version = info.get("emscriptenVersion", "");
		}
	}

	const String project_name = String(get_project_setting(p_preset, "application/config/name")).strip_edges();
	const String safe_name = project_name.is_empty() ? String("Godot") : project_name;
	const int orientation = int(get_project_setting(p_preset, "display/window/handheld/orientation"));
	const String appid = _configured_appid(p_preset);

	WeChatProjectLayout::Plan without_sub = WeChatProjectLayout::plan_project(appid, orientation, 0, 0, runtime_files);
	without_sub.use_runtime_subpackage = false;
	WeChatProjectLayout::Plan with_sub = without_sub;
	with_sub.use_runtime_subpackage = true;
	const WeChatProjectLayout::NetworkDomains network = WeChatProjectLayout::plan_network_domains(String(p_preset->get("wechat/request_domains")), String(p_preset->get("wechat/socket_domains")));
	if (!network.valid) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), network.error);
		return ERR_INVALID_PARAMETER;
	}
	ShellTexts shell_without = _build_shell(shell_template, without_sub, safe_name, orientation, revision, emscripten_version, wasm_name, resource_groups, budget_bytes, network);
	ShellTexts shell_with = _build_shell(shell_template, with_sub, safe_name, orientation, revision, emscripten_version, wasm_name, resource_groups, budget_bytes, network);
	const int64_t host_model_bytes = host_model.utf8().length();
	shell_without.bytes += host_model_bytes;
	shell_with.bytes += host_model_bytes;
	const WeChatProjectLayout::PackagePlan packages = WeChatProjectLayout::plan_resource_packages(appid, orientation, shell_without.bytes, shell_with.bytes, runtime_files, group_text, resource_files, main_scene, budget_30, measured_packs);
	if (!packages.valid) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), packages.error);
		return ERR_INVALID_PARAMETER;
	}
	const WeChatProjectLayout::Plan plan = packages.project;
	resource_groups = packages.groups;
	const ShellTexts shell = plan.use_runtime_subpackage ? shell_with : shell_without;

	Vector<String> existing_output;
	_collect_relative_files(project_dir, String(), existing_output);
	const Vector<String> planned_output = WeChatProjectLayout::planned_output_files(plan, resource_groups);
	const Vector<String> stale_output = WeChatProjectLayout::stale_uploaded_files(existing_output, planned_output);
	if (!stale_output.is_empty()) {
		Ref<DirAccess> project = DirAccess::open(project_dir);
		if (project.is_null() || project->erase_contents_recursive() != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not remove the previous WeChat export in \"%s\". Leftover resource groups would be uploaded inside the main package and are not included in the package budget."), project_dir));
			return ERR_CANT_CREATE;
		}
	}

	if (_write_text(project_dir.path_join("game.js"), shell.game_js) != OK ||
			_write_text(project_dir.path_join("wechat_host_model.js"), host_model) != OK ||
			_write_text(project_dir.path_join("game.json"), shell.game_json) != OK ||
			_write_text(project_dir.path_join("project.config.json"), shell.project_config) != OK ||
			_write_text(project_dir.path_join("project.private.config.json"), shell.private_config) != OK ||
			_write_text(project_dir.path_join("godot.wechat.json"), shell.manifest) != OK) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write WeChat project files in \"%s\"."), project_dir));
		return ERR_FILE_CANT_WRITE;
	}

	const String runtime_dir = plan.use_runtime_subpackage ? project_dir.path_join(WeChatProjectLayout::RUNTIME_SUBPACKAGE_ROOT) : project_dir;
	if (plan.use_runtime_subpackage && dir->make_dir_recursive(runtime_dir) != OK) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not create runtime subpackage directory: \"%s\"."), runtime_dir));
		return ERR_CANT_CREATE;
	}
	if (plan.use_runtime_subpackage) {
		const String runtime_entry = String("console.log(\"[Godot] engine runtime subpackage loaded\");\n");
		if (_write_text(runtime_dir.path_join("game.js"), runtime_entry) != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), TTR("Could not write the runtime subpackage entry."));
			return ERR_FILE_CANT_WRITE;
		}
	}
	if (wasm_name == "godot.wasm.br") {
		const String stale_wasm = runtime_dir.path_join("godot.wasm");
		if (FileAccess::exists(stale_wasm)) {
			dir->remove(stale_wasm);
		}
	}
	const String stale_pck = runtime_dir.path_join("game.pck");
	if (FileAccess::exists(stale_pck)) {
		dir->remove(stale_pck);
	}
	for (int i = 0; i < runtime_names.size(); i++) {
		const String from = staging.path_join(runtime_names[i]);
		const String to = runtime_dir.path_join(runtime_names[i]);
		if (FileAccess::exists(to)) {
			dir->remove(to);
		}
		if (dir->copy(from, to) != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write file: \"%s\"."), to));
			return ERR_FILE_CANT_WRITE;
		}
	}

	for (int i = 0; i < resource_groups.size(); i++) {
		const String group_dir = project_dir.path_join(resource_groups[i].root);
		if (dir->make_dir_recursive(group_dir) != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not create runtime subpackage directory: \"%s\"."), group_dir));
			return ERR_CANT_CREATE;
		}
		if (_write_text(group_dir.path_join("game.js"), WeChatProjectLayout::RESOURCE_SUBPACKAGE_ENTRY) != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), TTR("Could not write the runtime subpackage entry."));
			return ERR_FILE_CANT_WRITE;
		}
		const String from = staging.path_join(resource_groups[i].pack);
		const String to = project_dir.path_join(resource_groups[i].pack);
		if (FileAccess::exists(to)) {
			dir->remove(to);
		}
		if (dir->copy(from, to) != OK) {
			add_message(EXPORT_MESSAGE_ERROR, TTR("Export"), vformat(TTR("Could not write file: \"%s\"."), to));
			return ERR_FILE_CANT_WRITE;
		}
	}

	print_line(vformat("WeChat Mini Game project written to %s (runtime subpackage: %s, resource groups: %d).", project_dir, plan.use_runtime_subpackage ? "yes" : "no", resource_groups.size()));
	add_message(EXPORT_MESSAGE_WARNING, TTR("Network"), network.reminder);
	print_line(network.reminder);
	return OK;
}

bool EditorExportPlatformWeChat::poll_export() {
	return EditorExport::get_singleton() != nullptr;
}

int EditorExportPlatformWeChat::get_options_count() const {
	return 1;
}

String EditorExportPlatformWeChat::get_option_label(int p_index) const {
	return TTR("Open in WeChat Developer Tools");
}

String EditorExportPlatformWeChat::get_option_tooltip(int p_index) const {
	return TTR("Export the project and open it with the WeChat Developer Tools CLI. Set export/wechat/devtools_cli if the CLI is not in the default location.");
}

Error EditorExportPlatformWeChat::run(const Ref<EditorExportPreset> &p_preset, int p_option, BitField<EditorExportPlatform::DebugFlags> p_debug_flags) {
	const String project_dir = EditorPaths::get_singleton()->get_temp_dir().path_join("wechat-run");
	const String export_path = project_dir.path_join("project.config.json");
	Error err = export_project(p_preset, true, export_path, p_debug_flags);
	if (err != OK) {
		return err;
	}
	const String cli = _find_devtools_cli();
	if (cli.is_empty()) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Run"), vformat(TTR("WeChat Developer Tools CLI was not found. Open \"%s\" manually, or set export/wechat/devtools_cli. Command: cli open --project \"%s\"."), project_dir, project_dir));
		return ERR_FILE_NOT_FOUND;
	}
	List<String> args;
#ifdef WINDOWS_ENABLED
	args.push_back("/c");
	args.push_back(cli);
	args.push_back("open");
	args.push_back("--project");
	args.push_back(project_dir);
	err = OS::get_singleton()->create_process("cmd.exe", args);
#else
	args.push_back("open");
	args.push_back("--project");
	args.push_back(project_dir);
	err = OS::get_singleton()->create_process(cli, args);
#endif
	if (err != OK) {
		add_message(EXPORT_MESSAGE_ERROR, TTR("Run"), vformat(TTR("Could not launch WeChat Developer Tools CLI \"%s\". The project is at \"%s\"."), cli, project_dir));
	}
	return err;
}

EditorExportPlatformWeChat::EditorExportPlatformWeChat() {
	if (EditorNode::get_singleton()) {
		Ref<Image> image = memnew(Image);
		const bool upsample = !Math::is_equal_approx(Math::round(EDSCALE), EDSCALE);
		ImageLoaderSVG::create_image_from_string(image, _wechat_logo_svg, EDSCALE, upsample, HashMap<Color, Color>());
		logo = ImageTexture::create_from_image(image);
	}
}

EditorExportPlatformWeChat::~EditorExportPlatformWeChat() {
}
