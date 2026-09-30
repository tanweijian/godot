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
HOST_MODEL = ROOT / "js" / "wechat_host_model.js"


def _header_string(name: str) -> str:
    text = HEADER.read_text(encoding="utf-8")
    match = re.search(rf'{name}\[\] = "([^"]+)"', text)
    if not match:
        raise AssertionError(f"missing {name} in {HEADER}")
    return match.group(1)


def _header_cpp_string(name: str) -> str:
    prefix = f'{name}[] = "'
    for line in HEADER.read_text(encoding="utf-8").splitlines():
        if prefix not in line or not line.rstrip().endswith('";'):
            continue
        raw = line.split(prefix, 1)[1]
        raw = raw[: raw.rfind('"')]
        return raw.encode("utf-8").decode("unicode_escape")
    raise AssertionError(f"missing {name} in {HEADER}")


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
TOTAL_PACKAGE_LIMIT_20_BYTES = _header_int("TOTAL_PACKAGE_LIMIT_20_BYTES")
TOTAL_PACKAGE_LIMIT_30_BYTES = _header_int("TOTAL_PACKAGE_LIMIT_30_BYTES")
RESOURCE_SUBPACKAGE_ENTRY = _header_cpp_string("RESOURCE_SUBPACKAGE_ENTRY")
RESOURCE_SUBPACKAGE_DIR = _header_string("RESOURCE_SUBPACKAGE_DIR")


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
        return {"valid": False, "error": "4 MB", "main_package_bytes": main_bytes}
    main_files = [
        "game.js",
        "wechat_host_model.js",
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
        "main_package_bytes": main_bytes,
        "main_files": main_files,
        "runtime_files": runtime_out,
    }


def _matchn(text: str, pattern: str) -> bool:
    if not text or not pattern:
        return False

    def rec(left: str, right: str) -> bool:
        if not right:
            return not left
        if right[0] == "*":
            return rec(left, right[1:]) or (bool(left) and rec(left[1:], right))
        if right[0] == "?":
            return bool(left) and left[0] != "." and rec(left[1:], right[1:])
        if not left or left[0].lower() != right[0].lower():
            return False
        return rec(left[1:], right[1:])

    return rec(text, pattern)


def _path_matches(path: str, pattern: str) -> bool:
    normalized = path.replace("\\", "/")
    wildcard = pattern.replace("\\", "/")
    bare = normalized[6:] if normalized.startswith("res://") else normalized
    return _matchn(normalized, wildcard) or _matchn(bare, wildcard)


def _valid_group_name(name: str) -> bool:
    if not name:
        return False
    return all(char.isalnum() or char in "_-" for char in name)


def _must_stay_in_main(path: str, main_scene: str) -> bool:
    if path in ("res://project.godot", "res://project.binary") or path.startswith("res://.godot/"):
        return True
    return bool(main_scene) and path == main_scene


def resource_subpackage_entry_bytes() -> int:
    return len(RESOURCE_SUBPACKAGE_ENTRY.encode("utf-8"))


def validate_resource_group_text(text: str) -> str:
    names: list[str] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon <= 0:
            return "missing a resource pattern"
        name = line[:colon].strip()
        if name == RUNTIME_SUBPACKAGE_NAME:
            return "reserved"
        if not _valid_group_name(name):
            return "not valid"
        if name in names:
            return "assigned more than once"
        names.append(name)
        patterns = [part.strip() for part in line[colon + 1 :].split(",") if part.strip()]
        if not patterns:
            return "missing a resource pattern"
    return ""


