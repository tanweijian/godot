"""Generated WeChat project decisions.

Must stay in lockstep with platform/wechat/wechat_project_layout.h.
Expected values in the tests come from the spec, not from recomputing this file.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HEADER = ROOT / "wechat_project_layout.h"
SHELL = ROOT / "js" / "game.js"


def _header_string(name: str) -> str:
    text = HEADER.read_text(encoding="utf-8")
    match = re.search(rf'{name}\[\] = "([^"]+)"', text)
    if not match:
        raise AssertionError(f"missing {name} in {HEADER}")
    return match.group(1)


def _header_int(name: str) -> int:
    text = HEADER.read_text(encoding="utf-8")
    match = re.search(rf"{name} = ([0-9 *]+);", text)
    if not match:
        raise AssertionError(f"missing {name} in {HEADER}")
    return int(eval(match.group(1), {"__builtins__": {}}, {}))  # noqa: S307 - header literal only


MIN_BASE_LIBRARY = _header_string("MIN_BASE_LIBRARY")
PREVIEW_APPID = _header_string("PREVIEW_APPID")
RUNTIME_SUBPACKAGE_NAME = _header_string("RUNTIME_SUBPACKAGE_NAME")
RUNTIME_SUBPACKAGE_ROOT = _header_string("RUNTIME_SUBPACKAGE_ROOT")
MAIN_PACKAGE_LIMIT_BYTES = _header_int("MAIN_PACKAGE_LIMIT_BYTES")


def is_valid_appid(appid: str) -> bool:
    if appid == "" or appid == PREVIEW_APPID:
        return True
    if not appid.startswith("wx") or len(appid) != 18:
        return False
    return all(char in "0123456789abcdefABCDEF" for char in appid[2:])


def project_appid(appid: str) -> str:
    return PREVIEW_APPID if appid == "" else appid


def device_orientation_from_godot(orientation: int) -> str:
    if orientation in (1, 3, 5):
        return "portrait"
    return "landscape"


def plan_project(appid: str, godot_orientation: int, shell_without: int, shell_with: int, runtime_files: list[tuple[str, int]]) -> dict:
    if not is_valid_appid(appid):
        return {"valid": False, "error": "invalid appid"}
    runtime_bytes = sum(size for _, size in runtime_files)
    use_subpackage = shell_without + runtime_bytes > MAIN_PACKAGE_LIMIT_BYTES
    shell_bytes = shell_with if use_subpackage else shell_without
    main_bytes = shell_bytes if use_subpackage else shell_bytes + runtime_bytes
    if main_bytes > MAIN_PACKAGE_LIMIT_BYTES:
        return {"valid": False, "error": "4 MB"}
    main_files = [
        "game.js",
        "game.json",
        "project.config.json",
        "project.private.config.json",
        "godot.wechat.json",
    ]
    runtime_out = []
    for name, _size in runtime_files:
        relative = f"{RUNTIME_SUBPACKAGE_ROOT}/{name}" if use_subpackage else name
        if use_subpackage:
            runtime_out.append(relative)
        else:
            main_files.append(relative)
    if use_subpackage:
        runtime_out.append(f"{RUNTIME_SUBPACKAGE_ROOT}/game.js")
    return {
        "valid": True,
        "configured_appid": appid,
        "project_appid": project_appid(appid),
        "device_orientation": device_orientation_from_godot(godot_orientation),
        "use_runtime_subpackage": use_subpackage,
        "main_files": main_files,
        "runtime_files": runtime_out,
    }


def substitute_shell(template: str, values: dict[str, str]) -> str:
    text = template
    for key, value in values.items():
        text = text.replace(key, json.dumps(value, ensure_ascii=False))
    return text


def shell_contract_markers() -> list[str]:
    return [
        "2.19.0",
        "wx.showModal",
        "console.error",
        "wx.loadSubpackage",
        "WXWebAssembly.instantiate",
        "getContext(\"webgl2\")",
        "godotWeChatCompareVersion",
        "--main-pack",
    ]
