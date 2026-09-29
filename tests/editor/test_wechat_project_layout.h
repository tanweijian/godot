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
}

} // namespace TestWeChatProjectLayout
