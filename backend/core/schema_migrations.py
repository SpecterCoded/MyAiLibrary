"""Versioned SQLite migration safety for desktop and web startup."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.engine import Engine


LEGACY_SCHEMA_VERSION = "0001_legacy_schema"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _backup_root(database_path: Path) -> Path:
    data_root = database_path.parent.parent if database_path.parent.name == "database" else database_path.parent
    return data_root / "backups" / "pre-migration"


def _pending_marker(database_path: Path) -> Path:
    return _backup_root(database_path) / "pending.json"


def _create_database_backup(database_path: Path, version: str) -> Path:
    root = _backup_root(database_path)
    root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    backup_path = root / f"{timestamp}_{version}.db"
    source = sqlite3.connect(str(database_path), timeout=30)
    destination = sqlite3.connect(str(backup_path))
    try:
        source.backup(destination)
        result = destination.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Pre-migration database backup failed its integrity check.")
    finally:
        destination.close()
        source.close()
    marker = {
        "formatVersion": 1,
        "migrationVersion": version,
        "databasePath": str(database_path.resolve()),
        "backupPath": str(backup_path.resolve()),
        "backupSha256": _sha256(backup_path),
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    marker_path = _pending_marker(database_path)
    temporary_marker = marker_path.with_suffix(".tmp")
    temporary_marker.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary_marker, marker_path)
    return marker_path


def prepare_schema_migration(engine: Engine, database_path: Path, version: str) -> bool:
    with engine.connect() as connection:
        has_ledger = connection.execute(text(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'"
        )).scalar()
        applied = has_ledger and connection.execute(
            text("SELECT 1 FROM schema_migrations WHERE version = :version"),
            {"version": version},
        ).scalar()
    if applied:
        return False
    _create_database_backup(database_path, version)
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            "version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
        ))
    return True


class _ReadOnlyMigrationConnection:
    """Discard legacy idempotent statements after their migration is recorded."""

    def execute(self, *_args, **_kwargs):
        return None

    def commit(self) -> None:
        return None


@contextmanager
def schema_migration_connection(engine: Engine, should_apply: bool) -> Iterator[object]:
    if not should_apply:
        yield _ReadOnlyMigrationConnection()
        return
    with engine.connect() as connection:
        yield connection


def complete_schema_migration(engine: Engine, database_path: Path, version: str) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (:version, :applied_at)"),
            {"version": version, "applied_at": datetime.now(timezone.utc).isoformat()},
        )
    marker = _pending_marker(database_path)
    if marker.is_file():
        marker.unlink()


def recover_interrupted_schema_migration(data_dir: Path) -> bool:
    data_dir = data_dir.expanduser().resolve()
    marker_path = data_dir / "backups" / "pre-migration" / "pending.json"
    if not marker_path.is_file():
        return False
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    database_path = Path(marker["databasePath"]).resolve()
    backup_path = Path(marker["backupPath"]).resolve()
    expected_database = (data_dir / "database" / "library.db").resolve()
    if database_path != expected_database or not backup_path.is_file():
        raise RuntimeError("Migration recovery marker is invalid; existing data was not changed.")
    if _sha256(backup_path) != marker.get("backupSha256"):
        raise RuntimeError("Migration recovery backup failed verification; existing data was not changed.")
    connection = sqlite3.connect(str(backup_path))
    try:
        result = connection.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("Migration recovery backup failed integrity checking.")
    finally:
        connection.close()

    failed_root = data_dir / "backups" / "failed-migrations"
    failed_root.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    for suffix in ("", "-wal", "-shm"):
        current = Path(str(database_path) + suffix)
        if current.exists():
            shutil.move(str(current), str(failed_root / f"library-{timestamp}.db{suffix}"))
    restore_temp = database_path.with_suffix(".restore.tmp")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(backup_path, restore_temp)
    os.replace(restore_temp, database_path)
    marker_path.unlink()
    previous_version = None
    pre_update_root = data_dir / "backups" / "pre-update"
    if pre_update_root.is_dir():
        manifests = sorted(pre_update_root.glob("*/manifest.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        if manifests:
            try:
                previous_version = json.loads(manifests[0].read_text(encoding="utf-8")).get("currentVersion")
            except (OSError, ValueError):
                previous_version = None
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "recoveredAt": datetime.now(timezone.utc).isoformat(),
        "migrationVersion": marker.get("migrationVersion"),
        "previousVersion": previous_version,
        "failedFilesDirectory": str(failed_root),
    }
    report_temp = logs_dir / "migration-recovery.tmp"
    report_path = logs_dir / "migration-recovery.json"
    report_temp.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    os.replace(report_temp, report_path)
    return True
