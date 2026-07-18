import json
import subprocess
import time
import traceback
from uuid import uuid4

from core.logger import get_logger
from core.activity_log import log_user_activity
from embedding_service import store_resource_embeddings
from models import (
    Chapter,
    ChunkIndex,
    Embedding,
    Flashcard,
    MindMap,
    Quiz,
    Resource,
    SearchIndex,
    SubChapter,
)
from services.chapter_service import (
    build_chapter_transcript,
    build_subchapter_transcript,
    validate_subchapter_bounds,
)
from repositories.resource_repository import ensure_resource_content_hash, find_duplicate_resource_by_hash
from services.llm_service import (
    generate_chapters,
    generate_subchapters,
    generate_summary,
)
from services.pdf_service import extract_docx_text, extract_image_text, extract_pdf_text
from services.srt_parser import parse_srt
from services.transcription_service import transcribe_audio, _resolve_transcription_output_paths
from services.video_service import extract_audio_from_video
from services.dependency_failure_service import DependencyFailure, local_path_failure, missing_configuration

from database import SessionLocal
import os

logger = get_logger("PROCESSING")


FAILED_STATUS_PREFIX = "failed_"
DOCUMENT_EMBED_ONLY_TYPES = {"pdf", "docx", "image"}


def _extract_failed_stage(status: str | None) -> str | None:
    normalized = (status or "").strip().lower()
    if not normalized.startswith(FAILED_STATUS_PREFIX):
        return None
    stage = normalized[len(FAILED_STATUS_PREFIX):]
    return stage or None


def _infer_resume_stage(
    previous_status: str | None,
    *,
    has_prepared_transcript: bool,
    has_summary: bool,
    media_requires_chaptering: bool,
    existing_chapter_count: int,
) -> str | None:
    failed_stage = _extract_failed_stage(previous_status)
    if failed_stage:
        return failed_stage

    normalized = (previous_status or "").strip().lower()
    if normalized in {"embedding", "summarizing", "chaptering", "subchaptering", "transcribing", "indexing"}:
        return normalized

    if not has_prepared_transcript:
        return "transcribing"
    if media_requires_chaptering and existing_chapter_count <= 0:
        return "chaptering" if has_summary else "summarizing"
    if not has_summary and media_requires_chaptering:
        return "summarizing"
    return "embedding"


def _resume_stage_allows_completed_structure(resume_stage: str | None) -> bool:
    return resume_stage in {"embedding", "indexing", "ready"}


def _mark_failed(resource: Resource, db, stage: str):
    resource.processing_status = f"{FAILED_STATUS_PREFIX}{stage}"
    db.commit()


def _format_stage_label(stage: str | None) -> str:
    labels = {
        "transcribing": "transcription",
        "summarizing": "summary generation",
        "chaptering": "chapter generation",
        "subchaptering": "subchapter generation",
        "embedding": "embedding",
        "indexing": "indexing",
        "ready": "completion",
    }
    return labels.get((stage or "").strip().lower(), (stage or "processing").replace("_", " "))


def _notify_resume_started(db, resource: Resource, resume_stage: str | None):
    if not resource.user_id:
        return
    try:
        from main import create_notification

        stage_label = _format_stage_label(resume_stage)
        create_notification(
            db=db,
            user_id=resource.user_id,
            category="processing",
            title="Resume Started",
            message=f"Resuming '{resource.title or 'AI Resource'}' from {stage_label}. Remaining pipeline steps will continue automatically.",
            link=f"/resource/{resource.id}",
        )
    except Exception as e:
        logger.error(f"Failed to send resume-start notification: {e}")


def _is_document_embed_only_type(resource_type: str | None) -> bool:
    return (resource_type or "").strip().lower() in DOCUMENT_EMBED_ONLY_TYPES


def _require_provider(settings, service: str, stage: str, prefix: str):
    fields = [label for attr, label in ((f"{prefix}_base_url", "Base URL"), (f"{prefix}_api_key", "API key"), (f"{prefix}_model", "model")) if not str(getattr(settings, attr, "") or "").strip()]
    if fields:
        raise missing_configuration(service=service, stage=stage, settings_section=service, fields=fields)


