"""
Queue-based resource processing service.

Processes resources one-by-one in FIFO order.
Handles all failure cases and keeps the queue running.
"""

import time
import traceback
from datetime import datetime, timezone, timedelta
from threading import Thread

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from models import ProcessingJob, Resource, DownloadTask, User
from services.processing_service import process_resource
from services.dependency_failure_service import DependencyFailure, classify_provider_error
from core.activity_log import log_user_activity

from database import SessionLocal


DOCUMENT_EMBED_ONLY_TYPES = {"pdf", "docx", "image"}


class QueueWorker:
    """
    Singleton worker that processes resources from the queue.
    One job at a time. Never stops.
    """

    _instance = None
    _running = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(QueueWorker, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls):
        return cls()

    @classmethod
    def start(cls):
        """Start the worker thread if not already running."""
        instance = cls.get_instance()
        if not instance._running:
            instance._running = True
            thread = Thread(target=instance._work_loop, daemon=True)
            thread.start()
            print("[OK] Queue worker started")

    def _work_loop(self):
        """Main worker loop. Processes one job at a time forever."""
        print("Queue worker loop started")
        while self._running:
            db = None
            try:
                db = SessionLocal()
                try:
                    # Check for stuck processing jobs (stuck for > 10 min)
                    from datetime import timedelta
                    stuck_cutoff = datetime.utcnow() - timedelta(minutes=10)
                    stuck_jobs = (
                        db.query(ProcessingJob)
                        .filter(
                            ProcessingJob.status == "processing",
                            or_(
                                ProcessingJob.heartbeat_at < stuck_cutoff,
                                and_(
                                    ProcessingJob.heartbeat_at.is_(None),
                                    ProcessingJob.started_at < stuck_cutoff,
                                ),
                            ),
                        )
                        .all()
                    )
                    for stuck_job in stuck_jobs:
                        print(f"[QUEUE] WARNING: Found stuck job {stuck_job.id} (resource={stuck_job.resource_id}, started={stuck_job.started_at}), resetting to queued")
                        stuck_job.status = "queued"
                        stuck_job.started_at = None
                    if stuck_jobs:
                        db.commit()

                    # Promote dependency-waiting jobs once no other active job remains for the resource.
                    waiting_jobs = db.query(ProcessingJob).filter(ProcessingJob.status == "waiting").all()
                    for waiting_job in waiting_jobs:
                        blocker = (
                            db.query(ProcessingJob)
                            .filter(
                                ProcessingJob.resource_id == waiting_job.resource_id,
                                ProcessingJob.id != waiting_job.id,
                                ProcessingJob.status.in_(["queued", "processing"]),
                            )
                            .first()
                        )
                        if not blocker:
                            waiting_job.status = "queued"
                            waiting_job.blocked_by_job_id = None
                    if waiting_jobs:
                        db.commit()

                    connection_jobs = db.query(ProcessingJob).filter(
                        ProcessingJob.status.in_(["retrying_connection", "waiting_for_connection"]),
                        or_(
                            ProcessingJob.next_retry_at.is_(None),
                            ProcessingJob.next_retry_at <= datetime.utcnow(),
                        ),
                    ).all()
                    for connection_job in connection_jobs:
                        connection_job.status = "queued"
                        connection_job.current_stage = "resuming_connection"
                        connection_job.started_at = None
                        connection_job.heartbeat_at = datetime.utcnow()
                    if connection_jobs:
                        db.commit()

                    # Get the oldest queued job (Strict FIFO)
                    job = (
                        db.query(ProcessingJob)
                        .filter(ProcessingJob.status == "queued")
                        .order_by(ProcessingJob.created_at.asc())
                        .first()
                    )

                    if not job:
                        # No work, sleep briefly and continue
                        time.sleep(1)
                        continue

                    job_type = getattr(job, "job_type", "full")
                    print(f"[QUEUE] Found queued job: {job.id} (resource={job.resource_id}, type={job.job_type})")
                    # Found a job, mark it as processing
                    print(
                        f"\n[QUEUE] Starting FIFO processing: Job {job.id} for Resource {job.resource_id}"
                    )
                    job.status = "processing"
                    job.started_at = datetime.now(timezone.utc)
                    job.heartbeat_at = datetime.utcnow()
                    job.attempt_count = (getattr(job, "attempt_count", 0) or 0) + 1
                    job.current_stage = job.current_stage or "starting"
                    db.commit()

                    # Update resource status
                    resource = (
                        db.query(Resource)
                        .filter(Resource.id == job.resource_id)
                        .first()
                    )
                    if resource:
                        # Optional intelligence jobs have their own state and must not overwrite the primary resource pipeline.
                        if job_type not in {"document_intelligence", "knowledge_generation"}:
                            resource.processing_status = "processing"
                        db.commit()
                        log_user_activity(db, resource.user_id, 'queue', f'Started processing: {job_type}', resource.title)

                    try:
                        from main import _notify_explorer_changed
                        _notify_explorer_changed()
                    except Exception as e:
                        print(f"[QUEUE] Error notifying: {e}")

                    # Process the resource (synchronous, blocking call)
                    try:
                        knowledge_status = None
                        if job_type == "reindex":
                            from services.processing_service import reindex_resource
                            reindex_resource(job.resource_id)
                        elif job_type == "document_intelligence":
                            from services.document_intelligence_service import run_document_intelligence
                            run_document_intelligence(job.resource_id)
                        elif job_type == "knowledge_generation":
                            from services.knowledge_service import run_knowledge_pipeline
                            knowledge_status = run_knowledge_pipeline(job.resource_id, job.id)
                            if knowledge_status in {"paused", "cancelled"}:
                                print(f"[QUEUE] Knowledge job {job.id} {knowledge_status}")
                                db.close()
                                continue
                        else:
                            res_status = process_resource(job.resource_id, job_id=job.id, job_type=job_type)
                            if res_status == "paused":
                                print(f"[QUEUE] Job {job.id} paused by user")
                                db.close()
                                continue
                            if res_status == "deleted":
                                print(f"[QUEUE] Job {job.id} deleted or cancelled during processing")
                                db.close()
                                continue

                        # Expunge all stale objects from the identity map to avoid
                        # overwriting fresh data committed by process_resource()
                        db.expunge_all()

                        # Re-fetch job to update its status (resource is already updated by process_resource)
                        job = db.query(ProcessingJob).filter(ProcessingJob.id == job.id).first()

                        # If we got here, processing succeeded
                        if job:
                            job.status = "completed"
                            job.finished_at = datetime.utcnow()
                            job.error_message = None
                            job.next_retry_at = None
                            job.retry_schedule_step = 0
                            job.last_error_code = None

                        # Only commit the job status update — do NOT re-commit the resource
                        # process_resource() already set transcript, summary, and processing_status="ready"
                        db.commit()

                        # Re-fetch resource for notification purposes only (read-only)
                        resource = db.query(Resource).filter(Resource.id == job.resource_id).first() if job else None
                        print(f"[QUEUE] [OK] Job {job.id if job else 'unknown'} finished")
                        if resource and resource.user_id:
                            log_user_activity(db, resource.user_id, 'queue', f'Completed: {job_type}', resource.title)

                        # Commented out to prevent automatic document intelligence queueing on upload/index:
                        # try:
                        #     from services.document_intelligence_service import (
                        #         build_document_analysis_hash,
                        #         get_or_create_document_insight,
                        #         should_enable_document_intelligence,
                        #     )
                        #     if resource and job_type in ["full", "manual_index"] and should_enable_document_intelligence(resource):
                        #         existing_analysis_job = (
                        #             db.query(ProcessingJob)
                        #             .filter(
                        #                 ProcessingJob.resource_id == resource.id,
                        #                 ProcessingJob.status.in_(["queued", "processing"]),
                        #                 ProcessingJob.job_type == "document_intelligence",
                        #             )
                        #             .first()
                        #         )
                        #         if not existing_analysis_job:
                        #             insight = get_or_create_document_insight(db, resource.id)
                        #             if insight.status != "completed" or insight.content_hash != build_document_analysis_hash(resource):
                        #                 create_processing_job(db, resource.id, job_type="document_intelligence")
                        # except Exception as analysis_queue_error:
                        #     print(f"[QUEUE] Document intelligence enqueue skipped: {analysis_queue_error}")

                        try:
                            if resource and resource.user_id:
                                from main import create_notification
                                from models import MindMap, DocumentInsight
                                resource_title = resource.title or "AI Resource"
                                play_link = f"/folders/{resource.folder_id}"
                                if resource.type in ["audio", "video"]:
                                    play_link = f"/{resource.type}-player?resourceId={resource.id}"

                                if job_type == "knowledge_generation":
                                    if knowledge_status == "completed_empty":
                                        message = (
                                            f"Knowledge extraction completed for '{resource_title}', "
                                            "but no concepts met the publication standard."
                                        )
                                        notification_title = "Knowledge Extraction Completed"
                                    else:
                                        message = f"Knowledge extraction is ready for '{resource_title}'."
                                        notification_title = "Knowledge Extraction Ready"
                                    play_link = "/knowledge"
                                elif job_type == "document_intelligence":
                                    message = f"Document Intelligence is ready for '{resource_title}'."
                                    notification_title = "Document Intelligence Ready"
                                    play_link = f"/document-intelligence?resourceId={resource.id}"
                                elif job_type == "reindex":
                                    message = f"Re-indexing is complete for '{resource_title}'. Advanced RAG and search will now use the latest changes."
                                    notification_title = "Re-indexing Completed"
                                elif job_type == "transcript_only":
                                    message = f"Transcript regeneration is complete for '{resource_title}'. Chapters and subchapters were refreshed, and re-index is now available to update Advanced RAG."
                                    notification_title = "Transcript Regenerated"
                                elif resource.type in ["audio", "video", "youtube"]:
                                    if resource.summary:
                                        message = f"Transcript, summary, chapters, and subchapters are ready for '{resource_title}'."
                                    else:
                                        message = f"Transcript, chapters, and subchapters are ready for '{resource_title}'. Summary generation needs attention."
                                    notification_title = "Transcription Completed"
                                else:
                                    ready_parts = ["Text extraction"]
                                    if resource.summary and (resource.type or "").lower() not in DOCUMENT_EMBED_ONLY_TYPES:
                                        ready_parts.append("Summary")
                                    mm = db.query(MindMap).filter(MindMap.resource_id == resource.id).first()
                                    if mm:
                                        ready_parts.append("Mind map")
                                    insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource.id).first()
                                    if insight and insight.status == "completed":
                                        ready_parts.append("AI insights")
                                    message = f"AI pipeline complete for '{resource_title}'. {', '.join(ready_parts)} are ready."
                                    notification_title = "Processing Completed"

                                create_notification(
                                    db=db,
                                    user_id=resource.user_id,
                                    category="processing",
                                    title=notification_title,
                                    message=message,
                                    link=play_link
                                )
                        except Exception as ne:
                            print(f"[QUEUE NOTIFICATION ERROR] {ne}")

                        try:
                            from main import _notify_explorer_changed
                            _notify_explorer_changed()
                        except Exception as e:
                            print(f"[QUEUE] Error notifying: {e}")

                    except Exception as e:
                        # Processing failed. Do not log raw provider exceptions: they can contain credentials.
                        print("\n")
                        print("=" * 80)
                        print("QUEUE ERROR: processing job failed; safe diagnostic will be persisted")
                        print("=" * 80)

                        db.rollback()

                        job = db.query(ProcessingJob).filter(ProcessingJob.id == job.id).first()
                        resource = db.query(Resource).filter(Resource.id == job.resource_id).first()
                        failure = e if isinstance(e, DependencyFailure) else None
                        if not failure and resource:
                            stage = (resource.processing_status or "").removeprefix("failed_")
                            service_by_stage = {"summarizing": "Chat", "chaptering": "Chat", "subchaptering": "Chat", "embedding": "Embedding"}
                            service = service_by_stage.get(stage)
                            if service:
                                failure = classify_provider_error(service=service, stage=stage, error=e)

                        should_notify_failure = True
                        if job:
                            temporary_codes = {"service_unreachable", "service_timeout", "rate_limited"}
                            if (
                                job_type == "knowledge_generation"
                                and failure
                                and failure.code in temporary_codes
                            ):
                                delays = [10, 30, 90, 60]
                                step = min(job.retry_schedule_step or 0, len(delays) - 1)
                                job.retry_schedule_step = step + 1
                                job.status = "retrying_connection" if step < 3 else "waiting_for_connection"
                                job.current_stage = job.status
                                retry_delay = failure.retry_after_seconds or delays[step]
                                job.next_retry_at = datetime.utcnow() + timedelta(seconds=retry_delay)
                                job.finished_at = None
                                job.retryable = 1
                                job.last_error_code = failure.code
                                job.error_message = failure.safe_detail
                                should_notify_failure = step == 3
                            else:
                                job.status = "failed"
                                job.finished_at = datetime.utcnow()
                                job.error_message = failure.safe_detail if failure else "unexpected_processing_error"
                                job.last_error_code = failure.code if failure else "unexpected_processing_error"

                        if resource:
                            # Preserve specific failed status (e.g. "failed_embedding")
                            # so the resume endpoint knows exactly which step failed.
                            if job_type not in {"document_intelligence", "knowledge_generation"} and (
                                not resource.processing_status or not resource.processing_status.startswith("failed_")
                            ):
                                resource.processing_status = f"failed_{failure.stage}" if failure else "failed_processing"

                        db.commit()
                        print(f"[QUEUE] [FAIL] Job {job.id if job else 'unknown'} failed")
                        if resource and resource.user_id:
                            log_user_activity(db, resource.user_id, 'queue', f'Failed: {job_type}', resource.title)

                        try:
                            if resource and resource.user_id:
                                from main import create_notification
                                resource_title = resource.title or "AI Resource"
                                title, message = failure.notification_for(resource_title) if failure else (
                                    "Processing failed",
                                    f'“{resource_title}” stopped because MyAILibrary encountered an unexpected processing error. You can resume the pipeline; if it fails again, contact support with the job ID.',
                                )
                                notification_link = (
                                    "/settings?tab=ai"
                                    if failure and failure.settings_section in {
                                        "Knowledge Model",
                                        "WTP Canine Sentence Model",
                                        "Whisper Path Configuration",
                                        "Tesseract OCR",
                                    }
                                    else f"/resource/{resource.id}"
                                )
                                create_notification(
                                    db=db,
                                    user_id=resource.user_id,
                                    category="processing",
                                    title=title,
                                    message=message,
                                    link=notification_link
                                )
                        except Exception as ne:
                            print(f"[QUEUE NOTIFICATION ERROR] {ne}")

                        try:
                            from main import _notify_explorer_changed
                            _notify_explorer_changed()
                        except Exception as e:
                            print(f"[QUEUE] Error notifying: {e}")

                finally:
                    db.close()

            except Exception as e:
                print(f"[QUEUE] Unexpected error in worker: {e}")
                import traceback
                print(traceback.format_exc())
                if db:
                    try:
                        db.close()
                    except Exception:
                        pass
                time.sleep(2)

    def stop(self):
        """Stop the worker gracefully."""
        self._running = False
        print("Queue worker stopping...")


