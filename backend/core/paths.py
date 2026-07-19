"""Central filesystem layout for web development and packaged desktop builds."""

from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent.parent
DESKTOP_MODE = os.getenv("MYAI_DESKTOP_MODE", "0").lower() in {"1", "true", "yes"}


def _configured_path(name: str, fallback: Path) -> Path:
    value = os.getenv(name)
    return Path(value).expanduser().resolve() if value else fallback.resolve()


DATA_DIR = _configured_path("MYAI_DATA_DIR", BACKEND_DIR)
DATABASE_DIR = DATA_DIR / "database" if DESKTOP_MODE else DATA_DIR
CHROMA_DIR = DATA_DIR / "chroma_db"
LOG_DIR = DATA_DIR / "logs"
TEMP_DIR = DATA_DIR / "temp_audio"
COOKIES_DIR = DATA_DIR / "user_cookies"
EXTRA_FILES_DIR = DATA_DIR / "extraa_files"
UPLOADS_DIR = _configured_path("UPLOADS_ROOT", DATA_DIR / "uploads")
MODELS_DIR = DATA_DIR / "models"
CACHE_DIR = DATA_DIR / "cache"


def ensure_runtime_directories() -> None:
    """Create only mutable runtime directories, never packaged resource folders."""
    for path in (
        DATA_DIR,
        DATABASE_DIR,
        CHROMA_DIR,
        LOG_DIR,
        TEMP_DIR,
        COOKIES_DIR,
        EXTRA_FILES_DIR,
        UPLOADS_DIR,
        MODELS_DIR,
        CACHE_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