def _preflight_resource_dependencies(resource, settings, job_type: str):
    media = resource.type in {"video", "audio", "youtube"}
    resume_stage = job_type.split(":", 1)[1] if job_type.startswith("resume:") else ""
    if media and job_type != "manual_index" and resume_stage not in {"summarizing", "chaptering", "subchaptering", "embedding", "indexing", "ready"}:
        fields = [label for value, label in ((getattr(settings, "whisper_path", ""), "Whisper executable path"), (getattr(settings, "whisper_model_path", ""), "Whisper GGML model path")) if not str(value or "").strip()]
        if fields:
            raise missing_configuration(service="Whisper", stage="transcribing", settings_section="Whisper", fields=fields)
        if not os.path.isfile(settings.whisper_path) or not os.path.isfile(settings.whisper_model_path):
            raise local_path_failure(code="path_not_found", service="Whisper", stage="transcribing", settings_section="Whisper", path_label="Whisper executable or GGML model path")
        if not os.access(settings.whisper_path, os.X_OK):
            raise local_path_failure(code="path_not_executable", service="Whisper", stage="transcribing", settings_section="Whisper", path_label="Whisper executable path")
    if media and job_type != "manual_index" and resume_stage not in {"embedding", "indexing", "ready"}:
        _require_provider(settings, "Chat", "summarizing", "chat")
    if job_type == "manual_index" or resume_stage in {"embedding", "indexing"}:
        _require_provider(settings, "Embedding", "embedding", "embedding")


def _notify_processing_failure(db, user_id, resource_title, failed_step, resource_id):
    """Compatibility shim: queue_service is the single failure-notification writer."""
    logger.warning("Processing step failed; queue worker will notify the user: %s", failed_step)


def reindex_resource(resource_id: str):
    """Rebuild only the changed retrieval state for a resource without re-transcribing.

    This preserves unchanged chunk embeddings when possible and only replaces
    transcript/chapter-derived chunks that actually changed.
    """
    logger.info(f"START RE-INDEXING for resource {resource_id}")

    db = SessionLocal()
    try:
        resource = db.query(Resource).filter(Resource.id == resource_id).first()
        if not resource:
            return

        ensure_resource_content_hash(resource)
        duplicate_embedded_resource = find_duplicate_resource_by_hash(
            db,
            user_id=resource.user_id,
            content_hash=resource.content_hash,
            exclude_resource_id=resource.id,
        )
        if duplicate_embedded_resource and str(duplicate_embedded_resource.is_embedded).lower() == "true":
            logger.warning(
                "STRICT DEDUPE: skipping re-index for %s because duplicate content is already embedded by resource %s",
                resource.id,
                duplicate_embedded_resource.id,
            )
            resource.processing_status = "ready"
            resource.is_embedded = "false"
            db.commit()
            return

        # 1. Rebuild embeddings using smart chunk diffing.
        # store_resource_embeddings already:
        # - compares old/new chunk state
        # - removes only changed/removed chunks
        # - reuses unchanged embeddings
        # - updates ChunkIndex rows incrementally
        from embedding_service import store_resource_embeddings
        logger.info("Rebuilding embeddings incrementally...")
        store_resource_embeddings(resource_id, resource.transcript or "", resource.user_id, resource_type=resource.type)

        # 2. Rebuild the lightweight resource search index so summary/transcript
        # search reflects current metadata.
        logger.info("Rebuilding search index...")
        rebuild_resource_search_index(db, resource)
        
        # 3. Mark as ready
        resource.processing_status = "ready"
        resource.is_embedded = "true"
        
        db.commit()

        logger.info(f"RE-INDEX COMPLETE for resource {resource_id}")

    finally:
        db.close()


def get_media_duration(file_path: str) -> float:
    """Returns duration in seconds for any media file."""
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
    if result.returncode != 0 or not result.stdout.strip():
        return 0
    return float(result.stdout.strip())


def _clear_existing_media_structure(db, resource_id: str):
    existing_chapters = db.query(Chapter).filter(Chapter.resource_id == resource_id).all()
    if not existing_chapters:
        return

    for chapter in existing_chapters:
        db.query(SubChapter).filter(SubChapter.chapter_id == chapter.id).delete()
        db.delete(chapter)
    db.commit()


