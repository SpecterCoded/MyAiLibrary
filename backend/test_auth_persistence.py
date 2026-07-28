import tempfile
import unittest
from pathlib import Path

from desktop_entry import ensure_jwt_secret


class DesktopAuthPersistenceTests(unittest.TestCase):
    def test_jwt_secret_survives_backend_restarts(self):
        with tempfile.TemporaryDirectory(prefix="myailibrary-auth-") as directory:
            data_dir = Path(directory)

            first = ensure_jwt_secret(data_dir)
            second = ensure_jwt_secret(data_dir)

            self.assertGreaterEqual(len(first), 32)
            self.assertEqual(second, first)
            self.assertEqual(
                (data_dir / "secrets" / "jwt-secret").read_text(encoding="utf-8").strip(),
                first,
            )

    def test_invalid_existing_secret_is_replaced_once(self):
        with tempfile.TemporaryDirectory(prefix="myailibrary-auth-") as directory:
            data_dir = Path(directory)
            secret_file = data_dir / "secrets" / "jwt-secret"
            secret_file.parent.mkdir(parents=True)
            secret_file.write_text("too-short", encoding="utf-8")

            replacement = ensure_jwt_secret(data_dir)

            self.assertGreaterEqual(len(replacement), 32)
            self.assertNotEqual(replacement, "too-short")
            self.assertEqual(ensure_jwt_secret(data_dir), replacement)


if __name__ == "__main__":
    unittest.main()
