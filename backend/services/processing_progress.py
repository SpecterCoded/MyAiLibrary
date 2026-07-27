"""Authoritative, monotonic progress reporting for queued processing jobs."""

from __future__ import annotations

from core.time import utc_now
from models import ProcessingJob


MEDIA_CHECKPOINTS = {
    "preflight": 2,
    "transcribing": 8,
    "aligning_timestamps": 28,
    "chaptering": 40,
    "subchaptering": 55,
    "summarizing": 78,
    "embedding": 82,
    "indexing": 96,
    "finalizing": 96,
    "ready": 100,
    "complete": 100,
}
DOCUMENT_CHECKPOINTS = {
    "preflight": 2,
    "extracting_text": 12,
    "transcribing": 12,
    "embedding": 75,
    "indexing": 96,
    "finalizing": 96,
    "ready": 100,
    "complete": 100,
}
REINDEX_CHECKPOINTS = {
    "preflight": 2,
    "embedding": 15,
    "indexing": 96,
    "finalizing": 96,
    "ready": 100,
    "complete": 100,
}
DOCUMENT_INTELLIGENCE_CHECKPOINTS = {
    "preflight": 5,
    "analysis": 15,
    "related_document_matching": 75,
    "persistence": 95,
    "complete": 100,
}

_INDETERMINATE_STAGES = {
    "transcribing",
    "aligning_timestamps",
    "chaptering",
    "summarizing",
    "analysis",
    "resource_intelligence",
    "concept_extraction",
    "confidence_engine",
    "alias_resolution",
    "relationship_extraction",
}
_TERMINAL_STATUSES = {"completed", "failed", "cancelled"}
_TERMINAL_STAGES = {"ready", "complete"}


def checkpoint_map(job_type: str, *, is_media: bool = True) -> dict[str, int]:
    normalized = (job_type or "full").split(":", 1)[0]
    if normalized in {"reindex", "manual_index"}:
        return REINDEX_CHECKPOINTS
    if normalized == "document_intelligence":
        return DOCUMENT_INTELLIGENCE_CHECKPOINTS
    return MEDIA_CHECKPOINTS if is_media else DOCUMENT_CHECKPOINTS


def progress_mode_for(job: ProcessingJob) -> str:
    if job.status in _TERMINAL_STATUSES or (job.current_stage or "") in _TERMINAL_STAGES:
        return "terminal"
    if (job.current_stage or "") in _INDETERMINATE_STAGES:
        return "indeterminate"
    return "determinate"


def update_processing_progress(
    db,
    job_id: str | None,
    stage: str,
    *,
    progress: int | float | None = None,
    is_media: bool = True,
    allow_reset: bool = False,
) -> ProcessingJob | None:
    if not job_id:
        return None
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        return None
    checkpoints = checkpoint_map(job.job_type, is_media=is_media)
    proposed = checkpoints.get(stage, job.progress or 0) if progress is None else progress
    proposed = int(max(0, min(100, round(float(proposed)))))
    previous = int(job.progress or 0)
    job.progress = proposed if allow_reset else max(previous, proposed)
    job.current_stage = stage
    job.heartbeat_at = utc_now()
    db.commit()
    return job


def unit_progress(start: int, end: int, completed: int, total: int) -> int:
    if total <= 0:
        return end
    ratio = max(0.0, min(1.0, completed / total))
    return int(round(start + ((end - start) * ratio)))


def progress_payload(job: ProcessingJob) -> dict:
    return {
        "progress": max(0, min(100, int(job.progress or 0))),
        "current_stage": job.current_stage,
        "progress_mode": progress_mode_for(job),
    }
