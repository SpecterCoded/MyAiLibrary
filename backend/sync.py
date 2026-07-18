import os
import threading
import time

import httpx
from dotenv import load_dotenv
from sqlalchemy.orm import Session

from models import User

load_dotenv()

ADMIN_SERVER_URL = os.environ.get("ADMIN_SERVER_URL", "").rstrip("/")
MACHINE_ID = os.environ.get("MACHINE_ID", "default")


def is_enabled() -> bool:
    return bool(ADMIN_SERVER_URL)


def push_user(user: User) -> None:
    if not is_enabled():
        return
    try:
        payload = {
            "id": user.id,
            "machine_id": MACHINE_ID,
            "username": user.username,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "email_verified": 0,
            "storage_root": user.storage_root,
        }
        r = httpx.post(
            f"{ADMIN_SERVER_URL}/api/sync/user",
            json=payload,
            timeout=10,
        )
        if r.status_code != 200:
            print(f"[SYNC] Failed to push user {user.id}: {r.status_code} {r.text[:200]}")
    except Exception as e:
        print(f"[SYNC] Push error for {user.id}: {e}")


def push_current_user(db: Session, user_id: str) -> None:
    if not is_enabled():
        return
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        push_user(user)


def _periodic_sync(stop_event: threading.Event, interval_seconds: int = 3600):
    import httpx
    while not stop_event.is_set():
        try:
            r = httpx.get(
                f"{ADMIN_SERVER_URL}/api/sync/pending-changes/{MACHINE_ID}",
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                if data.get("users"):
                    pass
        except Exception as e:
            print(f"[SYNC] Periodic check error: {e}")
        stop_event.wait(interval_seconds)


_sync_thread: threading.Thread | None = None
_stop_event = threading.Event()


def start_periodic_sync(interval_seconds: int = 3600) -> None:
    global _sync_thread, _stop_event
    if not is_enabled():
        return
    if _sync_thread and _sync_thread.is_alive():
        return
    _stop_event.clear()
    _sync_thread = threading.Thread(
        target=_periodic_sync,
        args=(_stop_event, interval_seconds),
        daemon=True,
    )
    _sync_thread.start()


def stop_periodic_sync() -> None:
    if _stop_event:
        _stop_event.set()
