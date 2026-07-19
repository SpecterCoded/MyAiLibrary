import os
import subprocess
from core.paths import EXTRA_FILES_DIR


BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _resource_extra_dir(resource_id: str) -> str:
    return os.path.join(str(EXTRA_FILES_DIR), resource_id)


def generate_video_thumbnail(video_path: str, resource_id: str):
    extraa_dir = _resource_extra_dir(resource_id)
    os.makedirs(extraa_dir, exist_ok=True)

    thumbnail_path = os.path.join(extraa_dir, "thumbnail.jpg")
    if os.path.exists(thumbnail_path):
        return thumbnail_path

    result = subprocess.run(
        [
            "ffmpeg",
            "-ss",
            "00:00:01",
            "-i",
            video_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=360:-1",
            "-q:v",
            "4",
            thumbnail_path,
            "-y",
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0 or not os.path.exists(thumbnail_path):
        raise RuntimeError(result.stderr or "Failed to generate video thumbnail")

    return thumbnail_path


def extract_audio_from_video(video_path: str, resource_id: str):
    extraa_dir = _resource_extra_dir(resource_id)
    os.makedirs(extraa_dir, exist_ok=True)
    
    video_name = os.path.splitext(os.path.basename(video_path))[0]
    audio_path = os.path.join(extraa_dir, f"{video_name}.wav")

    result = subprocess.run(
        [
            "ffmpeg",
            "-i",
            video_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            audio_path,
            "-y",
        ],
        capture_output=True,
        text=True,
    )

    print("RETURN CODE:", result.returncode)
    print("STDERR:")
    print(result.stderr)

    return audio_path