def create_processing_job(db, resource_id: str, job_type: str = "full", input_fingerprint: str = None):
    """Create or deduplicate a typed processing job for a resource."""
    from uuid import uuid4

    existing_same_type = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.job_type == job_type,
            ProcessingJob.status.in_(["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"]),
        )
        .order_by(ProcessingJob.created_at.desc())
        .first()
    )
    if existing_same_type:
        return existing_same_type

    blocker = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.status.in_(["queued", "processing"]),
        )
        .order_by(ProcessingJob.created_at.asc())
        .first()
    )
    status = "waiting" if blocker else "queued"
    job = ProcessingJob(
        id=str(uuid4()),
        resource_id=resource_id,
        status=status,
        job_type=job_type,
        created_at=datetime.utcnow(),
        progress=0,
        current_stage="waiting_for_prerequisite" if blocker else "queued",
        attempt_count=0,
        retryable=1,
        blocked_by_job_id=blocker.id if blocker else None,
        input_fingerprint=input_fingerprint,
    )
    db.add(job)

    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if resource and job_type not in {"document_intelligence", "knowledge_generation"}:
        resource.processing_status = "queued"

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        concurrent = (
            db.query(ProcessingJob)
            .filter(
                ProcessingJob.resource_id == resource_id,
                ProcessingJob.job_type == job_type,
                ProcessingJob.status.in_(["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"]),
            )
            .first()
        )
        if concurrent:
            return concurrent
        raise

    print(f"[QUEUE] Queued job {job.id} type={job_type} for resource {resource_id}")
    if resource and resource.user_id:
        log_user_activity(db, resource.user_id, "queue", f"Queued: {job_type}", resource.title)
    return job

