"""Media-aware chunking for audio and video resources."""

from __future__ import annotations

import glob
import os
import re
from dataclasses import dataclass

from core.logger import get_logger
from core.paths import EXTRA_FILES_DIR, TEMP_DIR
from models import Chapter, SubChapter

from .chunking_models import ChunkPayload
from .srt_parser import parse_srt
from .token_budget_service import DEFAULT_CHUNK_TOKEN_BUDGET, estimate_tokens

logger = get_logger("MEDIA_CHUNKING")
SERVICE_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_ROOT = os.path.dirname(SERVICE_DIR)
EXTRAA_FILES_ROOT = str(EXTRA_FILES_DIR)

MEDIA_MAX_CHUNK_CHARS = int(os.getenv("MEDIA_MAX_CHUNK_CHARS", "1200"))
MEDIA_MAX_CHUNK_SECONDS = int(os.getenv("MEDIA_MAX_CHUNK_SECONDS", "75"))
MEDIA_MIN_CHUNK_SECONDS = int(os.getenv("MEDIA_MIN_CHUNK_SECONDS", "20"))
MEDIA_MIN_CHUNK_CHARS = int(os.getenv("MEDIA_MIN_CHUNK_CHARS", "220"))
MEDIA_PAUSE_GAP_SECONDS = float(os.getenv("MEDIA_PAUSE_GAP_SECONDS", "4.0"))
MEDIA_TOPIC_SHIFT_THRESHOLD = float(os.getenv("MEDIA_TOPIC_SHIFT_THRESHOLD", "0.08"))
MEDIA_MAX_CHUNK_TOKENS = int(os.getenv("MEDIA_MAX_CHUNK_TOKENS", str(DEFAULT_CHUNK_TOKEN_BUDGET)))
MEDIA_MIN_CHUNK_TOKENS = int(os.getenv("MEDIA_MIN_CHUNK_TOKENS", "60"))
MEDIA_SEMANTIC_TOPIC_SHIFT = os.getenv("MEDIA_SEMANTIC_TOPIC_SHIFT", "false").lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class TimeRange:
    """Absolute media range used to annotate chunk membership."""

    start: float
    end: float
    identifier: str
    title: str = ""


def chunk_media_resource(
    resource_id: str,
    transcript: str,
    db,
    *,
    max_chunk_chars: int = MEDIA_MAX_CHUNK_CHARS,
    max_chunk_seconds: int = MEDIA_MAX_CHUNK_SECONDS,
    min_chunk_seconds: int = MEDIA_MIN_CHUNK_SECONDS,
    min_chunk_chars: int = MEDIA_MIN_CHUNK_CHARS,
    pause_gap_seconds: float = MEDIA_PAUSE_GAP_SECONDS,
    topic_shift_threshold: float = MEDIA_TOPIC_SHIFT_THRESHOLD,
    max_chunk_tokens: int = MEDIA_MAX_CHUNK_TOKENS,
    min_chunk_tokens: int = MEDIA_MIN_CHUNK_TOKENS,
) -> list[ChunkPayload]:
    """Create time-aware chunks for audio/video using SRT segments and chapter structure."""

    segments = _load_segments(resource_id)
    if not segments:
        return []

    chapters, subchapters = _load_structure(resource_id, db)
    return chunk_media_segments(
        segments,
        transcript=transcript,
        chapters=chapters,
        subchapters=subchapters,
        max_chunk_chars=max_chunk_chars,
        max_chunk_seconds=max_chunk_seconds,
        min_chunk_seconds=min_chunk_seconds,
        min_chunk_chars=min_chunk_chars,
        pause_gap_seconds=pause_gap_seconds,
        topic_shift_threshold=topic_shift_threshold,
        max_chunk_tokens=max_chunk_tokens,
        min_chunk_tokens=min_chunk_tokens,
    )


