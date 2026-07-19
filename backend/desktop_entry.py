"""PyInstaller/desktop entry point for the local FastAPI service."""

from __future__ import annotations

import argparse
import os
import secrets
import threading
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="My AI Library desktop backend")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--ui-dir", default="")
    parser.add_argument("--ffmpeg-dir", default="")
    return parser.parse_args()


def ensure_jwt_secret(data_dir: Path) -> str:
    secret_dir = data_dir / "secrets"
    secret_dir.mkdir(parents=True, exist_ok=True)
    secret_file = secret_dir / "jwt-secret"
    if secret_file.is_file():
        value = secret_file.read_text(encoding="utf-8").strip()
        if len(value) >= 32:
            return value

    value = secrets.token_urlsafe(64)
    temp_file = secret_file.with_suffix(".tmp")
    temp_file.write_text(value, encoding="utf-8")
    os.replace(temp_file, secret_file)
    try:
        os.chmod(secret_file, 0o600)
    except OSError:
        pass
    return value


def main() -> None:
    args = parse_args()
    data_dir = Path(args.data_dir).expanduser().resolve()
    data_dir.mkdir(parents=True, exist_ok=True)

    os.environ["MYAI_DESKTOP_MODE"] = "1"
    os.environ["MYAI_DESKTOP_PORT"] = str(args.port)
    os.environ["MYAI_DESKTOP_TOKEN"] = args.token
    os.environ["MYAI_DATA_DIR"] = str(data_dir)
    os.environ["UPLOADS_ROOT"] = str(data_dir / "uploads")
    os.environ["JWT_SECRET_KEY"] = ensure_jwt_secret(data_dir)
    if args.ui_dir:
        os.environ["MYAI_UI_DIR"] = str(Path(args.ui_dir).expanduser().resolve())
    if args.ffmpeg_dir:
        ffmpeg_dir = str(Path(args.ffmpeg_dir).expanduser().resolve())
        os.environ["MYAI_FFMPEG_DIR"] = ffmpeg_dir
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

    # Legacy relative paths are deliberately rooted in the mutable desktop data directory.
    os.chdir(data_dir)

    import uvicorn
    from desktop_runtime import configure_desktop_app
    from main import app

    shutdown_event = configure_desktop_app(app)
    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=args.port,
            log_level="info",
            access_log=False,
        )
    )

    def watch_for_shutdown() -> None:
        shutdown_event.wait()
        server.should_exit = True

    threading.Thread(target=watch_for_shutdown, name="desktop-shutdown", daemon=True).start()
    server.run()


if __name__ == "__main__":
    main()