def get_queue_status(db, current_user_id: str = None):
    """
    Get all jobs with granular resource status.
    Ordered by creation time (Oldest First for active jobs).
    """
    query = db.query(ProcessingJob, Resource).join(Resource, ProcessingJob.resource_id == Resource.id)
    
    if current_user_id:
        query = query.filter(Resource.user_id == current_user_id)
        
    # Sort: Queued/Processing first, then chronologically
    results = (
        query.order_by(
            ProcessingJob.status.desc(), # 'queued' and 'processing' come before 'completed'
            ProcessingJob.created_at.asc() 
        )
        .all()
    )

    active_resource_ids = {
        job.resource_id
        for job, _resource in results
        if job.status in ["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"]
    }

    output = []
    seen_finished_resources = set()
    for job, resource in results:
        is_active = job.status in ["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"]
        if not is_active and job.resource_id in active_resource_ids:
            continue
        if not is_active and job.resource_id in seen_finished_resources:
            continue
        if not is_active:
            seen_finished_resources.add(job.resource_id)

        detail_status = resource.processing_status
        job_type = getattr(job, "job_type", "full")
        
        if job_type == "knowledge_generation":
            stage = getattr(job, "current_stage", None) or "queued"
            detail_status = stage.replace("_", " ")
            if job.status == "completed":
                detail_status = "knowledge ready"
            elif job.status == "failed":
                detail_status = "knowledge generation failed"
        elif job_type == "document_intelligence":
            if job.status == "completed":
                detail_status = "document intelligence ready"
            elif job.status == "processing":
                detail_status = "document intelligence"
            elif job.status == "failed":
                detail_status = "document intelligence failed"
            else:
                detail_status = "document intelligence queued"
        elif job_type == "reindex":
            if job.status == "completed":
                detail_status = "re-indexing complete"
            elif job.status == "processing":
                detail_status = "re-indexing changes..."
            elif job.status == "failed":
                detail_status = "re-indexing failed"
            else:
                detail_status = "queued for re-index"
        elif job_type == "transcript_only":
            if job.status == "completed":
                detail_status = "transcript regeneration complete"
            elif job.status == "processing":
                detail_status = "generating local timestamps..." if resource.processing_status == "aligning_timestamps" else "regenerating transcript..."
            elif job.status == "failed":
                detail_status = "transcript regeneration failed"
            else:
                detail_status = "queued for transcript regeneration"

        output.append({
            "job_id": job.id,
            "resource_id": job.resource_id,
            "resource_title": resource.title,
            "job_status": job.status, # The status of the queue job itself
            "detail_status": detail_status, # Granular: transcribing, chaptering, etc.
            "job_type": getattr(job, "job_type", "full"),
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "error_message": job.error_message,
            "progress": getattr(job, "progress", 0) or 0,
            "current_stage": getattr(job, "current_stage", None),
            "attempt_count": getattr(job, "attempt_count", 0) or 0,
            "retryable": bool(getattr(job, "retryable", 1)),
            "blocked_by_job_id": getattr(job, "blocked_by_job_id", None),
            "next_retry_at": job.next_retry_at.isoformat() if getattr(job, "next_retry_at", None) else None,
            "retry_schedule_step": getattr(job, "retry_schedule_step", 0) or 0,
            "last_error_code": getattr(job, "last_error_code", None),
        })
    return output


