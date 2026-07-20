"""PyInstaller/desktop entry point for the local FastAPI service."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import threading
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="My AI Library desktop backend")
    parser.add_argument("--port", type=int)
    parser.add_argument("--token")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--ui-dir", default="")
    parser.add_argument("--ffmpeg-dir", default="")
    parser.add_argument("--maintenance-backup", action="store_true")
    parser.add_argument("--current-version", default="unknown")
    parser.add_argument("--target-version", default="unknown")
    args = parser.parse_args()
    if not args.maintenance_backup and (args.port is None or not args.token):
        parser.error("--port and --token are required when starting the desktop backend")
    return args


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

    if args.maintenance_backup:
        from desktop_maintenance import create_pre_update_backup

        manifest_path = create_pre_update_backup(data_dir, args.current_version, args.target_version)
        print(json.dumps({"manifestPath": str(manifest_path)}), flush=True)
        return

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

    # Recover an interrupted/failed schema migration before importing any module
    # that opens the active SQLite database.
    from core.schema_migrations import recover_interrupted_schema_migration

    recover_interrupted_schema_migration(data_dir)

    import uvicorn
    from desktop_runtime import configure_desktop_app
    from main import app

    recovery_report = data_dir / "logs" / "migration-recovery.json"
    if recovery_report.is_file():
        recovery_report.unlink()

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
