import os
import subprocess
import base64
import requests
import re
import json
import hashlib
import shutil
from dotenv import load_dotenv
from services.dependency_failure_service import DependencyFailure, local_path_failure, missing_configuration

# Load environment variables
load_dotenv()

# DISABLED: Whisper API credentials - all transcription now runs through local whisper.cpp
# CHATQT_API_KEY = os.getenv("CHATQT_API_KEY")
# CHATQT_BASE_URL = os.getenv("CHATQT_BASE_URL")
# WHISPER_API_MODEL = "openai/whisper-large-v3-turbo"
LOCAL_ALIGNMENT_MODEL = os.getenv("LOCAL_WHISPER_ALIGNMENT_MODEL", "base")
LOCAL_ALIGNMENT_THREADS = max(1, int(os.getenv("LOCAL_WHISPER_ALIGNMENT_THREADS", "2") or "2"))
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(SERVICE_DIR)
EXTRAA_FILES_ROOT = os.path.join(BACKEND_ROOT, "extraa_files")


def _lookup_resource_context_from_filepath(file_path: str):
    """Best-effort lookup of resource_id/user_id from a media path."""
    from database import SessionLocal
    from models import Resource

    normalized = os.path.normpath(file_path)
    db = SessionLocal()
    try:
        resource = db.query(Resource).filter(Resource.local_path == normalized).first()
        if resource:
            return resource.id, resource.user_id

        parts = normalized.replace("\\", "/").split("/")
        for part in parts:
            if not part:
                continue
            resource = db.query(Resource).filter(Resource.id == part).first()
            if resource:
                return resource.id, resource.user_id
    except Exception as exc:
        print(f"Error resolving resource context from path: {exc}")
    finally:
        db.close()
    return None, None


def get_user_settings(
    *,
    user_id: str | None = None,
    resource_id: str | None = None,
    file_path: str | None = None,
):
    """Resolve whisper settings from explicit context first, then file-path lookup."""
    from database import SessionLocal
    from models import Resource, UserSetting

    db = SessionLocal()
    try:
        resolved_user_id = user_id

        if not resolved_user_id and resource_id:
            resource = db.query(Resource).filter(Resource.id == resource_id).first()
            if resource:
                resolved_user_id = resource.user_id

        if resolved_user_id:
            settings = db.query(UserSetting).filter(UserSetting.user_id == resolved_user_id).first()
            if settings:
                return settings.whisper_path, settings.whisper_model_path

        if file_path:
            resource_id_from_path, user_id_from_path = _lookup_resource_context_from_filepath(file_path)
            if user_id_from_path:
                settings = db.query(UserSetting).filter(UserSetting.user_id == user_id_from_path).first()
                if settings:
                    return settings.whisper_path, settings.whisper_model_path

            if resource_id_from_path:
                resource = db.query(Resource).filter(Resource.id == resource_id_from_path).first()
                if resource:
                    settings = db.query(UserSetting).filter(UserSetting.user_id == resource.user_id).first()
                    if settings:
                        return settings.whisper_path, settings.whisper_model_path
    finally:
        db.close()

    return None, None


def _resolve_transcription_output_paths(file_path: str, resource_id: str | None = None):
    resolved_resource_id = resource_id
    if not resolved_resource_id:
        resolved_resource_id, _user_id = _lookup_resource_context_from_filepath(file_path)
    source_name = os.path.splitext(os.path.basename(file_path))[0]

    if resolved_resource_id:
        output_dir = os.path.join(EXTRAA_FILES_ROOT, resolved_resource_id)
        os.makedirs(output_dir, exist_ok=True)
        base_name = os.path.join(output_dir, source_name)
    else:
        base_name = os.path.splitext(file_path)[0]
        output_dir = os.path.dirname(base_name) or "."

    return {
        "resource_id": resolved_resource_id,
        "output_dir": output_dir,
        "base_name": base_name,
        "srt_file": f"{base_name}.srt",
        "txt_file": f"{base_name}.txt",
        "meta_file": f"{base_name}.alignment.json",
    }


def _transcript_hash(transcript: str) -> str:
    return hashlib.sha1((transcript or "").strip().encode("utf-8")).hexdigest()


