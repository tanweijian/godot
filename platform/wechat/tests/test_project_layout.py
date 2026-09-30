import json
import tempfile
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
    measure_written_project,
    plan_network_domains,
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
        rendered = rendered.replace("___GODOT_REQUEST_DOMAINS___", "[]")
        rendered = rendered.replace("___GODOT_SOCKET_DOMAINS___", "[]")
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

    def test_export_collects_request_and_socket_domains_and_reminds_about_the_console(self):
        plan = plan_network_domains(
            "https://API.Example.com/\nhttps://cdn.example.com:8443\n# comment\nhttps://api.example.com, https://cdn.example.com:8443\n",
            "wss://Realtime.Example.com\n",
        )
        self.assertTrue(plan["valid"], plan.get("error"))
        self.assertEqual(plan["request_domains"], ["https://api.example.com", "https://cdn.example.com:8443"])
        self.assertEqual(plan["socket_domains"], ["wss://realtime.example.com"])
        for phrase in (
            "https://api.example.com",
            "https://cdn.example.com:8443",
            "wss://realtime.example.com",
            "request合法域名",
            "socket合法域名",
            "微信公众平台 > 开发 > 开发管理 > 开发设置 > 服务器域名",
            "cannot configure or verify",
            "443",
            "urlCheck",
        ):
            self.assertIn(phrase, plan["reminder"])

        empty = plan_network_domains("", "   \n# none\n")
        self.assertTrue(empty["valid"], empty.get("error"))
        self.assertEqual(empty["request_domains"], [])
        self.assertEqual(empty["socket_domains"], [])
        self.assertIn("wechat/request_domains", empty["reminder"])
        self.assertIn("wechat/socket_domains", empty["reminder"])
        self.assertIn("cannot configure or verify", empty["reminder"])

    def test_invalid_domain_entries_explain_how_to_fix_the_allowlist(self):
        cases = [
            ("http://api.example.com", "", "http://api.example.com", "https://"),
            ("https://api.example.com/v1", "", "https://api.example.com/v1", "path"),
            ("https://api.example.com:443", "", "https://api.example.com:443", "443"),
            ("https://127.0.0.1", "", "127.0.0.1", "request合法域名"),
            ("https://*.example.com", "", "*.example.com", "request合法域名"),
            ("", "ws://realtime.example.com", "ws://realtime.example.com", "wss://"),
            ("", "wss://realtime.example.com:9001", "wss://realtime.example.com:9001", "port"),
            ("wss://realtime.example.com", "", "wss://realtime.example.com", "socket"),
            ("", "https://api.example.com", "https://api.example.com", "request"),
        ]
        for request_text, socket_text, shown, hint in cases:
            plan = plan_network_domains(request_text, socket_text)
            self.assertFalse(plan["valid"], (request_text, socket_text))
            self.assertIn(shown, plan["error"])
            self.assertIn(hint, plan["error"].lower() if hint in ("path", "port") else plan["error"])
            self.assertIn("微信公众平台 > 开发 > 开发管理 > 开发设置 > 服务器域名", plan["error"])

    def test_a_written_export_is_measured_against_its_selected_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_bytes(root / "game.js", b"shell")
            _write_bytes(root / "godot-runtime" / "godot.wasm.br", b"w" * 100)
            _write_bytes(root / "godot-runtime" / "game.js", b"entry")
            _write_bytes(root / "groups" / "levels" / "pack.bin", b"p" * 50)
            _write_bytes(root / "groups" / "levels" / "game.js", b"group")
            manifest = {
                "mainPackageLimitBytes": 4 * 1024 * 1024,
                "totalPackageBudgetBytes": 20 * 1024 * 1024,
                "mainFiles": ["game.js", "godot.wechat.json"],
                "runtimeFiles": ["godot-runtime/godot.wasm.br", "godot-runtime/game.js"],
                "resourceGroups": [
                    {"name": "levels", "root": "groups/levels/", "pack": "groups/levels/pack.bin"}
                ],
            }
            manifest_bytes = _write_manifest(root, manifest)
            measured = measure_written_project(root)
        self.assertEqual(measured["main_bytes"], 5 + manifest_bytes)
        self.assertEqual(measured["runtime_bytes"], 105)
        self.assertEqual(measured["group_bytes"], 55)
        self.assertEqual(measured["total_bytes"], 165 + manifest_bytes)
        self.assertEqual(measured["main_limit_bytes"], 4194304)
        self.assertEqual(measured["budget_bytes"], 20971520)
        self.assertTrue(measured["within_main_limit"])
        self.assertTrue(measured["within_total_budget"])
        self.assertEqual(measured["missing"], [])
        self.assertEqual(measured["unplanned"], [])

    def test_a_leftover_outside_a_subpackage_counts_against_the_main_package_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_bytes(root / "game.js", b"main")
            _write_bytes(root / "groups" / "old" / "pack.bin", b"leftover!")
            manifest = _budget_manifest(main_limit=1, budget=20 * 1024 * 1024)
            manifest_bytes = _fit_manifest_limit(root, manifest, planned_main=4, slack=8)
            measured = measure_written_project(root)
        self.assertEqual(measured["main_bytes"], 4 + manifest_bytes + 9)
        self.assertEqual(measured["unplanned"], ["groups/old/pack.bin"])
        self.assertEqual(measured["group_bytes"], 0)
        self.assertGreater(measured["main_bytes"], measured["main_limit_bytes"])
        self.assertFalse(measured["within_main_limit"])

    def test_a_runtime_subpackage_file_counts_toward_the_total_budget_only(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_bytes(root / "game.js", b"main")
            _write_bytes(root / "godot-runtime" / "godot.wasm.br", b"w" * 1000)
            _write_bytes(root / "godot-runtime" / "extra.bin", b"e" * 50)
            manifest = _budget_manifest(
                main_limit=4 * 1024 * 1024,
                budget=100,
                runtime_files=["godot-runtime/godot.wasm.br"],
            )
            manifest_bytes = _write_manifest(root, manifest)
            measured = measure_written_project(root)
        self.assertEqual(measured["main_bytes"], 4 + manifest_bytes)
        self.assertEqual(measured["runtime_bytes"], 1050)
        self.assertEqual(measured["unplanned"], ["godot-runtime/extra.bin"])
        self.assertTrue(measured["within_main_limit"])
        self.assertGreater(measured["total_bytes"], 100)
        self.assertFalse(measured["within_total_budget"])

    def test_a_missing_planned_file_is_outside_the_selected_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_bytes(root / "game.js", b"main")
            _write_manifest(
                root,
                _budget_manifest(
                    main_limit=4 * 1024 * 1024,
                    budget=20 * 1024 * 1024,
                    runtime_files=["godot-runtime/godot.wasm.br"],
                ),
            )
            measured = measure_written_project(root)
        self.assertEqual(measured["missing"], ["godot-runtime/godot.wasm.br"])
        self.assertFalse(measured["within_main_limit"])
        self.assertFalse(measured["within_total_budget"])


def _budget_manifest(
    main_limit: int,
    budget: int,
    runtime_files: list[str] | None = None,
    groups: list[dict] | None = None,
) -> dict:
    return {
        "mainPackageLimitBytes": main_limit,
        "totalPackageBudgetBytes": budget,
        "mainFiles": ["game.js", "godot.wechat.json"],
        "runtimeFiles": runtime_files or [],
        "resourceGroups": groups or [],
    }


def _fit_manifest_limit(root: Path, manifest: dict, planned_main: int, slack: int) -> int:
    limit = manifest["mainPackageLimitBytes"]
    manifest_bytes = 0
    for _ in range(6):
        manifest["mainPackageLimitBytes"] = limit
        manifest_bytes = _write_manifest(root, manifest)
        wanted = planned_main + manifest_bytes + slack
        if wanted == limit:
            return manifest_bytes
        limit = wanted
    raise AssertionError("manifest limit did not converge")


def _write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def _write_manifest(root: Path, manifest: dict) -> int:
    payload = json.dumps(manifest, separators=(",", ":")).encode("utf-8")
    (root / "godot.wechat.json").write_bytes(payload)
    return len(payload)


if __name__ == "__main__":
    unittest.main()
