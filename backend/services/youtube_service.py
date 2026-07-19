import os
import re
import subprocess
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from models import Folder, Playlist, Resource, User
from core.config import UPLOADS_ROOT, get_upload_path
from repositories.resource_repository import DuplicateResourceError, find_duplicate_resource_by_hash
from services.resource_service import create_resource
from services.resource_service import compute_external_content_hash, compute_file_content_hash
from repositories.resource_repository import save_resource
from services.queue_service import create_processing_job
from core.paths import COOKIES_DIR, EXTRA_FILES_DIR

SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(SERVICE_DIR)
EXTRAA_FILES_ROOT = str(EXTRA_FILES_DIR)
USER_COOKIES_ROOT = str(COOKIES_DIR)
YOUTUBE_COOKIES_ROOT = os.path.join(USER_COOKIES_ROOT, "youtube")

# ... (rest of the existing functions)


def _safe_cookie_owner(user_id: str | None) -> str | None:
    if not user_id:
        return None
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", str(user_id)).strip("._-")
    return safe_id or None


def get_youtube_cookie_path(user_id: str | None) -> str | None:
    safe_id = _safe_cookie_owner(user_id)
    if not safe_id:
        return None
    return os.path.join(YOUTUBE_COOKIES_ROOT, safe_id, "cookies.txt")


def has_saved_youtube_cookies(user_id: str | None) -> bool:
    cookie_path = get_youtube_cookie_path(user_id)
    return bool(cookie_path and os.path.isfile(cookie_path) and os.path.getsize(cookie_path) > 0)


def save_youtube_cookies(user_id: str | None, cookies_content: str | None) -> bool:
    if not cookies_content or not str(cookies_content).strip():
        return False

    cookie_path = get_youtube_cookie_path(user_id)
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


def _ydl_opts_with_saved_cookies(user_id: str | None = None, **opts):
    cookie_path = get_youtube_cookie_path(user_id)
    if cookie_path and os.path.isfile(cookie_path):
        opts["cookiefile"] = cookie_path
    return opts

def create_youtube(url: str, folder_id: str, db: Session, current_user: User, playlist_id: str = None, quality: str = "best"):
    """
    Downloads, registers, and queues a YouTube video for processing.
    Only checks the physical file at the chosen path — same video can be
    imported into multiple playlists/folders freely.
    """

    # ── 1. Validate URL ───────────────────────────────────────────────────────
    vid = extract_video_id(url)
    if not vid:
        return {"error": "Invalid YouTube URL"}

    # ── 2. Fetch metadata (title / thumbnail) — no download yet ──────────────
    title = url
    thumbnail = ""
    try:
        with yt_dlp.YoutubeDL(_ydl_opts_with_saved_cookies(current_user.id, quiet=True)) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get("title") or title
            thumbnail = info.get("thumbnail") or ""
    except Exception:
        pass

    # ── 3. Resolve the target output directory ────────────────────────────────
    out_dir = UPLOADS_ROOT
    if folder_id:
        from main import _get_owned_folder, _get_folder_path
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        out_dir = _get_folder_path(folder, db, current_user)
    elif playlist_id:
        playlist = (
            db.query(Playlist)
            .filter(Playlist.id == playlist_id, Playlist.user_id == current_user.id)
            .first()
        )
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")

        root_folder = (
            db.query(Folder)
            .filter(
                Folder.name == "root",
                Folder.playlist_id == playlist_id,
                Folder.user_id == current_user.id,
            )
            .first()
        )
        if not root_folder:
            root_folder = Folder(
                id=str(uuid4()),
                name="root",
                playlist_id=playlist_id,
                user_id=current_user.id,
                storage_root=current_user.storage_root,
            )
            db.add(root_folder)
            db.commit()
            db.refresh(root_folder)

        folder_id = root_folder.id
        out_dir = get_upload_path(
            current_user.username,
            playlist.name,
            custom_root=current_user.storage_root,
        )
    else:
        out_dir = get_upload_path(current_user.username, custom_root=current_user.storage_root)

    os.makedirs(out_dir, exist_ok=True)

    # ── 4. Compute expected file path in the chosen folder ────────────────────
    safe_title = _sanitize_filename(title if title != url else vid)
    expected_path = os.path.join(out_dir, f"{safe_title}-{vid}.mp4")

    # ── 5. Check ONLY the chosen path — skip download if file is already there ─
    if os.path.exists(expected_path):
        local_file = expected_path
    else:
        # ── 6. Download into the chosen path ──────────────────────────────────
        local_file = None
        try:
            local_file = download_youtube_video(url, out_dir=out_dir, user_id=current_user.id, quality=quality)
        except Exception:
            local_file = None

    # ── 8. Create & persist resource record ───────────────────────────────────
    resource = create_resource(
        folder_id=folder_id,
        file_name=title or vid,
        file_path=local_file or url,
        resource_type="youtube",
        content_length=0,
        user_id=current_user.id,
        content_hash=compute_file_content_hash(local_file) if local_file and os.path.exists(local_file) else compute_external_content_hash(vid or url),
    )

    resource.description = url           # preserve URL for transcript pipeline
    resource.thumbnail_path = thumbnail or ""

    duplicate = find_duplicate_resource_by_hash(
        db,
        user_id=current_user.id,
        content_hash=resource.content_hash,
        folder_id=resource.folder_id,
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate resource blocked. This content already exists as '{duplicate.title or 'existing resource'}'.",
        )

    try:
        saved = save_resource(db, resource)
    except DuplicateResourceError as exc:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate resource blocked. This content already exists as '{exc.existing_resource.title or 'existing resource'}'.",
        )

    # ── 9. Queue for AI processing pipeline ───────────────────────────────────
    # Skip processing for default folders (Media, Resources, Notes) — files stay raw
    resource_folder = db.query(Folder).filter(Folder.id == saved.folder_id).first()
    is_in_default_folder = False
    if resource_folder:
        curr = resource_folder
        while curr:
            if curr.name in ("Media", "Resources", "resources", "Notes", "notes"):
                is_in_default_folder = True
                break
            if not curr.parent_id:
                break
            curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()

    if is_in_default_folder:
        saved.processing_status = "uploaded"
        db.commit()
    else:
        create_processing_job(db, saved.id)

    db.commit()
    db.refresh(saved)

    try:
        from main import _notify_explorer_changed
        _notify_explorer_changed()
    except Exception:
        pass

    return {"resource": saved}