def assign_resource_groups(text: str, files: list[tuple[str, int]], main_scene: str = "") -> dict:
    syntax = validate_resource_group_text(text)
    if syntax:
        return {"valid": False, "error": syntax, "groups": [], "main_resources": []}
    groups = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        name = line[:colon].strip()
        patterns = [part.strip().replace("\\", "/") for part in line[colon + 1 :].split(",") if part.strip()]
        groups.append(
            {
                "name": name,
                "subpackage": name,
                "root": f"{RESOURCE_SUBPACKAGE_DIR}/{name}/",
                "pack": f"{RESOURCE_SUBPACKAGE_DIR}/{name}/pack.bin",
                "patterns": patterns,
                "resources": [],
                "pack_bytes": 0,
            }
        )
    main_resources = []
    for path, size in files:
        normalized = path.replace("\\", "/")
        matched = None
        for group in groups:
            if any(_path_matches(normalized, pattern) for pattern in group["patterns"]):
                if matched is not None:
                    return {
                        "valid": False,
                        "error": f'{normalized} {matched["name"]} {group["name"]}',
                        "groups": [],
                        "main_resources": [],
                    }
                matched = group
        if matched is None:
            main_resources.append(normalized)
            continue
        if _must_stay_in_main(normalized, main_scene):
            return {
                "valid": False,
                "error": f"{normalized} main package",
                "groups": [],
                "main_resources": [],
            }
        matched["resources"].append(normalized)
        matched["pack_bytes"] += size
    for group in groups:
        if not group["resources"]:
            return {
                "valid": False,
                "error": f'{group["name"]} does not match',
                "groups": [],
                "main_resources": [],
            }
    if groups and not main_resources:
        return {
            "valid": False,
            "error": "no project resources",
            "groups": [],
            "main_resources": [],
        }
    return {"valid": True, "error": "", "groups": groups, "main_resources": main_resources}


def planned_output_files(plan: dict, groups: list[dict]) -> list[str]:
    planned = [path.replace("\\", "/") for path in plan.get("main_files", [])]
    planned.extend(path.replace("\\", "/") for path in plan.get("runtime_files", []))
    for group in groups:
        planned.append(group["pack"].replace("\\", "/"))
        root = group["root"].replace("\\", "/")
        planned.append(root + "game.js" if root.endswith("/") else root + "/game.js")
    return planned


def stale_uploaded_files(existing: list[str], planned: list[str]) -> list[str]:
    planned_set = {path.replace("\\", "/") for path in planned}
    return [path.replace("\\", "/") for path in existing if path.replace("\\", "/") not in planned_set]


def resource_group_manifest(groups: list[dict]) -> list[dict]:
    return [
        {
            "name": group["name"],
            "subpackage": group["subpackage"],
            "root": group["root"],
            "pack": group["pack"],
            "resources": list(group["resources"]),
        }
        for group in groups
    ]


def subpackage_entries(use_runtime: bool, groups: list[dict]) -> list[dict]:
    entries = []
    if use_runtime:
        entries.append({"name": RUNTIME_SUBPACKAGE_NAME, "root": RUNTIME_SUBPACKAGE_ROOT + "/"})
    for group in groups:
        entries.append({"name": group["subpackage"], "root": group["root"]})
    return entries


def plan_resource_packages(
    appid: str,
    godot_orientation: int,
    shell_without: int,
    shell_with: int,
    runtime_files: list[tuple[str, int]],
    groups_text: str,
    resources: list[tuple[str, int]],
    main_scene: str = "",
    budget_30mb: bool = False,
    measured: dict[str, int] | None = None,
) -> dict:
    budget = TOTAL_PACKAGE_LIMIT_30_BYTES if budget_30mb else TOTAL_PACKAGE_LIMIT_20_BYTES
    assignment = assign_resource_groups(groups_text, resources, main_scene)
    if not assignment["valid"]:
        return {"valid": False, "error": assignment["error"], "total_budget_bytes": budget}
    groups = assignment["groups"]
    for group in groups:
        if measured and group["name"] in measured:
            group["pack_bytes"] = measured[group["name"]]
    project = plan_project(appid, godot_orientation, shell_without, shell_with, runtime_files)
    if not project["valid"]:
        return {
            "valid": False,
            "error": project["error"],
            "main_package_bytes": project.get("main_package_bytes", 0),
            "total_budget_bytes": budget,
            "groups": groups,
            "main_resources": assignment["main_resources"],
        }
    runtime_bytes = sum(size for _, size in runtime_files)
    group_bytes = sum(group["pack_bytes"] + resource_subpackage_entry_bytes() for group in groups)
    runtime_extra = runtime_bytes if project["use_runtime_subpackage"] else 0
    total = project["main_package_bytes"] + runtime_extra + group_bytes
    if total > budget:
        label = "30 MB" if budget_30mb else "20 MB"
        return {
            "valid": False,
            "error": f"{total} {budget} {label}",
            "main_package_bytes": project["main_package_bytes"],
            "total_package_bytes": total,
            "total_budget_bytes": budget,
            "groups": groups,
            "main_resources": assignment["main_resources"],
            "project": project,
        }
    return {
        "valid": True,
        "error": "",
        "project": project,
        "groups": groups,
        "main_resources": assignment["main_resources"],
        "main_package_bytes": project["main_package_bytes"],
        "total_package_bytes": total,
        "total_budget_bytes": budget,
    }


