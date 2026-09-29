"""Open a generated minimal WeChat project in Developer Tools.

Uses the same shell and package-limit decisions as the editor exporter.
A real engine wasm/pck is included when the smoke build and pack export
have produced them; otherwise the startup shell still runs and reports the
missing runtime instead of failing silently.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from project_layout import (
    MIN_BASE_LIBRARY,
    PREVIEW_APPID,
    RUNTIME_SUBPACKAGE_NAME,
    RUNTIME_SUBPACKAGE_ROOT,
    SHELL,
    plan_project,
    substitute_shell,
)

ROOT = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent
OUT = TESTS / "out" / "wechat-boot"
RECORD = ROOT / ".scratch" / "wechat-minigame-support" / "devtools-launch.md"
CLI_CANDIDATES = [
    os.environ.get("WECHAT_DEVTOOLS_CLI", ""),
    r"C:\Program Files (x86)\Tencent\微信web开发者工具\cli.bat",
    r"C:\Program Files\Tencent\微信web开发者工具\cli.bat",
]


def _revision() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return ""


def _emscripten() -> str:
    try:
        output = subprocess.check_output(["emcc", "--version"], text=True)
    except Exception:
        return ""
    first = output.splitlines()[0] if output else ""
    for part in first.split():
        if part[:1].isdigit():
            return part
    return first


def _find_wasm() -> Path | None:
    matches = sorted((ROOT / "bin").glob("godot.wechat.template_release*.wasm"))
    return matches[-1] if matches else None


def _find_js() -> Path | None:
    matches = sorted((ROOT / "bin").glob("godot.wechat.template_release*.js"))
    matches = [path for path in matches if not path.name.endswith(".wechat-build.json")]
    return matches[-1] if matches else None


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def assemble(destination: Path) -> dict:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    wasm = _find_wasm()
    glue = _find_js()
    pck = TESTS / "out" / "game.pck"
    runtime = []
    if glue:
        runtime.append(("godot.js", glue.stat().st_size))
    if wasm:
        runtime.append(("godot.wasm", wasm.stat().st_size))
    if pck.exists():
        runtime.append(("game.bin", pck.stat().st_size))
    if not runtime:
        runtime.append(("godot.wasm", 5 * 1024 * 1024))
    plan = plan_project("", 1, 8192, 8192, runtime)
    if not plan["valid"]:
        raise SystemExit(plan["error"])
    root = f"{RUNTIME_SUBPACKAGE_ROOT}/" if plan["use_runtime_subpackage"] else ""
    shell = substitute_shell(
        SHELL.read_text(encoding="utf-8"),
        {
            "___GODOT_MIN_BASE_LIBRARY___": MIN_BASE_LIBRARY,
            "___GODOT_RUNTIME_SUBPACKAGE___": RUNTIME_SUBPACKAGE_NAME if plan["use_runtime_subpackage"] else "",
            "___GODOT_WASM_PATH___": root + "godot.wasm",
            "___GODOT_JS_PATH___": root + "godot.js",
            "___GODOT_PCK_PATH___": root + "game.bin",
            "___GODOT_REVISION___": _revision(),
            "___GODOT_EMSCRIPTEN_VERSION___": _emscripten(),
            "___GODOT_PROJECT_NAME___": "WeChat Boot",
        },
    )
    game = {
        "deviceOrientation": "portrait",
        "showStatusBar": False,
        "networkTimeout": {"request": 60000, "connectSocket": 60000, "uploadFile": 60000, "downloadFile": 60000},
    }
    if plan["use_runtime_subpackage"]:
        game["subpackages"] = [{"name": RUNTIME_SUBPACKAGE_NAME, "root": RUNTIME_SUBPACKAGE_ROOT + "/"}]
    project_config = {
        "description": "Godot WeChat Mini Game",
        "packOptions": {
            "ignore": [],
            "include": [
                {"type": "suffix", "value": ".wasm"},
                {"type": "suffix", "value": ".pck"},
                {"type": "file", "value": root + "godot.js"},
            ],
        },
        "setting": {
            "urlCheck": False,
            "es6": False,
            "enhance": False,
            "minified": False,
            "ignoreDevUnusedFiles": False,
            "ignoreUploadUnusedFiles": False,
            "useIsolateContext": False,
        },
        "compileType": "minigame",
        "libVersion": "latest",
        "appid": PREVIEW_APPID,
        "projectname": "WeChat Boot",
        "condition": {},
    }
    manifest = {
        "format": 1,
        "configuredAppId": "",
        "appId": PREVIEW_APPID,
        "deviceOrientation": "portrait",
        "minBaseLibrary": MIN_BASE_LIBRARY,
        "runtimeSubpackage": RUNTIME_SUBPACKAGE_NAME if plan["use_runtime_subpackage"] else "",
        "renderer": "gl_compatibility",
        "threads": False,
        "simd": False,
        "godotRevision": _revision(),
        "emscriptenVersion": _emscripten(),
        "mainFiles": plan["main_files"],
        "runtimeFiles": plan["runtime_files"],
    }
    _write(destination / "game.js", shell)
    _write(destination / "game.json", json.dumps(game, indent=2) + "\n")
    _write(destination / "project.config.json", json.dumps(project_config, indent=2) + "\n")
    _write(destination / "project.private.config.json", json.dumps({"libVersion": "latest", "setting": {"urlCheck": False, "ignoreDevUnusedFiles": False}}, indent=2) + "\n")
    _write(destination / "godot.wechat.json", json.dumps(manifest, indent=2) + "\n")
    runtime_dir = destination / RUNTIME_SUBPACKAGE_ROOT if plan["use_runtime_subpackage"] else destination
    runtime_dir.mkdir(parents=True, exist_ok=True)
    if plan["use_runtime_subpackage"]:
        _write(runtime_dir / "game.js", 'console.log("[Godot] engine runtime subpackage loaded");\n')
    if glue:
        shutil.copyfile(glue, runtime_dir / "godot.js")
    if wasm:
        shutil.copyfile(wasm, runtime_dir / "godot.wasm")
    if pck.exists():
        shutil.copyfile(pck, runtime_dir / "game.bin")
    return plan


def _cli() -> str:
    for candidate in CLI_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    return ""


def main() -> int:
    plan = assemble(OUT)
    cli = _cli()
    lines = [
        "# WeChat Developer Tools launch",
        "",
        f"- Project: `{OUT}`",
        f"- AppID: `{PREVIEW_APPID}` (empty preset, local preview)",
        f"- Runtime subpackage: `{plan['use_runtime_subpackage']}`",
        f"- Godot revision: `{_revision() or 'unknown'}`",
        f"- Emscripten: `{_emscripten() or 'not found on PATH'}`",
        f"- CLI: `{cli or 'not found'}`",
        "",
    ]
    if not cli:
        lines.append("Developer Tools CLI was not found. Open the project directory manually.")
        RECORD.parent.mkdir(parents=True, exist_ok=True)
        RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
        return 1
    completed = subprocess.run(["cmd", "/c", cli, "open", "--project", str(OUT)], check=False)
    lines.append(f"- CLI exit code: `{completed.returncode}`")
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