def get_youtube_transcript(video_id: str):
    # Return list of segments with start/duration/text
    try:
        segments = YouTubeTranscriptApi().get_transcript(video_id)
        return segments
    except Exception:
        # fallback to fetch for older versions
        segments = YouTubeTranscriptApi().fetch(video_id)
        return segments


def extract_video_id(url: str):

    parsed = urlparse(url)

    if parsed.hostname == "youtu.be":
        return parsed.path[1:]

    if parsed.hostname in (
        "www.youtube.com",
        "youtube.com",
    ):
        return parse_qs(parsed.query).get("v", [None])[0]

    return None


def download_youtube_audio(url: str, resource_id: str, user_id: str | None = None):
    """Download audio and save the WAV in extraa_files/{resource_id}/."""
    extraa_dir = os.path.join(EXTRAA_FILES_ROOT, resource_id)
    os.makedirs(extraa_dir, exist_ok=True)
    
    # Step 1: Download as best audio
    temp_output_template = os.path.join(extraa_dir, "%(id)s.%(ext)s")

    ydl_opts = _ydl_opts_with_saved_cookies(
        user_id,
        format="bestaudio/best",
        outtmpl=temp_output_template,
        quiet=True,
    )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        downloaded_file = ydl.prepare_filename(info)

    # Step 2: Convert to WAV format
    base_name = os.path.splitext(downloaded_file)[0]
    wav_file = f"{base_name}.wav"

    # Convert using ffmpeg
    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        downloaded_file,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wav_file,
    ]

    try:
        subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True)
        
        # Step 3: Remove the original file
        if os.path.exists(downloaded_file) and downloaded_file != wav_file:
            os.remove(downloaded_file)

        return wav_file

    except subprocess.CalledProcessError as e:
        print(f"FFmpeg conversion failed: {e.stderr}")
        return downloaded_file


