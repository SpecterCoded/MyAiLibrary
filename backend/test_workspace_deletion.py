import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from main import delete_storage_path
from models import DownloadTask, Folder, Note, Playlist, StoragePath, User
from services.workspace_storage_service import WorkspaceStorageError


class WorkspaceDeletionTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory(prefix="myailibrary-delete-")
        database_path = Path(self.temp_directory.name) / "workspace-deletion.db"
        self.engine = create_engine(
            f"sqlite:///{database_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.default_root = Path(self.temp_directory.name) / "default"
        self.secondary_root = Path(self.temp_directory.name) / "secondary"
        self.default_root.mkdir()
        self.secondary_root.mkdir()
        self.sentinel = self.secondary_root / "personal.txt"
        self.sentinel.write_text("preserve", encoding="utf-8")
        self.user = User(
            id="delete-user",
            username="DeleteUser",
            email="delete@example.com",
            password_hash="unused",
            storage_root=str(self.secondary_root),
            active_storage_path_id="secondary-workspace",
        )
        self.default = StoragePath(
            id="default-workspace",
            name="Default",
            path=str(self.default_root),
            user_id=self.user.id,
            is_default=1,
            is_app_managed=0,
            deletion_pending=0,
        )
        self.secondary = StoragePath(
            id="secondary-workspace",
            name="Secondary",
            path=str(self.secondary_root),
            user_id=self.user.id,
            is_default=0,
            is_app_managed=0,
            deletion_pending=0,
        )
        self.workspace_playlist = Playlist(
            id="secondary-playlist",
            name="Workspace playlist",
            user_id=self.user.id,
            storage_root=str(self.secondary_root),
        )
        self.workspace_folder = Folder(
            id="secondary-folder",
            name="Generated folder",
            playlist_id=self.workspace_playlist.id,
            user_id=self.user.id,
            storage_root=str(self.secondary_root),
        )
        self.workspace_note = Note(
            id="secondary-note",
            title="Workspace note",
            content="workspace data",
            note_type="text",
            folder_id=self.workspace_folder.id,
            user_id=self.user.id,
            filename="workspace-note.md",
        )
        self.workspace_download = DownloadTask(
            id="secondary-download",
            url="https://example.com/media",
            folder_id=self.workspace_folder.id,
            playlist_id=self.workspace_playlist.id,
            user_id=self.user.id,
        )
        self.default_playlist = Playlist(
            id="default-playlist",
            name="Default playlist",
            user_id=self.user.id,
            storage_root=str(self.default_root),
        )
        self.db.add_all([
            self.user,
            self.default,
            self.secondary,
            self.workspace_playlist,
            self.workspace_folder,
            self.workspace_note,
            self.workspace_download,
            self.default_playlist,
        ])
        self.db.commit()
        self.generated_directory = (
            self.secondary_root
            / self.user.username
            / self.workspace_playlist.name
            / self.workspace_folder.name
        )
        self.generated_directory.mkdir(parents=True)
        self.note_file = self.generated_directory / self.workspace_note.filename
        self.note_file.write_text("# Workspace note", encoding="utf-8")

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        self.temp_directory.cleanup()

    def test_active_secondary_deletion_switches_to_default_and_preserves_adopted_root(self):
        secondary_id = self.secondary.id
        playlist_id = self.workspace_playlist.id
        folder_id = self.workspace_folder.id
        note_id = self.workspace_note.id
        download_id = self.workspace_download.id
        default_playlist_id = self.default_playlist.id
        with (
            patch("main.delete_workspace_collection"),
            patch("main._notify_explorer_changed") as notify,
        ):
            result = delete_storage_path(
                secondary_id,
                confirm=True,
                db=self.db,
                current_user=self.user,
            )

        self.assertTrue(result["switched_to_default"])
        self.assertEqual(Path(result["active_path"]), self.default_root)
        self.assertIsNone(
            self.db.query(StoragePath).filter(StoragePath.id == secondary_id).first()
        )
        self.assertIsNone(
            self.db.query(Playlist).filter(Playlist.id == playlist_id).first()
        )
        self.assertIsNone(
            self.db.query(Folder).filter(Folder.id == folder_id).first()
        )
        self.assertIsNone(
            self.db.query(Note).filter(Note.id == note_id).first()
        )
        self.assertIsNone(
            self.db.query(DownloadTask).filter(
                DownloadTask.id == download_id
            ).first()
        )
        self.assertIsNotNone(
            self.db.query(Playlist).filter(Playlist.id == default_playlist_id).first()
        )
        persisted_user = self.db.query(User).filter(User.id == self.user.id).one()
        self.assertEqual(persisted_user.active_storage_path_id, self.default.id)
        self.assertEqual(Path(persisted_user.storage_root), self.default_root)
        self.assertEqual(self.sentinel.read_text(encoding="utf-8"), "preserve")
        self.assertFalse(self.note_file.exists())
        self.assertFalse(self.generated_directory.exists())
        notify.assert_called_once()

    def test_default_workspace_deletion_is_forbidden(self):
        with self.assertRaises(HTTPException) as raised:
            delete_storage_path(
                self.default.id,
                confirm=True,
                db=self.db,
                current_user=self.user,
            )

        self.assertEqual(raised.exception.status_code, 403)
        self.assertIsNotNone(
            self.db.query(StoragePath).filter(StoragePath.id == self.default.id).first()
        )

    def test_deletion_requires_explicit_confirmation(self):
        with self.assertRaises(HTTPException) as raised:
            delete_storage_path(
                self.secondary.id,
                confirm=False,
                db=self.db,
                current_user=self.user,
            )

        self.assertEqual(raised.exception.status_code, 400)

    def test_failed_physical_cleanup_leaves_workspace_locked_for_retry(self):
        with (
            patch("main.delete_workspace_collection"),
            patch(
                "main.remove_workspace_directory",
                side_effect=WorkspaceStorageError("Folder is busy.", status_code=409),
            ),
        ):
            with self.assertRaises(HTTPException) as raised:
                delete_storage_path(
                    self.secondary.id,
                    confirm=True,
                    db=self.db,
                    current_user=self.user,
                )

        self.assertEqual(raised.exception.status_code, 500)
        remaining = self.db.query(StoragePath).filter(
            StoragePath.id == self.secondary.id
        ).one()
        self.assertTrue(bool(remaining.deletion_pending))
        self.assertEqual(self.sentinel.read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
