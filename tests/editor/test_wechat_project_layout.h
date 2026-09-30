/**************************************************************************/
/*  test_wechat_project_layout.h                                          */
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

#include "platform/wechat/wechat_project_layout.h"

#include "thirdparty/doctest/doctest.h"

namespace TestWeChatProjectLayout {

TEST_CASE("[WeChat] Empty AppID stays usable for local preview") {
	CHECK(WeChatProjectLayout::is_valid_appid(""));
	CHECK(WeChatProjectLayout::project_appid("") == "touristappid");
}

TEST_CASE("[WeChat] Explicit AppID is preserved and invalid AppIDs are rejected") {
	CHECK(WeChatProjectLayout::is_valid_appid("wx0123456789abcdef"));
	CHECK(WeChatProjectLayout::project_appid("wx0123456789abcdef") == "wx0123456789abcdef");
	CHECK_FALSE(WeChatProjectLayout::is_valid_appid("not-an-appid"));
	CHECK_FALSE(WeChatProjectLayout::is_valid_appid("wx123"));
}

TEST_CASE("[WeChat] Handheld orientation maps onto WeChat deviceOrientation") {
	CHECK(WeChatProjectLayout::device_orientation_from_godot(0) == "landscape");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(1) == "portrait");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(2) == "landscape");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(3) == "portrait");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(4) == "landscape");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(5) == "portrait");
	CHECK(WeChatProjectLayout::device_orientation_from_godot(6) == "landscape");
}

TEST_CASE("[WeChat] Engine runtime stays in the main package when it fits") {
	Vector<WeChatProjectLayout::RuntimeFile> files;
	WeChatProjectLayout::RuntimeFile wasm;
	wasm.name = "godot.wasm";
	wasm.size = 1024;
	files.push_back(wasm);

	const WeChatProjectLayout::Plan plan = WeChatProjectLayout::plan_project("", 1, 2048, 4096, files);
	CHECK(plan.valid);
	CHECK_FALSE(plan.use_runtime_subpackage);
	CHECK(plan.project_appid == "touristappid");
	CHECK(plan.device_orientation == "portrait");
	CHECK(plan.main_files.has("godot.wasm"));
	CHECK(plan.main_files.has("wechat_host_model.js"));
	CHECK(plan.runtime_files.is_empty());
}

TEST_CASE("[WeChat] Engine runtime moves to a subpackage when the main package limit requires it") {
	Vector<WeChatProjectLayout::RuntimeFile> files;
	WeChatProjectLayout::RuntimeFile wasm;
	wasm.name = "godot.wasm";
	wasm.size = 5 * 1024 * 1024;
	files.push_back(wasm);
	WeChatProjectLayout::RuntimeFile glue;
	glue.name = "godot.js";
	glue.size = 1024;
	files.push_back(glue);

	const WeChatProjectLayout::Plan plan = WeChatProjectLayout::plan_project("wx0123456789abcdef", 0, 2048, 4096, files);
	CHECK(plan.valid);
	CHECK(plan.use_runtime_subpackage);
	CHECK(plan.project_appid == "wx0123456789abcdef");
	CHECK(plan.device_orientation == "landscape");
	CHECK(plan.runtime_files.has("godot-runtime/godot.wasm"));
	CHECK(plan.runtime_files.has("godot-runtime/godot.js"));
	CHECK(plan.runtime_files.has("godot-runtime/game.js"));
	CHECK_FALSE(plan.main_files.has("godot.wasm"));
}

TEST_CASE("[WeChat] Main package limit is reported when the shell itself cannot fit") {
	Vector<WeChatProjectLayout::RuntimeFile> files;
	const WeChatProjectLayout::Plan plan = WeChatProjectLayout::plan_project("", 0, 5 * 1024 * 1024, 5 * 1024 * 1024, files);
	CHECK_FALSE(plan.valid);
	CHECK(plan.error.contains("4 MB"));
	CHECK(plan.error.contains("4194304"));
}

static WeChatProjectLayout::ResourceFile _resource(const char *p_path, int64_t p_size) {
	WeChatProjectLayout::ResourceFile file;
	file.path = p_path;
	file.size = p_size;
	return file;
}