def get_youtube_content(
    url: str,
    resource_id: str,
    *,
    user_id: str | None = None,
    cancel_check=None,
    status_callback=None,
):

    video_id = extract_video_id(url)

    if not video_id:
        raise Exception("Invalid YouTube URL")
    # Try to extract metadata (title/thumbnail) without downloading
    metadata = {}
    try:
        with yt_dlp.YoutubeDL(_ydl_opts_with_saved_cookies(user_id, quiet=True)) as ydl:
            info = ydl.extract_info(url, download=False)
            metadata["title"] = info.get("title")
            metadata["thumbnail"] = info.get("thumbnail")
    except Exception:
        metadata["title"] = None
        metadata["thumbnail"] = None

    def _segment_value(segment, key, default=None):
        if isinstance(segment, dict):
            return segment.get(key, default)
        return getattr(segment, key, default)

    try:
        print("TRYING YOUTUBE TRANSCRIPT")

        segments = get_youtube_transcript(video_id)

        # Build plain transcript text
        text = " ".join(
            str(_segment_value(item, "text", "")).strip() for item in segments
        ).strip()

        output_dir = os.path.join(EXTRAA_FILES_ROOT, resource_id)
        os.makedirs(output_dir, exist_ok=True)
        safe_base_name = _sanitize_filename(metadata.get("title") or video_id or resource_id)
        srt_path = os.path.join(output_dir, f"{safe_base_name}.srt")
        txt_path = os.path.join(output_dir, f"{safe_base_name}.txt")

        from services.subtitle_generation_service import generate_subtitles_from_segments, build_srt_content
        
        try:
            standard_segments = []
            for seg in segments:
                standard_segments.append({
                    "text": str(_segment_value(seg, "text", "")).replace("\n", " "),
                    "start": float(_segment_value(seg, "start", 0)),
                    "duration": float(_segment_value(seg, "duration", 0))
                })
                
            subtitle_segments = generate_subtitles_from_segments(standard_segments)
            srt_content = build_srt_content(subtitle_segments)
            
            with open(srt_path, "w", encoding="utf-8") as sf:
                sf.write(srt_content)
            with open(txt_path, "w", encoding="utf-8") as tf:
                tf.write(text)
        except Exception as ex:
            print(f"Error writing SRT: {ex}")
            srt_path = None

        return {
            "transcript": text,
            "srt_file": srt_path,
            "audio_path": None,
            "title": metadata.get("title"),
            "thumbnail": metadata.get("thumbnail"),
        }

    except Exception as e:
        print("================================")
        print("YOUTUBE TRANSCRIPT FAILED")
        print("ERROR TYPE:", type(e).__name__)
        print("ERROR:", str(e))
        print("================================")

        print("FALLING BACK TO WHISPER")

        audio_path = download_youtube_audio(url, resource_id, user_id=user_id)

        from services.transcription_service import transcribe_audio

        result = transcribe_audio(
            audio_path,
            user_id=user_id,
            resource_id=resource_id,
            cancel_check=cancel_check,
            status_callback=status_callback,
        )
        # transcribe_audio returns dict with transcript and srt_file
        result["audio_path"] = audio_path
        result["title"] = metadata.get("title")
        result["thumbnail"] = metadata.get("thumbnail")

        return result


def _sanitize_filename(value: str) -> str:
    if not value:
        return "youtube_video"
    if value.startswith(("http://", "https://")):
        extracted_video_id = extract_video_id(value)
        if extracted_video_id:
            return extracted_video_id
        return "youtube_video"
    sanitized = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value)
    sanitized = sanitized.strip().strip(". ")
    return sanitized or "youtube_video"


from core.config import UPLOADS_ROOT

def download_youtube_video(url: str, out_dir: str = UPLOADS_ROOT, user_id: str | None = None, quality: str = "best"):
    """Download the full YouTube video into `out_dir` and return the local file path."""
    # Map quality selection to yt-dlp format strings
    quality_map = {
        "best": "bestvideo[ext=mp4]/bestvideo/best",
        "1080": "bestvideo[height<=1080][ext=mp4]/bestvideo[height<=1080]/bestvideo/best",
        "720": "bestvideo[height<=720][ext=mp4]/bestvideo[height<=720]/bestvideo/best",
        "480": "bestvideo[height<=480][ext=mp4]/bestvideo[height<=480]/bestvideo/best",
        "360": "bestvideo[height<=360][ext=mp4]/bestvideo[height<=360]/bestvideo/best",
        "audio_only": None,  # Special case: download audio only
    }
    video_format = quality_map.get(quality, quality_map["best"])

    os.makedirs(out_dir, exist_ok=True)

    video_id = extract_video_id(url) or "youtube_video"
    title = None

    try:
        with yt_dlp.YoutubeDL(_ydl_opts_with_saved_cookies(user_id, quiet=True)) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get("title")
    except Exception:
        title = None

    safe_title = _sanitize_filename(title or video_id)
    final_output_path = os.path.join(out_dir, f"{safe_title}-{video_id}.mp4")

    if os.path.exists(final_output_path):
        return final_output_path

    video_template = os.path.join(out_dir, f"{video_id}.video.%(ext)s")
    audio_template = os.path.join(out_dir, f"{video_id}.audio.%(ext)s")

    with yt_dlp.YoutubeDL(
        _ydl_opts_with_saved_cookies(
            user_id,
            format=video_format,
            outtmpl=video_template,
            quiet=True,
        )
    ) as ydl:
        video_info = ydl.extract_info(url, download=True)
        video_file = ydl.prepare_filename(video_info)

    with yt_dlp.YoutubeDL(
        _ydl_opts_with_saved_cookies(
            user_id,
            format="bestaudio[ext=m4a]/bestaudio/best",
            outtmpl=audio_template,
            quiet=True,
        )
    ) as ydl:
        audio_info = ydl.extract_info(url, download=True)
        audio_file = ydl.prepare_filename(audio_info)

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-i",
        video_file,
        "-i",
        audio_file,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        final_output_path,
    ]

    try:
        subprocess.run(ffmpeg_cmd, check=True, capture_output=True, text=True)
    except subprocess.CalledProcessError as e:
        print("ERROR merging audio/video:", e.stderr)
        if os.path.exists(final_output_path):
            return final_output_path
        return video_file

    try:
        if os.path.exists(video_file):
            os.remove(video_file)
        if os.path.exists(audio_file):
            os.remove(audio_file)
    except Exception:
        pass

    return final_output_path
