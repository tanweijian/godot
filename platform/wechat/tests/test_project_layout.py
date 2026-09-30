import json
import unittest
from pathlib import Path

from project_layout import (
    HOST_MODEL,
    MAIN_PACKAGE_LIMIT_BYTES,
    MIN_BASE_LIBRARY,
    PREVIEW_APPID,
    SHELL,
    TOTAL_PACKAGE_LIMIT_20_BYTES,
    TOTAL_PACKAGE_LIMIT_30_BYTES,
    device_orientation_from_godot,
    host_contract_markers,
    is_valid_appid,
    plan_project,
    plan_resource_packages,
    project_appid,
    resource_group_manifest,
    shell_contract_markers,
    stale_uploaded_files,
    substitute_shell,
)


class WeChatProjectLayoutTest(unittest.TestCase):
    def test_limits_match_the_spec(self):
        self.assertEqual(MIN_BASE_LIBRARY, "2.19.0")
        self.assertEqual(PREVIEW_APPID, "touristappid")
        self.assertEqual(MAIN_PACKAGE_LIMIT_BYTES, 4 * 1024 * 1024)

    def test_empty_appid_remains_usable_for_local_preview(self):
        self.assertTrue(is_valid_appid(""))
        self.assertEqual(project_appid(""), "touristappid")
        plan = plan_project("", 1, 1000, 1200, [("godot.wasm", 1000)])
        self.assertTrue(plan["valid"])
        self.assertEqual(plan["project_appid"], "touristappid")
        self.assertFalse(plan["use_runtime_subpackage"])

    def test_explicit_appid_is_preserved_and_invalid_appid_is_rejected(self):
        self.assertEqual(project_appid("wx0123456789abcdef"), "wx0123456789abcdef")
        self.assertFalse(is_valid_appid("not-an-appid"))
        plan = plan_project("not-an-appid", 0, 1000, 1200, [])
        self.assertFalse(plan["valid"])

    def test_orientation_mapping(self):
        self.assertEqual(device_orientation_from_godot(0), "landscape")
        self.assertEqual(device_orientation_from_godot(1), "portrait")
        self.assertEqual(device_orientation_from_godot(3), "portrait")
        self.assertEqual(device_orientation_from_godot(6), "landscape")

    def test_runtime_subpackage_is_created_only_when_the_main_package_limit_requires_it(self):
        small = plan_project("", 0, 2048, 4096, [("godot.wasm", 1024), ("godot.js", 512)])
        self.assertFalse(small["use_runtime_subpackage"])
        self.assertIn("godot.wasm", small["main_files"])
        self.assertIn("wechat_host_model.js", small["main_files"])

        large = plan_project("wx0123456789abcdef", 0, 2048, 4096, [("godot.wasm", 5 * 1024 * 1024)])
        self.assertTrue(large["valid"])
        self.assertTrue(large["use_runtime_subpackage"])
        self.assertIn("godot-runtime/godot.wasm", large["runtime_files"])
        self.assertIn("godot-runtime/game.js", large["runtime_files"])
        self.assertNotIn("godot.wasm", large["main_files"])

    def test_shell_itself_cannot_exceed_the_main_package_limit(self):
        plan = plan_project("", 0, 5 * 1024 * 1024, 5 * 1024 * 1024, [])
        self.assertFalse(plan["valid"])
        self.assertIn("4 MB", plan["error"])

    def test_startup_shell_reports_base_library_webgl2_and_wasm_failures(self):
        source = SHELL.read_text(encoding="utf-8")
        for marker in shell_contract_markers():
            self.assertIn(marker, source)
        host_source = HOST_MODEL.read_text(encoding="utf-8")
        for marker in host_contract_markers():
            self.assertIn(marker, host_source)
        rendered = substitute_shell(
            source,
            {
                "___GODOT_MIN_BASE_LIBRARY___": "2.19.0",
                "___GODOT_RUNTIME_SUBPACKAGE___": "godot-runtime",
                "___GODOT_WASM_PATH___": "godot-runtime/godot.wasm",
                "___GODOT_JS_PATH___": "godot-runtime/godot.js",
                "___GODOT_PCK_PATH___": "godot-runtime/game.bin",
                "___GODOT_REVISION___": "abc123",
                "___GODOT_EMSCRIPTEN_VERSION___": "4.0.11",
                "___GODOT_PROJECT_NAME___": 'Quote "Game"',
            },
        )
        self.assertIn(json.dumps("2.19.0"), rendered)
        self.assertIn(json.dumps('Quote "Game"'), rendered)
        rendered = rendered.replace("___GODOT_RESOURCE_GROUPS___", "[]")
        self.assertNotIn("___GODOT_", rendered)

    def test_resource_groups_map_to_packs_and_leave_unassigned_files_in_the_main_package(self):
        files = [
            ("res://levels/boss.tscn", 10),
            ("res://ui/menu.tscn", 4),
            ("res://audio/boss.ogg", 8),
            ("res://music/theme.wav", 3),
            ("res://project.binary", 20),
            ("res://main.tscn", 6),
        ]
        plan = plan_resource_packages(
            "",
            1,
            100,
            120,
            [],
            "levels:res://levels/*\naudio:res://audio/*.ogg,res://music/*\n",
            files,
            "res://main.tscn",
            False,
        )
        self.assertTrue(plan["valid"], plan.get("error"))
        self.assertEqual(plan["groups"][0]["pack"], "groups/levels/pack.bin")
        self.assertEqual(plan["groups"][0]["root"], "groups/levels/")
        self.assertEqual(plan["groups"][0]["resources"], ["res://levels/boss.tscn"])
        self.assertEqual(plan["groups"][1]["resources"], ["res://audio/boss.ogg", "res://music/theme.wav"])
        self.assertIn("res://ui/menu.tscn", plan["main_resources"])
        self.assertIn("res://main.tscn", plan["main_resources"])
        self.assertNotIn("res://levels/boss.tscn", plan["main_resources"])
        manifest = resource_group_manifest(plan["groups"])
        self.assertEqual(manifest[0]["subpackage"], "levels")
        self.assertEqual(manifest[0]["pack"], "groups/levels/pack.bin")
        self.assertEqual(manifest[0]["resources"], ["res://levels/boss.tscn"])
        self.assertNotIn("res://ui/menu.tscn", manifest[0]["resources"])
        self.assertEqual(plan["total_budget_bytes"], 20971520)
        self.assertEqual(TOTAL_PACKAGE_LIMIT_20_BYTES, 20971520)
        self.assertEqual(TOTAL_PACKAGE_LIMIT_30_BYTES, 31457280)

    def test_overlapping_groups_and_main_scene_assignment_are_rejected(self):
        overlap = plan_resource_packages(
            "",
            0,
            100,
            120,
            [],
            "levels:res://shared/*\naudio:res://shared/*\n",
            [("res://shared/a.txt", 1), ("res://project.binary", 1)],
        )
        self.assertFalse(overlap["valid"])
        self.assertIn("res://shared/a.txt", overlap["error"])
        self.assertIn("levels", overlap["error"])
        self.assertIn("audio", overlap["error"])

        main_scene = plan_resource_packages(
            "",
            0,
            100,
            120,
            [],
            "levels:res://main.tscn\n",
            [("res://main.tscn", 1), ("res://project.binary", 1)],
            "res://main.tscn",
        )
        self.assertFalse(main_scene["valid"])
        self.assertIn("res://main.tscn", main_scene["error"])
        self.assertIn("main package", main_scene["error"])

    def test_total_budget_errors_name_the_selected_20_or_30_mb_limit(self):
        files = [("res://project.binary", 1), ("res://levels/boss.tscn", 20971520)]
        groups = "levels:res://levels/*\n"
        over_20 = plan_resource_packages("", 0, 100, 120, [], groups, files, "", False)
        self.assertFalse(over_20["valid"])
        self.assertIn("20971671", over_20["error"])
        self.assertIn("20971520", over_20["error"])
        self.assertIn("20 MB", over_20["error"])

        under_30 = plan_resource_packages("", 0, 100, 120, [], groups, files, "", True)
        self.assertTrue(under_30["valid"], under_30.get("error"))
        self.assertEqual(under_30["total_budget_bytes"], 31457280)
        self.assertEqual(under_30["main_package_bytes"], 100)

        over_30 = plan_resource_packages(
            "",
            0,
            100,
            120,
            [],
            groups,
            [("res://project.binary", 1), ("res://levels/boss.tscn", 31457280)],
            "",
            True,
        )
        self.assertFalse(over_30["valid"])
        self.assertIn("31457431", over_30["error"])
        self.assertIn("31457280", over_30["error"])
        self.assertIn("30 MB", over_30["error"])

    def test_measured_pack_size_counts_toward_the_total_but_not_the_main_package(self):
        files = [("res://project.binary", 1), ("res://levels/boss.tscn", 10)]
        groups = "levels:res://levels/*\n"
        plan = plan_resource_packages("", 0, 100, 120, [], groups, files, "", False, {"levels": 5 * 1024 * 1024})
        self.assertTrue(plan["valid"], plan.get("error"))
        self.assertEqual(plan["main_package_bytes"], 100)
        self.assertLess(plan["main_package_bytes"], 4194304)
        self.assertEqual(plan["groups"][0]["pack_bytes"], 5 * 1024 * 1024)

        over = plan_resource_packages("", 0, 100, 120, [], groups, files, "", False, {"levels": 20971520})
        self.assertFalse(over["valid"])
        self.assertIn("20971671", over["error"])
        self.assertIn("20 MB", over["error"])

    def test_a_dropped_resource_group_is_not_part_of_the_next_upload(self):
        stale = stale_uploaded_files(
            ["game.js", "groups/old/pack.bin", "groups/old/game.js", "game.pck"],
            ["game.js", "groups/levels/pack.bin", "groups/levels/game.js"],
        )
        self.assertEqual(stale, ["groups/old/pack.bin", "groups/old/game.js", "game.pck"])

    def test_a_resource_group_does_not_hide_a_main_package_limit_error(self):
        plan = plan_resource_packages(
            "",
            0,
            5 * 1024 * 1024,
            5 * 1024 * 1024,
            [],
            "levels:res://levels/*\n",
            [("res://project.binary", 1), ("res://levels/boss.tscn", 10)],
        )
        self.assertFalse(plan["valid"])
        self.assertIn("4 MB", plan["error"])


if __name__ == "__main__":
    unittest.main()
