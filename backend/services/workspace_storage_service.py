import json
import os
import shutil
import tempfile
from pathlib import Path
from uuid import uuid4

from models import StoragePath
from sqlalchemy import text

WORKSPACE_MARKER_NAME = ".myailibrary-workspace.json"


class WorkspaceStorageError(ValueError):
    def __init__(self, detail: str, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


def migrate_storage_paths_schema(conn, inspector) -> None:
    """Add workspace ownership metadata without changing existing user data."""
    if "storage_paths" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE storage_paths ("
            "id TEXT PRIMARY KEY, "
            "name TEXT NOT NULL, "
            "path TEXT NOT NULL, "
            "user_id TEXT NOT NULL, "
            "is_default INTEGER NOT NULL DEFAULT 0, "
            "is_app_managed INTEGER NOT NULL DEFAULT 0, "
            "deletion_pending INTEGER NOT NULL DEFAULT 0"
            ")"
        ))
        return

    existing_columns = {column["name"] for column in inspector.get_columns("storage_paths")}
    added_default_flag = "is_default" not in existing_columns
    if added_default_flag:
        conn.execute(text(
            "ALTER TABLE storage_paths ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0"
        ))
    if "is_app_managed" not in existing_columns:
        conn.execute(text(
            "ALTER TABLE storage_paths ADD COLUMN is_app_managed INTEGER NOT NULL DEFAULT 0"
        ))
    if "deletion_pending" not in existing_columns:
        conn.execute(text(
            "ALTER TABLE storage_paths ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0"
        ))
    if added_default_flag:
        # Older releases registered onboarding before any Settings workspaces.
        # Protect the first registration for each account as its default.
        conn.execute(text(
            "UPDATE storage_paths SET is_default = 1 "
            "WHERE rowid IN (SELECT MIN(rowid) FROM storage_paths GROUP BY user_id)"
        ))


def canonicalize_workspace_path(raw_path: str) -> str:
    path = (raw_path or "").strip()
    if not path:
        raise WorkspaceStorageError("Workspace directory path is required.")
    if "\x00" in path:
        raise WorkspaceStorageError("Workspace directory path is invalid.")

    expanded = os.path.expandvars(os.path.expanduser(path))
    return os.path.normpath(os.path.realpath(os.path.abspath(expanded)))


def workspace_path_key(raw_path: str) -> str:
    return os.path.normcase(canonicalize_workspace_path(raw_path))


def _verify_directory_is_writable(path: str) -> None:
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".myailibrary-write-check-",
            dir=path,
            delete=True,
        ):
            pass
    except OSError as exc:
        raise WorkspaceStorageError(
            f"My AI Library cannot write to this workspace directory: {exc}",
            status_code=400,
        ) from exc


