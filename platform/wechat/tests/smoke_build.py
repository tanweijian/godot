"""Build smoke test for the WeChat platform target.

Records the selected Emscripten version and Godot revision, then builds
template_release if emcc is available. The generated template zip is the
artifact exercised by launch_devtools.py.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RECORD = ROOT / ".scratch" / "wechat-minigame-support" / "toolchain-record.md"


def _run(command: list[str], cwd: Path | None = None) -> tuple[int, str]:
    try:
        completed = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    except FileNotFoundError as exc:
        return 127, str(exc)
    return completed.returncode, (completed.stdout or "") + (completed.stderr or "")


def godot_revision() -> str:
    code, output = _run(["git", "rev-parse", "HEAD"], ROOT)
    return output.strip() if code == 0 else ""


def emscripten_version() -> str:
    code, output = _run(["emcc", "--version"])
    if code != 0:
        return ""
    first = output.splitlines()[0] if output else ""
    for part in first.split():
        if part[:1].isdigit():
            return part
    return first


def main() -> int:
    revision = godot_revision()
    emcc = emscripten_version()
    RECORD.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# WeChat toolchain record",
        "",
        f"- Godot revision: `{revision or 'unknown'}`",
        f"- Emscripten: `{emcc or 'not found on PATH'}`",
        "- Profile: single-threaded, non-SIMD, Compatibility/WebGL 2",
        "",
    ]
    if not emcc:
        lines.append("Build was not started because `emcc` is not on PATH.")
        RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("\n".join(lines))
        return 1

    env = os.environ.copy()
    command = [
        sys.executable,
        "-m",
        "SCons",
        "platform=wechat",
        "target=template_release",
        "threads=no",
        "wasm_simd=no",
        "dlink_enabled=no",
    ]
    print("Running:", " ".join(command))
    completed = subprocess.run(command, cwd=ROOT, env=env, check=False)
    lines.append(f"- Build exit code: `{completed.returncode}`")
    zips = sorted((ROOT / "bin").glob("godot.wechat.template_release*.zip"))
    if zips:
        lines.append(f"- Template: `{zips[-1]}`")
    RECORD.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