def substitute_shell(template: str, values: dict[str, str]) -> str:
    text = template
    for key, value in values.items():
        text = text.replace(key, json.dumps(value, ensure_ascii=False))
    return text


NETWORK_CONSOLE_PATH = "微信公众平台 > 开发 > 开发管理 > 开发设置 > 服务器域名"


def network_allowlist_reminder(request_domains: list[str], socket_domains: list[str]) -> str:
    text = (
        "Configure request and WebSocket domains in the WeChat developer console under "
        + NETWORK_CONSOLE_PATH
        + ". Put HTTPS origins in request合法域名 and WSS hosts in socket合法域名. "
        "Request entries must not include a path or the default port 443. "
        "Socket entries must not include a path or port. "
        "This exporter cannot configure or verify those allowlists. "
        "The generated project leaves urlCheck disabled, so Developer Tools skips the allowlist; real devices still enforce it."
    )
    if request_domains or socket_domains:
        text += " Request domains: " + (", ".join(request_domains) if request_domains else "(none)") + "."
        text += " Socket domains: " + (", ".join(socket_domains) if socket_domains else "(none)") + "."
    else:
        text += (
            " No request or WebSocket domains were entered. Add them to wechat/request_domains and "
            "wechat/socket_domains before release if the game uses HTTPRequest or WebSocketPeer."
        )
    return text


def _network_domain_error(entry: str, problem: str) -> str:
    return (
        f'WeChat domain "{entry}" is not valid: {problem} '
        f"Add the corrected entry in {NETWORK_CONSOLE_PATH}. "
        "The exporter cannot configure or verify that allowlist."
    )


def _split_network_entries(text: str) -> list[str]:
    entries: list[str] = []
    for raw in str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        for part in line.split(","):
            token = part.strip()
            if token:
                entries.append(token)
    return entries


def _is_ip_host(host: str) -> bool:
    bare = host[1:-1] if host.startswith("[") and host.endswith("]") else host
    if bare.count(":") >= 2:
        return True
    parts = bare.split(".")
    if len(parts) != 4:
        return False
    for part in parts:
        if not part.isdigit() or int(part) > 255:
            return False
    return True