def _write_workspace_marker(path: str, storage_path_id: str) -> None:
    marker_path = Path(path) / WORKSPACE_MARKER_NAME
    marker_path.write_text(
        json.dumps(
            {
                "format": 1,
                "storage_path_id": storage_path_id,
                "managed_by": "MyAiLibrary",
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def register_workspace_path(
    db,
    current_user,
    name: str,
    raw_path: str,
    *,
    is_default: bool = False,
) -> StoragePath:
    workspace_name = (name or "").strip()
    if not workspace_name:
        raise WorkspaceStorageError("Workspace name is required.")

    canonical_path = canonicalize_workspace_path(raw_path)
    candidate_key = workspace_path_key(canonical_path)

    # Compare canonical path identities instead of raw strings so retries using
    # different slash/case/dot forms remain idempotent on Windows.
    existing_paths = db.query(StoragePath).all()
    existing_default = next(
        (
            existing
            for existing in existing_paths
            if existing.user_id == current_user.id and bool(existing.is_default)
        ),
        None,
    )
    for existing in existing_paths:
        try:
            existing_key = workspace_path_key(existing.path)
        except WorkspaceStorageError:
            continue
        if existing_key != candidate_key:
            continue
        if existing.user_id == current_user.id:
            if is_default and not bool(existing.is_default):
                if existing_default and existing_default.id != existing.id:
                    raise WorkspaceStorageError(
                        "A default workspace is already registered for this account.",
                        status_code=409,
                    )
                existing.is_default = 1
                db.commit()
                db.refresh(existing)
            return existing
        raise WorkspaceStorageError(
            "This workspace directory is already registered to another account on this device.",
            status_code=409,
        )

    if is_default and existing_default:
        raise WorkspaceStorageError(
            "A default workspace is already registered for this account.",
            status_code=409,
        )

    created_directory = False
    storage_path_id = str(uuid4())
    marker_written = False
    try:
        if os.path.exists(canonical_path):
            if not os.path.isdir(canonical_path):
                raise WorkspaceStorageError(
                    "The selected workspace path points to a file. Please choose a directory."
                )
        else:
            os.makedirs(canonical_path, exist_ok=False)
            created_directory = True

        _verify_directory_is_writable(canonical_path)

        if created_directory:
            _write_workspace_marker(canonical_path, storage_path_id)
            marker_written = True

        storage_path = StoragePath(
            id=storage_path_id,
            name=workspace_name,
            path=canonical_path,
            user_id=current_user.id,
            is_default=1 if is_default else 0,
            is_app_managed=1 if created_directory else 0,
            deletion_pending=0,
        )
        db.add(storage_path)
        db.commit()
        db.refresh(storage_path)
        return storage_path
    except WorkspaceStorageError:
        db.rollback()
        if marker_written:
            try:
                (Path(canonical_path) / WORKSPACE_MARKER_NAME).unlink()
            except OSError:
                pass
        if created_directory:
            try:
                os.rmdir(canonical_path)
            except OSError:
                pass
        raise
    except OSError as exc:
        db.rollback()
        if marker_written:
            try:
                (Path(canonical_path) / WORKSPACE_MARKER_NAME).unlink()
            except OSError:
                pass
        if created_directory:
            try:
                os.rmdir(canonical_path)
            except OSError:
                pass
        raise WorkspaceStorageError(
            f"Failed to prepare workspace directory: {exc}",
            status_code=400,
        ) from exc
    except Exception as exc:
        db.rollback()
        if marker_written:
            try:
                (Path(canonical_path) / WORKSPACE_MARKER_NAME).unlink()
            except OSError:
                pass
        if created_directory:
            try:
                os.rmdir(canonical_path)
            except OSError:
                pass
        raise WorkspaceStorageError(
            "Failed to register the workspace directory.",
            status_code=500,
        ) from exc


def remove_workspace_directory(storage_path: StoragePath, tracked_directories: list[str]) -> None:
    canonical_root = Path(canonicalize_workspace_path(storage_path.path))
    if not canonical_root.exists():
        return
    if not canonical_root.is_dir():
        raise WorkspaceStorageError(
            "The registered workspace path is no longer a directory.",
            status_code=409,
        )

    if bool(storage_path.is_app_managed):
        marker_path = canonical_root / WORKSPACE_MARKER_NAME
        try:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise WorkspaceStorageError(
                "Workspace ownership could not be verified, so its root folder was not deleted.",
                status_code=409,
            ) from exc
        if marker.get("storage_path_id") != storage_path.id:
            raise WorkspaceStorageError(
                "Workspace ownership marker does not match this workspace.",
                status_code=409,
            )

        resolved_home = Path.home().resolve()
        resolved_root = canonical_root.resolve()
        if resolved_root == Path(resolved_root.anchor) or resolved_root == resolved_home:
            raise WorkspaceStorageError(
                "Refusing to delete an unsafe workspace root.",
                status_code=409,
            )
        shutil.rmtree(resolved_root)
        return

    # Adopted folders can contain unrelated user files. Remove only empty,
    # tracked directories beneath the workspace and never recurse through the
    # selected root.
    root_key = workspace_path_key(str(canonical_root))
    candidates: list[Path] = []
    for directory in tracked_directories:
        candidate = Path(canonicalize_workspace_path(directory))
        try:
            common_path = os.path.commonpath(
                [workspace_path_key(str(canonical_root)), workspace_path_key(str(candidate))]
            )
        except (OSError, ValueError):
            continue
        if common_path != root_key:
            continue
        if workspace_path_key(str(candidate)) == root_key:
            continue
        candidates.append(candidate)

    for candidate in sorted(candidates, key=lambda item: len(item.parts), reverse=True):
        try:
            candidate.rmdir()
        except OSError:
            pass