def rebuild_resource_search_index(db, resource):
    existing_indices = (
        db.query(SearchIndex)
        .filter(SearchIndex.source_type == "resource")
        .filter(SearchIndex.source_id == resource.id)
        .all()
    )
    for existing_index in existing_indices:
        db.delete(existing_index)

    resource_index = SearchIndex(
        id=str(uuid4()),
        source_type="resource",
        source_id=resource.id,
        content=f"""
{resource.title}

{resource.summary}

{resource.transcript}
""",
    )

    db.add(resource_index)
    db.commit()


def save_quiz(db, resource, quiz_data):
    """Save quiz questions to database for a resource."""
    for item in quiz_data:
        quiz = Quiz(
            id=str(uuid4()),
            resource_id=resource.id,
            question=item["question"],
            option_a=item["option_a"],
            option_b=item["option_b"],
            option_c=item["option_c"],
            option_d=item["option_d"],
            correct_answer=item["correct_answer"],
        )
        db.add(quiz)

    db.commit()
    logger.info(f"Saved {len(quiz_data)} quiz questions for resource {resource.id}")


def save_flashcards(db, resource, flashcards_data):
    for item in flashcards_data:
        flashcard = Flashcard(
            id=str(uuid4()),
            resource_id=resource.id,
            front=item["front"],
            back=item["back"],
        )

        db.add(flashcard)

    db.commit()

    logger.info(f"Saved {len(flashcards_data)} flashcards for resource {resource.id}")


def save_mindmap(
    db,
    resource,
    mindmap_data,
):
    # Replace any existing mindmap row instead of updating an already-loaded ORM
    # instance. This avoids StaleDataError when another flow has deleted the row
    # (or when a bulk delete desynchronizes the session) before this save runs.
    db.query(MindMap).filter(MindMap.resource_id == resource.id).delete(synchronize_session=False)

    mindmap = MindMap(
        id=str(uuid4()),
        resource_id=resource.id,
        content=json.dumps(mindmap_data),
    )

    db.add(mindmap)

    db.commit()

    logger.info(f"Mind map saved for resource {resource.id}")