TEST_CASE("[WeChat] Resource groups map to subpackage packs and leave other files in the main package") {
	Vector<WeChatProjectLayout::ResourceFile> files;
	files.push_back(_resource("res://levels/boss.tscn", 10));
	files.push_back(_resource("res://ui/menu.tscn", 4));
	files.push_back(_resource("res://audio/boss.ogg", 8));
	files.push_back(_resource("res://music/theme.wav", 3));
	files.push_back(_resource("res://project.binary", 20));
	files.push_back(_resource("res://main.tscn", 6));
	const String groups = "levels:res://levels/*\naudio:res://audio/*.ogg,res://music/*\n";
	const WeChatProjectLayout::PackagePlan plan = WeChatProjectLayout::plan_resource_packages("", 1, 100, 120, Vector<WeChatProjectLayout::RuntimeFile>(), groups, files, "res://main.tscn", false, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK(plan.valid);
	REQUIRE(plan.groups.size() == 2);
	CHECK(plan.groups[0].name == "levels");
	CHECK(plan.groups[0].subpackage == "levels");
	CHECK(plan.groups[0].root == "groups/levels/");
	CHECK(plan.groups[0].pack == "groups/levels/pack.bin");
	CHECK(plan.groups[0].resources.size() == 1);
	CHECK(plan.groups[0].resources[0] == "res://levels/boss.tscn");
	CHECK(plan.groups[1].pack == "groups/audio/pack.bin");
	CHECK(plan.groups[1].resources.size() == 2);
	CHECK(plan.groups[1].resources[0] == "res://audio/boss.ogg");
	CHECK(plan.groups[1].resources[1] == "res://music/theme.wav");
	CHECK(plan.main_resources.has("res://ui/menu.tscn"));
	CHECK(plan.main_resources.has("res://project.binary"));
	CHECK(plan.main_resources.has("res://main.tscn"));
	CHECK_FALSE(plan.main_resources.has("res://levels/boss.tscn"));

	const Array manifest = WeChatProjectLayout::resource_group_manifest(plan.groups);
	REQUIRE(manifest.size() == 2);
	const Dictionary levels = manifest[0];
	CHECK(levels["name"] == String("levels"));
	CHECK(levels["subpackage"] == String("levels"));
	CHECK(levels["root"] == String("groups/levels/"));
	CHECK(levels["pack"] == String("groups/levels/pack.bin"));
	const Array resources = levels["resources"];
	CHECK(resources.has("res://levels/boss.tscn"));
	CHECK_FALSE(resources.has("res://ui/menu.tscn"));
	CHECK(plan.total_budget_bytes == 20971520);
}

TEST_CASE("[WeChat] Overlapping resource groups and main-package files are rejected") {
	Vector<WeChatProjectLayout::ResourceFile> files;
	files.push_back(_resource("res://shared/a.txt", 1));
	files.push_back(_resource("res://project.binary", 1));
	const WeChatProjectLayout::PackagePlan overlap = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, Vector<WeChatProjectLayout::RuntimeFile>(), "levels:res://shared/*\naudio:res://shared/*\n", files, "", false, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK_FALSE(overlap.valid);
	CHECK(overlap.error.contains("res://shared/a.txt"));
	CHECK(overlap.error.contains("levels"));
	CHECK(overlap.error.contains("audio"));

	Vector<WeChatProjectLayout::ResourceFile> startup;
	startup.push_back(_resource("res://main.tscn", 1));
	startup.push_back(_resource("res://project.binary", 1));
	const WeChatProjectLayout::PackagePlan main_scene = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, Vector<WeChatProjectLayout::RuntimeFile>(), "levels:res://main.tscn\n", startup, "res://main.tscn", false, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK_FALSE(main_scene.valid);
	CHECK(main_scene.error.contains("res://main.tscn"));
	CHECK(main_scene.error.contains("main package"));
}

TEST_CASE("[WeChat] Total package budget is 20 MB by default and 30 MB when selected") {
	Vector<WeChatProjectLayout::ResourceFile> files;
	files.push_back(_resource("res://project.binary", 1));
	files.push_back(_resource("res://levels/boss.tscn", 20971520));
	Vector<WeChatProjectLayout::RuntimeFile> runtime;
	const String groups = "levels:res://levels/*\n";
	const WeChatProjectLayout::PackagePlan over_20 = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, runtime, groups, files, "", false, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK_FALSE(over_20.valid);
	CHECK(over_20.error.contains("20971671"));
	CHECK(over_20.error.contains("20971520"));
	CHECK(over_20.error.contains("20 MB"));

	const WeChatProjectLayout::PackagePlan under_30 = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, runtime, groups, files, "", true, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK(under_30.valid);
	CHECK(under_30.total_budget_bytes == 31457280);
	CHECK(under_30.main_package_bytes == 100);

	files.write[1].size = 31457280;
	const WeChatProjectLayout::PackagePlan over_30 = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, runtime, groups, files, "", true, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK_FALSE(over_30.valid);
	CHECK(over_30.error.contains("31457431"));
	CHECK(over_30.error.contains("31457280"));
	CHECK(over_30.error.contains("30 MB"));
}

TEST_CASE("[WeChat] Measured resource packs count toward the total budget but not the 4 MB main package") {
	Vector<WeChatProjectLayout::ResourceFile> files;
	files.push_back(_resource("res://project.binary", 1));
	files.push_back(_resource("res://levels/boss.tscn", 10));
	Vector<WeChatProjectLayout::MeasuredPack> measured;
	WeChatProjectLayout::MeasuredPack pack;
	pack.name = "levels";
	pack.bytes = 5 * 1024 * 1024;
	measured.push_back(pack);
	const WeChatProjectLayout::PackagePlan plan = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, Vector<WeChatProjectLayout::RuntimeFile>(), "levels:res://levels/*\n", files, "", false, measured);
	CHECK(plan.valid);
	CHECK(plan.main_package_bytes == 100);
	CHECK(plan.main_package_bytes < 4194304);
	CHECK(plan.groups[0].pack_bytes == 5 * 1024 * 1024);

	pack.bytes = 20971520;
	measured.write[0] = pack;
	const WeChatProjectLayout::PackagePlan over = WeChatProjectLayout::plan_resource_packages("", 0, 100, 120, Vector<WeChatProjectLayout::RuntimeFile>(), "levels:res://levels/*\n", files, "", false, measured);
	CHECK_FALSE(over.valid);
	CHECK(over.error.contains("20971671"));
	CHECK(over.error.contains("20 MB"));
}