def chunk_media_segments(
    segments: list[dict],
    *,
    transcript: str = "",
    chapters: list[TimeRange] | None = None,
    subchapters: list[TimeRange] | None = None,
    max_chunk_chars: int = MEDIA_MAX_CHUNK_CHARS,
    max_chunk_seconds: int = MEDIA_MAX_CHUNK_SECONDS,
    min_chunk_seconds: int = MEDIA_MIN_CHUNK_SECONDS,
    min_chunk_chars: int = MEDIA_MIN_CHUNK_CHARS,
    pause_gap_seconds: float = MEDIA_PAUSE_GAP_SECONDS,
    topic_shift_threshold: float = MEDIA_TOPIC_SHIFT_THRESHOLD,
    max_chunk_tokens: int = MEDIA_MAX_CHUNK_TOKENS,
    min_chunk_tokens: int = MEDIA_MIN_CHUNK_TOKENS,
) -> list[ChunkPayload]:
    """Group timed subtitle segments into coherent media chunks."""

    cleaned_segments = [_normalize_segment(segment) for segment in segments]
    cleaned_segments = [segment for segment in cleaned_segments if segment and segment["text"]]
    if not cleaned_segments:
        return []

    annotated = [
        {
            **segment,
            "chapter": _find_range(segment["start"], chapters or []),
            "subchapter": _find_range(segment["start"], subchapters or []),
        }
        for segment in cleaned_segments
    ]

    chunks: list[ChunkPayload] = []
    current: list[dict] = []

    for segment in annotated:
        if not current:
            current = [segment]
            continue

        if _should_start_new_chunk(
            current=current,
            incoming=segment,
            max_chunk_chars=max_chunk_chars,
            max_chunk_seconds=max_chunk_seconds,
            min_chunk_seconds=min_chunk_seconds,
            min_chunk_chars=min_chunk_chars,
            pause_gap_seconds=pause_gap_seconds,
            topic_shift_threshold=topic_shift_threshold,
            max_chunk_tokens=max_chunk_tokens,
            min_chunk_tokens=min_chunk_tokens,
        ):
            payload = _build_chunk_payload(current)
            if payload:
                chunks.append(payload)
            current = [segment]
        else:
            current.append(segment)

    if current:
        payload = _build_chunk_payload(current)
        if payload:
            chunks.append(payload)

    if not chunks and transcript.strip():
        return [ChunkPayload(content=transcript.strip(), metadata={"media_chunking_strategy": "transcript_fallback"})]

    logger.info(f"Media chunks created: {len(chunks)} from {len(cleaned_segments)} segments")
    return chunks


def _load_segments(resource_id: str) -> list[dict]:
    srt_files = glob.glob(os.path.join(EXTRAA_FILES_ROOT, resource_id, "*.srt"))
    if not srt_files:
        srt_files = glob.glob(os.path.join(str(TEMP_DIR), "*.srt"))
    if not srt_files:
        return []
    try:
        return parse_srt(srt_files[0])
    except Exception as exc:
        logger.warning(f"Failed to parse SRT for {resource_id}: {exc}")
        return []


def _load_structure(resource_id: str, db) -> tuple[list[TimeRange], list[TimeRange]]:
    chapters = [
        TimeRange(
            start=float(chapter.start_time or 0.0),
            end=float(chapter.end_time or chapter.start_time or 0.0),
            identifier=chapter.id,
            title=chapter.title or "",
        )
        for chapter in db.query(Chapter).filter(Chapter.resource_id == resource_id).all()
    ]
    chapter_ids = [chapter.identifier for chapter in chapters]
    subchapter_rows = []
    if chapter_ids:
        subchapter_rows = db.query(SubChapter).filter(SubChapter.chapter_id.in_(chapter_ids)).all()
    chapter_map = {chapter.identifier: chapter for chapter in chapters}
    subchapters = []
    for row in subchapter_rows:
        parent = chapter_map.get(row.chapter_id)
        if not parent:
            continue
        subchapters.append(
            TimeRange(
                start=parent.start + float(row.start_time or 0.0),
                end=parent.start + float(row.end_time or row.start_time or 0.0),
                identifier=row.id,
                title=row.title or "",
            )
        )
    return chapters, subchapters


def _normalize_segment(segment: dict) -> dict | None:
    text = re.sub(r"\s+", " ", str(segment.get("text") or "")).strip()
    if not text:
        return None
    speaker = str(segment.get("speaker") or "").strip()
    speaker_match = re.match(r"^(?P<speaker>[A-Z][A-Za-z0-9 _-]{1,40}|Speaker\s+\d+):\s+(?P<text>.+)$", text)
    if speaker_match:
        if not speaker:
            speaker = speaker_match.group("speaker").strip()
        text = speaker_match.group("text").strip()
    start = float(segment.get("start") or 0.0)
    end = float(segment.get("end") or start)
    if end < start:
        end = start
    return {"start": start, "end": end, "text": text, "speaker": speaker}


def _find_range(timestamp: float, ranges: list[TimeRange]) -> TimeRange | None:
    for item in ranges:
        if item.start <= timestamp <= item.end:
            return item
    return None


