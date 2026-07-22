import os
import subprocess
from typing import Any


def windows_hidden_subprocess_kwargs() -> dict[str, Any]:
    """Return subprocess kwargs that prevent console flashes on Windows.

    Packaged Electron starts the Python backend without a console, but Windows can
    still create a visible console for helper programs such as powershell, wmic,
    ffmpeg, ffprobe, winget, or tesseract unless child processes are explicitly
    hidden.
    """
    if os.name != "nt":
        return {}

    startupinfo = subprocess.STARTUPINFO()
    startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startupinfo.wShowWindow = subprocess.SW_HIDE

    return {
        "startupinfo": startupinfo,
        "creationflags": subprocess.CREATE_NO_WINDOW,
    }


def merge_hidden_subprocess_kwargs(kwargs: dict[str, Any] | None = None) -> dict[str, Any]:
    merged = dict(kwargs or {})
    for key, value in windows_hidden_subprocess_kwargs().items():
        merged.setdefault(key, value)
    return merged


def run_hidden(*popenargs: Any, **kwargs: Any) -> subprocess.CompletedProcess:
    return subprocess.run(*popenargs, **merge_hidden_subprocess_kwargs(kwargs))


def popen_hidden(*popenargs: Any, **kwargs: Any) -> subprocess.Popen:
    return subprocess.Popen(*popenargs, **merge_hidden_subprocess_kwargs(kwargs))