def clear_queue_history(db, current_user_id: str):
    """Delete all completed or failed jobs for a specific user."""
    jobs_to_delete = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(
            Resource.user_id == current_user_id,
            ProcessingJob.status.in_(["completed", "failed"])
        )
        .all()
    )
    
    count = 0
    for job in jobs_to_delete:
        db.delete(job)
        count += 1
    
    db.commit()
    return count


def get_job_status(db, resource_id: str):
    """Get the most recent job for a resource with granular detail."""
    result = (
        db.query(ProcessingJob, Resource)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.resource_id == resource_id)
        .order_by(ProcessingJob.created_at.desc())
        .first()
    )

    if not result:
        return None

    job, resource = result
    detail_status = resource.processing_status
    if getattr(job, "job_type", "full") == "document_intelligence":
        if job.status == "completed":
            detail_status = "document intelligence ready"
        elif job.status == "processing":
            detail_status = "document intelligence"
        elif job.status == "failed":
            detail_status = "document intelligence failed"
        else:
            detail_status = "document intelligence queued"
    elif getattr(job, "job_type", "full") == "transcript_only":
        if job.status == "completed":
            detail_status = "transcript regeneration complete"
        elif job.status == "processing":
            detail_status = "generating local timestamps..." if resource.processing_status == "aligning_timestamps" else "regenerating transcript..."
        elif job.status == "failed":
            detail_status = "transcript regeneration failed"
        else:
            detail_status = "queued for transcript regeneration"

    return {
        "job_id": job.id,
        "resource_id": job.resource_id,
        "resource_title": resource.title,
        "job_status": job.status,
        "detail_status": detail_status,
        "job_type": getattr(job, "job_type", "full"),
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "error_message": job.error_message,
    }


