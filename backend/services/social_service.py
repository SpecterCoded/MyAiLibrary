import os
import shutil
import subprocess
import mimetypes
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from uuid import uuid4

from database import SessionLocal
from models import Folder, Resource, DownloadTask, User
from services.resource_service import create_resource
from services.resource_service import compute_file_content_hash
from repositories.resource_repository import DuplicateResourceError, find_duplicate_resource_by_hash, save_resource
from core.paths import COOKIES_DIR

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(SERVICE_DIR)
USER_COOKIES_ROOT = str(COOKIES_DIR)
SOCIAL_COOKIE_PLATFORMS = {"twitter", "instagram"}


def _safe_cookie_owner(user_id: str | None) -> str | None:
    if not user_id:
        return None
    safe_id = "".join(ch if ch.isalnum() or ch in "_.-" else "_" for ch in str(user_id)).strip("._-")
    return safe_id or None


def _normalize_social_platform(platform: str | None) -> str | None:
    normalized = (platform or "").strip().lower()
    if normalized in {"x", "x.com"}:
        normalized = "twitter"
    return normalized if normalized in SOCIAL_COOKIE_PLATFORMS else None


def get_social_cookie_path(user_id: str | None, platform: str | None) -> str | None:
    safe_id = _safe_cookie_owner(user_id)
    normalized = _normalize_social_platform(platform)
    if not safe_id or not normalized:
        return None
    return os.path.join(USER_COOKIES_ROOT, normalized, safe_id, "cookies.txt")


def has_saved_social_cookies(user_id: str | None, platform: str | None) -> bool:
    cookie_path = get_social_cookie_path(user_id, platform)
    return bool(cookie_path and os.path.isfile(cookie_path) and os.path.getsize(cookie_path) > 0)


def save_social_cookies(user_id: str | None, platform: str | None, cookies_content: str | None) -> bool:
    if not cookies_content or not str(cookies_content).strip():
        return False

    cookie_path = get_social_cookie_path(user_id, platform)
    if not cookie_path:
        return False

    os.makedirs(os.path.dirname(cookie_path), exist_ok=True)
    with open(cookie_path, "w", encoding="utf-8", newline="") as cookie_file:
        cookie_file.write(cookies_content)
    try:
        os.chmod(cookie_path, 0o600)
    except Exception:
        pass
    return True


def update_task_progress(task_id: str, progress: int, status: str = None):
    """Safely update progress or status of a download task using a new session."""
    db = SessionLocal()
    try:
        task = db.query(DownloadTask).filter(DownloadTask.id == task_id).first()
        if task:
            task.progress = progress
            if status:
                task.status = status
            task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
    except Exception as e:
        print(f"[SOCIAL SERVICE] Failed to update task progress: {e}")
    finally:
        db.close()


def download_social_profile(task_id: str, url: str, folder_id: str, db_session: Session, current_user: User):
    """
    Downloads profile media from Twitter/Instagram using gallery-dl.
    Registers downloaded files as resources in My AI Library under the username's folder.
    """
    from main import _get_folder_path
    
    subfolder = db_session.query(Folder).filter(Folder.id == folder_id, Folder.user_id == current_user.id).first()
    if not subfolder:
        raise Exception("Subfolder not found for social media import")

    out_dir = _get_folder_path(subfolder, db_session, current_user)
    os.makedirs(out_dir, exist_ok=True)
    
    update_task_progress(task_id, 10, "processing")

    task = db_session.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    saved_cookies_path = get_social_cookie_path(current_user.id, getattr(task, "task_type", None))
    legacy_cookies_path = os.path.join(out_dir, "cookies.txt")
    cookies_path = saved_cookies_path if saved_cookies_path and os.path.exists(saved_cookies_path) else legacy_cookies_path
    
    cmd = [
        "gallery-dl",
        "-o", f"extractor.base-directory={out_dir}",
        "-o", "extractor.directory=[]"
    ]
    
    if os.path.exists(cookies_path):
        cmd.extend(["-C", cookies_path])
        print("[SOCIAL SERVICE] Using saved cookies.txt")
    else:
        print("[SOCIAL SERVICE] WARNING: No saved cookies.txt found. Attempting download without authentication (public content only).")

    cmd.append(url)

    try:
        update_task_progress(task_id, 30, "processing")
        files_before = set(f for f in os.listdir(out_dir) if f != "cookies.txt")
        
        print("[SOCIAL SERVICE] Executing gallery-dl command")
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
        
        if result.returncode != 0:
            print(f"[GALLERY-DL ERROR] Exit code: {result.returncode}")
            print(f"[GALLERY-DL STDERR] {result.stderr}")
            print(f"[GALLERY-DL STDOUT] {result.stdout}")
        
        files_after = set(f for f in os.listdir(out_dir) if f != "cookies.txt")
        new_files = files_after - files_before
        if new_files:
            print(f"[SOCIAL SERVICE] Download complete. {len(new_files)} new file(s) downloaded.")
        else:
            print("[SOCIAL SERVICE] Download finished but no new files were detected.")
    except Exception as e:
        print(f"[SOCIAL SERVICE] Download failed: {e}")


    update_task_progress(task_id, 92)

    registered_count = 0
    for entry in os.scandir(out_dir):
        if entry.is_file():
            file_path = entry.path
            file_name = entry.name
            
            # Skip hidden or temporary system files
            if file_name.startswith('.'):
                continue
                
            # Check if this file path is already in resources table under this folder
            existing_res = db_session.query(Resource).filter(
                Resource.local_path == file_path,
                Resource.folder_id == folder_id,
                Resource.user_id == current_user.id
            ).first()
            
            if not existing_res:
                mime_type, _ = mimetypes.guess_type(file_path)
                res_type = "video"
                if mime_type:
                    if mime_type.startswith("image/"):
                        res_type = "image"
                    elif mime_type.startswith("audio/"):
                        res_type = "audio"
                
                file_size = entry.stat().st_size
                content_hash = compute_file_content_hash(file_path)
                duplicate = find_duplicate_resource_by_hash(
                    db_session,
                    user_id=current_user.id,
                    content_hash=content_hash,
                    folder_id=folder_id,
                )
                if duplicate:
                    continue
                
                resource = create_resource(
                    folder_id=folder_id,
                    file_name=file_name,
                    file_path=file_path,
                    resource_type=res_type,
                    content_length=file_size,
                    user_id=current_user.id,
                    content_hash=content_hash,
                )
                
                # Mark as uploaded so user can manually process later if desired
                resource.processing_status = "uploaded"
                
                # For images, local path acts as a working thumbnail path
                if res_type == "image":
                    resource.thumbnail_path = file_path
                
                try:
                    saved = save_resource(db_session, resource)
                except DuplicateResourceError:
                    continue
                
                registered_count += 1
                
    db_session.commit()
    
    # Update the title of DownloadTask to show registered count
    task = db_session.query(DownloadTask).filter(DownloadTask.id == task_id).first()
    if task:
        task.file_name = f"Imported {registered_count} media files from {task.username}"
        db_session.commit()
        
    update_task_progress(task_id, 100, "completed")
    return {"registered_resources_count": registered_count}