def _normalize_network_domain(entry: str, kind: str) -> tuple[str, str]:
    scheme_end = entry.find("://")
    if scheme_end <= 0:
        return "", _network_domain_error(entry, "enter an https:// request origin or a wss:// socket host.")
    scheme = entry[:scheme_end].lower()
    after = entry[scheme_end + 3 :]
    if not after or "@" in after:
        return "", _network_domain_error(entry, "enter a host without user info.")
    cut = len(after)
    for marker in ("/", "?", "#"):
        found = after.find(marker)
        if found >= 0:
            cut = min(cut, found)
    rest = after[cut:]
    authority = after[:cut]
    if not authority:
        return "", _network_domain_error(entry, "enter a host name.")
    host = authority
    port = ""
    if authority.startswith("["):
        end = authority.find("]")
        if end < 0:
            return "", _network_domain_error(entry, "enter a host name.")
        host = authority[: end + 1]
        if len(authority) > end + 1:
            if authority[end + 1] != ":":
                return "", _network_domain_error(entry, "enter a host name.")
            port = authority[end + 2 :]
    else:
        colon = authority.rfind(":")
        if colon >= 0:
            host = authority[:colon]
            port = authority[colon + 1 :]
    host = host.lower()
    if kind == "request" and scheme == "wss":
        return "", _network_domain_error(entry, "this is a WebSocket domain. Enter it in wechat/socket_domains, not request domains.")
    if kind == "socket" and scheme == "https":
        return "", _network_domain_error(entry, "this is an HTTP request domain. Enter it in wechat/request_domains, not socket domains.")
    if kind == "request" and scheme != "https":
        return "", _network_domain_error(entry, "request allowlist entries must use https://, for example https://api.example.com.")
    if kind == "socket" and scheme != "wss":
        return "", _network_domain_error(entry, "socket allowlist entries must use wss://, for example wss://realtime.example.com.")
    if rest not in ("", "/"):
        return "", _network_domain_error(entry, "allowlist entries cannot include a path, query, or fragment.")
    if port and (not port.isdigit() or port != str(int(port)) or int(port) < 1 or int(port) > 65535):
        return "", _network_domain_error(entry, "enter a numeric port from 1 to 65535, or omit the port.")
    if kind == "request" and port == "443":
        return "", _network_domain_error(entry, "omit the default port 443. https://host:443 is not the same allowlist entry as https://host.")
    if kind == "socket" and port:
        return "", _network_domain_error(entry, "socket allowlist entries must not include a port. Enter wss://host and WeChat allows every port on that host.")
    if _is_ip_host(host) or host == "localhost":
        label = "request合法域名" if kind == "request" else "socket合法域名"
        return "", _network_domain_error(entry, f"{label} cannot be an IP address or localhost.")
    if "*" in host:
        label = "request合法域名" if kind == "request" else "socket合法域名"
        return "", _network_domain_error(entry, f"{label} does not accept a wildcard parent domain. Enter each subdomain separately.")
    if "." not in host.strip("[]"):
        return "", _network_domain_error(entry, "enter a domain name, not a single-label host.")
    normalized = scheme + "://" + host
    if kind == "request" and port:
        normalized += ":" + port
    return normalized, ""


def _collect_network_domains(text: str, kind: str) -> tuple[list[str], str]:
    domains: list[str] = []
    for entry in _split_network_entries(text):
        normalized, error = _normalize_network_domain(entry, kind)
        if error:
            return [], error
        if normalized not in domains:
            domains.append(normalized)
    return domains, ""


def plan_network_domains(request_text: str, socket_text: str) -> dict:
    request_domains, request_error = _collect_network_domains(request_text, "request")
    if request_error:
        return {"valid": False, "error": request_error, "request_domains": [], "socket_domains": [], "reminder": ""}
    socket_domains, socket_error = _collect_network_domains(socket_text, "socket")
    if socket_error:
        return {"valid": False, "error": socket_error, "request_domains": [], "socket_domains": [], "reminder": ""}
    return {
        "valid": True,
        "error": "",
        "request_domains": request_domains,
        "socket_domains": socket_domains,
        "reminder": network_allowlist_reminder(request_domains, socket_domains),
    }


def shell_contract_markers() -> list[str]:
    return [
        "2.19.0",
        "wx.showModal",
        "console.error",
        "wx.loadSubpackage",
        "WXWebAssembly.instantiate",
        "getContext(\"webgl2\")",
        "probeCompatibility3D",
        "diagnoseRendererMessage",
        "samplePerformance",
        "guaranteed=false",
        "godotWeChatCompareVersion",
        "setResourceSubpackages",
        "GODOT_RESOURCE_GROUPS",
        "GODOT_REQUEST_DOMAINS",
        "GODOT_SOCKET_DOMAINS",
        "networkAllowlistReminder",
        "--main-pack",
        'require("./wechat_host_model.js")',
        "createGodotFiles",
        "userDataMounts",
        "createPackageAccess",
    ]


def host_contract_markers() -> list[str]:
    return [
        "onTouchStart",
        "onTouchMove",
        "onTouchEnd",
        "onTouchCancel",
        "onHide",
        "onShow",
        "onWindowResize",
        "safeArea",
        "loadResourceSubpackage",
        "setResourceSubpackages",
        "wx.request",
        "wx.connectSocket",
    ]