class DownloaderWorker:
    """
    Singleton worker that processes download tasks from the database.
    Processes one task at a time.
    """

    _instance = None
    _running = False

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DownloaderWorker, cls).__new__(cls)
        return cls._instance

    @classmethod
    def get_instance(cls):
        return cls()

    @classmethod
    def start(cls):
        instance = cls.get_instance()
        if not instance._running:
            instance._running = True
            thread = Thread(target=instance._work_loop, daemon=True)
            thread.start()
            print("[OK] Downloader worker started")

    def _work_loop(self):
        print("Downloader worker loop started")
        while self._running:
            try:
                db = SessionLocal()
                try:
                    task = (
                        db.query(DownloadTask)
                        .filter(DownloadTask.status == "queued")
                        .order_by(DownloadTask.created_at.asc())
                        .first()
                    )

                    if not task:
                        time.sleep(1)
                        continue

                    task.status = "processing"
                    task.updated_at = datetime.utcnow()
                    db.commit()
                    log_user_activity(db, task.user_id, 'download', f'Started download: {task.url}')
                    try:
                        from main import _notify_explorer_changed
                        _notify_explorer_changed()
                    except Exception as e:
                        print(f"[DOWNLOADER] Error notifying: {e}")

                    try:
                        # Fetch the user associated with the task
                        user = db.query(User).filter(User.id == task.user_id).first()
                        if not user:
                            raise Exception("User not found for task")

                        # Check if task is social media download or default youtube video
                        task_type = getattr(task, "task_type", None)
                        if task_type in ["twitter", "instagram"]:
                            from services.social_service import download_social_profile
                            download_social_profile(task_id=task.id, url=task.url, folder_id=task.folder_id, db_session=db, current_user=user)
                        else:
                            from main import create_youtube
                            # Call the original, synchronous create_youtube function
                            # This function handles download, resource creation, AND job queuing
                            create_youtube(
                                url=task.url,
                                folder_id=task.folder_id,
                                playlist_id=task.playlist_id,
                                db=db,
                                current_user=user,
                                quality=getattr(task, "quality", "best") or "best",
                            )
                            
                            task.status = "completed"
                            task.progress = 100

                        log_user_activity(db, task.user_id, 'download', f'Download completed: {task.file_name or task.url}')
                        try:
                            from main import create_notification
                            task_name = task.file_name or task.url
                            create_notification(
                                db=db,
                                user_id=task.user_id,
                                category="download",
                                title="Download Completed",
                                message=f"Finished downloading '{task_name}'. AI pipeline has been started.",
                                link="/downloads"
                            )
                        except Exception as ne:
                            print(f"[DOWNLOAD NOTIFICATION ERROR] {ne}")

                    except Exception as e:
                        task.status = "failed"
                        task.error_message = str(e)
                        log_user_activity(db, task.user_id, 'download', f'Download failed: {task.file_name or task.url}', str(e)[:200])
                        try:
                            from main import create_notification
                            task_name = task.file_name or task.url
                            create_notification(
                                db=db,
                                user_id=task.user_id,
                                category="download",
                                title="Download Failed",
                                message=f"Failed downloading '{task_name}': {str(e)}",
                                link="/downloads"
                            )
                        except Exception as ne:
                            print(f"[DOWNLOAD NOTIFICATION ERROR] {ne}")
                    
                    task.updated_at = datetime.utcnow()
                    db.commit()
                    try:
                        from main import _notify_explorer_changed
                        _notify_explorer_changed()
                    except Exception as e:
                        print(f"[DOWNLOADER] Error notifying: {e}")
                finally:
                    db.close()
            except Exception as e:
                print(f"[DOWNLOADER] Error: {e}")
                time.sleep(2)
