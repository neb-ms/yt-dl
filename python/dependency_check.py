#!/usr/bin/env python3
import importlib.util
import json
import os
import platform
import shutil
import sys
from datetime import datetime, timezone


def _forced_missing_set():
    raw = os.environ.get("FORCE_MISSING_DEPENDENCIES", "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def _is_forced_missing(name, forced):
    normalized = name.lower()
    alias_map = {
        "yt-dlp": {"yt-dlp", "yt_dlp"},
        "yt_dlp": {"yt-dlp", "yt_dlp"},
    }
    aliases = alias_map.get(normalized, {normalized})
    return any(alias in forced for alias in aliases)


def _install_hint(tool_name):
    os_name = platform.system().lower()

    if tool_name == "python":
        return "Install Python 3 and ensure it is available on PATH."

    if tool_name == "yt-dlp":
        if os_name == "windows":
            return "Run scripts\\setup-python.ps1 to install Python dependencies."
        return "Run ./scripts/setup-python.sh to install Python dependencies."

    if tool_name == "ffmpeg":
        if os_name == "windows":
            return "Install ffmpeg (for example: winget install Gyan.FFmpeg) and ensure PATH is updated."
        if os_name == "darwin":
            return "Install ffmpeg (for example: brew install ffmpeg) and ensure PATH is updated."
        return "Install ffmpeg from your distro package manager and ensure PATH is updated."

    return "Install the missing dependency and run dependency check again."


def _check_python():
    return {
        "name": "python",
        "available": True,
        "path": sys.executable,
        "version": platform.python_version(),
        "installHint": _install_hint("python"),
    }


def _check_ffmpeg(forced):
    path = None if _is_forced_missing("ffmpeg", forced) else shutil.which("ffmpeg")
    return {
        "name": "ffmpeg",
        "available": bool(path),
        "path": path,
        "installHint": _install_hint("ffmpeg"),
    }


def _check_ytdlp(forced):
    forced_missing = _is_forced_missing("yt-dlp", forced)
    binary_path = None if forced_missing else shutil.which("yt-dlp")
    module_available = False
    if not forced_missing:
        module_available = importlib.util.find_spec("yt_dlp") is not None

    source = "missing"
    if binary_path:
        source = "binary"
    elif module_available:
        source = "python-module"

    return {
        "name": "yt-dlp",
        "available": bool(binary_path or module_available),
        "path": binary_path,
        "moduleAvailable": module_available,
        "source": source,
        "installHint": _install_hint("yt-dlp"),
    }


def main():
    forced = _forced_missing_set()

    checks = [
        _check_python(),
        _check_ytdlp(forced),
        _check_ffmpeg(forced),
    ]

    required = [check for check in checks if check["name"] in {"yt-dlp", "ffmpeg"}]
    ok = all(check["available"] for check in required)

    result = {
        "ok": ok,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "message": (
            "All required media dependencies are available."
            if ok
            else "One or more required dependencies are missing. Install missing tools, then recheck."
        ),
        "checks": checks,
    }

    print(json.dumps(result))


if __name__ == "__main__":
    main()

