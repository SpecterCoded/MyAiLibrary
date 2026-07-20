"""Offline maintenance commands used by the trusted Electron main process."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


_SAFE_VERSION = re.compile(r"[^0-9A-Za-z._-]+")


def _safe_version(value: str) -> str:
    cleaned = _SAFE_VERSION.sub("-", value).strip("-.")
    return cleaned[:80] or "unknown"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _contained(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def _copy_configuration(data_dir: Path, destination: Path) -> list[Path]:
    source = data_dir / "config"
    if not source.is_dir():
        return []
    copied: list[Path] = []
    for item in source.rglob("*"):
        if not item.is_file() or item.is_symlink() or item.name.endswith(".tmp"):
            continue
        relative = item.relative_to(source)
        target = destination / "config" / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied.append(target)
    return copied


def _backup_sqlite(database_path: Path, destination: Path) -> Path | None:
    if not database_path.is_file():
        return None
    target = destination / "database" / "library.db"
    target.parent.mkdir(parents=True, exist_ok=True)
    source_connection = sqlite3.connect(str(database_path), timeout=30)
    destination_connection = sqlite3.connect(str(target))
    try:
        source_connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        source_connection.backup(destination_connection)
        result = destination_connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {result[0] if result else 'no result'}")
    finally:
        destination_connection.close()
        source_connection.close()
    return target


def _prune_verified_backups(backups_root: Path, keep: int = 3) -> None:
    verified: list[tuple[float, Path]] = []
    for child in backups_root.iterdir():
        manifest = child / "manifest.json"
        if child.is_dir() and manifest.is_file() and not child.name.startswith(".pending-"):
            verified.append((manifest.stat().st_mtime, child))
    for _, old_backup in sorted(verified, reverse=True)[keep:]:
        if _contained(old_backup, backups_root):
            shutil.rmtree(old_backup)


def create_pre_update_backup(data_dir: Path, current_version: str, target_version: str) -> Path:
    data_dir = data_dir.expanduser().resolve()
    backups_root = (data_dir / "backups" / "pre-update").resolve()
    backups_root.mkdir(parents=True, exist_ok=True)
    database_path = data_dir / "database" / "library.db"
    config_dir = data_dir / "config"
    estimated_size = database_path.stat().st_size if database_path.is_file() else 0
    if config_dir.is_dir():
        estimated_size += sum(item.stat().st_size for item in config_dir.rglob("*") if item.is_file())
    required_free = max(estimated_size * 2, 64 * 1024 * 1024)
    if shutil.disk_usage(backups_root).free < required_free:
        raise RuntimeError("Not enough free disk space to create a verified pre-update backup.")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    name = f"{timestamp}_{_safe_version(current_version)}-to-{_safe_version(target_version)}"
    final_directory = backups_root / name
    pending_directory = backups_root / f".pending-{name}-{os.getpid()}"
    pending_directory.mkdir(parents=False, exist_ok=False)
    try:
        files: list[Path] = []
        database_backup = _backup_sqlite(database_path, pending_directory)
        if database_backup:
            files.append(database_backup)
        files.extend(_copy_configuration(data_dir, pending_directory))
        manifest_files = [
            {
                "path": file.relative_to(pending_directory).as_posix(),
                "size": file.stat().st_size,
                "sha256": _sha256(file),
            }
            for file in files
        ]
        manifest = {
            "formatVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "currentVersion": current_version,
            "targetVersion": target_version,
            "backupDirectory": str(final_directory),
            "databasePresent": database_backup is not None,
            "chromaDirectoryPreserved": str(data_dir / "chroma_db"),
            "files": manifest_files,
        }
        manifest_path = pending_directory / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        os.replace(pending_directory, final_directory)
        final_manifest = final_directory / "manifest.json"
        # Only a completed directory with a readable manifest is eligible for retention.
        json.loads(final_manifest.read_text(encoding="utf-8"))
        _prune_verified_backups(backups_root)
        return final_manifest
    except Exception:
        if pending_directory.exists() and _contained(pending_directory, backups_root):
            shutil.rmtree(pending_directory, ignore_errors=True)
        raise
