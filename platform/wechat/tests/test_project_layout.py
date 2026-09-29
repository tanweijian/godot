import json
import unittest
from pathlib import Path

from project_layout import (
    MAIN_PACKAGE_LIMIT_BYTES,
    MIN_BASE_LIBRARY,
    PREVIEW_APPID,
    SHELL,
    device_orientation_from_godot,
    is_valid_appid,
    plan_project,
    project_appid,
    shell_contract_markers,
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
        self.assertNotIn("___GODOT_", rendered)


if __name__ == "__main__":
    unittest.main()