TEST_CASE("[WeChat] A previous resource group left in the output directory is not part of the new upload") {
	Vector<String> existing;
	existing.push_back("game.js");
	existing.push_back("groups/old/pack.bin");
	existing.push_back("groups/old/game.js");
	existing.push_back("game.pck");
	Vector<String> planned;
	planned.push_back("game.js");
	planned.push_back("groups/levels/pack.bin");
	planned.push_back("groups/levels/game.js");
	const Vector<String> stale = WeChatProjectLayout::stale_uploaded_files(existing, planned);
	CHECK(stale.has("groups/old/pack.bin"));
	CHECK(stale.has("groups/old/game.js"));
	CHECK(stale.has("game.pck"));
	CHECK_FALSE(stale.has("game.js"));
	CHECK_FALSE(stale.has("groups/levels/pack.bin"));
}

TEST_CASE("[WeChat] A resource group does not hide a main package that cannot fit") {
	Vector<WeChatProjectLayout::ResourceFile> files;
	files.push_back(_resource("res://project.binary", 1));
	files.push_back(_resource("res://levels/boss.tscn", 10));
	const WeChatProjectLayout::PackagePlan plan = WeChatProjectLayout::plan_resource_packages("", 0, 5 * 1024 * 1024, 5 * 1024 * 1024, Vector<WeChatProjectLayout::RuntimeFile>(), "levels:res://levels/*\n", files, "", false, Vector<WeChatProjectLayout::MeasuredPack>());
	CHECK_FALSE(plan.valid);
	CHECK(plan.error.contains("4 MB"));
	CHECK(plan.error.contains("4194304"));
}

} // namespace TestWeChatProjectLayout
