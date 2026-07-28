import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sqlalchemy
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from models import Base, StoragePath, User
from services.workspace_storage_service import (
    WORKSPACE_MARKER_NAME,
    WorkspaceStorageError,
    migrate_storage_paths_schema,
    register_workspace_path,
    remove_workspace_directory,
)


class WorkspaceStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory(prefix="myailibrary-workspace-")
        database_path = Path(self.temp_directory.name) / "workspace-tests.db"
        self.engine = create_engine(
            f"sqlite:///{database_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.user = User(
            id="workspace-user",
            username="WorkspaceUser",
            email="workspace@example.com",
            password_hash="unused",
        )
        self.db.add(self.user)
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp_directory.cleanup()

    def test_registers_existing_directory_without_touching_its_files(self):
        workspace = Path(self.temp_directory.name) / "existing"
        workspace.mkdir()
        sentinel = workspace / "keep-me.txt"
        sentinel.write_text("preserve this", encoding="utf-8")

        registered = register_workspace_path(
            self.db,
            self.user,
            "Existing workspace",
            str(workspace),
        )

        self.assertEqual(Path(registered.path), workspace.resolve())
        self.assertFalse(bool(registered.is_app_managed))
        self.assertFalse((workspace / WORKSPACE_MARKER_NAME).exists())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "preserve this")
        self.assertEqual(self.db.query(StoragePath).count(), 1)

    def test_creates_missing_directory_and_persists_registration(self):
        workspace = Path(self.temp_directory.name) / "new" / "workspace"

        registered = register_workspace_path(
            self.db,
            self.user,
            "New workspace",
            str(workspace),
        )

        self.assertTrue(workspace.is_dir())
        self.assertTrue(bool(registered.is_app_managed))
        marker = json.loads((workspace / WORKSPACE_MARKER_NAME).read_text(encoding="utf-8"))
        self.assertEqual(marker["storage_path_id"], registered.id)
        registered_id = registered.id
        self.db.close()
        self.db = self.Session()
        persisted = self.db.query(StoragePath).filter(StoragePath.id == registered_id).one()
        self.assertEqual(Path(persisted.path), workspace.resolve())

    def test_normalized_duplicate_retry_returns_existing_record(self):
        workspace = Path(self.temp_directory.name) / "duplicate"
        workspace.mkdir()
        first = register_workspace_path(self.db, self.user, "First", str(workspace))
        equivalent = workspace / ".." / workspace.name

        second = register_workspace_path(self.db, self.user, "Retry", str(equivalent))

        self.assertEqual(second.id, first.id)
        self.assertEqual(second.name, "First")
        self.assertEqual(self.db.query(StoragePath).count(), 1)

        if os.name == "nt":
            third = register_workspace_path(
                self.db,
                self.user,
                "Case retry",
                str(workspace).swapcase(),
            )
            self.assertEqual(third.id, first.id)
            self.assertEqual(self.db.query(StoragePath).count(), 1)

    def test_rejects_a_path_that_points_to_a_file(self):
        target = Path(self.temp_directory.name) / "not-a-directory"
        target.write_text("file", encoding="utf-8")

        with self.assertRaisesRegex(WorkspaceStorageError, "points to a file"):
            register_workspace_path(self.db, self.user, "Invalid", str(target))

        self.assertEqual(self.db.query(StoragePath).count(), 0)
        self.assertEqual(target.read_text(encoding="utf-8"), "file")

    def test_rejects_directory_when_write_probe_fails(self):
        workspace = Path(self.temp_directory.name) / "read-only"
        workspace.mkdir()

        with patch(
            "services.workspace_storage_service.tempfile.NamedTemporaryFile",
            side_effect=PermissionError("access denied"),
        ):
            with self.assertRaisesRegex(WorkspaceStorageError, "cannot write"):
                register_workspace_path(self.db, self.user, "Read only", str(workspace))

        self.assertEqual(self.db.query(StoragePath).count(), 0)
        self.assertTrue(workspace.is_dir())

    def test_prevents_cross_account_registration_of_same_directory(self):
        workspace = Path(self.temp_directory.name) / "private"
        workspace.mkdir()
        first = register_workspace_path(self.db, self.user, "Private", str(workspace))
        other_user = User(
            id="other-user",
            username="OtherUser",
            email="other@example.com",
            password_hash="unused",
        )
        self.db.add(other_user)
        self.db.commit()

        with self.assertRaises(WorkspaceStorageError) as raised:
            register_workspace_path(self.db, other_user, "Other", str(workspace))

        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.db.query(StoragePath).count(), 1)
        self.assertEqual(self.db.query(StoragePath).one().id, first.id)

    def test_marks_only_the_onboarding_workspace_as_default(self):
        default_root = Path(self.temp_directory.name) / "default"
        secondary_root = Path(self.temp_directory.name) / "secondary"

        default = register_workspace_path(
            self.db,
            self.user,
            "Default",
            str(default_root),
            is_default=True,
        )
        secondary = register_workspace_path(
            self.db,
            self.user,
            "Secondary",
            str(secondary_root),
        )

        self.assertTrue(bool(default.is_default))
        self.assertFalse(bool(secondary.is_default))
        with self.assertRaisesRegex(WorkspaceStorageError, "default workspace"):
            register_workspace_path(
                self.db,
                self.user,
                "Another default",
                str(Path(self.temp_directory.name) / "another-default"),
                is_default=True,
            )

    def test_removes_an_app_created_workspace_only_with_matching_marker(self):
        workspace = Path(self.temp_directory.name) / "managed"
        registered = register_workspace_path(
            self.db,
            self.user,
            "Managed",
            str(workspace),
        )
        (workspace / "generated.txt").write_text("generated", encoding="utf-8")

        remove_workspace_directory(registered, [])

        self.assertFalse(workspace.exists())

    def test_refuses_managed_root_removal_when_marker_does_not_match(self):
        workspace = Path(self.temp_directory.name) / "managed-mismatch"
        registered = register_workspace_path(
            self.db,
            self.user,
            "Managed",
            str(workspace),
        )
        marker_path = workspace / WORKSPACE_MARKER_NAME
        marker = json.loads(marker_path.read_text(encoding="utf-8"))
        marker["storage_path_id"] = "different-workspace"
        marker_path.write_text(json.dumps(marker), encoding="utf-8")

        with self.assertRaisesRegex(WorkspaceStorageError, "does not match"):
            remove_workspace_directory(registered, [])

        self.assertTrue(workspace.is_dir())

    def test_adopted_workspace_preserves_root_and_unrelated_files(self):
        workspace = Path(self.temp_directory.name) / "adopted"
        tracked = workspace / "My AI Library" / "Generated"
        unrelated = workspace / "personal"
        tracked.mkdir(parents=True)
        unrelated.mkdir(parents=True)
        sentinel = workspace / "keep-me.txt"
        sentinel.write_text("personal", encoding="utf-8")
        (unrelated / "photo.txt").write_text("personal", encoding="utf-8")
        registered = register_workspace_path(
            self.db,
            self.user,
            "Adopted",
            str(workspace),
        )

        remove_workspace_directory(
            registered,
            [str(tracked), str(tracked.parent), str(workspace), str(workspace.parent)],
        )

        self.assertTrue(workspace.is_dir())
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "personal")
        self.assertTrue((unrelated / "photo.txt").is_file())
        self.assertFalse(tracked.exists())
        self.assertFalse(tracked.parent.exists())

    def test_migrates_existing_registrations_and_protects_first_per_user(self):
        migration_database = Path(self.temp_directory.name) / "legacy-storage.db"
        migration_engine = create_engine(f"sqlite:///{migration_database.as_posix()}")
        with migration_engine.begin() as connection:
            connection.execute(text(
                "CREATE TABLE storage_paths ("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, user_id TEXT NOT NULL)"
            ))
            connection.execute(text(
                "INSERT INTO storage_paths (id, name, path, user_id) VALUES "
                "('first-a', 'Default A', 'A:/default', 'user-a'), "
                "('second-a', 'Secondary A', 'A:/secondary', 'user-a'), "
                "('first-b', 'Default B', 'B:/default', 'user-b')"
            ))

        inspector = sqlalchemy.inspect(migration_engine)
        with migration_engine.begin() as connection:
            migrate_storage_paths_schema(connection, inspector)

        with migration_engine.connect() as connection:
            rows = connection.execute(text(
                "SELECT id, is_default, is_app_managed, deletion_pending "
                "FROM storage_paths ORDER BY id"
            )).mappings().all()
        migration_engine.dispose()

        by_id = {row["id"]: row for row in rows}
        self.assertEqual(by_id["first-a"]["is_default"], 1)
        self.assertEqual(by_id["first-b"]["is_default"], 1)
        self.assertEqual(by_id["second-a"]["is_default"], 0)
        self.assertTrue(all(row["is_app_managed"] == 0 for row in rows))
        self.assertTrue(all(row["deletion_pending"] == 0 for row in rows))


if __name__ == "__main__":
    unittest.main()
