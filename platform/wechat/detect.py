import importlib.util
import sys
from pathlib import Path

from SCons.Util import WhereIs

from platform_methods import validate_arch


def get_name():
    return "WeChat"


def can_build():
    return WhereIs("emcc") is not None


def get_tools(env):
    return ["cc", "c++", "ar", "link", "textfile", "zip"]


def get_opts():
    return _web_detect().get_opts()


def get_doc_classes():
    return [
        "EditorExportPlatformWeChat",
        "WeChat",
    ]


def get_doc_path():
    return "doc_classes"


def get_flags():
    web = _web_detect()
    flags = dict(web.get_flags())
    flags["threads"] = False
    flags["wasm_simd"] = False
    flags["dlink_enabled"] = False
    flags["opengl3"] = True
    return flags


def configure(env):
    if env.get("threads", False):
        _warn(env, "WeChat Mini Game forces threads=no.")
    env["threads"] = False
    if env.get("wasm_simd", False):
        _warn(env, "WeChat Mini Game forces wasm_simd=no.")
    env["wasm_simd"] = False
    if env.get("dlink_enabled", False):
        _warn(env, "WeChat Mini Game forces dlink_enabled=no.")
    env["dlink_enabled"] = False
    if not env["opengl3"]:
        _error("WeChat Mini Game requires opengl3=yes for the Compatibility renderer.")
        sys.exit(255)

    web = _web_detect()
    web.configure(env)
    validate_arch(env["arch"], get_name(), ["wasm32"])
    env.Append(CPPDEFINES=["WECHAT_ENABLED"])


def _warn(env, message):
    try:
        from methods import print_warning

        print_warning(message)
    except Exception:
        print(message)


def _error(message):
    try:
        from methods import print_error

        print_error(message)
    except Exception:
        print(message, file=sys.stderr)


def _web_detect():
    web_dir = Path(__file__).resolve().parents[1] / "web"
    if str(web_dir) not in sys.path:
        sys.path.insert(0, str(web_dir))
    spec = importlib.util.spec_from_file_location("godot_web_detect", web_dir / "detect.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