def _should_start_new_chunk(
    *,
    current: list[dict],
    incoming: dict,
    max_chunk_chars: int,
    max_chunk_seconds: int,
    min_chunk_seconds: int,
    min_chunk_chars: int,
    pause_gap_seconds: float,
    topic_shift_threshold: float,
    max_chunk_tokens: int,
    min_chunk_tokens: int,
) -> bool:
    current_text = " ".join(item["text"] for item in current)
    current_duration = current[-1]["end"] - current[0]["start"]
    incoming_gap = max(0.0, incoming["start"] - current[-1]["end"])
    combined_chars = len(current_text) + len(incoming["text"]) + 1
    combined_duration = incoming["end"] - current[0]["start"]
    combined_tokens = estimate_tokens(f"{current_text} {incoming['text']}")
    current_tokens = estimate_tokens(current_text)

    chapter_changed = _range_id(current[-1].get("chapter")) != _range_id(incoming.get("chapter"))
    subchapter_changed = _range_id(current[-1].get("subchapter")) != _range_id(incoming.get("subchapter"))
    speaker_changed = _speaker_key(current[-1].get("speaker")) != _speaker_key(incoming.get("speaker"))
    time_limit = combined_duration > max_chunk_seconds
    char_limit = combined_chars > max_chunk_chars
    token_limit = combined_tokens > max_chunk_tokens
    pause_boundary = incoming_gap >= pause_gap_seconds and (
        current_duration >= min_chunk_seconds or len(current_text) >= min_chunk_chars or current_tokens >= min_chunk_tokens
    )
    # --- Additive: semantic topic shift detection (default OFF) ---
    if MEDIA_SEMANTIC_TOPIC_SHIFT:
        _sim = _semantic_similarity(current_text, incoming["text"])
        topic_shift = _sim < topic_shift_threshold
    else:
        topic_shift = _lexical_overlap(current_text, incoming["text"]) < topic_shift_threshold
    # --- End semantic topic shift ---
    semantic_boundary = topic_shift and (
        current_duration >= min_chunk_seconds or len(current_text) >= min_chunk_chars or current_tokens >= min_chunk_tokens
    )
    speaker_boundary = speaker_changed and bool(incoming.get("speaker")) and (
        current_duration >= min_chunk_seconds or current_tokens >= min_chunk_tokens
    )

    return (
        chapter_changed or subchapter_changed or speaker_boundary or
        time_limit or char_limit or token_limit or pause_boundary or semantic_boundary
    )


def _build_chunk_payload(segments: list[dict]) -> ChunkPayload | None:
    texts = []
    seen = set()
    for segment in segments:
        normalized = segment["text"].strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            texts.append(segment["text"].strip())
    content = " ".join(texts).strip()
    if not content:
        return None

    first = segments[0]
    last = segments[-1]
    chapter = first.get("chapter")
    subchapter = first.get("subchapter")
    metadata = {
        "start_time": first["start"],
        "end_time": last["end"],
        "duration_seconds": max(0.0, last["end"] - first["start"]),
        "segment_count": len(segments),
        "media_chunking_strategy": "timed_segments",
        "estimated_tokens": estimate_tokens(content),
    }
    speakers = [segment.get("speaker") for segment in segments if segment.get("speaker")]
    if speakers:
        unique_speakers = list(dict.fromkeys(speakers))
        metadata["speakers"] = unique_speakers
        metadata["speaker_count"] = len(unique_speakers)
        metadata["speaker_label"] = unique_speakers[0] if len(unique_speakers) == 1 else "multiple"
    if chapter:
        metadata["chapter_id"] = chapter.identifier
        metadata["chapter_title"] = chapter.title
    if subchapter:
        metadata["subchapter_id"] = subchapter.identifier
        metadata["subchapter_title"] = subchapter.title
    return ChunkPayload(content=content, metadata=metadata)


def _range_id(item: TimeRange | None) -> str | None:
    return item.identifier if item else None


def _lexical_overlap(left: str, right: str) -> float:
    left_tokens = set(re.findall(r"\b\w+\b", left.lower()))
    right_tokens = set(re.findall(r"\b\w+\b", right.lower()))
    if not left_tokens or not right_tokens:
        return 1.0
    shared = left_tokens.intersection(right_tokens)
    total = left_tokens.union(right_tokens)
    return len(shared) / max(1, len(total))


def _speaker_key(value: str | None) -> str:
    return (value or "").strip().lower()


# --- Additive: semantic similarity (opt-in via MEDIA_SEMANTIC_TOPIC_SHIFT) ---
_semantic_model = None
_semantic_model_failed = False


def _get_semantic_model():
    """Lazy-load a small local sentence model for similarity detection."""
    global _semantic_model, _semantic_model_failed
    if _semantic_model is not None:
        return _semantic_model
    if _semantic_model_failed:
        return None
    try:
        import contextlib
        from sentence_transformers import SentenceTransformer
        with open(os.devnull, "w") as devnull:
            with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                _semantic_model = SentenceTransformer("all-MiniLM-L6-v2")
        return _semantic_model
    except Exception:
        _semantic_model_failed = True
        return None


def _semantic_similarity(text_a: str, text_b: str) -> float:
    """Compute cosine similarity between two text blocks using sentence embeddings.

    Returns a value between 0.0 (completely different) and 1.0 (identical).
    Falls back to lexical overlap if the model is unavailable.
    """
    model = _get_semantic_model()
    if model is None:
        return _lexical_overlap(text_a, text_b)

    try:
        import numpy as np
        emb_a = model.encode(text_a[:2000], show_progress_bar=False)
        emb_b = model.encode(text_b[:2000], show_progress_bar=False)
        denom = float(np.linalg.norm(emb_a) * np.linalg.norm(emb_b))
        if denom == 0:
            return 0.0
        return float(np.dot(emb_a, emb_b) / denom)
    except Exception:
        return _lexical_overlap(text_a, text_b)