def _audio_signature(file_path: str) -> dict:
    try:
        stat = os.stat(file_path)
        return {
            "path": os.path.normpath(file_path),
            "size": int(stat.st_size),
            "mtime": int(stat.st_mtime),
        }
    except OSError:
        return {
            "path": os.path.normpath(file_path),
            "size": 0,
            "mtime": 0,
        }


def _load_alignment_cache(meta_file: str) -> dict | None:
    if not os.path.exists(meta_file):
        return None
    try:
        with open(meta_file, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def _save_alignment_cache(meta_file: str, payload: dict):
    with open(meta_file, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def _find_openai_whisper_cli(preferred_path: str | None = None) -> str | None:
    candidates = []
    if preferred_path:
        candidates.append(preferred_path)
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _run_openai_whisper_timestamp_pass(
    file_path: str,
    transcript_hint: str,
    output_paths: dict,
    whisper_path: str | None,
    whisper_model: str | None,
    cancel_check=None,
    status_callback=None,
):
    whisper_cli = _find_openai_whisper_cli(whisper_path)
    if not whisper_cli:
        raise RuntimeError("No local openai-whisper CLI is available")

    transcript_hash = _transcript_hash(transcript_hint)
    audio_signature = _audio_signature(file_path)
    cache = _load_alignment_cache(output_paths["meta_file"])
    if (
        cache
        and cache.get("strategy") == "openai-whisper-cli"
        and cache.get("transcript_hash") == transcript_hash
        and cache.get("audio_signature") == audio_signature
        and os.path.exists(output_paths["srt_file"])
        and os.path.exists(output_paths["txt_file"])
    ):
        with open(output_paths["txt_file"], "r", encoding="utf-8") as handle:
            cached_transcript = handle.read().strip()
        return {
            "transcript": cached_transcript or transcript_hint,
            "srt_file": output_paths["srt_file"],
            "from_cache": True,
        }

    model_name = (whisper_model or "").strip() or LOCAL_ALIGNMENT_MODEL
    if os.path.exists(model_name) or any(sep in model_name for sep in ("\\", "/")):
        raise RuntimeError("Configured whisper model looks like a legacy file path, not an openai-whisper model name")
    initial_prompt = (transcript_hint or "").strip()
    if len(initial_prompt) > 220:
        initial_prompt = initial_prompt[:220]

    if status_callback:
        try:
            status_callback("aligning_timestamps")
        except Exception:
            pass

    cmd = [
        whisper_cli,
        file_path,
        "--model",
        model_name,
        "--device",
        "cpu",
        "--task",
        "transcribe",
        "--output_dir",
        output_paths["output_dir"],
        "--output_format",
        "all",
        "--verbose",
        "False",
        "--word_timestamps",
        "True",
        "--max_words_per_line",
        "8",
        "--threads",
        str(threads),
        "--condition_on_previous_text",
        "False",
    ]
    if initial_prompt:
        cmd.extend(["--initial_prompt", initial_prompt])

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    import time
    while process.poll() is None:
        if cancel_check and cancel_check():
            process.kill()
            raise Exception("Job cancelled by user")
        time.sleep(1)

    if process.returncode != 0:
        raise RuntimeError(f"Local openai-whisper timestamp pass failed with return code {process.returncode}")

    if not os.path.exists(output_paths["srt_file"]):
        raise RuntimeError("Local openai-whisper did not produce an SRT file")

    transcript = transcript_hint
    if os.path.exists(output_paths["txt_file"]):
        with open(output_paths["txt_file"], "r", encoding="utf-8") as handle:
            transcript = handle.read().strip() or transcript_hint

    _save_alignment_cache(
        output_paths["meta_file"],
        {
            "strategy": "openai-whisper-cli",
            "model": model_name,
            "threads": LOCAL_ALIGNMENT_THREADS,
            "transcript_hash": transcript_hash,
            "audio_signature": audio_signature,
        },
    )

    return {
        "transcript": transcript,
        "srt_file": output_paths["srt_file"],
        "from_cache": False,
    }


def get_user_settings_from_filepath(file_path: str):
    """
    Looks up user settings in the SQLite database by resolving user_id or resource_id
    from the file path.
    """
    try:
        settings = get_user_settings(file_path=file_path)
        if settings != (None, None):
            return settings

        # Fallback for voice uploads whose user_id is encoded in the temp filename.
        base = os.path.basename(file_path)
        match = re.search(r"voice_([a-zA-Z0-9\-]+)_", base)
        if match:
            return get_user_settings(user_id=match.group(1))
    except Exception as e:
        print(f"Error querying user settings from path: {e}")
    return None, None


def get_media_duration(file_path: str) -> float:
    """Returns duration in seconds for a media file using ffprobe."""
    try:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return 0.0


def generate_srt_from_text(text: str, duration_seconds: float) -> str:
    """
    Generates a structured SRT subtitle file by splitting the raw text into chunks
    and distributing them evenly across the media's duration.
    """
    from services.subtitle_generation_service import generate_subtitles_from_text, build_srt_content

    # Default to 10 seconds if duration is 0
    if duration_seconds <= 0:
        duration_seconds = 10.0

    segments = generate_subtitles_from_text(text, duration_seconds)
    return build_srt_content(segments)


def detect_speech_intervals(file_path: str, duration_seconds: float) -> list[tuple[float, float]]:
    """Estimate speech intervals using ffmpeg silence detection."""
    if duration_seconds <= 0:
        duration_seconds = get_media_duration(file_path)
    if duration_seconds <= 0:
        return []

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-i",
                file_path,
                "-af",
                "silencedetect=noise=-32dB:d=0.25",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
        )
        output = f"{result.stdout}\n{result.stderr}"
        silence_starts = [float(match) for match in re.findall(r"silence_start:\s*([0-9]+(?:\.[0-9]+)?)", output)]
        silence_ends = [float(match) for match in re.findall(r"silence_end:\s*([0-9]+(?:\.[0-9]+)?)", output)]

        intervals: list[tuple[float, float]] = []
        cursor = 0.0
        for silence_start in silence_starts:
            if silence_start - cursor >= 0.15:
                intervals.append((cursor, silence_start))
        for silence_end in silence_ends:
            cursor = max(cursor, silence_end)
        # rebuild with ordered silence pairs
        intervals = []
        cursor = 0.0
        for idx, silence_start in enumerate(silence_starts):
            if silence_start - cursor >= 0.15:
                intervals.append((cursor, silence_start))
            if idx < len(silence_ends):
                cursor = max(cursor, silence_ends[idx])
        if duration_seconds - cursor >= 0.15:
            intervals.append((cursor, duration_seconds))
        return intervals
    except Exception as exc:
        print(f"Silence detection failed for {file_path}: {exc}")
        return []


def _prepare_audio_input_for_whisper(file_path: str, output_dir: str) -> tuple[str, list[str]]:
    """Convert compressed audio to PCM WAV so whisper.cpp sees a stable input stream."""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".wav":
        return file_path, []

    prepared_path = os.path.join(output_dir, "__whisper_input.wav")
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            file_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            prepared_path,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not os.path.exists(prepared_path):
        raise Exception(
            "Failed to convert audio into a whisper-compatible WAV before transcription."
        )

    return prepared_path, [prepared_path]


def _validate_whisper_dependencies(whisper_path: str, whisper_model_path: str) -> None:
    missing_fields = []
    if not whisper_path:
        missing_fields.append("Whisper executable path")
    if not whisper_model_path:
        missing_fields.append("Whisper GGML model path")
    if missing_fields:
        raise missing_configuration(
            service="Whisper",
            stage="transcribing",
            settings_section="Whisper",
            fields=missing_fields,
        )
    if not os.path.isfile(whisper_path):
        raise local_path_failure(
            code="path_not_found",
            service="Whisper",
            stage="transcribing",
            settings_section="Whisper",
            path_label="Whisper executable path",
        )
    if not os.path.isfile(whisper_model_path):
        raise local_path_failure(
            code="path_not_found",
            service="Whisper",
            stage="transcribing",
            settings_section="Whisper",
            path_label="Whisper GGML model path",
        )

def transcribe_audio(
    file_path: str,
    whisper_path: str = None,
    whisper_model_path: str = None,
    user_id: str | None = None,
    resource_id: str | None = None,
    cancel_check=None,
    status_callback=None,
    threads: int | None = None,
):
    output_paths = _resolve_transcription_output_paths(file_path, resource_id=resource_id)
    base_name = output_paths["base_name"]
    srt_file = output_paths["srt_file"]
    txt_file = output_paths["txt_file"]

    # 1. Load paths from user settings in DB (if not explicitly provided)
    if not whisper_path or not whisper_model_path:
        db_w_path, db_w_model_path = get_user_settings(
            user_id=user_id,
            resource_id=resource_id,
            file_path=file_path,
        )
        if db_w_path and not whisper_path:
            whisper_path = db_w_path
        if db_w_model_path and not whisper_model_path:
            whisper_model_path = db_w_model_path

    # 1b. Resolve thread count from user setting (0 = auto-detect)
    if threads is None:
        try:
            from database import SessionLocal
            from models import UserSetting
            db = SessionLocal()
            try:
                if user_id:
                    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
                    if settings:
                        threads = getattr(settings, "whisper_threads", 0) or 0
                else:
                    threads = 0
            finally:
                db.close()
        except Exception:
            threads = 0
    if threads <= 0:
        threads = max(1, (os.cpu_count() or 2) - 1)

    # 2. Validate — both paths must be configured
    whisper_path = (whisper_path or "").strip()
    whisper_model_path = (whisper_model_path or "").strip()
    _validate_whisper_dependencies(whisper_path, whisper_model_path)

    if not whisper_path or not whisper_model_path:
        missing = []
        if not whisper_path:
            missing.append("Whisper executable path")
        if not whisper_model_path:
            missing.append("Whisper GGML model path")
        raise Exception(
            f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} not configured. "
            "Please set them in Settings → AI tab."
        )

    # 3. Validate — paths must exist on disk
    if not os.path.exists(whisper_path):
        raise Exception(
            f"Whisper executable not found at: '{whisper_path}'. "
            "Please check your Settings → AI tab."
        )
    if not os.path.exists(whisper_model_path):
        raise Exception(
            f"Whisper GGML model not found at: '{whisper_model_path}'. "
            "Please check your Settings → AI tab."
        )

    # 4. Run whisper.cpp
    print(f"[WHISPER.CPP] Executable: {whisper_path}")
    print(f"[WHISPER.CPP] Model:      {whisper_model_path}")
    print(f"[WHISPER.CPP] Input:      {file_path}")
    print(f"[WHISPER.CPP] Output:     {base_name}")

    if status_callback:
        try:
            status_callback("transcribing")
        except Exception:
            pass

    import time
    transcription_input_path, _cleanup_paths = _prepare_audio_input_for_whisper(
        file_path,
        output_paths["output_dir"],
    )
    process = subprocess.Popen(
        [
            whisper_path,
            "-m", whisper_model_path,
            "-f", transcription_input_path,
            "-osrt",          # generate SRT file
            "-otxt",          # generate TXT file
            "--output-file", base_name,
            "--threads", str(threads),
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    while process.poll() is None:
        if cancel_check and cancel_check():
            process.kill()
            raise Exception("Job cancelled by user")
        time.sleep(1)

    if process.returncode != 0:
        raise DependencyFailure(
            code="transcription_failed",
            service="Whisper",
            stage="transcribing",
            settings_section="Whisper",
        )
        raise Exception(
            f"whisper.cpp process exited with code {process.returncode}. "
            "Check that the executable and model paths are correct in Settings → AI tab."
        )

    for cleanup_path in _cleanup_paths:
        try:
            if os.path.exists(cleanup_path):
                os.remove(cleanup_path)
        except Exception:
            pass

    # 5. Read outputs
    transcript = ""
    if os.path.exists(txt_file):
        with open(txt_file, "r", encoding="utf-8") as f:
            transcript = f.read()

    if not os.path.exists(srt_file):
        raise DependencyFailure(
            code="transcription_failed",
            service="Whisper",
            stage="transcribing",
            settings_section="Whisper",
        )
        raise Exception(
            "whisper.cpp did not produce an SRT file. "
            "Transcription may have failed silently — check that the input audio is valid."
        )

    print("[WHISPER.CPP] Transcription complete.")
    return {
        "transcript": transcript,
        "srt_file": srt_file,
    }