def process_resource(resource_id: str, job_id: str = None, job_type: str = "full"):

    logger.info(f"START PROCESSING (Type: {job_type})")

    db = SessionLocal()
    try:
        resource = db.query(Resource).filter(Resource.id == resource_id).first()

        if not resource:
            return "deleted"
            
        # Validate only the configured dependencies the selected job will use.
        from models import UserSetting
        settings = db.query(UserSetting).filter(UserSetting.user_id == resource.user_id).first()
        try:
            _preflight_resource_dependencies(resource, settings, job_type)
        except DependencyFailure as failure:
            _mark_failed(resource, db, failure.stage)
            raise

        from models import ProcessingJob
        def check_abort():
            res = db.query(Resource).filter(Resource.id == resource_id).first()
            if not res or res.is_deleted == 1:
                return "deleted"
            
            if job_id:
                job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
            else:
                job = db.query(ProcessingJob).filter(
                    ProcessingJob.resource_id == resource_id,
                    ProcessingJob.status.in_(["queued", "processing", "paused"])
                ).first()
                
            if not job:
                return "deleted"
            if job.status == "paused":
                return "paused"
            return None

        def update_processing_status(next_status: str):
            resource.processing_status = next_status
            db.commit()

        file_type = resource.type
        logger.info(f"FILE TYPE: {file_type}")
        media_requires_chaptering = resource.type in ["video", "audio", "youtube"]
        document_embed_only = _is_document_embed_only_type(resource.type)
        chaptering_completed = not media_requires_chaptering
        has_summary = bool((resource.summary or "").strip())

        abort_reason = check_abort()
        if abort_reason: return abort_reason

        # =====================================
        # TRANSCRIBING / INDEXING
        # =====================================

        has_prepared_transcript = bool((resource.transcript or "").strip())
        
        existing_chapters = db.query(Chapter).filter(Chapter.resource_id == resource_id).count()
        # Parse the resume stage from job_type (e.g. "resume:embedding" -> "embedding").
        # If not encoded or invalid, fall back to heuristic inference.
        _is_resume = job_type.startswith("resume")
        _valid_stages = {"transcribing", "summarizing", "chaptering", "subchaptering", "embedding", "indexing", "ready"}
        if _is_resume and ":" in job_type:
            _raw_stage = job_type.split(":", 1)[1] or ""
            # If the encoded stage is not a valid pipeline stage (e.g. "failed"),
            # fall back to smart inference based on resource state.
            if _raw_stage in _valid_stages:
                resume_stage = _raw_stage
            else:
                resume_stage = _infer_resume_stage(
                    resource.processing_status,
                    has_prepared_transcript=has_prepared_transcript,
                    has_summary=has_summary,
                    media_requires_chaptering=media_requires_chaptering,
                    existing_chapter_count=existing_chapters,
                )
        elif _is_resume:
            resume_stage = _infer_resume_stage(
                resource.processing_status,
                has_prepared_transcript=has_prepared_transcript,
                has_summary=has_summary,
                media_requires_chaptering=media_requires_chaptering,
                existing_chapter_count=existing_chapters,
            )
        else:
            resume_stage = None
        if _is_resume:
            stage_label = _format_stage_label(resume_stage)
            logger.info(
                "RESUME PIPELINE: resource=%s start_stage=%s transcript_ready=%s summary_ready=%s chapters=%s",
                resource.id,
                resume_stage or "unknown",
                has_prepared_transcript,
                has_summary,
                existing_chapters,
            )
            _notify_resume_started(db, resource, resume_stage)
        if existing_chapters > 0 and (
            not _is_resume or _resume_stage_allows_completed_structure(resume_stage)
        ):
            chaptering_completed = True

        if job_type == "manual_index" and has_prepared_transcript:
            logger.info("USING EXISTING TRANSCRIPT FOR MANUAL INDEX")
            resource.processing_status = "indexing"
        elif _is_resume and has_prepared_transcript:
            logger.info("USING EXISTING TRANSCRIPT FOR RESUME")
            resource.processing_status = "indexing"
        elif document_embed_only:
            logger.info("INDEXING")
            resource.processing_status = "indexing"
        else:
            logger.info("TRANSCRIBING")
            resource.processing_status = "transcribing"
        db.commit()

        result = {}

        try:
            logger.info(f"RESOURCE TYPE: {resource.type}")
            logger.info(f"FILE PATH: {resource.local_path}")

            if job_type == "manual_index" and media_requires_chaptering:
                if not has_prepared_transcript:
                    logger.error("MANUAL INDEX BLOCKED: media resource has no transcript.")
                    _mark_failed(resource, db, "transcribing")
                    _notify_processing_failure(db, resource.user_id, resource.title, "Transcript generation", resource.id)
                    return
                # Manual media indexing reuses the existing chapter structure.
                # to allow embedding and indexing to proceed.
                chaptering_completed = True

            if (job_type == "manual_index" or _is_resume) and has_prepared_transcript:
                logger.info("Skipping extraction/transcription; resource is already prepared.")
                if not chaptering_completed and media_requires_chaptering:
                    # Attempt to resolve SRT path if we need to run chaptering
                    audio_path = None
                    if resource.type == "audio":
                        audio_path = resource.local_path
                    elif resource.type == "video":
                        audio_path = extract_audio_from_video(resource.local_path, resource.id)
                    elif resource.type == "youtube":
                        local_file = resource.local_path if resource.local_path and not str(resource.local_path).startswith("http") else None
                        if local_file: audio_path = extract_audio_from_video(local_file)

                    if audio_path:
                        paths = _resolve_transcription_output_paths(audio_path, resource.id)
                        if paths and os.path.exists(paths["srt_file"]):
                            result["srt_file"] = paths["srt_file"]

            elif resource.type == "pdf":
                log_user_activity(db, resource.user_id, 'queue', 'Extracting text from PDF', resource.title)
                resource.transcript = extract_pdf_text(resource.local_path, user_id=resource.user_id)

            elif resource.type == "docx":
                log_user_activity(db, resource.user_id, 'queue', 'Extracting text from DOCX', resource.title)
                resource.transcript = extract_docx_text(resource.local_path)

            elif resource.type == "image":
                log_user_activity(db, resource.user_id, 'queue', 'Extracting text from image', resource.title)
                resource.transcript = extract_image_text(resource.local_path, user_id=resource.user_id)

            elif resource.type == "video":
                log_user_activity(db, resource.user_id, 'queue', 'Transcribing video', resource.title)
                audio_path = extract_audio_from_video(resource.local_path, resource.id)
                abort_reason = check_abort()
                if abort_reason: return abort_reason
                result = transcribe_audio(
                    audio_path,
                    user_id=resource.user_id,
                    resource_id=resource.id,
                    cancel_check=check_abort,
                    status_callback=update_processing_status,
                )
                resource.transcript = result["transcript"]
                resource.duration_seconds = get_media_duration(audio_path)

            elif resource.type == "audio":
                log_user_activity(db, resource.user_id, 'queue', 'Transcribing audio', resource.title)
                result = transcribe_audio(
                    resource.local_path,
                    user_id=resource.user_id,
                    resource_id=resource.id,
                    cancel_check=check_abort,
                    status_callback=update_processing_status,
                )
                resource.transcript = result["transcript"]
                resource.duration_seconds = get_media_duration(resource.local_path)

            elif resource.type == "youtube":
                log_user_activity(db, resource.user_id, 'queue', 'Processing YouTube content', resource.title)
                from services.youtube_service import get_youtube_content

                original_url = (
                    resource.description
                    if resource.description and resource.description.startswith("http")
                    else None
                )
                result = None

                if original_url:
                    try:
                        result = get_youtube_content(
                            original_url,
                            resource.id,
                            user_id=resource.user_id,
                            cancel_check=check_abort,
                            status_callback=update_processing_status,
                        )
                    except Exception:
                        result = None

                if (
                    not result
                    or not isinstance(result, dict)
                    or not result.get("transcript")
                ):
                    local_file = (
                        resource.local_path
                        if resource.local_path
                        and not str(resource.local_path).startswith("http")
                        else None
                    )
                    if local_file:
                        try:
                            audio_path = extract_audio_from_video(local_file)
                            abort_reason = check_abort()
                            if abort_reason: return abort_reason
                            result2 = transcribe_audio(
                                audio_path,
                                user_id=resource.user_id,
                                resource_id=resource.id,
                                cancel_check=check_abort,
                                status_callback=update_processing_status,
                            )
                            result = result2
                            result["audio_path"] = audio_path
                        except Exception:
                            result = result or {}
                    else:
                        if original_url:
                            try:
                                result = get_youtube_content(
                                    original_url,
                                    resource.id,
                                    user_id=resource.user_id,
                                    cancel_check=check_abort,
                                    status_callback=update_processing_status,
                                )
                            except Exception:
                                result = {}

                if isinstance(result, dict):
                    resource.transcript = result.get("transcript", "")
                    if result.get("title"):
                        resource.title = result.get("title")
                    if result.get("thumbnail"):
                        resource.thumbnail_path = result.get("thumbnail")
                    audio_path = result.get("audio_path")
                    if audio_path:
                        resource.duration_seconds = get_media_duration(audio_path)
                else:
                    resource.transcript = str(result) if result else ""

            else:
                resource.transcript = "Transcript extraction not implemented for this file type yet."

            logger.info(f"TRANSCRIPT LENGTH: {len(resource.transcript)}")

            db.commit()

            has_summary = bool((resource.summary or "").strip())

            if document_embed_only:
                logger.info(
                    "DOCUMENT PIPELINE: text extraction only for %s. Summary generation is skipped; embedding happens only on manual embed/resume.",
                    resource.type,
                )
            # Summary generation moved to after chaptering (see below)

        except Exception as e:
            if "Job cancelled by user" in str(e):
                logger.info("Transcription interrupted by user (paused or deleted).")
                abort_reason = check_abort()
                if abort_reason: return abort_reason
                
            logger.error(f"TRANSCRIPTION ERROR: {str(e)}")
            failed_stage = _extract_failed_stage(resource.processing_status)
            if not failed_stage:
                failed_stage = "transcribing"
                _mark_failed(resource, db, failed_stage)
            failure_labels = {
                "transcribing": "Transcription",
                "summarizing": "Summary generation",
                "chaptering": "Chapter generation",
                "subchaptering": "Subchapter generation",
                "embedding": "Embedding",
                "indexing": "Indexing",
            }
            _notify_processing_failure(
                db,
                resource.user_id,
                resource.title,
                failure_labels.get(failed_stage, "Processing"),
                resource.id,
            )
            raise e

        if job_type == "transcript_only":
            logger.info("TRANSCRIPT-ONLY REGENERATION COMPLETE, REFRESHING STRUCTURE")

        abort_reason = check_abort()
        if abort_reason: return abort_reason

        # =====================================
        # CHAPTERING / SUBCHAPTERING
        # =====================================

        # =====================================
        # QUIZ GENERATION
        # =====================================

        # Quiz generation and parsing are currently disabled.
        # The save_quiz helper remains available for later use.

        if media_requires_chaptering and not chaptering_completed and job_type != "manual_index":
            try:
                if _is_resume and resume_stage in {"chaptering", "subchaptering"}:
                    logger.info("RESUME REBUILDING STRUCTURE FROM FAILED CHAPTER STEP")
                    _clear_existing_media_structure(db, resource.id)

                if job_type == "transcript_only":
                    logger.info("CLEARING EXISTING CHAPTERS/SUBCHAPTERS BEFORE STRUCTURE REFRESH")
                    _clear_existing_media_structure(db, resource.id)

                # CHAPTERING status
                logger.info("CHAPTERING")
                resource.processing_status = "chaptering"
                db.commit()
                log_user_activity(db, resource.user_id, 'ai_features', 'Generating chapters', resource.title)

                # Ensure we have an SRT file path before attempting to read
                srt_path = result.get("srt_file")
                if not srt_path or not os.path.exists(srt_path):
                    # SRT missing — attempt to re-extract from audio
                    logger.warning("SRT file missing or not found, attempting re-extraction for chaptering")
                    re_audio_path = None
                    if resource.type == "audio":
                        re_audio_path = resource.local_path
                    elif resource.type == "video":
                        re_audio_path = extract_audio_from_video(resource.local_path, resource.id)
                    elif resource.type == "youtube":
                        local_file = resource.local_path if resource.local_path and not str(resource.local_path).startswith("http") else None
                        if local_file:
                            re_audio_path = extract_audio_from_video(local_file)

                    if re_audio_path:
                        re_result = transcribe_audio(
                            re_audio_path,
                            user_id=resource.user_id,
                            resource_id=resource.id,
                            cancel_check=check_abort,
                            status_callback=update_processing_status,
                        )
                        srt_path = re_result.get("srt_file")
                        if srt_path and os.path.exists(srt_path):
                            result["srt_file"] = srt_path
                            # Also update transcript if re-transcription produced new content
                            if re_result.get("transcript"):
                                resource.transcript = re_result["transcript"]
                                db.commit()

                if not srt_path or not os.path.exists(srt_path):
                    raise RuntimeError("No SRT file found for chapter generation (re-extraction also failed)")

                with open(srt_path, "r", encoding="utf-8") as f:
                    srt_text = f.read()

                    chapters = generate_chapters(
                        srt_text,
                        user_id=resource.user_id,
                        resource_id=resource.id,
                        feature="upload_chapter_generation",
                    )
                    if not chapters:
                        raise RuntimeError("Chapter generation returned no chapters")
                    logger.info(f"GENERATED CHAPTERS: {chapters}")

                    segments = parse_srt(srt_path)

                    # SUBCHAPTERING status
                    logger.info("SUBCHAPTERING")
                    resource.processing_status = "subchaptering"
                    db.commit()
                    log_user_activity(db, resource.user_id, 'ai_features', 'Generating subchapters', resource.title)

                    chaptering_errors: list[str] = []

                    for chapter_data in chapters:
                        try:
                            chapter_transcript = build_chapter_transcript(
                                segments,
                                chapter_data["start_time"],
                                chapter_data["end_time"],
                            )

                            chapter = Chapter(
                                id=str(uuid4()),
                                resource_id=resource.id,
                                title=chapter_data["title"],
                                start_time=chapter_data["start_time"],
                                end_time=chapter_data["end_time"],
                                summary=chapter_data["summary"],
                                transcript=chapter_transcript,
                            )

                            db.add(chapter)
                            db.flush()
                            logger.info(f"Chapter flushed: {chapter.id} - '{chapter.title}'")

                            db.commit()
                            logger.info(f"Chapter committed: {chapter.id}")

                            chapter_duration = chapter.end_time - chapter.start_time

                            if chapter_duration >= 60:
                                logger.info(
                                    f"Calling generate_subchapters for chapter '{chapter.title}' (duration={chapter_duration})"
                                )

                                subchapters = generate_subchapters(
                                    chapter.transcript,
                                    chapter_duration=chapter_duration,
                                    user_id=resource.user_id,
                                    resource_id=resource.id,
                                    feature="upload_subchapter_generation",
                                )

                                subchapters = validate_subchapter_bounds(
                                    subchapters,
                                    chapter_start=0,
                                    chapter_end=chapter_duration,
                                )
                            else:
                                subchapters = []

                            chapter_segments = []

                            max_segment_time = max([s["end"] for s in segments]) if segments else chapter.end_time
                            effective_end = chapter.end_time
                            if chapter.end_time >= max_segment_time - 3.0:
                                effective_end = max_segment_time + 10.0

                            for segment in segments:
                                if (
                                    chapter.start_time <= segment["start"] < effective_end
                                ):
                                    chapter_segments.append(
                                        {
                                            "start": segment["start"] - chapter.start_time,
                                            "end": segment["end"] - chapter.start_time,
                                            "text": segment["text"],
                                        }
                                    )

                            sub_count = 0
                            for subchapter_data in subchapters:
                                try:
                                    subchapter_transcript = build_subchapter_transcript(
                                        chapter_segments,
                                        subchapter_data["start_time"],
                                        subchapter_data["end_time"],
                                    )

                                    if not subchapter_transcript.strip():
                                        logger.warning(
                                            f"Skipping subchapter '{subchapter_data.get('title', '')}' due to empty transcript"
                                        )
                                        continue

                                    subchapter = SubChapter(
                                        id=str(uuid4()),
                                        chapter_id=chapter.id,
                                        title=subchapter_data["title"],
                                        summary=subchapter_data.get("summary", ""),
                                        start_time=subchapter_data["start_time"],
                                        end_time=subchapter_data["end_time"],
                                        transcript=subchapter_transcript,
                                    )

                                    db.add(subchapter)
                                    sub_count += 1
                                except Exception:
                                    error = traceback.format_exc()
                                    logger.error("SUBCHAPTER CREATION ERROR:\n" + error)
                                    chaptering_errors.append(error)

                            if sub_count:
                                db.commit()
                                logger.info(
                                    f"Committed {sub_count} subchapters for chapter {chapter.id}"
                                )

                        except Exception:
                            error = traceback.format_exc()
                            logger.error("CHAPTER CREATION ERROR:\n" + error)
                            chaptering_errors.append(error)

                    if chaptering_errors:
                        raise RuntimeError("Chapter or subchapter generation did not complete successfully")

                    chaptering_completed = True
            except Exception as e:
                logger.error(f"CHAPTERING FAILED: {str(e)}\n{traceback.format_exc()}")
                failed_stage = "subchaptering" if str(resource.processing_status or "").lower() == "subchaptering" else "chaptering"
                _mark_failed(resource, db, failed_stage)
                failed_label = "Subchapter generation" if failed_stage == "subchaptering" else "Chapter generation"
                _notify_processing_failure(db, resource.user_id, resource.title, failed_label, resource.id)
                raise e
        else:
            logger.info(f"Skipping chapters for file type: {resource.type}")

        abort_reason = check_abort()
        if abort_reason: return abort_reason

        # =====================================
        # SUMMARY GENERATION (after chapters are available)
        # =====================================

        if (
            job_type != "transcript_only"
            and resource.transcript
            and not has_summary
            and not document_embed_only
        ):
            try:
                resource.processing_status = "summarizing"
                db.commit()
                logger.info("GENERATING SUMMARY (with chapter structure)")
                log_user_activity(db, resource.user_id, 'ai_features', 'Generating summary', resource.title)
                chapters_for_summary = [{"title": c.title, "start_time": c.start_time, "end_time": c.end_time} for c in db.query(Chapter).filter(Chapter.resource_id == resource.id).order_by(Chapter.start_time).all()]
                resource.summary = generate_summary(
                    resource.transcript,
                    user_id=resource.user_id,
                    resource_id=resource.id,
                    feature="upload_summary_generation",
                    chapters=chapters_for_summary if chapters_for_summary else None,
                )
                db.commit()
                logger.info("SUMMARY GENERATION COMPLETE")
            except Exception as e:
                logger.error(f"Error generating initial summary: {str(e)}")
                _mark_failed(resource, db, "summarizing")
                raise e

        # =====================================
        # EMBEDDING + SEARCH INDEXING
        # =====================================

        should_embed = True
        if resource.type in ["pdf", "docx", "image", "audio", "video", "youtube"]:
            if job_type != "manual_index" and not _is_resume:
                logger.info(f"Skipping auto-embedding for {resource.type}. Manual indexing required.")
                should_embed = False

        if media_requires_chaptering and not chaptering_completed:
            logger.warning("Continuing indexing without chapter/subchapter enrichment because chaptering is incomplete.")

        if not (resource.transcript or "").strip():
            logger.error("Indexing blocked: transcript is required before embeddings can be built.")
            _mark_failed(resource, db, "indexing")
            return

        if should_embed:
            try:
                if document_embed_only:
                    logger.info(
                        "DOCUMENT EMBED: embedding extracted text directly for %s without summary generation.",
                        resource.type,
                    )
                ensure_resource_content_hash(resource)
                duplicate_embedded_resource = find_duplicate_resource_by_hash(
                    db,
                    user_id=resource.user_id,
                    content_hash=resource.content_hash,
                    exclude_resource_id=resource.id,
                )
                if duplicate_embedded_resource and str(duplicate_embedded_resource.is_embedded).lower() == "true":
                    logger.warning(
                        "STRICT DEDUPE: skipping embeddings for %s because duplicate content is already embedded by resource %s",
                        resource.id,
                        duplicate_embedded_resource.id,
                    )
                    resource.is_embedded = "false"
                    resource.processing_status = "ready"
                    db.commit()
                    return

                logger.info("EMBEDDING")

                resource.processing_status = "embedding"
                db.commit()
                log_user_activity(db, resource.user_id, 'ai_features', 'Embedding and indexing', resource.title)

                logger.info("STORING CHROMA EMBEDDINGS")

                store_resource_embeddings(
                    resource.id,
                    resource.transcript or "",
                    resource.user_id,
                    resource_type=resource.type,
                )

                logger.info("CHROMA EMBEDDINGS STORED")

                # =====================================
                # SEARCH INDEXING
                # =====================================

                rebuild_resource_search_index(db, resource)

                resource.is_embedded = "true"
                db.commit()

                time.sleep(1)

            except Exception as e:
                logger.error("EMBEDDING/INDEX ERROR\n" + traceback.format_exc())
                try:
                    _mark_failed(resource, db, "embedding")
                except Exception:
                    logger.error("Failed to set resource status to failed:\n" + traceback.format_exc())
                raise e
        else:
            if resource.type in ["audio", "video", "youtube"] and resource.transcript:
                logger.info("REBUILDING SEARCH INDEX WITHOUT EMBEDDINGS")
                resource.processing_status = "indexing"
                db.commit()
                rebuild_resource_search_index(db, resource)
            resource.is_embedded = "false"
            db.commit()

        # =====================================
        # READY
        # =====================================

        logger.info("READY")

        resource.processing_status = "ready"
        db.commit()

    finally:
        db.close()
