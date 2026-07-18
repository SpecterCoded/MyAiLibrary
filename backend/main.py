import os
from datetime import datetime, timedelta

import sys
import warnings

# Aggressively silence all warnings
os.environ["PYTHONWARNINGS"] = "ignore"
warnings.simplefilter("ignore")

# Load .env from backend directory regardless of CWD
from dotenv import load_dotenv
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

import json
import hashlib
import mimetypes
import re
import contextlib
import subprocess
import shutil
import threading
from glob import glob
from typing import List
from uuid import uuid4

import sqlalchemy
# ... (rest of imports)

# Initialize logger
from core.config import get_upload_path, UPLOADS_ROOT
from core.logger import setup_logger, get_logger
logger = setup_logger()
sys_logger = get_logger("SYSTEM")
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
EXTRAA_FILES_ROOT = os.path.join(BACKEND_DIR, "extraa_files")

sys_logger.info("Initializing My AI Library...")

from auth import create_access_token, create_refresh_token, get_current_user, get_current_user_id, validate_registration, validate_token
from embedding_service import (
    answer_question,
    build_context,
    delete_resource_embeddings,
    extract_sources_from_metadatas,
)
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, Header, Request, Body
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from models import (
    Attachment,
    Base,
    Chapter,
    ChatMessage,
    ChatSession,
    ChunkIndex,
    Concept,
    ConceptLink,
    Embedding,
    Flashcard,
    Folder,
    MindMap,
    Note,
    Playlist,
    ProcessingJob,
    Quiz,
    Resource,
    SearchIndex,
    StoragePath,
    SubChapter,
    Summary,
    User,
    DownloadTask,
    DocumentInsight,
    UserSetting,
    UserSession,
    Notification,
    ActivityLog,
)
from core.activity_log import log_user_activity
from sync import push_user, start_periodic_sync
from pydantic import BaseModel
from repositories.resource_repository import (
    DuplicateResourceError,
    ensure_resource_content_hash,
    find_duplicate_resource_by_hash,
    save_resource,
)
from security import hash_password, verify_password
from services.mock_embedding_service import calculate_similarity, generate_fake_embedding
from services.llm_service import (
    generate_answer,
    generate_chat_summary,
    generate_flashcards,
    generate_mindmap,
    generate_quiz,
    generate_study_notes,
    generate_summary,
)
from services.query_rewrite_service import rewrite_query
from services.processing_service import (
    save_flashcards,
    save_mindmap,
    save_quiz,
)
from services.transcription_service import transcribe_audio
from embedding_service import (
    answer_question,
    build_context,
    delete_resource_embeddings,
    extract_sources_from_metadatas,
)
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse, FileResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from models import (
    Attachment,
    Base,
    Chapter,
    ChatMessage,
    ChatSession,
    ChunkIndex,
    Concept,
    ConceptLink,
    Embedding,
    Flashcard,
    Folder,
    MindMap,
    Note,
    Playlist,
    ProcessingJob,
    Quiz,
    Resource,
    SearchIndex,
    StoragePath,
    SubChapter,
    Summary,
    User,
    DownloadTask,
    DocumentInsight,
    UserSetting,
    UserSession,
    Notification,
    ActivityLog,
)
from pydantic import BaseModel
from repositories.resource_repository import save_resource
from security import hash_password, verify_password
from services.mock_embedding_service import calculate_similarity, generate_fake_embedding
from services.llm_service import (
    generate_answer,
    generate_chat_summary,
    generate_flashcards,
    generate_mindmap,
    generate_quiz,
    generate_study_notes,
    generate_summary,
)
from services.query_rewrite_service import rewrite_query
from services.processing_service import (
    save_flashcards,
    save_mindmap,
    save_quiz,
)
from services.transcription_service import transcribe_audio
from services.queue_service import (
    DownloaderWorker,
    QueueWorker,
    clear_queue_history,
    create_processing_job,
    get_job_status,
    get_queue_status,
)
from services.resource_service import create_resource
from services.resource_service import compute_bytes_content_hash, compute_file_content_hash
from services.note_service import NoteService, _sanitize_filename
from sqlalchemy import or_, and_, text, func
from sqlalchemy.orm import Session
from database import SessionLocal, engine

# Create tables automatically
Base.metadata.create_all(bind=engine)

from services.knowledge_stale_listener import register_knowledge_stale_listeners
register_knowledge_stale_listeners(SessionLocal.class_)

# Define allowed types for processing
ALLOWED_PROCESSING_TYPES = ["video", "audio", "pdf", "image", "docx"]

# Ensure certain tables have new nullable columns (backfill migration)
inspector = sqlalchemy.inspect(engine)
with engine.connect() as conn:
    if "attachments" in inspector.get_table_names():
        existing = [c["name"] for c in inspector.get_columns("attachments")]
        if "chapter_id" not in existing:
            conn.execute(text("ALTER TABLE attachments ADD COLUMN chapter_id TEXT"))
        if "subchapter_id" not in existing:
            conn.execute(text("ALTER TABLE attachments ADD COLUMN subchapter_id TEXT"))

    if "notes" in inspector.get_table_names():
        existing_notes = [c["name"] for c in inspector.get_columns("notes")]
        if "concept_id" not in existing_notes:
            conn.execute(text("ALTER TABLE notes ADD COLUMN concept_id TEXT"))
        if "is_favorite" not in existing_notes:
            conn.execute(text("ALTER TABLE notes ADD COLUMN is_favorite INTEGER DEFAULT 0"))
        if "status" not in existing_notes:
            conn.execute(text("ALTER TABLE notes ADD COLUMN status TEXT DEFAULT 'active'"))
        if "tags" not in existing_notes:
            conn.execute(text("ALTER TABLE notes ADD COLUMN tags TEXT"))
        if "folder_id" not in existing_notes:
            conn.execute(text("ALTER TABLE notes ADD COLUMN folder_id TEXT"))

    if "folders" in inspector.get_table_names():
        existing_folders = [c["name"] for c in inspector.get_columns("folders")]
        if "user_id" not in existing_folders:
            conn.execute(text("ALTER TABLE folders ADD COLUMN user_id TEXT"))
        if "storage_root" not in existing_folders:
            conn.execute(text("ALTER TABLE folders ADD COLUMN storage_root TEXT"))
        if "parent_id" not in existing_folders:
            conn.execute(text("ALTER TABLE folders ADD COLUMN parent_id TEXT"))
        if "is_deleted" not in existing_folders:
            conn.execute(text("ALTER TABLE folders ADD COLUMN is_deleted INTEGER DEFAULT 0"))

    if "playlists" in inspector.get_table_names():
        existing_playlists = [c["name"] for c in inspector.get_columns("playlists")]
        if "user_id" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN user_id TEXT"))
        if "storage_root" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN storage_root TEXT"))
        if "description" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN description TEXT"))
        if "icon_type" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN icon_type TEXT DEFAULT 'standup'"))
        if "is_favorite" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN is_favorite INTEGER DEFAULT 0"))
        if "created_at" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN created_at TEXT"))
        if "updated_at" not in existing_playlists:
            conn.execute(text("ALTER TABLE playlists ADD COLUMN updated_at TEXT"))

    if "concept_links" in inspector.get_table_names():
        existing_cl = [c["name"] for c in inspector.get_columns("concept_links")]
        if "link_type" not in existing_cl:
            conn.execute(text("ALTER TABLE concept_links ADD COLUMN link_type TEXT DEFAULT 'reference'"))

    if "concepts" in inspector.get_table_names():
        existing_concepts = [c["name"] for c in inspector.get_columns("concepts")]
        concept_columns = {
            "tags": "TEXT",
            "canonical_name": "TEXT",
            "normalized_name": "TEXT",
            "user_id": "TEXT",
            "domain": "TEXT",
            "concept_type": "TEXT DEFAULT 'concept'",
            "origin": "TEXT DEFAULT 'manual'",
            "confidence": "FLOAT",
            "difficulty": "TEXT",
            "summary": "TEXT",
            "prerequisites": "TEXT",
            "examples": "TEXT",
            "common_mistakes": "TEXT",
            "recommended_next_topic": "TEXT",
            "learning_stage": "TEXT",
            "archived": "INTEGER DEFAULT 0",
            "is_favorite": "INTEGER DEFAULT 0",
        }
        for column_name, column_type in concept_columns.items():
            if column_name not in existing_concepts:
                conn.execute(text(f"ALTER TABLE concepts ADD COLUMN {column_name} {column_type}"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_concepts_user_domain_name ON concepts(user_id, domain, normalized_name)"))

    if "concept_analytics" in inspector.get_table_names():
        existing_analytics = [c["name"] for c in inspector.get_columns("concept_analytics")]
        analytics_columns = {
            "meaningful_occurrence_count": "INTEGER DEFAULT 0",
            "discussion_duration_seconds": "FLOAT DEFAULT 0",
            "raw_phrase_occurrences": "INTEGER DEFAULT 0",
        }
        for column_name, column_type in analytics_columns.items():
            if column_name not in existing_analytics:
                conn.execute(text(f"ALTER TABLE concept_analytics ADD COLUMN {column_name} {column_type}"))

    if "resources" in inspector.get_table_names():
        existing_resources = [c["name"] for c in inspector.get_columns("resources")]
        if "user_id" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN user_id TEXT"))
        if "content_hash" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN content_hash TEXT"))
        if "is_embedded" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN is_embedded TEXT DEFAULT 'false'"))
        if "is_deleted" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN is_deleted INTEGER DEFAULT 0"))
        if "study_notes" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN study_notes TEXT"))
        if "suggested_questions" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN suggested_questions TEXT"))
        if "starred_transcripts" not in existing_resources:
            conn.execute(text("ALTER TABLE resources ADD COLUMN starred_transcripts TEXT"))

    if "chapters" in inspector.get_table_names():
        existing_chapters = [c["name"] for c in inspector.get_columns("chapters")]
        if "is_favorite" not in existing_chapters:
            conn.execute(text("ALTER TABLE chapters ADD COLUMN is_favorite INTEGER DEFAULT 0"))

    if "subchapters" in inspector.get_table_names():
        existing_subchapters = [c["name"] for c in inspector.get_columns("subchapters")]
        if "is_favorite" not in existing_subchapters:
            conn.execute(text("ALTER TABLE subchapters ADD COLUMN is_favorite INTEGER DEFAULT 0"))

    if "knowledge_runs" in inspector.get_table_names():
        existing_runs = [c["name"] for c in inspector.get_columns("knowledge_runs")]
        knowledge_run_columns = {
            "resume_cursor": "TEXT",
            "checkpoint_json": "TEXT DEFAULT '{}'",
            "metrics_json": "TEXT DEFAULT '{}'",
            "rule_version": "TEXT",
            "model_version": "TEXT",
        }
        for column_name, column_type in knowledge_run_columns.items():
            if column_name not in existing_runs:
                conn.execute(text(f"ALTER TABLE knowledge_runs ADD COLUMN {column_name} {column_type}"))

    if "processing_jobs" in inspector.get_table_names():
        existing_jobs = [c["name"] for c in inspector.get_columns("processing_jobs")]
        processing_job_columns = {
            "job_type": "TEXT DEFAULT 'full'",
            "progress": "INTEGER DEFAULT 0",
            "current_stage": "TEXT",
            "attempt_count": "INTEGER DEFAULT 0",
            "heartbeat_at": "DATETIME",
            "retryable": "INTEGER DEFAULT 1",
            "blocked_by_job_id": "TEXT",
            "input_fingerprint": "TEXT",
            "next_retry_at": "DATETIME",
            "retry_schedule_step": "INTEGER DEFAULT 0",
            "last_error_code": "TEXT",
        }
        for column_name, column_type in processing_job_columns.items():
            if column_name not in existing_jobs:
                conn.execute(text(f"ALTER TABLE processing_jobs ADD COLUMN {column_name} {column_type}"))
        conn.execute(text("DROP INDEX IF EXISTS uq_processing_jobs_active_resource"))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_jobs_active_resource_type "
            "ON processing_jobs(resource_id, job_type) "
            "WHERE status IN ('queued', 'waiting', 'retrying_connection', 'waiting_for_connection', 'processing', 'paused')"
        ))

    if "resources" in inspector.get_table_names():
        conn.execute(text("DROP INDEX IF EXISTS uq_resources_user_content_hash_active"))
        conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_resources_user_folder_content_hash_active "
            "ON resources(user_id, folder_id, content_hash) "
            "WHERE content_hash IS NOT NULL AND content_hash != '' AND is_deleted = 0"
        ))

    if "document_insights" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE document_insights ("
            "id TEXT PRIMARY KEY,"
            "resource_id TEXT NOT NULL UNIQUE,"
            "status TEXT DEFAULT 'pending',"
            "content_hash TEXT,"
            "short_summary TEXT,"
            "detailed_summary TEXT,"
            "topics TEXT,"
            "keywords TEXT,"
            "key_concepts TEXT,"
            "named_entities TEXT,"
            "difficulty_level TEXT,"
            "estimated_reading_minutes INTEGER,"
            "document_language TEXT,"
            "document_type TEXT,"
            "suggested_questions TEXT,"
            "related_documents TEXT,"
            "ai_tags TEXT,"
            "analysis_duration_ms FLOAT,"
            "llm_usage TEXT,"
            "token_usage TEXT,"
            "estimated_cost FLOAT,"
            "retry_count INTEGER DEFAULT 0,"
            "error_message TEXT,"
            "created_at DATETIME,"
            "updated_at DATETIME"
            ")"
        ))

    if "storage_paths" not in inspector.get_table_names():
        conn.execute(text("CREATE TABLE storage_paths (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL, user_id TEXT NOT NULL)"))

    if "users" in inspector.get_table_names():
        existing_users = [c["name"] for c in inspector.get_columns("users")]
        if "storage_root" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN storage_root TEXT"))
        if "active_storage_path_id" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN active_storage_path_id TEXT"))
        if "avatar_url" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url TEXT"))
        if "banner_url" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN banner_url TEXT"))
        if "username_changed_at" not in existing_users:
            conn.execute(text("ALTER TABLE users ADD COLUMN username_changed_at DATETIME"))

    if "user_sessions" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE user_sessions ("
            "  id TEXT PRIMARY KEY,"
            "  user_id TEXT NOT NULL,"
            "  user_agent TEXT,"
            "  device TEXT,"
            "  browser TEXT,"
            "  ip_address TEXT,"
            "  created_at DATETIME,"
            "  last_active DATETIME"
            ")"
        ))

    if "download_tasks" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE download_tasks ("
            "  id TEXT PRIMARY KEY,"
            "  url TEXT NOT NULL,"
            "  status TEXT DEFAULT 'queued',"
            "  progress INTEGER DEFAULT 0,"
            "  file_name TEXT,"
            "  error_message TEXT,"
            "  created_at DATETIME,"
            "  updated_at DATETIME,"
            "  user_id TEXT NOT NULL,"
            "  folder_id TEXT,"
            "  playlist_id TEXT,"
            "  task_type TEXT,"
            "  username TEXT"
            ")"
        ))
    else:
        existing_dt = [c["name"] for c in inspector.get_columns("download_tasks")]
        if "folder_id" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN folder_id TEXT"))
        if "playlist_id" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN playlist_id TEXT"))
        if "progress" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN progress INTEGER DEFAULT 0"))
        if "file_name" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN file_name TEXT"))
        if "error_message" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN error_message TEXT"))
        if "updated_at" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN updated_at DATETIME"))
        if "task_type" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN task_type TEXT"))
        if "username" not in existing_dt:
            conn.execute(text("ALTER TABLE download_tasks ADD COLUMN username TEXT"))

    if "notifications" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE notifications ("
            "  id TEXT PRIMARY KEY,"
            "  user_id TEXT NOT NULL,"
            "  category TEXT NOT NULL,"
            "  title TEXT NOT NULL,"
            "  message TEXT NOT NULL,"
            "  actor_id TEXT,"
            "  link TEXT,"
            "  item_thumb TEXT,"
            "  item_meta TEXT,"
            "  is_read INTEGER DEFAULT 0,"
            "  is_archived INTEGER DEFAULT 0,"
            "  created_at DATETIME"
            ")"
        ))

    if "activity_logs" not in inspector.get_table_names():
        conn.execute(text(
            "CREATE TABLE activity_logs ("
            "  id TEXT PRIMARY KEY,"
            "  user_id TEXT NOT NULL,"
            "  category TEXT NOT NULL,"
            "  action TEXT NOT NULL,"
            "  detail TEXT,"
            "  created_at DATETIME"
            ")"
        ))
        conn.execute(text("CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id)"))
        conn.execute(text("CREATE INDEX idx_activity_logs_category ON activity_logs(category)"))
        conn.execute(text("CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at)"))

    if "user_settings" in inspector.get_table_names():
        existing_settings = [c["name"] for c in inspector.get_columns("user_settings")]
        if "rag_chunk_overlap" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_chunk_overlap INTEGER DEFAULT 0"))
        if "rag_query_routing" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_query_routing INTEGER DEFAULT 0"))
        if "rag_nli_verification" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_nli_verification INTEGER DEFAULT 0"))
        if "rag_adaptive_rrf" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_adaptive_rrf INTEGER DEFAULT 1"))
        if "rag_parent_child" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_parent_child INTEGER DEFAULT 0"))
        if "rag_hierarchical" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_hierarchical INTEGER DEFAULT 0"))
        if "rag_contextual_enrichment" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN rag_contextual_enrichment INTEGER DEFAULT 0"))
        if "media_contextual_enrichment" not in existing_settings:
            conn.execute(text("ALTER TABLE user_settings ADD COLUMN media_contextual_enrichment INTEGER DEFAULT 0"))
        for col, default in [
            ("chat_base_url", None), ("chat_api_key", None), ("chat_model", None),
            ("embedding_base_url", None), ("embedding_api_key", None), ("embedding_model", None),
            ("reranker_base_url", None), ("reranker_api_key", None), ("reranker_model", None),
            ("knowledge_base_url", None), ("knowledge_api_key", None), ("knowledge_model", None),
            ("chat_cost_base_url", None), ("chat_cost_api_key", None),
            ("wallet_balance_base_url", None), ("wallet_balance_api_key", None),
            ("whisper_threads", 0),
            ("tesseract_path", None),
            ("wtp_model_path", None),
            ("notifications_enabled", 1),
            ("knowledge_node_distance", 140),
            ("knowledge_view_preferences", None),
        ]:
            if col not in existing_settings:
                if default is None:
                    conn.execute(text(f"ALTER TABLE user_settings ADD COLUMN {col} VARCHAR"))
                else:
                    conn.execute(text(f"ALTER TABLE user_settings ADD COLUMN {col} INTEGER DEFAULT {default}"))

    conn.commit()

app = FastAPI()

from fastapi.responses import JSONResponse
from services.dependency_failure_service import DependencyFailure

@app.exception_handler(DependencyFailure)
async def dependency_failure_response(request: Request, failure: DependencyFailure):
    _, message = failure.notification_for("Request")
    return JSONResponse(status_code=503, content={"detail": message, "code": failure.code})


_explorer_event_condition = threading.Condition()
_explorer_event_version = 0

def _notify_explorer_changed():
    global _explorer_event_version
    with _explorer_event_condition:
        _explorer_event_version += 1
        _explorer_event_condition.notify_all()

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _iso(dt):
    return dt.isoformat() if dt else None


def serialize_playlist(p: Playlist, item_count: int = 0):
    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "icon_type": p.icon_type,
        "is_favorite": getattr(p, "is_favorite", 0),
        "created_at": getattr(p, "created_at", None),
        "updated_at": getattr(p, "updated_at", None),
        "item_count": item_count,
    }


def serialize_folder(f: Folder):
    return {
        "id": f.id,
        "name": f.name,
        "playlist_id": f.playlist_id,
        "parent_id": getattr(f, "parent_id", None),
        "is_deleted": getattr(f, "is_deleted", 0),
    }


def serialize_resource(r: Resource):
    preview_status = "unavailable"
    preview_url = None
    if r.thumbnail_path:
        preview_status = "ready"
        preview_url = f"/resources/{r.id}/thumbnail"
    elif r.type in ("image", "video"):
        preview_status = "generating" if r.type == "video" else "ready"
        preview_url = f"/resources/{r.id}/thumbnail" if r.type == "video" else f"/resources/{r.id}/file"

    return {
        "id": r.id,
        "title": r.title,
        "description": r.description,
        "tags": r.tags,
        "type": r.type,
        "local_path": r.local_path,
        "thumbnail_path": r.thumbnail_path,
        "preview_url": preview_url,
        "preview_status": preview_status,
        "file_size": r.file_size,
        "duration_seconds": r.duration_seconds,
        "processing_status": r.processing_status,
        "document_insight_status": getattr(getattr(r, "document_insight", None), "status", None),
        "transcript": r.transcript,
        "summary": r.summary,
        "chapters_json": r.chapters_json,
        "is_embedded": getattr(r, "is_embedded", "false"),
        "created_at": _iso(r.created_at),
        "folder_id": r.folder_id,
    }


def _duplicate_resource_http_exception(existing_resource: Resource) -> HTTPException:
    existing_name = existing_resource.title or "existing resource"
    return HTTPException(
        status_code=409,
        detail=f"Duplicate resource blocked. This content already exists as '{existing_name}'.",
    )


def _extract_youtube_video_id(value: str | None) -> str | None:
    if not value:
        return None

    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/)([A-Za-z0-9_-]{6,})",
        r"-([A-Za-z0-9_-]{6,})\.mp4$",
    ]
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            return match.group(1)
    return None


def _get_owned_playlist(db: Session, playlist_id: str, user_id: str):
    return (
        db.query(Playlist)
        .filter(Playlist.id == playlist_id, Playlist.user_id == user_id)
        .first()
    )


def _touch_playlist(db: Session, playlist_id: str):
    """Update a playlist's updated_at timestamp."""
    pl = db.query(Playlist).filter(Playlist.id == playlist_id).first()
    if pl:
        pl.updated_at = datetime.utcnow().isoformat()


def _get_owned_folder(db: Session, folder_id: str, user_id: str):
    return (
        db.query(Folder)
        .filter(Folder.id == folder_id, Folder.user_id == user_id)
        .first()
    )


def _get_owned_resource(db: Session, resource_id: str, user_id: str):
    return (
        db.query(Resource)
        .filter(Resource.id == resource_id, Resource.user_id == user_id)
        .first()
    )


def serialize_chapter(c: Chapter):
    return {
        "id": c.id,
        "resource_id": c.resource_id,
        "title": c.title,
        "start_time": c.start_time,
        "end_time": c.end_time,
        "summary": c.summary,
        "transcript": c.transcript,
    }


def serialize_subchapter(s: SubChapter):
    return {
        "id": s.id,
        "chapter_id": s.chapter_id,
        "title": s.title,
        "start_time": s.start_time,
        "end_time": s.end_time,
        "summary": s.summary,
        "transcript": s.transcript,
    }


def serialize_note(n: Note):
    tags_data = getattr(n, "tags", None)
    parsed_tags = []
    if tags_data:
        try:
            import json
            parsed_tags = json.loads(tags_data) if isinstance(tags_data, str) else tags_data
        except Exception:
            parsed_tags = []
    if not isinstance(parsed_tags, list):
        parsed_tags = []

    return {
        "id": n.id,
        "title": n.title,
        "content": n.content,
        "note_type": n.note_type,
        "resource_id": n.resource_id,
        "chapter_id": n.chapter_id,
        "subchapter_id": n.subchapter_id,
        "concept_id": getattr(n, "concept_id", None),
        "playlist_id": getattr(n, "playlist_id", None),
        "folder_id": getattr(n, "folder_id", None),
        "is_favorite": getattr(n, "is_favorite", 0) == 1,
        "status": getattr(n, "status", "active"),
        "filename": getattr(n, "filename", None),
        "tags": parsed_tags,
        "created_at": _iso(n.created_at),
        "updated_at": _iso(n.updated_at),
    }



def serialize_concept(c: Concept):
    parsed_tags = []
    tags_data = getattr(c, "tags", None)
    if tags_data:
        try:
            parsed_tags = json.loads(tags_data) if isinstance(tags_data, str) else tags_data
        except Exception:
            parsed_tags = []
    if not isinstance(parsed_tags, list):
        parsed_tags = []

    return {
        "id": c.id,
        "name": getattr(c, "canonical_name", None) or c.name,
        "description": c.description,
        "color": c.color,
        "tags": parsed_tags,
        "created_at": _iso(c.created_at),
    }


def serialize_conceptlink(link: ConceptLink, db: Session = None):
    title = "Unknown Target"
    if db:
        t = link.source_type
        try:
            if t == "concept":
                obj = db.query(Concept).filter(Concept.id == link.source_id).first()
                if obj: title = obj.name
            elif t == "note":
                obj = db.query(Note).filter(Note.id == link.source_id).first()
                if obj and getattr(obj, "status", "active") != "deleted": title = obj.title
            elif t == "chapter":
                obj = db.query(Chapter).filter(Chapter.id == link.source_id).first()
                if obj: title = obj.title
            elif t == "subchapter":
                obj = db.query(SubChapter).filter(SubChapter.id == link.source_id).first()
                if obj: title = obj.title
            elif t == "attachment":
                obj = db.query(Attachment).filter(Attachment.id == link.source_id).first()
                if obj: title = obj.file_name
            else: # resource (video, pdf, docx, audio, image)
                obj = db.query(Resource).filter(Resource.id == link.source_id).first()
                if obj and getattr(obj, "is_deleted", 0) == 0: title = obj.title
        except Exception as e:
            logger.error(f"Error getting target title for concept link: {e}")

    return {
        "id": link.id,
        "concept_id": link.concept_id,
        "source_type": link.source_type,
        "source_id": link.source_id,
        "link_type": getattr(link, "link_type", "reference"),
        "target_title": title,
    }


def serialize_notification(n: Notification, db: Session = None):
    actor_data = None
    if n.actor_id and db:
        actor = db.query(User).filter(User.id == n.actor_id).first()
        if actor:
            actor_data = {
                "name": actor.username,
                "avatar": actor.avatar_url or "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100",
            }
            
    if not actor_data and n.actor_id:
        actor_data = {
            "name": "User",
            "avatar": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100",
        }

    return {
        "id": n.id,
        "user_id": n.user_id,
        "category": n.category,
        "title": n.title,
        "message": n.message,
        "link": n.link,
        "actor_id": n.actor_id,
        "actor": actor_data,
        "item_thumb": n.item_thumb,
        "item_meta": n.item_meta,
        "is_read": n.is_read == 1,
        "is_archived": n.is_archived == 1,
        "created_at": _iso(n.created_at),
    }


def create_notification(
    db: Session,
    user_id: str,
    category: str,
    title: str,
    message: str,
    link: str = None,
    actor_id: None = None,
    item_thumb: None = None,
    item_meta: None = None,
):
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if settings and getattr(settings, "notifications_enabled", 1) == 0:
            return None
        notif = Notification(
            id=str(uuid4()),
            user_id=user_id,
            category=category,
            title=title,
            message=message,
            link=link,
            actor_id=actor_id,
            item_thumb=item_thumb,
            item_meta=item_meta,
            is_read=0,
            is_archived=0,
            created_at=datetime.utcnow(),
        )
        db.add(notif)
        db.commit()
        try:
            _notify_explorer_changed()
        except Exception:
            pass
        return notif
    except Exception as e:
        print(f"[NOTIFICATION ERROR] Failed to create notification: {e}")
        db.rollback()
        return None


# ==================================================
# ROOT
# ==================================================


@app.get("/")
def root():
    return {"message": "MyAILibrary Running"}


# ==================================================
# PLAYLISTS
# ==================================================


@app.post("/playlists")
def create_playlist(
    name: str,
    description: str = None,
    icon_type: str = "standup",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fetch user fresh in current session to ensure it's persistent
    user = db.query(User).filter(User.id == current_user.id).one()

    existing = db.query(Playlist).filter(
        Playlist.user_id == user.id,
        Playlist.name == name
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="A playlist with this name already exists.")

    playlist = Playlist(
        id=str(uuid4()),
        name=name,
        description=description,
        icon_type=icon_type,
        user_id=user.id,
        storage_root=user.storage_root,
        created_at=datetime.utcnow().isoformat(),
        updated_at=datetime.utcnow().isoformat()
    )

    # Physical folder creation
    path = get_upload_path(user.username, playlist.name, custom_root=user.storage_root)
    os.makedirs(path, exist_ok=True)
    os.makedirs(os.path.join(path, "Resources"), exist_ok=True)
    os.makedirs(os.path.join(path, "Notes"), exist_ok=True)
    os.makedirs(os.path.join(path, "Media"), exist_ok=True)

    db.add(playlist)
    db.commit()
    db.refresh(playlist)

    return serialize_playlist(playlist)


def create_notes_folder_for_playlist(username: str, playlist_name: str, custom_root: str = None):
    """Ensures the 'notes' subfolder exists within a playlist directory."""
    playlist_path = get_upload_path(username, playlist_name, custom_root=custom_root)
    notes_path = os.path.join(playlist_path, "notes")
    os.makedirs(notes_path, exist_ok=True)
    sys_logger.info(f"Created notes folder: {notes_path}")


@app.post("/import/youtube")
def import_youtube(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url = data.get("url")
    folder_id = data.get("folder_id")
    cookies_content = data.get("cookies_content")
    
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if cookies_content:
        from services.youtube_service import save_youtube_cookies
        save_youtube_cookies(current_user.id, cookies_content)

    # Delegate to existing youtube processing logic
    return create_youtube(
        url=url,
        folder_id=folder_id,
        playlist_id=data.get("playlist_id"),
        db=db,
        current_user=current_user,
    )


@app.get("/youtube/cookies/status")
def youtube_cookies_status(current_user: User = Depends(get_current_user)):
    from services.youtube_service import has_saved_youtube_cookies
    return {"has_cookies": has_saved_youtube_cookies(current_user.id)}


@app.post("/youtube/cookies")
def replace_youtube_cookies(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    cookies_content = data.get("cookies_content")
    if not cookies_content or not str(cookies_content).strip():
        raise HTTPException(status_code=400, detail="cookies.txt content is required")

    from services.youtube_service import save_youtube_cookies
    if not save_youtube_cookies(current_user.id, cookies_content):
        raise HTTPException(status_code=400, detail="Failed to save YouTube cookies")
    return {"has_cookies": True}


@app.post("/tasks/youtube/create")
def create_youtube_task(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url = data.get("url")
    folder_id = data.get("folder_id")
    playlist_id = data.get("playlist_id")
    cookies_content = data.get("cookies_content")
    quality = data.get("quality", "best")

    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    if cookies_content:
        from services.youtube_service import save_youtube_cookies
        save_youtube_cookies(current_user.id, cookies_content)

    # Deduplication check
    existing_task = db.query(DownloadTask).filter(
        DownloadTask.url == url, 
        DownloadTask.user_id == current_user.id,
        DownloadTask.status.in_(["queued", "processing"])
    ).first()
    
    if existing_task:
        raise HTTPException(status_code=409, detail="This video is already in the download queue.")
        
    task = DownloadTask(
        id=str(uuid4()),
        url=url,
        user_id=current_user.id,
        folder_id=folder_id,
        playlist_id=playlist_id,
        status="queued",
        quality=quality
    )
    db.add(task)
    db.commit()
    
    return {"task_id": task.id, "status": "queued"}


@app.get("/folders/check-social-exist")
def check_social_exist(
    playlist_id: str,
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Find "Media" folder
    social_folder = db.query(Folder).filter(
        Folder.name == "Media",
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id,
        or_(Folder.parent_id.is_(None), Folder.parent_id == "")
    ).first()
    
    if not social_folder:
        return {"exists": False}
        
    # Check if folder name matching username exists under Social Media
    subfolder = db.query(Folder).filter(
        func.lower(Folder.name) == username.lower(),
        Folder.parent_id == social_folder.id,
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id
    ).first()
    
    if subfolder:
        path = _get_folder_path(subfolder, db, current_user)
        if os.path.exists(path):
            return {"exists": True, "folder_id": subfolder.id}
            
    # Also double check physical folder existence on disk
    root_path = _get_folder_path(social_folder, db, current_user)
    physical_path = os.path.join(root_path, username)
    if os.path.exists(physical_path):
        return {"exists": True}
        
    return {"exists": False}


@app.get("/social/cookies/status")
def social_cookies_status(
    platform: str,
    current_user: User = Depends(get_current_user),
):
    from services.social_service import has_saved_social_cookies
    return {"has_cookies": has_saved_social_cookies(current_user.id, platform)}


@app.post("/social/cookies")
def replace_social_cookies(
    data: dict,
    current_user: User = Depends(get_current_user),
):
    platform = data.get("platform")
    cookies_content = data.get("cookies_content")
    if not cookies_content or not str(cookies_content).strip():
        raise HTTPException(status_code=400, detail="cookies.txt content is required")

    from services.social_service import save_social_cookies
    if not save_social_cookies(current_user.id, platform, cookies_content):
        raise HTTPException(status_code=400, detail="Failed to save social cookies")
    return {"has_cookies": True}


@app.post("/tasks/social/create")
def create_social_task(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    url = data.get("url")
    platform = data.get("platform")  # "twitter" or "instagram"
    username = data.get("username")
    playlist_id = data.get("playlist_id")
    replace = data.get("replace", False)
    cookies_content = data.get("cookies_content", "")  # Manual cookie file content

    if not url or not platform or not username or not playlist_id:
        raise HTTPException(status_code=400, detail="Missing required fields")

    if cookies_content:
        from services.social_service import save_social_cookies
        save_social_cookies(current_user.id, platform, cookies_content)

    # 1. Ensure Media folder exists
    social_folder = db.query(Folder).filter(
        Folder.name == "Media",
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id,
        or_(Folder.parent_id.is_(None), Folder.parent_id == "")
    ).first()
    
    if not social_folder:
        social_folder = Folder(
            id=str(uuid4()),
            name="Media",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None
        )
        db.add(social_folder)
        db.commit()
        db.refresh(social_folder)
        path = _get_folder_path(social_folder, db, current_user)
        os.makedirs(path, exist_ok=True)

    # 2. Check if subfolder for username exists
    subfolder = db.query(Folder).filter(
        func.lower(Folder.name) == username.lower(),
        Folder.parent_id == social_folder.id,
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id
    ).first()

    subfolder_id = None
    if subfolder:
        subfolder_id = subfolder.id
        if replace:
            # Delete resources first from DB
            resources = db.query(Resource).filter(
                Resource.folder_id == subfolder_id,
                Resource.user_id == current_user.id
            ).all()
            for r in resources:
                db.delete(r)
            
            # Delete subfolder record from DB
            db.delete(subfolder)
            db.commit()
            
            # Delete physical directory
            path = _get_folder_path(subfolder, db, current_user)
            if os.path.exists(path):
                shutil.rmtree(path, ignore_errors=True)
                
            subfolder_id = None
            subfolder = None

    # Check physical folder just in case record wasn't in DB but files are
    social_root_path = _get_folder_path(social_folder, db, current_user)
    physical_path = os.path.join(social_root_path, username)
    if replace and os.path.exists(physical_path):
        shutil.rmtree(physical_path, ignore_errors=True)

    # 3. Create username subfolder if it does not exist (e.g. was deleted or new)
    if not subfolder_id:
        subfolder = Folder(
            id=str(uuid4()),
            name=username,
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=social_folder.id
        )
        db.add(subfolder)
        db.commit()
        db.refresh(subfolder)
        subfolder_id = subfolder.id
        
        path = _get_folder_path(subfolder, db, current_user)
        os.makedirs(path, exist_ok=True)

    # 4. Check if task is already running/queued
    existing_task = db.query(DownloadTask).filter(
        DownloadTask.url == url,
        DownloadTask.playlist_id == playlist_id,
        DownloadTask.user_id == current_user.id,
        DownloadTask.status.in_(["queued", "processing"])
    ).first()
    
    if existing_task:
        raise HTTPException(status_code=409, detail="A download task for this profile is already in progress.")

    # 5. Create the DownloadTask
    task = DownloadTask(
        id=str(uuid4()),
        url=url,
        user_id=current_user.id,
        folder_id=subfolder_id,
        playlist_id=playlist_id,
        task_type=platform,
        username=username,
        status="queued"
    )
    db.add(task)
    _touch_playlist(db, playlist_id)
    db.commit()

    return {"task_id": task.id, "status": "queued"}



@app.get("/tasks")
def get_download_tasks(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all download tasks for the current user, newest first."""
    tasks = (
        db.query(DownloadTask)
        .filter(DownloadTask.user_id == current_user.id)
        .order_by(DownloadTask.created_at.desc())
        .all()
    )
    return [
        {
            "id": t.id,
            "url": t.url,
            "status": t.status,
            "progress": t.progress or 0,
            "file_name": t.file_name,
            "error_message": t.error_message,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            "folder_id": t.folder_id,
            "playlist_id": t.playlist_id,
            "task_type": t.task_type or "youtube",
            "username": t.username,
        }
        for t in tasks
    ]


@app.delete("/tasks/{task_id}")
def delete_download_task(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a download task by ID (only if owned by current user)."""
    task = (
        db.query(DownloadTask)
        .filter(DownloadTask.id == task_id, DownloadTask.user_id == current_user.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return {"deleted": task_id}


@app.post("/tasks/{task_id}/open-folder")
def open_task_folder(
    task_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Open the directory where the downloaded task files are located in Explorer."""
    task = (
        db.query(DownloadTask)
        .filter(DownloadTask.id == task_id, DownloadTask.user_id == current_user.id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    path = None
    if task.folder_id:
        folder = db.query(Folder).filter(Folder.id == task.folder_id, Folder.user_id == current_user.id).first()
        if folder:
            path = _get_folder_path(folder, db, current_user)

    if not path:
        path = get_upload_path(current_user.username, custom_root=current_user.storage_root)

    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Physical folder does not exist on disk")

    try:
        os.startfile(path)
        return {"opened": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to open folder: {str(e)}")


@app.get("/playlists")
def get_playlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Playlist).filter(Playlist.user_id == current_user.id)

    if current_user.storage_root:
        query = query.filter(Playlist.storage_root == current_user.storage_root)
    else:
        query = query.filter(Playlist.storage_root.is_(None))

    items = query.all()
    items.sort(key=lambda p: p.created_at or "", reverse=True)

    # Count items (resources + notes) for each playlist
    playlist_ids = [p.id for p in items]
    resource_counts = {}
    note_counts = {}
    if playlist_ids:
        # Count resources via folders belonging to each playlist
        folder_ids = [f.id for f in db.query(Folder.id).filter(Folder.playlist_id.in_(playlist_ids), Folder.is_deleted == 0).all()]
        if folder_ids:
            rows = db.query(Resource.folder_id, func.count(Resource.id)).filter(
                Resource.folder_id.in_(folder_ids), Resource.is_deleted == 0
            ).group_by(Resource.folder_id).all()
            for folder_id, cnt in rows:
                # Find which playlist this folder belongs to
                folder = db.query(Folder).filter(Folder.id == folder_id).first()
                if folder and folder.playlist_id:
                    resource_counts[folder.playlist_id] = resource_counts.get(folder.playlist_id, 0) + cnt

        # Count notes per playlist
        rows = db.query(Note.playlist_id, func.count(Note.id)).filter(
            Note.playlist_id.in_(playlist_ids), Note.status != 'deleted'
        ).group_by(Note.playlist_id).all()
        for pl_id, cnt in rows:
            note_counts[pl_id] = cnt

    return [
        serialize_playlist(p, resource_counts.get(p.id, 0) + note_counts.get(p.id, 0))
        for p in items
    ]


@app.get("/playlists/{playlist_id}/resources")
def get_playlist_resources(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
        
    root_folder = db.query(Folder).filter(
        Folder.name == "root",
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id
    ).first()
    
    if not root_folder:
        return []
        
    resources = (
        db.query(Resource)
        .filter(Resource.folder_id == root_folder.id, Resource.user_id == current_user.id)
        .all()
    )
    return [serialize_resource(r) for r in resources]


def _get_root_folder_for_playlist(db: Session, playlist_id: str, current_user: User):
    return (
        db.query(Folder)
        .filter(
            Folder.name == "root",
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id,
        )
        .first()
    )


def _build_folder_breadcrumbs(folder: Folder, db: Session):
    breadcrumbs = []
    current = folder
    seen = set()
    while current and current.id not in seen:
        seen.add(current.id)
        if current.name != "root":
            breadcrumbs.insert(0, serialize_folder(current))
        if not current.parent_id:
            break
        current = db.query(Folder).filter(Folder.id == current.parent_id).first()
    return breadcrumbs


def _get_explorer_payload(
    db: Session,
    playlist_id: str,
    folder_id: str | None,
    current_user: User,
    q: str | None = None,
    recycle_bin: bool = False,
    recursive: bool = False,
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    if recursive and not recycle_bin:
        # Fetch all folders of this playlist that are not deleted
        folders_query = db.query(Folder).filter(
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id,
            or_(Folder.is_deleted != 1, Folder.is_deleted.is_(None))
        )
        if current_user.storage_root:
            folders_query = folders_query.filter(Folder.storage_root == current_user.storage_root)
        else:
            folders_query = folders_query.filter(Folder.storage_root.is_(None))
        all_playlist_folders = folders_query.all()
        folder_ids = [f.id for f in all_playlist_folders]

        resources_query = db.query(Resource).filter(
            Resource.user_id == current_user.id,
            Resource.folder_id.in_(folder_ids),
            or_(Resource.is_deleted != 1, Resource.is_deleted.is_(None))
        )
        if q:
            resources_query = resources_query.filter(Resource.title.ilike(f"%{q}%"))
        resources = resources_query.order_by(Resource.title.asc()).all()

        notes_query = db.query(Note).filter(
            Note.playlist_id == playlist_id,
            Note.user_id == current_user.id,
            Note.status != "deleted"
        )
        if q:
            notes_query = notes_query.filter(Note.title.ilike(f"%{q}%"))

        serialized_notes = []
        for note in notes_query.all():
            notes_dir = _get_note_physical_dir_path(db, current_user, playlist_id, note.folder_id)
            local_path = os.path.join(notes_dir, note.filename or f"{note.title or 'note'}.md")
            file_size = 0
            try:
                if os.path.exists(local_path):
                    file_size = os.path.getsize(local_path)
            except Exception:
                pass
            serialized_notes.append({
                "id": note.id,
                "title": note.title or note.filename or "Untitled Note",
                "description": "Notebook Note",
                "tags": note.tags if hasattr(note, "tags") else "[]",
                "type": "document",
                "local_path": local_path,
                "thumbnail_path": None,
                "file_size": file_size,
                "duration_seconds": 0,
                "processing_status": "completed",
                "transcript": None,
                "summary": None,
                "chapters_json": "[]",
                "is_embedded": "false",
                "created_at": _iso(note.created_at) if hasattr(note, "created_at") else None,
                "folder_id": note.folder_id,
                "is_note": True,
            })

        all_resources = [serialize_resource(resource) for resource in resources] + serialized_notes
        return {
            "playlist": serialize_playlist(playlist),
            "current_folder": None,
            "breadcrumbs": [],
            "folders": [],
            "resources": all_resources,
        }

    if recycle_bin:
        # Fetch all deleted folders for this playlist
        all_deleted_folders = db.query(Folder).filter(
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id,
            Folder.is_deleted == 1
        ).all()
        
        # Fetch all deleted resources for this user
        all_deleted_resources = db.query(Resource).filter(
            Resource.user_id == current_user.id,
            Resource.is_deleted == 1
        ).all()
        
        # We need a quick way to check if a folder belongs to this playlist.
        all_playlist_folders = db.query(Folder).filter(
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id
        ).all()
        
        folder_map = {f.id: f for f in all_playlist_folders}
        
        # Filter directly deleted folders (folders where parent is not deleted)
        folders = []
        for f in all_deleted_folders:
            parent_deleted = False
            if f.parent_id and f.parent_id in folder_map:
                parent_deleted = (folder_map[f.parent_id].is_deleted == 1)
            if not parent_deleted:
                folders.append(f)
                
        # Filter directly deleted resources (resources where parent folder is not deleted)
        resources = []
        for r in all_deleted_resources:
            if r.folder_id and r.folder_id in folder_map:
                folder_obj = folder_map[r.folder_id]
                if folder_obj.is_deleted == 1:
                    continue
                resources.append(r)
                
        return {
            "playlist": serialize_playlist(playlist),
            "current_folder": None,
            "breadcrumbs": [],
            "folders": [serialize_folder(folder) for folder in folders],
            "resources": [serialize_resource(resource) for resource in resources],
        }

    active_folder = None
    if folder_id:
        active_folder = _get_owned_folder(db, folder_id, current_user.id)
        if not active_folder or active_folder.playlist_id != playlist_id:
            raise HTTPException(status_code=404, detail="Folder not found")

    folders_query = db.query(Folder).filter(
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id,
    )
    resources_query = db.query(Resource).filter(Resource.user_id == current_user.id)

    # Exclude soft-deleted items in standard view
    folders_query = folders_query.filter(or_(Folder.is_deleted != 1, Folder.is_deleted.is_(None)))
    resources_query = resources_query.filter(or_(Resource.is_deleted != 1, Resource.is_deleted.is_(None)))

    if active_folder:
        folders_query = folders_query.filter(Folder.parent_id == active_folder.id)
        resources_query = resources_query.filter(Resource.folder_id == active_folder.id)
        breadcrumbs = _build_folder_breadcrumbs(active_folder, db)
    else:
        folders_query = folders_query.filter(
            Folder.name != "root",
            or_(Folder.parent_id.is_(None), Folder.parent_id == ""),
        )
        root_folder = _get_root_folder_for_playlist(db, playlist_id, current_user)
        resources_query = resources_query.filter(
            Resource.folder_id == root_folder.id if root_folder else False
        )
        breadcrumbs = []

    if current_user.storage_root:
        folders_query = folders_query.filter(Folder.storage_root == current_user.storage_root)
    else:
        folders_query = folders_query.filter(Folder.storage_root.is_(None))

    if q:
        like_query = f"%{q}%"
        folders_query = folders_query.filter(Folder.name.ilike(like_query))
        resources_query = resources_query.filter(Resource.title.ilike(like_query))

    folders = folders_query.order_by(Folder.name.asc()).all()
    resources = resources_query.order_by(Resource.title.asc()).all()

    # Query notebook notes inside this folder/playlist
    serialized_notes = []
    is_notes_view = False
    is_root_notes_folder = False
    
    if active_folder:
        if active_folder.name.lower() == "notes" and (not active_folder.parent_id or active_folder.parent_id == ""):
            is_root_notes_folder = True
            is_notes_view = True
        else:
            is_notes_view = True
            
    if is_notes_view:
        if is_root_notes_folder:
            notes_query = db.query(Note).filter(
                Note.playlist_id == playlist_id,
                Note.user_id == current_user.id,
                Note.status != "deleted",
                or_(Note.folder_id.is_(None), Note.folder_id == "", Note.folder_id == active_folder.id)
            )
        else:
            notes_query = db.query(Note).filter(
                Note.folder_id == active_folder.id,
                Note.user_id == current_user.id,
                Note.status != "deleted"
            )
            
        for note in notes_query.all():
            notes_dir = _get_note_physical_dir_path(db, current_user, playlist_id, note.folder_id)
            local_path = os.path.join(notes_dir, note.filename or f"{note.title or 'note'}.md")
            
            file_size = 0
            try:
                if os.path.exists(local_path):
                    file_size = os.path.getsize(local_path)
            except Exception:
                pass
                
            serialized_notes.append({
                "id": note.id,
                "title": note.title or note.filename or "Untitled Note",
                "description": "Notebook Note",
                "tags": note.tags if hasattr(note, "tags") else "[]",
                "type": "document",
                "local_path": local_path,
                "thumbnail_path": None,
                "file_size": file_size,
                "duration_seconds": 0,
                "processing_status": "completed",
                "transcript": None,
                "summary": None,
                "chapters_json": "[]",
                "is_embedded": "false",
                "created_at": _iso(note.created_at) if hasattr(note, "created_at") else None,
                "folder_id": note.folder_id if note.folder_id else (active_folder.id if active_folder else None),
                "is_note": True,
            })

    all_resources = [serialize_resource(resource) for resource in resources] + serialized_notes

    return {
        "playlist": serialize_playlist(playlist),
        "current_folder": serialize_folder(active_folder) if active_folder else None,
        "breadcrumbs": breadcrumbs,
        "folders": [serialize_folder(folder) for folder in folders],
        "resources": all_resources,
    }


@app.get("/explorer")
def get_explorer_directory(
    playlist_id: str,
    folder_id: str = None,
    q: str = None,
    recycle_bin: bool = False,
    recursive: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return _get_explorer_payload(db, playlist_id, folder_id, current_user, q, recycle_bin, recursive)


@app.get("/explorer/events")
def stream_explorer_events(
    playlist_id: str,
    folder_id: str = None,
    token: str = None,
):
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")

    user_id = validate_token(token, "access")

    def event_generator():
        last_seen_version = _explorer_event_version
        yield f"event: heartbeat\ndata: {json.dumps({'changed': False})}\n\n"
        while True:
            with _explorer_event_condition:
                _explorer_event_condition.wait(timeout=30)
                current_version = _explorer_event_version

            if current_version != last_seen_version:
                last_seen_version = current_version
                yield f"event: changed\ndata: {json.dumps({'changed': True})}\n\n"
            else:
                yield f"event: heartbeat\ndata: {json.dumps({'changed': False})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/playlists/{playlist_id}/all-folders")
def get_playlist_all_folders(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    # Ensure 'root', 'Notes', 'Media', and 'Resources' folders exist in the database for this playlist
    root_folder = db.query(Folder).filter(Folder.name == "root", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id, or_(Folder.parent_id.is_(None), Folder.parent_id == "")).first()
    if not root_folder:
        root_folder = Folder(
            id=str(uuid4()),
            name="root",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None
        )
        db.add(root_folder)

    notes_folder = db.query(Folder).filter(Folder.name == "Notes", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id, or_(Folder.parent_id.is_(None), Folder.parent_id == "")).first()
    if not notes_folder:
        notes_folder = Folder(
            id=str(uuid4()),
            name="Notes",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None
        )
        db.add(notes_folder)

    media_folder = db.query(Folder).filter(Folder.name == "Media", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id, or_(Folder.parent_id.is_(None), Folder.parent_id == "")).first()
    if not media_folder:
        media_folder = Folder(
            id=str(uuid4()),
            name="Media",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None
        )
        db.add(media_folder)

    resources_folder = db.query(Folder).filter(Folder.name == "Resources", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id, or_(Folder.parent_id.is_(None), Folder.parent_id == "")).first()
    if not resources_folder:
        resources_folder = Folder(
            id=str(uuid4()),
            name="Resources",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None
        )
        db.add(resources_folder)
    
    db.commit()

    # Ensure physical folders exist on disk
    try:
        for f in [notes_folder, media_folder, resources_folder]:
            path = _get_folder_path(f, db, current_user)
            os.makedirs(path, exist_ok=True)
    except Exception as e:
        sys_logger.error(f"Failed to create physical directory: {e}")

    all_folders = db.query(Folder).filter(
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id
    ).all()
    
    # The import destination tree needs every selectable playlist folder,
    # including the root and the three default folders.
    return [serialize_folder(f) for f in all_folders]


@app.get("/resources/{resource_id}/chunks")
def get_resource_chunks(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    chunks = (
        db.query(ChunkIndex)
        .filter(ChunkIndex.resource_id == resource_id)
        .order_by(ChunkIndex.chunk_index.asc())
        .all()
    )

    return [{"chunk_index": c.chunk_index, "content": c.content} for c in chunks]


@app.get("/rag/library/overview")
def get_rag_library_overview(
    playlist_id: str | None = None,
    folder_id: str | None = None,
    q: str | None = None,
    embedded_only: bool | None = None,
    resource_type: str | None = None,
    processing_status: str | None = None,
    page: int = 1,
    page_size: int = 25,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
    if folder_id:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    from services.rag_library_service import get_rag_library_overview as build_rag_library_overview

    return build_rag_library_overview(
        db,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        playlist_id=playlist_id,
        folder_id=folder_id,
        q=q,
        embedded_only=embedded_only,
        resource_type=resource_type,
        processing_status=processing_status,
        page=max(1, page),
        page_size=max(1, min(page_size, 100)),
        sort_by=sort_by,
        sort_order=sort_order,
    )


@app.get("/rag/library/volume")
def get_rag_library_volume(
    days: int = 7,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    q: str | None = None,
    embedded_only: bool | None = None,
    resource_type: str | None = None,
    processing_status: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
    if folder_id:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    from services.rag_library_service import get_rag_library_volume as build_rag_library_volume

    return build_rag_library_volume(
        db,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        days=max(1, min(days, 31)),
        playlist_id=playlist_id,
        folder_id=folder_id,
        q=q,
        embedded_only=embedded_only,
        resource_type=resource_type,
        processing_status=processing_status,
    )


@app.get("/rag/library/resources/{resource_id}")
def get_rag_resource_detail(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.rag_library_service import get_rag_resource_detail as build_rag_resource_detail

    return build_rag_resource_detail(
        db,
        resource=resource,
        storage_root=current_user.storage_root,
    )


@app.get("/rag/library/resources/{resource_id}/chunks")
def get_rag_resource_chunks(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.rag_library_service import get_rag_resource_chunks as build_rag_resource_chunks

    settings = db.query(UserSetting).filter(UserSetting.user_id == current_user.id).first()
    if not settings:
        settings = UserSetting(user_id=current_user.id)

    return {
        "whisper_path": settings.whisper_path or "",
        "whisper_model_path": settings.whisper_model_path or "",
        "auto_sync": (settings.auto_sync or 0) == 1,
        "theme": settings.theme or "system",
        "compact_mode": (settings.compact_mode or 0) == 1,
        "language": settings.language or "en",
        "rag_chunk_overlap": (getattr(settings, "rag_chunk_overlap", 0) or 0) == 1,
        "rag_query_routing": (getattr(settings, "rag_query_routing", 0) or 0) == 1,
        "rag_nli_verification": (getattr(settings, "rag_nli_verification", 0) or 0) == 1,
        "rag_adaptive_rrf": (getattr(settings, "rag_adaptive_rrf", 1) or 0) == 1,
        "rag_parent_child": (getattr(settings, "rag_parent_child", 0) or 0) == 1,
        "rag_hierarchical": (getattr(settings, "rag_hierarchical", 0) or 0) == 1,
        "rag_contextual_enrichment": (getattr(settings, "rag_contextual_enrichment", 0) or 0) == 1,
        "media_contextual_enrichment": (getattr(settings, "media_contextual_enrichment", 0) or 0) == 1,
        "chat_base_url": getattr(settings, "chat_base_url", "") or "",
        "chat_api_key": getattr(settings, "chat_api_key", "") or "",
        "chat_model": getattr(settings, "chat_model", "") or "deepseek/deepseek-v4-flash",
        "embedding_base_url": getattr(settings, "embedding_base_url", "") or "",
        "embedding_api_key": getattr(settings, "embedding_api_key", "") or "",
        "embedding_model": getattr(settings, "embedding_model", "") or "openai/text-embedding-3-large",
        "reranker_base_url": getattr(settings, "reranker_base_url", "") or "",
        "reranker_api_key": getattr(settings, "reranker_api_key", "") or "",
        "reranker_model": getattr(settings, "reranker_model", "") or "rerank-v4.0-fast",
        "knowledge_base_url": getattr(settings, "knowledge_base_url", "") or "",
        "knowledge_api_key": getattr(settings, "knowledge_api_key", "") or "",
        "knowledge_model": getattr(settings, "knowledge_model", "") or "",
        "chat_cost_base_url": getattr(settings, "chat_cost_base_url", "") or "",
        "chat_cost_api_key": getattr(settings, "chat_cost_api_key", "") or "",
        "wallet_balance_base_url": getattr(settings, "wallet_balance_base_url", "") or "",
        "wallet_balance_api_key": getattr(settings, "wallet_balance_api_key", "") or "",
        "whisper_threads": getattr(settings, "whisper_threads", 2) or 2,
        "notifications_enabled": (getattr(settings, "notifications_enabled", 1) or 0) == 1,
        "resource_id": resource.id,
        "chunks": build_rag_resource_chunks(
            db,
            resource=resource,
            storage_root=current_user.storage_root,
        ),
    }


@app.get("/rag/library/resources/{resource_id}/retrieve-preview")
def get_rag_retrieval_preview(
    resource_id: str,
    q: str,
    top_k: int = 5,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.rag_library_service import get_rag_retrieval_preview as build_rag_retrieval_preview

    return build_rag_retrieval_preview(
        db,
        resource=resource,
        storage_root=current_user.storage_root,
        query=q,
        top_k=max(1, min(top_k, 20)),
    )


@app.get("/rag/library/retrieve-preview")
def get_rag_library_retrieve_preview(
    q: str,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    top_k: int = 5,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
    if folder_id:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    from services.rag_library_service import get_rag_library_retrieval_preview as build_rag_library_retrieval_preview

    return build_rag_library_retrieval_preview(
        db,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        query=q,
        playlist_id=playlist_id,
        folder_id=folder_id,
        top_k=max(1, min(top_k, 20)),
    )


@app.get("/rag/library/search")
def search_rag_library(
    q: str,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
    if folder_id:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    from services.rag_library_service import search_rag_library as run_rag_library_search

    return run_rag_library_search(
        db,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        query=q,
        playlist_id=playlist_id,
        folder_id=folder_id,
        limit=max(1, min(limit, 100)),
    )


@app.get("/resources/{resource_id}/bm25-test")
def bm25_test(
    resource_id: str,
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.bm25_service import search_resource_bm25
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    return search_resource_bm25(resource_id, q)


@app.get("/resources/{resource_id}/hybrid-test")
def hybrid_test(
    resource_id: str,
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.hybrid_service import search_resource_hybrid
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    return search_resource_hybrid(resource_id, q)


@app.get("/resources/{resource_id}/rerank-test")
def rerank_test(
    resource_id: str,
    q: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.hybrid_service import search_resource_hybrid
    from services.reranker_service import rerank_results
    
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
        
    # Hybrid retrieval
    hybrid_results = search_resource_hybrid(resource_id, q, top_k=20)
    
    # Rerank
    reranked_results = rerank_results(q, hybrid_results, top_k=5, user_id=current_user.id)
    
    return reranked_results


@app.on_event("startup")
def startup_queue_worker():
    """Start the queue worker on app startup."""
    QueueWorker.start()
    DownloaderWorker.start()
    start_periodic_sync()


# ==================================================
# FOLDERS
# ==================================================


def _get_folder_path(folder: Folder, db: Session, current_user: User) -> str:
    playlist_name = None
    if folder.playlist_id:
        if folder.playlist:
            playlist_name = folder.playlist.name
        else:
            playlist = db.query(Playlist).filter(Playlist.id == folder.playlist_id, Playlist.user_id == current_user.id).first()
            playlist_name = playlist.name if playlist else None
        
    root = current_user.storage_root or UPLOADS_ROOT
    if playlist_name:
        if folder.name == 'root':
            return os.path.join(root, current_user.username, playlist_name)
        
        path_parts = [folder.name]
        curr = folder
        while curr.parent_id:
            parent = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
            if parent and parent.name != 'root':
                path_parts.insert(0, parent.name)
                curr = parent
            else:
                break
                
        return os.path.join(root, current_user.username, playlist_name, *path_parts)
    else:
        # Standalone custom folder
        path_parts = [folder.name]
        curr = folder
        while curr.parent_id:
            parent = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
            if parent and parent.name != 'root':
                path_parts.insert(0, parent.name)
                curr = parent
            else:
                break
        return os.path.join(root, current_user.username, *path_parts)


@app.post("/folders")
def create_folder(
    name: str,
    playlist_id: str = None,
    parent_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if playlist_id == "null" or playlist_id == "":
        playlist_id = None

    if playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")

    if parent_id == "null" or parent_id == "":
        parent_id = None

    # Check for existing folder (idempotency check)
    query = db.query(Folder).filter(
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id,
        Folder.parent_id == parent_id
    )
    
    # Case-insensitive check for default names to prevent duplicates
    if name.lower() in ["notes", "resources"]:
        existing = query.filter(func.lower(Folder.name) == name.lower()).first()
        if existing:
            return serialize_folder(existing)

    folder = Folder(
        id=str(uuid4()),
        name=name,
        playlist_id=playlist_id,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        parent_id=parent_id,
    )

    # Physical folder creation: resolve hierarchical path
    path = _get_folder_path(folder, db, current_user)
    os.makedirs(path, exist_ok=True)

    db.add(folder)
    if playlist_id:
        _touch_playlist(db, playlist_id)
    db.commit()
    db.refresh(folder)
    _notify_explorer_changed()

    return serialize_folder(folder)


@app.get("/folders")
def get_folders(
    playlist_id: str = None,
    parent_id: str = None,
    all_folders: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sys_logger.info(f"[FOLDERS] get_folders called with playlist_id={playlist_id}, parent_id={parent_id}, all_folders={all_folders}")
    query = db.query(Folder).filter(Folder.user_id == current_user.id)
    
    if all_folders:
        if current_user.storage_root:
            query = query.filter(Folder.storage_root == current_user.storage_root)
        else:
            query = query.filter(Folder.storage_root.is_(None))
    items = query.all()
    return [serialize_folder(f) for f in items]

    if playlist_id == "null" or playlist_id == "":
        playlist_id = None

    if playlist_id:
        query = query.filter(Folder.playlist_id == playlist_id)
    else:
        query = query.filter(Folder.playlist_id.is_(None))
        
    # Filter by parent_id to support hierarchies. 
    # If parent_id parameter is passed as "null" (string) or empty string from frontend, treat it as None
    if parent_id == "null" or parent_id == "":
        parent_id = None
        
    if parent_id:
        query = query.filter(Folder.parent_id == parent_id)
    else:
        # Exclude 'root' folder from root results
        query = query.filter(or_(Folder.parent_id.is_(None), Folder.parent_id == ""))

    if current_user.storage_root:
        query = query.filter(Folder.storage_root == current_user.storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))
        
    items = query.all()
    return [serialize_folder(f) for f in items]


@app.get("/folders/{folder_id}/resources")
def get_folder_resources(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    resources = (
        db.query(Resource)
        .filter(Resource.folder_id == folder_id, Resource.user_id == current_user.id)
        .all()
    )

    return [serialize_resource(resource) for resource in resources]


@app.get("/folders/{folder_id}/details")
def get_folder_details(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    folder = _get_owned_folder(db, folder_id, current_user.id)

    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    resources = (
        db.query(Resource)
        .filter(Resource.folder_id == folder_id, Resource.user_id == current_user.id)
        .all()
    )

    return {
        "folder": serialize_folder(folder),
        "resources": [serialize_resource(resource) for resource in resources],
    }


# ==================================================
# RESOURCES
# ==================================================


@app.get("/resources")
def get_resources(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Filter resources based on folder's storage_root
    query = db.query(Resource).join(Folder, Resource.folder_id == Folder.id).filter(Resource.user_id == current_user.id)
    
    if current_user.storage_root:
        query = query.filter(Folder.storage_root == current_user.storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))
        
    items = query.all()
    return [serialize_resource(r) for r in items]


@app.get("/resources/{resource_id}")
def get_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    item = _get_owned_resource(db, resource_id, current_user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Resource not found")

    return serialize_resource(item)


@app.get("/resources/{resource_id}/file")
def get_resource_file(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_owned_resource(db, resource_id, current_user.id)
    if not item or not item.local_path:
        raise HTTPException(status_code=404, detail="Resource file not found")
        
    if not os.path.exists(item.local_path):
        raise HTTPException(status_code=404, detail="Physical file does not exist")
        
    return FileResponse(item.local_path)


@app.get("/resources/{resource_id}/thumbnail")
def get_resource_thumbnail(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_owned_resource(db, resource_id, current_user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Resource thumbnail not found")

    thumbnail_exists = False
    if item.thumbnail_path:
        if item.thumbnail_path.startswith(("http://", "https://")):
            return RedirectResponse(item.thumbnail_path)
        thumbnail_exists = os.path.exists(item.thumbnail_path)

    if item.type == "video" and item.local_path and os.path.exists(item.local_path) and not thumbnail_exists:
        try:
            from services.video_service import generate_video_thumbnail

            item.thumbnail_path = generate_video_thumbnail(item.local_path, item.id)
            db.commit()
            thumbnail_exists = os.path.exists(item.thumbnail_path)
        except Exception as e:
            sys_logger.error(f"[THUMBNAIL] Failed to generate video thumbnail for {item.id}: {e}")

    if not item.thumbnail_path:
        raise HTTPException(status_code=404, detail="Resource thumbnail not found")

    if not thumbnail_exists and not os.path.exists(item.thumbnail_path):
        raise HTTPException(status_code=404, detail="Physical thumbnail does not exist")

    return FileResponse(item.thumbnail_path)


@app.get("/resources/{resource_id}/srt")
def get_resource_srt(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    item = _get_owned_resource(db, resource_id, current_user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.youtube_service import extract_video_id

    srt_dir = os.path.join(EXTRAA_FILES_ROOT, resource_id)
    srt_files = glob(os.path.join(srt_dir, "*.srt")) if os.path.exists(srt_dir) else []
    if not srt_files and (item.type or "").lower() == "youtube" and item.description:
        video_id = extract_video_id(item.description)
        if video_id:
            legacy_srt_path = os.path.join("temp_audio", f"{video_id}.srt")
            if os.path.exists(legacy_srt_path):
                os.makedirs(srt_dir, exist_ok=True)
                migrated_srt_path = os.path.join(srt_dir, f"{video_id}.srt")
                shutil.copyfile(legacy_srt_path, migrated_srt_path)
                legacy_txt_path = os.path.join("temp_audio", f"{video_id}.txt")
                migrated_txt_path = os.path.join(srt_dir, f"{video_id}.txt")
                if os.path.exists(legacy_txt_path) and not os.path.exists(migrated_txt_path):
                    shutil.copyfile(legacy_txt_path, migrated_txt_path)
                srt_files = [migrated_srt_path]
    if not srt_files:
        if (item.type or "").lower() in {"audio", "video", "youtube"}:
            raise HTTPException(
                status_code=404,
                detail="Timed subtitle file not found for this media resource",
            )

        transcript_text = (item.transcript or "").strip()
        if not transcript_text:
            raise HTTPException(status_code=404, detail="SRT file not found")

        from services.transcription_service import generate_srt_from_text, get_media_duration

        duration_seconds = float(item.duration_seconds or 0)
        if duration_seconds <= 0 and item.local_path and os.path.exists(item.local_path):
            duration_seconds = get_media_duration(item.local_path)

        os.makedirs(srt_dir, exist_ok=True)
        source_name = os.path.splitext(os.path.basename(item.local_path or item.title or resource_id))[0] or resource_id
        synthesized_srt_path = os.path.join(srt_dir, f"{source_name}.srt")
        synthesized_txt_path = os.path.join(srt_dir, f"{source_name}.txt")

        srt_content = generate_srt_from_text(transcript_text, duration_seconds)
        with open(synthesized_srt_path, "w", encoding="utf-8") as handle:
            handle.write(srt_content)
        with open(synthesized_txt_path, "w", encoding="utf-8") as handle:
            handle.write(transcript_text)

        srt_files = [synthesized_srt_path]

    return FileResponse(srt_files[0], media_type="text/plain")


def get_resource_folder_path(db: Session, resource: Resource, user_id: str) -> str:
    if not resource.folder_id:
        return "No Folder Selected"
    
    path_segments = []
    curr_folder = db.query(Folder).filter(Folder.id == resource.folder_id, Folder.user_id == user_id).first()
    
    playlist = None
    while curr_folder:
        path_segments.insert(0, curr_folder.name)
        if curr_folder.playlist_id:
            playlist = db.query(Playlist).filter(Playlist.id == curr_folder.playlist_id, Playlist.user_id == user_id).first()
            break
        if curr_folder.parent_id:
            curr_folder = db.query(Folder).filter(Folder.id == curr_folder.parent_id, Folder.user_id == user_id).first()
        else:
            break
            
    if playlist:
        path_segments.insert(0, playlist.name)
        
    return " / ".join(path_segments) if path_segments else "No Folder Selected"


@app.get("/resources/{resource_id}/details")
def get_resource_details(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    chapters = db.query(Chapter).filter(Chapter.resource_id == resource_id).all()

    chapter_ids = [chapter.id for chapter in chapters]

    subchapters = (
        db.query(SubChapter).filter(SubChapter.chapter_id.in_(chapter_ids)).all()
    )

    playlist_id = None
    playlist_name = "Playlist"
    folder_name = "Folder"

    if resource.folder_id:
        folder = db.query(Folder).filter(Folder.id == resource.folder_id, Folder.user_id == current_user.id).first()
        if folder:
            folder_name = folder.name if folder.name != "root" else "resources"
            curr = folder
            while curr:
                if curr.playlist_id:
                    playlist_id = curr.playlist_id
                    break
                if curr.parent_id:
                    curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
                else:
                    break

    if playlist_id:
        playlist = db.query(Playlist).filter(Playlist.id == playlist_id, Playlist.user_id == current_user.id).first()
        if playlist:
            playlist_name = playlist.name

    resource_data = serialize_resource(resource)
    resource_data["folder_path"] = get_resource_folder_path(db, resource, current_user.id)
    resource_data["playlist_id"] = playlist_id
    resource_data["playlist_name"] = playlist_name
    resource_data["folder_name"] = folder_name
    from services.document_intelligence_service import serialize_document_insight
    document_insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource_id).first()
    from services.knowledge_service import serialize_knowledge_state
    knowledge_state = serialize_knowledge_state(db, resource)
    resource_data["knowledge_status"] = knowledge_state["status"]
    resource_data["knowledge_active_version"] = knowledge_state["active_version"]
    resource_data["knowledge_generated_at"] = knowledge_state["generated_at"]
    resource_data["knowledge_stale_reasons"] = knowledge_state["stale_reasons"]
    resource_data["knowledge_job_id"] = knowledge_state["job_id"]

    return {
        "resource": resource_data,
        "chapters": [serialize_chapter(c) for c in chapters],
        "subchapters": [serialize_subchapter(s) for s in subchapters],
        "document_insight": serialize_document_insight(document_insight),
        "knowledge": knowledge_state,
    }



# ==================================================
# YOUTUBE
# ==================================================


@app.post("/youtube")
def create_youtube(
    url: str,
    folder_id: str = None,
    playlist_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    quality: str = "best",
):
    from services.youtube_service import create_youtube as _yt_create
    result = _yt_create(
        url=url,
        folder_id=folder_id,
        playlist_id=playlist_id,
        db=db,
        current_user=current_user,
        quality=quality,
    )
    if playlist_id:
        _touch_playlist(db, playlist_id)
        db.commit()
    return result


# ==================================================
# DELETE / RENAME endpoints (resources, folders, playlists)
# ==================================================


def _safe_remove_file(path: str):
    try:
        if (
            path
            and isinstance(path, str)
            and not path.startswith("http")
            and os.path.exists(path)
        ):
            os.remove(path)
    except Exception:
        pass


def _cleanup_derived_files(resource_id: str):
    """Deletes the centralized extraa_files directory for the resource."""
    derived_dir = os.path.join(EXTRAA_FILES_ROOT, resource_id)
    if os.path.exists(derived_dir):
        shutil.rmtree(derived_dir)
        sys_logger.info(f"[DELETE]   Derived files directory removed: {derived_dir}")


def _extract_youtube_video_id(url: str):
    try:
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(url)
        if parsed.hostname == "youtu.be":
            return parsed.path[1:]
        if parsed.hostname in ("www.youtube.com", "youtube.com"):
            return parse_qs(parsed.query).get("v", [None])[0]
    except Exception:
        return None
    return None


def _cleanup_youtube_temp_files(url: str):
    video_id = _extract_youtube_video_id(url)
    if not video_id:
        return

    temp_dir = "temp_audio"
    for ext in [".srt", ".wav", ".txt", ".webm", ".m4a"]:
        _safe_remove_file(os.path.join(temp_dir, f"{video_id}{ext}"))

    for path in glob(os.path.join("uploads", f"*{video_id}*")):
        _safe_remove_file(path)


def _delete_resource_instance(resource: Resource, db: Session):
    """Full cascading delete for a single resource.

    Deletes (in order):
      1. ChromaDB embeddings
      2. Physical files (upload, thumbnail, derived SRT/WAV/TXT)
      3. Attachment records + their files
      4. SubChapters  ->  Chapters
      5. Notes linked to resource / its chapters / subchapters
      6. Flashcards
      7. Quizzes
      8. Summaries
      9. MindMaps
     10. SearchIndex records
     11. Embedding (SQL) records
     12. ProcessingJob records
     13. ConceptLink records
     14. Resource row
    """
    rid = resource.id
    sys_logger.info(f"[DELETE] Starting deletion of resource {rid} ('{resource.title}')")

    # ── 1. ChromaDB ──────────────────────────────────────────────────────────
    try:
        delete_resource_embeddings(rid)
        sys_logger.info(f"[DELETE]   Chroma embeddings removed for resource {rid}")
    except Exception as exc:
        sys_logger.warning(f"[DELETE]   WARNING: could not remove Chroma embeddings: {exc}")

    # ── 2. Physical files ────────────────────────────────────────────────────
    if resource.local_path:
        _safe_remove_file(resource.local_path)
        _cleanup_derived_files(rid)
        sys_logger.info(f"[DELETE]   Local file removed: {resource.local_path}")

    if resource.thumbnail_path:
        _safe_remove_file(resource.thumbnail_path)
        sys_logger.info(f"[DELETE]   Thumbnail removed: {resource.thumbnail_path}")

    if resource.description and isinstance(resource.description, str):
        _cleanup_youtube_temp_files(resource.description)

    # ── 3. Attachments ───────────────────────────────────────────────────────
    attachments = db.query(Attachment).filter(Attachment.resource_id == rid).all()
    sys_logger.info(f"[DELETE]   Deleting {len(attachments)} attachment(s)")
    for a in attachments:
        _safe_remove_file(a.file_path)
        db.delete(a)

    # ── 4. SubChapters -> Chapters ───────────────────────────────────────────
    chapters = db.query(Chapter).filter(Chapter.resource_id == rid).all()
    chapter_ids = [c.id for c in chapters]
    subchs = (
        db.query(SubChapter)
        .filter(SubChapter.chapter_id.in_(chapter_ids) if chapter_ids else False)
        .all()
    )
    subchapter_ids = [s.id for s in subchs]

    sys_logger.info(
        f"[DELETE]   Deleting {len(chapters)} chapter(s) and {len(subchs)} subchapters"
    )
    for s in subchs:
        db.delete(s)
    for c in chapters:
        db.delete(c)

    # ── 5. Notes (resource-level + chapter-level + subchapter-level) ─────────
    notes_deleted = (
        db.query(Note)
        .filter(
            (Note.resource_id == rid)
            | (Note.chapter_id.in_(chapter_ids) if chapter_ids else False)
            | (Note.subchapter_id.in_(subchapter_ids) if subchapter_ids else False)
        )
        .delete(synchronize_session=False)
    )
    sys_logger.info(f"[DELETE]   Deleted {notes_deleted} note(s)")

    # ── 6. Flashcards ────────────────────────────────────────────────────────
    fc_deleted = db.query(Flashcard).filter(Flashcard.resource_id == rid).delete()
    sys_logger.info(f"[DELETE]   Deleted {fc_deleted} flashcard(s)")

    # ── 7. Quizzes ───────────────────────────────────────────────────────────
    quiz_deleted = (
        db.query(Quiz)
        .filter(
            (Quiz.resource_id == rid)
            | (Quiz.chapter_id.in_(chapter_ids) if chapter_ids else False)
            | (Quiz.subchapter_id.in_(subchapter_ids) if subchapter_ids else False)
        )
        .delete(synchronize_session=False)
    )
    sys_logger.info(f"[DELETE]   Deleted {quiz_deleted} quiz question(s)")

    # ── 8. Summaries ─────────────────────────────────────────────────────────
    summary_deleted = (
        db.query(Summary)
        .filter(
            (Summary.resource_id == rid)
            | (Summary.chapter_id.in_(chapter_ids) if chapter_ids else False)
        )
        .delete(synchronize_session=False)
    )
    sys_logger.info(f"[DELETE]   Deleted {summary_deleted} summary record(s)")

    # ── 9. MindMaps ──────────────────────────────────────────────────────────
    mm_deleted = db.query(MindMap).filter(MindMap.resource_id == rid).delete()
    sys_logger.info(f"[DELETE]   Deleted {mm_deleted} mindmap(s)")

    # ── 10. SearchIndex ──────────────────────────────────────────────────────
    si_deleted = (
        db.query(SearchIndex)
        .filter(SearchIndex.source_type == "resource", SearchIndex.source_id == rid)
        .delete()
    )
    # ── 10a. ChunkIndex ──────────────────────────────────────────────────────
    ci_deleted = db.query(ChunkIndex).filter(ChunkIndex.resource_id == rid).delete()
    sys_logger.info(
        f"[DELETE]   Deleted {si_deleted} search index record(s) and {ci_deleted} chunk index record(s)"
    )

    # Invalidate BM25 cache for this resource
    from services.bm25_service import invalidate_bm25_cache
    invalidate_bm25_cache(rid)

    # ── 11. SQL Embeddings ───────────────────────────────────────────────────
    emb_deleted = (
        db.query(Embedding)
        .filter(Embedding.source_type == "resource", Embedding.source_id == rid)
        .delete()
    )
    sys_logger.info(f"[DELETE]   Deleted {emb_deleted} SQL embedding record(s)")

    # ── 12. Knowledge graph contribution ────────────────────────────────────
    from services.knowledge_service import delete_resource_knowledge
    delete_resource_knowledge(db, rid, resource.user_id)

    # ── 13. ProcessingJobs ───────────────────────────────────────────────────
    job_deleted = (
        db.query(ProcessingJob).filter(ProcessingJob.resource_id == rid).delete()
    )
    sys_logger.info(f"[DELETE]   Deleted {job_deleted} processing job(s)")

    # ── 14. ConceptLinks ─────────────────────────────────────────────────────
    links_deleted = (
        db.query(ConceptLink)
        .filter(
            ((ConceptLink.source_type == "resource") & (ConceptLink.source_id == rid))
            | (
                (ConceptLink.source_type == "chapter")
                & (ConceptLink.source_id.in_(chapter_ids) if chapter_ids else False)
            )
            | (
                (ConceptLink.source_type == "subchapter")
                & (
                    ConceptLink.source_id.in_(subchapter_ids)
                    if subchapter_ids
                    else False
                )
            )
        )
        .delete(synchronize_session=False)
    )
    sys_logger.info(f"[DELETE]   Deleted {links_deleted} concept link(s)")

    # ── 15. Resource row ─────────────────────────────────────────────────────
    db.delete(resource)
    sys_logger.info(f"[DELETE]   Resource row queued for deletion: {rid}")


def _add_outdated_flag(current_val: str, flag: str) -> str:
    """Helper to append specific outdated flags (summary, transcript, structure) to is_embedded."""
    if not current_val or current_val in ["true", "false"]:
        return f"outdated:{flag}"
    if current_val.startswith("outdated"):
        parts = current_val.split(":")
        if len(parts) > 1:
            flags = set(parts[1].split(","))
            flags.add(flag)
            return f"outdated:{','.join(sorted(flags))}"
        return f"outdated:{flag}"
    return f"outdated:{flag}"


@app.post("/resources/{resource_id}/regenerate-transcript")
def regenerate_transcript(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Queue a transcript-only Whisper regeneration without restarting the full pipeline."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    if resource.type not in ["audio", "video", "youtube"]:
        raise HTTPException(status_code=400, detail="Transcript regeneration is only supported for audio, video, or YouTube resources.")

    try:
        resource.is_embedded = _add_outdated_flag(resource.is_embedded, "transcript")
        resource.is_embedded = _add_outdated_flag(resource.is_embedded, "structure")
        db.commit()

        create_processing_job(db, resource_id, job_type="transcript_only")
        sys_logger.info(f"Transcript-only regeneration triggered for resource: {resource_id}")
        log_user_activity(db, current_user.id, 'ai_features', 'Regenerating transcript', resource.title)
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"Error regenerating transcript for {resource_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))

    return {"message": "Regeneration started"}


def _soft_delete_folder_recursive(folder: Folder, db: Session):
    folder.is_deleted = 1
    resources = db.query(Resource).filter(Resource.folder_id == folder.id).all()
    for r in resources:
        r.is_deleted = 1
    subfolders = db.query(Folder).filter(Folder.parent_id == folder.id).all()
    for sf in subfolders:
        _soft_delete_folder_recursive(sf, db)


def _hard_delete_folder_recursive(folder: Folder, db: Session):
    resources = db.query(Resource).filter(Resource.folder_id == folder.id).all()
    for r in resources:
        _delete_resource_instance(r, db)
    subfolders = db.query(Folder).filter(Folder.parent_id == folder.id).all()
    for sf in subfolders:
        _hard_delete_folder_recursive(sf, db)
        
    # Batch delete Notebook notes attached to this folder
    db.query(Note).filter(Note.folder_id == folder.id).delete(synchronize_session=False)
    
    db.delete(folder)


@app.delete("/resources/{resource_id}")
def delete_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a resource. Moves to Recycle Bin if active, or permanently deletes if already in Recycle Bin."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    try:
        if resource.is_deleted == 1:
            _delete_resource_instance(resource, db)
            if resource.folder_id:
                folder = db.query(Folder).filter(Folder.id == resource.folder_id).first()
                if folder and folder.playlist_id:
                    _touch_playlist(db, folder.playlist_id)
            db.commit()
            sys_logger.info(f"[DELETE] Resource {resource_id} permanently deleted.")
            log_user_activity(db, current_user.id, 'resource', 'Deleted resource permanently', resource.title)
        else:
            resource.is_deleted = 1
            if resource.folder_id:
                folder = db.query(Folder).filter(Folder.id == resource.folder_id).first()
                if folder and folder.playlist_id:
                    _touch_playlist(db, folder.playlist_id)
            db.commit()
            sys_logger.info(f"[DELETE] Resource {resource_id} soft-deleted.")
            log_user_activity(db, current_user.id, 'resource', 'Moved resource to recycle bin', resource.title)
        _notify_explorer_changed()
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"[DELETE] ERROR deleting resource {resource_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Deletion failed: {exc}")

    return {"message": "Resource deleted successfully"}


@app.delete("/folders/{folder_id}")
def delete_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a folder. Moves to Recycle Bin if active, or permanently deletes if already in Recycle Bin."""
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    if folder.name in ["Resources", "Notes", "Media", "resources", "notes"] and (not folder.parent_id or folder.parent_id == ""):
        raise HTTPException(status_code=403, detail="Default folders cannot be deleted")

    try:
        if folder.playlist_id:
            _touch_playlist(db, folder.playlist_id)
        if folder.is_deleted == 1:
            _hard_delete_folder_recursive(folder, db)
            db.commit()
            sys_logger.info(f"[DELETE] Folder {folder_id} permanently deleted recursively.")
        else:
            _soft_delete_folder_recursive(folder, db)
            db.commit()
            sys_logger.info(f"[DELETE] Folder {folder_id} soft-deleted recursively.")
        _notify_explorer_changed()
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"[DELETE] ERROR deleting folder {folder_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Deletion failed: {exc}")

    return {"message": "Folder deleted successfully"}


@app.delete("/playlists/{playlist_id}")
def delete_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a playlist and cascade-delete every folder and resource inside it."""
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    folders = (
        db.query(Folder)
        .filter(Folder.playlist_id == playlist_id, Folder.user_id == current_user.id)
        .all()
    )

    sys_logger.info(
        f"[DELETE] Deleting playlist {playlist_id} ('{playlist.name}') with {len(folders)} folder(s)"
    )

    try:
        folder_ids = [f.id for f in folders]
        
        # 1. Fetch all resource rows in bulk
        resources = []
        if folder_ids:
            resources = (
                db.query(Resource)
                .filter(
                    Resource.folder_id.in_(folder_ids),
                    Resource.user_id == current_user.id,
                )
                .all()
            )
        resource_ids = [r.id for r in resources]

        # 2. Batch-delete from ChromaDB
        if resource_ids:
            try:
                from embedding_service import collection
                collection.delete(where={"resource_id": {"$in": resource_ids}})
                sys_logger.info(f"[DELETE] Bulk-removed Chroma embeddings for {len(resource_ids)} resources.")
            except Exception as exc:
                sys_logger.warning(f"[DELETE] Warning, Chroma bulk delete failed: {exc}")

        # 3. Batch-delete DB tables using bulk deletions
        if resource_ids:
            # Gather child chapters & subchapters in bulk
            chapters = db.query(Chapter).filter(Chapter.resource_id.in_(resource_ids)).all()
            chapter_ids = [c.id for c in chapters]
            
            subchapter_ids = []
            if chapter_ids:
                subchapters = db.query(SubChapter).filter(SubChapter.chapter_id.in_(chapter_ids)).all()
                subchapter_ids = [s.id for s in subchapters]

            # Batch delete Attachments
            db.query(Attachment).filter(Attachment.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete SubChapters and Chapters
            if chapter_ids:
                db.query(SubChapter).filter(SubChapter.chapter_id.in_(chapter_ids)).delete(synchronize_session=False)
                db.query(Chapter).filter(Chapter.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete Notes
            note_filters = [Note.resource_id.in_(resource_ids)]
            if chapter_ids:
                note_filters.append(Note.chapter_id.in_(chapter_ids))
            if subchapter_ids:
                note_filters.append(Note.subchapter_id.in_(subchapter_ids))
            db.query(Note).filter(or_(*note_filters)).delete(synchronize_session=False)

            # Batch delete Flashcards
            db.query(Flashcard).filter(Flashcard.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete Quizzes
            quiz_filters = [Quiz.resource_id.in_(resource_ids)]
            if chapter_ids:
                quiz_filters.append(Quiz.chapter_id.in_(chapter_ids))
            if subchapter_ids:
                quiz_filters.append(Quiz.subchapter_id.in_(subchapter_ids))
            db.query(Quiz).filter(or_(*quiz_filters)).delete(synchronize_session=False)

            # Batch delete Summaries
            summary_filters = [Summary.resource_id.in_(resource_ids)]
            if chapter_ids:
                summary_filters.append(Summary.chapter_id.in_(chapter_ids))
            db.query(Summary).filter(or_(*summary_filters)).delete(synchronize_session=False)

            # Batch delete MindMaps
            db.query(MindMap).filter(MindMap.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete SearchIndexes
            db.query(SearchIndex).filter(SearchIndex.source_type == "resource", SearchIndex.source_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete ChunkIndexes
            db.query(ChunkIndex).filter(ChunkIndex.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Invalidate BM25 cache for all affected resources
            from services.bm25_service import invalidate_bm25_cache
            for rid in resource_ids:
                invalidate_bm25_cache(rid)

            # Batch delete SQL Embeddings
            db.query(Embedding).filter(Embedding.source_type == "resource", Embedding.source_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete ProcessingJobs
            from services.knowledge_service import delete_resource_knowledge
            for knowledge_resource_id in resource_ids:
                delete_resource_knowledge(db, knowledge_resource_id, current_user.id)
            db.query(ProcessingJob).filter(ProcessingJob.resource_id.in_(resource_ids)).delete(synchronize_session=False)

            # Batch delete ConceptLinks
            link_filters = [((ConceptLink.source_type == "resource") & ConceptLink.source_id.in_(resource_ids))]
            if chapter_ids:
                link_filters.append(((ConceptLink.source_type == "chapter") & ConceptLink.source_id.in_(chapter_ids)))
            if subchapter_ids:
                link_filters.append(((ConceptLink.source_type == "subchapter") & ConceptLink.source_id.in_(subchapter_ids)))
            db.query(ConceptLink).filter(or_(*link_filters)).delete(synchronize_session=False)

            # Finally, batch delete Resources
            db.query(Resource).filter(Resource.id.in_(resource_ids)).delete(synchronize_session=False)

        # 4. Batch delete Folders and generic notes attached to them
        if folder_ids:
            db.query(Note).filter(Note.folder_id.in_(folder_ids)).delete(synchronize_session=False)
            db.query(Folder).filter(Folder.id.in_(folder_ids)).delete(synchronize_session=False)

        # 5. Delete Notebook notes attached directly to the playlist
        db.query(Note).filter(Note.playlist_id == playlist_id).delete(synchronize_session=False)

        # 6. Delete Playlist row
        db.delete(playlist)
        
        # 6. Physically delete the playlist folder recursively in one go
        user = db.query(User).filter(User.id == current_user.id).one()
        playlist_path = get_upload_path(user.username, playlist.name, custom_root=user.storage_root)
        if os.path.exists(playlist_path):
            import shutil
            shutil.rmtree(playlist_path)
            
        db.commit()
        sys_logger.info(f"[DELETE] Playlist {playlist_id} deleted successfully.")
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"[DELETE] ERROR deleting playlist {playlist_id}: {exc}")
        raise HTTPException(status_code=500, detail=f"Deletion failed: {exc}")

    return {"message": "Playlist deleted successfully"}


@app.patch("/playlists/{playlist_id}")
def rename_playlist(
    playlist_id: str,
    name: str,
    description: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    old_name = playlist.name

    # 1. Rename physical folder
    user = db.query(User).filter(User.id == current_user.id).one()
    old_path = get_upload_path(user.username, old_name, custom_root=user.storage_root)
    new_path = get_upload_path(user.username, name, custom_root=user.storage_root)

    if os.path.exists(old_path):
        os.rename(old_path, new_path)

    # 2. Update DB name
    playlist.name = name
    if description is not None:
        playlist.description = description
    playlist.updated_at = datetime.utcnow().isoformat()

    # 3. Update all resource paths in this playlist
    resources = db.query(Resource).join(Folder).filter(Folder.playlist_id == playlist.id).all()
    for r in resources:
        if r.local_path and r.local_path.startswith(old_path):
            r.local_path = r.local_path.replace(old_path, new_path, 1)

    db.commit()
    return serialize_playlist(playlist)


@app.patch("/playlists/{playlist_id}/icon")
def update_playlist_icon(
    playlist_id: str,
    icon_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    playlist.icon_type = icon_type
    playlist.updated_at = datetime.utcnow().isoformat()
    db.commit()
    return serialize_playlist(playlist)


@app.patch("/playlists/{playlist_id}/favorite")
def toggle_playlist_favorite(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    playlist.is_favorite = 0 if getattr(playlist, "is_favorite", 0) == 1 else 1
    db.commit()
    return serialize_playlist(playlist)


@app.patch("/folders/{folder_id}")
def rename_folder(
    folder_id: str,
    name: str = None,
    playlist_id: str = None,
    parent_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
        
    old_path = _get_folder_path(folder, db, current_user)
    
    location_changed = False
    
    if name is not None:
        folder.name = name
        location_changed = True
        
    if playlist_id is not None:
        if playlist_id == "null" or playlist_id == "":
            new_playlist_id = None
        else:
            new_playlist_id = playlist_id
        if folder.playlist_id != new_playlist_id:
            folder.playlist_id = new_playlist_id
            location_changed = True

    if parent_id is not None:
        if parent_id == "null" or parent_id == "":
            new_parent_id = None
        else:
            new_parent_id = parent_id
        if folder.parent_id != new_parent_id:
            folder.parent_id = new_parent_id
            location_changed = True
            
    if location_changed:
        db.flush()
        new_path = _get_folder_path(folder, db, current_user)
        
        if new_path != old_path:
            if os.path.exists(old_path):
                os.makedirs(os.path.dirname(new_path), exist_ok=True)
                shutil.move(old_path, new_path)
                
            # Update all resource paths in this folder
            resources = db.query(Resource).filter(Resource.folder_id == folder.id).all()
            for r in resources:
                if r.local_path and r.local_path.startswith(old_path):
                    r.local_path = r.local_path.replace(old_path, new_path, 1)
            
            # Recursively update playlist_id for subfolders and notes if playlist changed
            if playlist_id is not None:
                def _update_child_playlists(p_id, pl_id):
                    subfs = db.query(Folder).filter(Folder.parent_id == p_id, Folder.user_id == current_user.id).all()
                    for subf in subfs:
                        subf.playlist_id = pl_id
                        _update_child_playlists(subf.id, pl_id)
                    subnotes = db.query(Note).filter(Note.folder_id == p_id, Note.user_id == current_user.id).all()
                    for sn in subnotes:
                        sn.playlist_id = pl_id
                
                direct_notes = db.query(Note).filter(Note.folder_id == folder.id, Note.user_id == current_user.id).all()
                for sn in direct_notes:
                    sn.playlist_id = folder.playlist_id
                    
                _update_child_playlists(folder.id, folder.playlist_id)

    if folder.playlist_id:
        _touch_playlist(db, folder.playlist_id)
    db.commit()
    _notify_explorer_changed()
    return serialize_folder(folder)


@app.patch("/resources/{resource_id}/title")
def rename_resource_title(
    resource_id: str,
    title: str = None,
    new_filename: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    if title:
        resource.title = title
        
    if new_filename:
        # 1. Rename physical file
        old_path = resource.local_path
        new_path = os.path.join(os.path.dirname(old_path), new_filename)
        
        if os.path.exists(old_path):
            os.rename(old_path, new_path)
            
        # 2. Update DB
        resource.local_path = new_path
        resource.file_name = new_filename
        
    db.commit()
    _notify_explorer_changed()
    log_user_activity(db, current_user.id, 'resource', f'Renamed resource to "{title or new_filename}"', resource.title)
    return serialize_resource(resource)


class ExplorerActionPayload(BaseModel):
    resource_ids: List[str] = []
    folder_ids: List[str] = []
    target_folder_id: str | None = None
    target_playlist_id: str | None = None


def _resolve_explorer_target_folder(payload: ExplorerActionPayload, db: Session, current_user: User):
    if payload.target_folder_id:
        folder = _get_owned_folder(db, payload.target_folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Target folder not found")
        return folder

    if payload.target_playlist_id:
        playlist = _get_owned_playlist(db, payload.target_playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Target playlist not found")
        folder = _get_root_folder_for_playlist(db, payload.target_playlist_id, current_user)
        if not folder:
            folder = Folder(
                id=str(uuid4()),
                name="root",
                playlist_id=payload.target_playlist_id,
                user_id=current_user.id,
                storage_root=current_user.storage_root,
            )
            db.add(folder)
            db.commit()
            db.refresh(folder)
        return folder

    raise HTTPException(status_code=400, detail="Target folder or playlist is required")


@app.post("/explorer/move")
def move_explorer_items(
    payload: ExplorerActionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_folder = _resolve_explorer_target_folder(payload, db, current_user)
    target_dir = _get_folder_path(target_folder, db, current_user)
    os.makedirs(target_dir, exist_ok=True)

    moved = {"resources": 0, "folders": 0}

    for resource_id in payload.resource_ids:
        resource = _get_owned_resource(db, resource_id, current_user.id)
        if not resource:
            continue
        if resource.local_path and os.path.exists(resource.local_path):
            new_path = os.path.join(target_dir, os.path.basename(resource.local_path))
            if os.path.normpath(resource.local_path) != os.path.normpath(new_path):
                shutil.move(resource.local_path, new_path)
                resource.local_path = new_path
        resource.folder_id = target_folder.id
        moved["resources"] += 1

    for folder_id in payload.folder_ids:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder or folder.id == target_folder.id:
            continue
        old_path = _get_folder_path(folder, db, current_user)
        folder.parent_id = None if target_folder.name == "root" else target_folder.id
        folder.playlist_id = target_folder.playlist_id
        new_path = _get_folder_path(folder, db, current_user)
        if os.path.exists(old_path) and os.path.normpath(old_path) != os.path.normpath(new_path):
            os.makedirs(os.path.dirname(new_path), exist_ok=True)
            shutil.move(old_path, new_path)
        moved["folders"] += 1

    if target_folder.playlist_id:
        _touch_playlist(db, target_folder.playlist_id)
    db.commit()
    _notify_explorer_changed()
    return {"moved": moved}


@app.post("/explorer/copy")
def copy_explorer_items(
    payload: ExplorerActionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    target_folder = _resolve_explorer_target_folder(payload, db, current_user)
    target_dir = _get_folder_path(target_folder, db, current_user)
    os.makedirs(target_dir, exist_ok=True)

    copied = {"resources": 0}

    for resource_id in payload.resource_ids:
        resource = _get_owned_resource(db, resource_id, current_user.id)
        if not resource or not resource.local_path:
            continue

        ensure_resource_content_hash(resource)
        if find_duplicate_resource_by_hash(
            db,
            user_id=current_user.id,
            content_hash=resource.content_hash,
            folder_id=target_folder.id,
            exclude_resource_id=resource.id,
        ):
            continue

        new_path = os.path.join(target_dir, os.path.basename(resource.local_path))
        if os.path.exists(resource.local_path) and os.path.normpath(resource.local_path) != os.path.normpath(new_path):
            shutil.copy2(resource.local_path, new_path)
        new_resource = create_resource(
            folder_id=target_folder.id,
            file_name=resource.title,
            file_path=new_path,
            resource_type=resource.type,
            content_length=resource.file_size or 0,
            user_id=current_user.id,
            content_hash=resource.content_hash or "",
        )
        new_resource.description = resource.description
        new_resource.thumbnail_path = resource.thumbnail_path
        try:
            save_resource(db, new_resource)
        except DuplicateResourceError:
            if os.path.exists(new_path):
                os.remove(new_path)
            continue
        copied["resources"] += 1

    if target_folder.playlist_id:
        _touch_playlist(db, target_folder.playlist_id)
    db.commit()
    _notify_explorer_changed()
    return {"copied": copied}


def _restore_folder_recursive(folder: Folder, db: Session):
    folder.is_deleted = 0
    resources = db.query(Resource).filter(Resource.folder_id == folder.id).all()
    for r in resources:
        r.is_deleted = 0
    subfolders = db.query(Folder).filter(Folder.parent_id == folder.id).all()
    for sf in subfolders:
        _restore_folder_recursive(sf, db)


def _restore_parents_recursive(folder_id: str | None, db: Session):
    if not folder_id:
        return
    parent = db.query(Folder).filter(Folder.id == folder_id).first()
    if parent and parent.is_deleted == 1:
        parent.is_deleted = 0
        _restore_parents_recursive(parent.parent_id, db)


@app.post("/explorer/restore")
def restore_explorer_items(
    payload: ExplorerActionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        # Restore folders
        for folder_id in payload.folder_ids:
            folder = _get_owned_folder(db, folder_id, current_user.id)
            if folder:
                _restore_folder_recursive(folder, db)
                _restore_parents_recursive(folder.parent_id, db)

        # Restore resources
        for resource_id in payload.resource_ids:
            resource = _get_owned_resource(db, resource_id, current_user.id)
            if resource:
                resource.is_deleted = 0
                _restore_parents_recursive(resource.folder_id, db)

        # Touch affected playlists
        touched = set()
        for folder_id in payload.folder_ids:
            folder = db.query(Folder).filter(Folder.id == folder_id).first()
            if folder and folder.playlist_id and folder.playlist_id not in touched:
                _touch_playlist(db, folder.playlist_id)
                touched.add(folder.playlist_id)
        for resource_id in payload.resource_ids:
            resource = db.query(Resource).filter(Resource.id == resource_id).first()
            if resource and resource.folder_id:
                folder = db.query(Folder).filter(Folder.id == resource.folder_id).first()
                if folder and folder.playlist_id and folder.playlist_id not in touched:
                    _touch_playlist(db, folder.playlist_id)
                    touched.add(folder.playlist_id)

        db.commit()
        _notify_explorer_changed()
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"[RESTORE] ERROR restoring items: {exc}")
        raise HTTPException(status_code=500, detail=f"Restore failed: {exc}")

    return {"message": "Items restored successfully"}


class EmptyRecycleBinPayload(BaseModel):
    playlist_id: str


@app.post("/explorer/empty-recycle-bin")
def empty_recycle_bin(
    payload: EmptyRecycleBinPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist_id = payload.playlist_id
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    try:
        # Get all deleted folders for this playlist/user
        deleted_folders = db.query(Folder).filter(
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id,
            Folder.is_deleted == 1
        ).all()

        # Get all deleted resources for this playlist/user
        all_playlist_folders = db.query(Folder).filter(
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id
        ).all()
        playlist_folder_ids = {f.id for f in all_playlist_folders}

        deleted_resources = db.query(Resource).filter(
            Resource.user_id == current_user.id,
            Resource.is_deleted == 1,
            Resource.folder_id.in_(list(playlist_folder_ids)) if playlist_folder_ids else False
        ).all()

        # Perform hard deletes
        for r in deleted_resources:
            _delete_resource_instance(r, db)

        for f in deleted_folders:
            if f in db:
                _hard_delete_folder_recursive(f, db)

        db.commit()
        _notify_explorer_changed()
    except Exception as exc:
        db.rollback()
        sys_logger.error(f"[EMPTY_RECYCLE_BIN] ERROR emptying recycle bin: {exc}")
        raise HTTPException(status_code=500, detail=f"Empty Recycle Bin failed: {exc}")

    return {"message": "Recycle bin emptied successfully"}


# ==================================================
# SIMPLE FILE UPLOAD
# ==================================================


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    print(f"DEBUG: user {current_user.username} storage_root: {current_user.storage_root}")
    # Use custom root if available, otherwise default
    root = current_user.storage_root or UPLOADS_ROOT
    upload_dir = os.path.join(root, current_user.username)
    print(f"DEBUG: resolved upload_dir: {upload_dir}")

    os.makedirs(upload_dir, exist_ok=True)

    file_path = os.path.join(upload_dir, file.filename)

    content = await file.read()

    with open(file_path, "wb") as buffer:
        buffer.write(content)

    return {"filename": file.filename, "saved_to": file_path}


@app.post("/voice/transcribe")
async def transcribe_voice_input(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    import subprocess
    temp_dir = "temp_audio"
    os.makedirs(temp_dir, exist_ok=True)
    extension = os.path.splitext(file.filename or "")[1] or ".webm"
    unique_id = uuid4().hex
    file_path = os.path.join(temp_dir, f"voice_{current_user.id}_{unique_id}{extension}")
    wav_path = os.path.join(temp_dir, f"voice_{current_user.id}_{unique_id}.wav")

    try:
        content = await file.read()
        with open(file_path, "wb") as buffer:
            buffer.write(content)

        # Convert webm/opus to 16kHz PCM mono wav using ffmpeg for whisper compatibility
        ffmpeg_cmd = [
            "ffmpeg",
            "-y",
            "-i", file_path,
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            wav_path
        ]
        subprocess.run(ffmpeg_cmd, check=True, capture_output=True)

        result = transcribe_audio(wav_path)
        return {"transcript": (result.get("transcript") or "").strip()}
    except Exception as exc:
        sys_logger.error(f"[VOICE_TRANSCRIBE] ERROR: {exc}")
        raise HTTPException(status_code=500, detail=f"Voice transcription failed: {exc}")
    finally:
        for path_to_remove in (file_path, wav_path):
            try:
                if os.path.exists(path_to_remove):
                    os.remove(path_to_remove)
            except Exception:
                pass
        base_name = os.path.splitext(wav_path)[0]
        for cleanup_path in (f"{base_name}.txt", f"{base_name}.srt"):
            try:
                if os.path.exists(cleanup_path):
                    os.remove(cleanup_path)
            except Exception:
                pass


def _is_social_media_folder(folder: Folder, db: Session, current_user: User) -> bool:
    """Check if the folder is a descendant of the 'Social Media' folder."""
    curr = folder
    while curr:
        if curr.name == "Social Media":
            return True
        if not curr.parent_id:
            break
        curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
    return False


def _is_media_folder(folder: Folder, db: Session, current_user: User) -> bool:
    """Check if the folder is or is a descendant of the 'Media' folder."""
    curr = folder
    while curr:
        if curr.name == "Media":
            return True
        if not curr.parent_id:
            break
        curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
    return False


def _is_resources_folder(folder: Folder, db: Session, current_user: User) -> bool:
    """Check if the folder is or is a descendant of the 'Resources' folder."""
    curr = folder
    while curr:
        if curr.name == "Resources" or curr.name == "resources":
            return True
        if not curr.parent_id:
            break
        curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
    return False


def _is_notes_folder(folder: Folder, db: Session, current_user: User) -> bool:
    """Check if the folder is or is a descendant of the 'Notes' folder."""
    curr = folder
    while curr:
        if curr.name == "Notes" or curr.name == "notes":
            return True
        if not curr.parent_id:
            break
        curr = db.query(Folder).filter(Folder.id == curr.parent_id, Folder.user_id == current_user.id).first()
    return False


def _is_default_folder(folder: Folder, db: Session, current_user: User) -> bool:
    """Check if the folder is or is a descendant of any default folder (Media, Resources, Notes)."""
    return _is_media_folder(folder, db, current_user) or _is_resources_folder(folder, db, current_user) or _is_notes_folder(folder, db, current_user)


def _sync_folder_recursive(folder: Folder, folder_dir: str, db: Session, current_user: User, sync_stats: dict):
    """Recursively syncs a single folder and its nested subfolders."""
    if not os.path.exists(folder_dir):
        return

    # 1. Sync resources (files) in this folder
    physical_files = {}  # path: size
    for name in os.listdir(folder_dir):
        path = os.path.join(folder_dir, name)
        if os.path.isfile(path):
            physical_files[path] = os.path.getsize(path)

    db_resources = db.query(Resource).filter(Resource.folder_id == folder.id, Resource.user_id == current_user.id).all()
    matched_files = set()
    matched_db_res = set()

    for path, size in physical_files.items():
        for r in db_resources:
            if r.local_path and os.path.normpath(r.local_path) == os.path.normpath(path):
                matched_files.add(path)
                matched_db_res.add(r.id)
                break

    for path, size in physical_files.items():
        if path in matched_files: continue
        file_type = detect_resource_type(os.path.basename(path))
        for r in db_resources:
            if r.id in matched_db_res: continue
            if r.file_size and abs(r.file_size - size) < 1024 and detect_resource_type(r.title or "") == file_type:
                r.local_path = path
                r.title = os.path.basename(path)
                db.commit()
                matched_files.add(path)
                matched_db_res.add(r.id)
                break

    for path, size in physical_files.items():
        if path in matched_files:
            continue
        if detect_resource_type(os.path.basename(path)) != "video":
            continue

        path_video_id = _extract_youtube_video_id(path)
        if not path_video_id:
            continue

        for r in db_resources:
            if r.id in matched_db_res or (r.type or "").lower() != "youtube":
                continue

            resource_video_id = (
                _extract_youtube_video_id(r.description)
                or _extract_youtube_video_id(r.local_path)
            )
            if resource_video_id != path_video_id:
                continue

            r.local_path = path
            r.file_size = size
            db.commit()
            matched_files.add(path)
            matched_db_res.add(r.id)
            break

    for path, size in physical_files.items():
        if path not in matched_files:
            resource_type = detect_resource_type(os.path.basename(path))
            resource = create_resource(
                folder_id=folder.id,
                file_name=os.path.basename(path),
                file_path=path,
                resource_type=resource_type,
                content_length=size,
                user_id=current_user.id,
                content_hash=compute_file_content_hash(path) if resource_type in ALLOWED_PROCESSING_TYPES else "",
            )
            try:
                saved = save_resource(db, resource)
            except DuplicateResourceError:
                continue
            if resource_type in ALLOWED_PROCESSING_TYPES:
                if not _is_social_media_folder(folder, db, current_user) and not _is_default_folder(folder, db, current_user):
                    create_processing_job(db, saved.id)
                else:
                    saved.processing_status = "uploaded"
                    db.commit()
            sync_stats["added"]["resources"] += 1

    for r in db_resources:
        if r.id not in matched_db_res:
            _delete_resource_instance(r, db)
            db.commit()
            sync_stats["removed"]["resources"] += 1

    # 2. Sync subfolders in this folder
    physical_subdirs = []
    for name in os.listdir(folder_dir):
        if name == "resources": continue
        path = os.path.join(folder_dir, name)
        if os.path.isdir(path):
            physical_subdirs.append((name, path))

    db_subfolders = db.query(Folder).filter(Folder.parent_id == folder.id, Folder.user_id == current_user.id).all()
    matched_dirs = set()
    matched_db_folders = set()

    # Match by name
    for ph_name, ph_path in physical_subdirs:
        for f in db_subfolders:
            if ph_name == f.name:
                matched_dirs.add(ph_path)
                matched_db_folders.add(f.id)
                _sync_folder_recursive(f, ph_path, db, current_user, sync_stats)
                break

    # Add remaining new subfolders
    for ph_name, ph_path in physical_subdirs:
        if ph_path not in matched_dirs:
            new_f = Folder(
                id=str(uuid4()),
                name=ph_name,
                playlist_id=folder.playlist_id,
                user_id=current_user.id,
                storage_root=current_user.storage_root,
                parent_id=folder.id
            )
            db.add(new_f)
            db.commit()
            db.refresh(new_f)
            sync_stats["added"]["folders"] += 1
            matched_dirs.add(ph_path)
            _sync_folder_recursive(new_f, ph_path, db, current_user, sync_stats)

    # Clean up remaining unmatched DB subfolders
    for f in db_subfolders:
        if f.id not in matched_db_folders:
            delete_folder(f.id, db, current_user)
            sync_stats["removed"]["folders"] += 1


def _sync_playlist(playlist: Playlist, db: Session, current_user: User):
    """Syncs a single playlist: adds new folders/resources, cleans up orphans recursively."""
    sync_stats = {"added": {"folders": 0, "resources": 0}, "removed": {"folders": 0, "resources": 0}}
    user_root = current_user.storage_root or UPLOADS_ROOT
    playlist_dir = os.path.join(user_root, current_user.username, playlist.name)
    
    if not os.path.exists(playlist_dir):
        return sync_stats

    # Ensure default folders exist
    os.makedirs(os.path.join(playlist_dir, "Resources"), exist_ok=True)
    os.makedirs(os.path.join(playlist_dir, "Notes"), exist_ok=True)
    os.makedirs(os.path.join(playlist_dir, "Media"), exist_ok=True)

    # Gather physical items
    physical_folders = []
    for name in os.listdir(playlist_dir):
        if name in ["Resources", "Notes", "Media", "resources", "notes", "Social Media"]: continue
        item_path = os.path.join(playlist_dir, name)
        if os.path.isdir(item_path):
            physical_folders.append((name, item_path))
    
    # Gather top-level DB items
    db_folders = db.query(Folder).filter(
        Folder.playlist_id == playlist.id,
        Folder.user_id == current_user.id,
        Folder.name != "root",
        Folder.name.notin_(["Resources", "Notes", "Media", "resources", "notes", "Social Media"]),
        or_(Folder.parent_id.is_(None), Folder.parent_id == "")
    ).all()
    
    matched_physical = set()
    matched_db = set()
    
    # 1. Match by name
    for ph_name, ph_path in physical_folders:
        for f in db_folders:
            if ph_name == f.name:
                matched_physical.add(ph_path)
                matched_db.add(f.id)
                _sync_folder_recursive(f, ph_path, db, current_user, sync_stats)
                break
    
    # 2. Add remaining new top-level folders
    for ph_name, ph_path in physical_folders:
        if ph_path not in matched_physical:
            folder = Folder(
                id=str(uuid4()),
                name=ph_name,
                playlist_id=playlist.id,
                user_id=current_user.id,
                storage_root=current_user.storage_root,
                parent_id=None
            )
            db.add(folder)
            db.commit()
            db.refresh(folder)
            sync_stats["added"]["folders"] += 1
            matched_physical.add(ph_path)
            _sync_folder_recursive(folder, ph_path, db, current_user, sync_stats)

    # 3. Clean up remaining unmatched top-level DB folders
    for f in db_folders:
        if f.id not in matched_db:
            delete_folder(f.id, db, current_user)
            sync_stats["removed"]["folders"] += 1

    # 4. Sync the "Resources" default folder
    resources_dir = os.path.join(playlist_dir, "Resources")
    if os.path.isdir(resources_dir):
        resources_folder = db.query(Folder).filter(
            Folder.playlist_id == playlist.id,
            Folder.user_id == current_user.id,
            func.lower(Folder.name) == "resources",
        ).first()
        if not resources_folder:
            resources_folder = Folder(
                id=str(uuid4()),
                name="resources",
                playlist_id=playlist.id,
                user_id=current_user.id,
                storage_root=current_user.storage_root,
                parent_id=None,
            )
            db.add(resources_folder)
            db.commit()
            db.refresh(resources_folder)
        _sync_folder_recursive(resources_folder, resources_dir, db, current_user, sync_stats)

    # Handle files in playlist root (sync to DB "root" folder)
    root_folder = db.query(Folder).filter(Folder.name == "root", Folder.playlist_id == playlist.id, Folder.user_id == current_user.id).first()
    if not root_folder:
        root_folder = Folder(id=str(uuid4()), name="root", playlist_id=playlist.id, user_id=current_user.id, storage_root=current_user.storage_root)
        db.add(root_folder)
        db.commit()
        db.refresh(root_folder)
        
    physical_files = {}
    for name in os.listdir(playlist_dir):
        item_path = os.path.join(playlist_dir, name)
        if os.path.isfile(item_path):
            physical_files[item_path] = os.path.getsize(item_path)
            
    db_resources = db.query(Resource).filter(Resource.folder_id == root_folder.id, Resource.user_id == current_user.id).all()
    matched_files = set()
    matched_db_res = set()
    
    for path, size in physical_files.items():
        for r in db_resources:
            if r.local_path and os.path.normpath(r.local_path) == os.path.normpath(path):
                matched_files.add(path)
                matched_db_res.add(r.id)
                break
                
    for path, size in physical_files.items():
        if path in matched_files: continue
        file_type = detect_resource_type(os.path.basename(path))
        for r in db_resources:
            if r.id in matched_db_res: continue
            if r.file_size and abs(r.file_size - size) < 1024 and detect_resource_type(r.title or "") == file_type:
                r.local_path = path
                r.title = os.path.basename(path)
                db.commit()
                matched_files.add(path)
                matched_db_res.add(r.id)
                break
                
    for path, size in physical_files.items():
        if path in matched_files:
            continue
        if detect_resource_type(os.path.basename(path)) != "video":
            continue

        path_video_id = _extract_youtube_video_id(path)
        if not path_video_id:
            continue

        for r in db_resources:
            if r.id in matched_db_res or (r.type or "").lower() != "youtube":
                continue

            resource_video_id = (
                _extract_youtube_video_id(r.description)
                or _extract_youtube_video_id(r.local_path)
            )
            if resource_video_id != path_video_id:
                continue

            r.local_path = path
            r.file_size = size
            db.commit()
            matched_files.add(path)
            matched_db_res.add(r.id)
            break

    for path, size in physical_files.items():
        if path not in matched_files:
            resource_type = detect_resource_type(os.path.basename(path))
            resource = create_resource(
                folder_id=root_folder.id,
                file_name=os.path.basename(path),
                file_path=path,
                resource_type=resource_type,
                content_length=size,
                user_id=current_user.id,
                content_hash=compute_file_content_hash(path) if resource_type in ALLOWED_PROCESSING_TYPES else "",
            )
            try:
                saved = save_resource(db, resource)
            except DuplicateResourceError:
                continue
            if resource_type in ALLOWED_PROCESSING_TYPES:
                # Skip processing for default folders (Media, Resources, Notes) — files stay raw
                res_folder = db.query(Folder).filter(Folder.id == saved.folder_id).first()
                if res_folder and _is_default_folder(res_folder, db, current_user):
                    saved.processing_status = "uploaded"
                    db.commit()
                else:
                    create_processing_job(db, saved.id)
            sync_stats["added"]["resources"] += 1
            
    for r in db_resources:
        if r.id not in matched_db_res:
            _delete_resource_instance(r, db)
            db.commit()
            sync_stats["removed"]["resources"] += 1
            
    return sync_stats


def _sync_folder(folder: Folder, db: Session, current_user: User):
    """Syncs a single folder: adds new resources, updates renamed, cleans up orphans."""
    sync_stats = {"added": {"resources": 0, "folders": 0}, "removed": {"resources": 0, "folders": 0}}
    folder_dir = _get_folder_path(folder, db, current_user)
    _sync_folder_recursive(folder, folder_dir, db, current_user, sync_stats)
    return sync_stats


@app.post("/playlists/{playlist_id}/refresh")
def refresh_specific_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
        
    stats = _sync_playlist(playlist, db, current_user)
    _touch_playlist(db, playlist_id)
    db.commit()
    return {"message": f"Playlist {playlist.name} synced", "stats": stats}


@app.post("/folders/{folder_id}/refresh")
def refresh_specific_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
        
    stats = _sync_folder(folder, db, current_user)
    return {"message": f"Folder {folder.name} synced", "stats": stats}

@app.post("/refresh")
def refresh_library(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Scans the user's storage directory to synchronize with DB:
    1. Adds new items (playlists, folders, resources).
    2. Cleans up orphaned DB records for items deleted from disk.
    """
    user_root = current_user.storage_root or UPLOADS_ROOT
    user_path = os.path.join(user_root, current_user.username)

    if not os.path.exists(user_path):
        return {"message": "User storage directory not found", "path": user_path}

    sync_stats = {"added": {"playlists": 0, "folders": 0, "resources": 0}, "removed": {"playlists": 0, "folders": 0, "resources": 0}}

    # Sync playlists (which handle folders/resources)
    for playlist_name in os.listdir(user_path):
        playlist_dir = os.path.join(user_path, playlist_name)
        if not os.path.isdir(playlist_dir):
            continue

        playlist = db.query(Playlist).filter(Playlist.name == playlist_name, Playlist.user_id == current_user.id).first()
        if not playlist:
            playlist = Playlist(id=str(uuid4()), name=playlist_name, user_id=current_user.id, storage_root=current_user.storage_root)
            db.add(playlist)
            db.commit()
            db.refresh(playlist)
            sync_stats["added"]["playlists"] += 1
        
        # Call helper
        stats = _sync_playlist(playlist, db, current_user)
        sync_stats["added"]["folders"] += stats["added"]["folders"]
        sync_stats["added"]["resources"] += stats["added"]["resources"]
        sync_stats["removed"]["folders"] += stats["removed"]["folders"]
        sync_stats["removed"]["resources"] += stats["removed"]["resources"]

    # Playlist cleanup
    playlists = db.query(Playlist).filter(Playlist.user_id == current_user.id).all()
    for p in playlists:
        playlist_dir = os.path.join(user_path, p.name)
        if not os.path.exists(playlist_dir):
            delete_playlist(p.id, db, current_user)
            sync_stats["removed"]["playlists"] += 1

    return {"message": "Refresh (sync) complete", "sync_stats": sync_stats}


# ==================================================
# RESOURCE UPLOAD
# ==================================================


@app.post("/resources/upload")
async def upload_resource(
    folder_id: str = None,
    playlist_id: str = None,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not folder_id or folder_id == "null" or folder_id == "undefined":
        if not playlist_id:
            raise HTTPException(status_code=400, detail="Either folder_id or playlist_id must be provided")
        
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        folder = db.query(Folder).filter(Folder.name == "root", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id).first()
        if not folder:
            folder = Folder(
                id=str(uuid4()),
                name="root",
                playlist_id=playlist_id,
                user_id=current_user.id,
                storage_root=current_user.storage_root
            )
            db.add(folder)
            db.commit()
            db.refresh(folder)
        folder_id = folder.id
    else:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

    sys_logger.info(
        f"[UPLOAD] user={current_user.id} file='{file.filename}' target_folder_id={folder.id} target_folder_name='{folder.name}' playlist_id={folder.playlist_id}"
    )

    ext = os.path.splitext(file.filename)[1].lower()
    allowed_exts = {
        ".pdf": "pdf",
        ".docx": "docx",
        ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image",
        ".mp3": "audio", ".wav": "audio", ".aac": "audio", ".flac": "audio", ".ogg": "audio", ".m4a": "audio",
        ".mp4": "video", ".mkv": "video", ".avi": "video", ".mov": "video", ".webm": "video"
    }

    resource_type = detect_resource_type(file.filename)
    if resource_type not in ["video", "audio", "pdf", "docx", "image"]:
        if ext in allowed_exts:
            resource_type = allowed_exts[ext]
        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Only video, audio, PDF, DOCX, and images are allowed."
            )

    user_upload_dir = _get_folder_path(folder, db, current_user)
    os.makedirs(user_upload_dir, exist_ok=True)

    file_path = os.path.join(user_upload_dir, file.filename)

    # Allow same file in different folders/accounts
    # Only check if this specific file already exists in this specific folder for this user
    existing_resource = (
        db.query(Resource)
        .filter(Resource.folder_id == folder_id, Resource.local_path == file_path)
        .first()
    )
    if existing_resource:
        raise HTTPException(
            status_code=400,
            detail="Resource already exists in this folder",
        )

    content = await file.read()
    content_hash = compute_bytes_content_hash(content)
    duplicate_resource = find_duplicate_resource_by_hash(
        db,
        user_id=current_user.id,
        content_hash=content_hash,
        folder_id=folder_id,
    )
    if duplicate_resource:
        raise _duplicate_resource_http_exception(duplicate_resource)

    with open(file_path, "wb") as f:
        f.write(content)

    resource = create_resource(
        folder_id=folder_id,
        file_name=file.filename,
        file_path=file_path,
        resource_type=resource_type,
        content_length=len(content),
        user_id=current_user.id,
        content_hash=content_hash,
    )
    try:
        saved = save_resource(db, resource)
    except DuplicateResourceError as exc:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise _duplicate_resource_http_exception(exc.existing_resource)

    if folder.playlist_id:
        _touch_playlist(db, folder.playlist_id)

    # Skip processing for default folders (Media, Resources, Notes) — files stay raw
    if _is_default_folder(folder, db, current_user):
        saved.processing_status = "uploaded"
        db.commit()
    else:
        # Create a processing job and queue it
        create_processing_job(db, saved.id)
    sys_logger.info(
        f"[UPLOAD] resource_saved id={saved.id} title='{saved.title}' folder_id={saved.folder_id} processing_status={saved.processing_status}"
    )
    _notify_explorer_changed()

    return serialize_resource(saved)



@app.post("/files/create")
def create_md_file(
    filename: str,
    folder_id: str = None,
    playlist_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not filename.endswith(".md"):
        raise HTTPException(status_code=400, detail="Only .md files are allowed")

    if folder_id:
        folder = _get_owned_folder(db, folder_id, current_user.id)
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")
        folder_dir = _get_folder_path(folder, db, current_user)
    elif playlist_id:
        playlist = _get_owned_playlist(db, playlist_id, current_user.id)
        if not playlist:
            raise HTTPException(status_code=404, detail="Playlist not found")
        
        # Get or create root folder for playlist
        folder = db.query(Folder).filter(Folder.name == "root", Folder.playlist_id == playlist_id, Folder.user_id == current_user.id).first()
        if not folder:
            folder = Folder(
                id=str(uuid4()),
                name="root",
                playlist_id=playlist_id,
                user_id=current_user.id,
                storage_root=current_user.storage_root
            )
            db.add(folder)
            db.commit()
            db.refresh(folder)
        folder_dir = _get_folder_path(folder, db, current_user)
    else:
        raise HTTPException(status_code=400, detail="Either folder_id or playlist_id must be provided")

    os.makedirs(folder_dir, exist_ok=True)
    file_path = os.path.join(folder_dir, filename)

    if os.path.exists(file_path):
        raise HTTPException(status_code=400, detail="File already exists")

    # Create empty file
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("")

    # Register in DB
    resource = create_resource(
        folder_id=folder.id,
        file_name=filename,
        file_path=file_path,
        resource_type="text",
        content_length=0,
        user_id=current_user.id,
    )
    saved = save_resource(db, resource)
    if folder.playlist_id:
        _touch_playlist(db, folder.playlist_id)
    _notify_explorer_changed()

    return serialize_resource(saved)


@app.post("/resources/{resource_id}/index")
def index_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    if resource.type not in ["pdf", "docx", "image", "audio", "video", "youtube"]:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX, image, audio, video, and YouTube resources can be indexed manually.",
        )

    # Check if already queued or processing
    existing_job = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.status.in_(["queued", "processing"]),
        )
        .first()
    )

    if existing_job:
        raise HTTPException(
            status_code=409,
            detail="Resource is already queued or being processed.",
        )

    # Create a processing job for this resource
    create_processing_job(db, resource_id, job_type="manual_index")
    log_user_activity(db, current_user.id, 'ai_features', 'Manual indexing', resource.title)

    return {"message": "Resource queued for processing"}


@app.post("/resources/{resource_id}/resume")
def resume_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Resumes processing for a failed or paused resource from where it left off.
    """
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    sys_logger.info(f"[RESUME] Resuming processing for {resource_id}")
    log_user_activity(db, current_user.id, 'queue', 'Resumed processing', resource.title)

    existing_active_job = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.status.in_(["queued", "processing"]),
        )
        .first()
    )
    if existing_active_job:
        raise HTTPException(
            status_code=409,
            detail="Resource is already queued or being processed.",
        )

    resume_allowed_statuses = {
        "failed",
        "failed_transcribing",
        "failed_summarizing",
        "failed_chaptering",
        "failed_subchaptering",
        "failed_embedding",
        "failed_indexing",
        "paused",
        "cancelled",
    }
    normalized_status = (resource.processing_status or "").strip().lower()
    if normalized_status not in resume_allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Resource cannot be resumed from status '{resource.processing_status or 'unknown'}'.",
        )

    # Remove historical failed/paused/cancelled job records before re-queueing.
    db.query(ProcessingJob).filter(
        ProcessingJob.resource_id == resource_id,
        ProcessingJob.status.in_(["failed", "paused", "completed"]),
    ).delete(synchronize_session=False)

    # Save the failed stage before wiping the status, so the pipeline
    # knows exactly where to pick up instead of guessing.
    failed_stage = normalized_status.replace("failed_", "", 1) if normalized_status.startswith("failed_") else normalized_status
    resume_job_type = f"resume:{failed_stage}" if failed_stage else "resume"

    resource.processing_status = "queued"
    db.commit()

    create_processing_job(db, resource_id, job_type=resume_job_type)

    try:
        failed_stage = normalized_status.replace("failed_", "", 1) if normalized_status.startswith("failed_") else normalized_status
        stage_labels = {
            "failed": "the failed step",
            "paused": "the paused step",
            "cancelled": "the cancelled step",
            "transcribing": "transcription",
            "summarizing": "summary generation",
            "chaptering": "chapter generation",
            "subchaptering": "subchapter generation",
            "embedding": "embedding",
            "indexing": "indexing",
        }
        create_notification(
            db=db,
            user_id=current_user.id,
            category="processing",
            title="Resume Queued",
            message=f"Resume queued for '{resource.title or 'AI Resource'}' from {stage_labels.get(failed_stage, failed_stage or 'the last failed step')}. Remaining pipeline steps will continue automatically.",
            link=f"/resource/{resource.id}",
        )
    except Exception as exc:
        sys_logger.warning(f"[RESUME] Failed to create resume notification for {resource_id}: {exc}")

    return {"message": "Resource queued for resuming"}


@app.post("/resources/{resource_id}/resume-advanced")
def resume_resource_advanced(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Advanced resume: inspects the resource's actual state (transcript, summary,
    chapters, embeddings) to determine exactly which pipeline step to resume from.
    Works even when the processing_status is generic "failed" or corrupted.
    """
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    sys_logger.info(f"[RESUME-ADVANCED] Resuming processing for {resource_id}")

    # Check for active jobs
    existing_active_job = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.status.in_(["queued", "processing"]),
        )
        .first()
    )
    if existing_active_job:
        raise HTTPException(
            status_code=409,
            detail="Resource is already queued or being processed.",
        )

    # --- Smart stage inference based on actual resource state ---
    has_transcript = bool((resource.transcript or "").strip())
    has_summary = bool((resource.summary or "").strip())
    existing_chapters = db.query(Chapter).filter(Chapter.resource_id == resource_id).count()
    is_embedded = str(getattr(resource, "is_embedded", "")).lower() == "true"
    media_type = (resource.type or "").lower() in ["audio", "video", "youtube"]
    doc_type = (resource.type or "").lower() in ["pdf", "docx", "image"]

    # Determine the resume stage by walking the pipeline forward
    if not has_transcript:
        resume_stage = "transcribing"
    elif not has_summary and not doc_type:
        resume_stage = "summarizing"
    elif media_type and existing_chapters <= 0:
        resume_stage = "chaptering"
    elif not is_embedded:
        resume_stage = "embedding"
    else:
        resume_stage = "indexing"

    # If resource is already fully done, nothing to resume
    normalized = (resource.processing_status or "").strip().lower()
    if normalized == "ready" and is_embedded:
        raise HTTPException(
            status_code=400,
            detail="Resource is already fully processed and ready.",
        )

    sys_logger.info(
        f"[RESUME-ADVANCED] resource={resource_id} inferred_stage={resume_stage} "
        f"transcript={has_transcript} summary={has_summary} chapters={existing_chapters} embedded={is_embedded}"
    )

    # Clean up old jobs
    db.query(ProcessingJob).filter(
        ProcessingJob.resource_id == resource_id,
        ProcessingJob.status.in_(["failed", "paused", "completed"]),
    ).delete(synchronize_session=False)

    resource.processing_status = "queued"
    db.commit()

    job_type = f"resume:{resume_stage}"
    create_processing_job(db, resource_id, job_type=job_type)

    # Notify user
    try:
        stage_labels = {
            "transcribing": "transcription",
            "summarizing": "summary generation",
            "chaptering": "chapter generation",
            "subchaptering": "subchapter generation",
            "embedding": "embedding",
            "indexing": "indexing",
        }
        create_notification(
            db=db,
            user_id=current_user.id,
            category="processing",
            title="Advanced Resume Queued",
            message=f"Resuming '{resource.title or 'AI Resource'}' from {stage_labels.get(resume_stage, resume_stage)}. Pipeline will continue automatically.",
            link=f"/resource/{resource.id}",
        )
    except Exception as exc:
        sys_logger.warning(f"[RESUME-ADVANCED] Failed to create notification for {resource_id}: {exc}")

    log_user_activity(db, current_user.id, 'queue', f'Advanced resume from {resume_stage}', resource.title)

    return {
        "message": f"Resource queued for resuming from {resume_stage}",
        "resume_stage": resume_stage,
    }


@app.post("/resources/{resource_id}/reprocess")
def reprocess_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cleans up all derived metadata/files for a resource and restarts processing.
    """
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    sys_logger.info(f"[REPROCESS] Starting re-processing for {resource_id}")
    log_user_activity(db, current_user.id, 'queue', 'Reprocessing resource', resource.title)

    # 1. Cleanup derived data (Chroma, SQL indexes, derived files)
    # Reuse existing delete logic but prevent deletion of the resource itself
    # We need a partial cleanup that keeps the 'Resource' row.
    
    # ── Clean ChromaDB ──────────────────────────────────────────────────────────
    try:
        delete_resource_embeddings(resource_id)
    except Exception as exc:
        sys_logger.warning(f"[REPROCESS] Could not remove Chroma: {exc}")

    # ── Clean Physical Derived files (SRT, WAV, TXT) ──────────────────────────
    _cleanup_derived_files(resource_id)

    # ── Clean SQL Index/Processing Records ────────────────────────────────────
    db.query(ChunkIndex).filter(ChunkIndex.resource_id == resource_id).delete()
    db.query(ProcessingJob).filter(ProcessingJob.resource_id == resource_id).delete()
    
    # Reset resource status
    resource.processing_status = "queued"
    db.commit()

    # 2. Restart processing
    create_processing_job(db, resource_id)

    return {"message": "Resource queued for re-processing"}


def _regenerate_media_structure(
    resource_id: str,
    db: Session,
    current_user: User,
):
    """Regenerate chapters and subchapters for one media resource using the current pipeline logic."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    if resource.type not in ["video", "audio", "youtube"]:
        raise HTTPException(status_code=400, detail="Chapters only supported for video/audio/youtube")

    if not resource.transcript:
        raise HTTPException(status_code=400, detail="No transcript available yet")

    from services.chapter_service import build_chapter_transcript, build_subchapter_transcript, validate_subchapter_bounds
    from services.llm_service import generate_chapters, generate_subchapters
    from services.srt_parser import parse_srt

    existing_chapters = db.query(Chapter).filter(Chapter.resource_id == resource_id).all()
    if existing_chapters:
        for ch in existing_chapters:
            db.query(SubChapter).filter(SubChapter.chapter_id == ch.id).delete()
            db.delete(ch)
        db.commit()

    resource.processing_status = "chaptering"
    resource.is_embedded = _add_outdated_flag(resource.is_embedded, "structure")
    db.commit()
    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating chapters', resource.title)

    try:
        srt_file = None
        extraa_dir = os.path.join(EXTRAA_FILES_ROOT, resource_id)
        if os.path.isdir(extraa_dir):
            for f in os.listdir(extraa_dir):
                if f.endswith(".srt"):
                    srt_file = os.path.join(extraa_dir, f)
                    break

        if not srt_file:
            resource.processing_status = "ready"
            db.commit()
            return {"message": "No SRT file found, skipping chapters"}

        with open(srt_file, "r", encoding="utf-8") as f:
            srt_text = f.read()

        chapters = generate_chapters(
            srt_text,
            user_id=current_user.id,
            resource_id=resource.id,
            feature="transcript_regeneration_chapter_generation",
        )
        segments = parse_srt(srt_file)

        for chapter_data in chapters:
            try:
                chapter_transcript = build_chapter_transcript(
                    segments, chapter_data["start_time"], chapter_data["end_time"]
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
                db.commit()

                chapter_duration = chapter.end_time - chapter.start_time
                if chapter_duration >= 60:
                    subchapters = generate_subchapters(
                        chapter.transcript,
                        chapter_duration=chapter_duration,
                        user_id=current_user.id,
                        resource_id=resource.id,
                        feature="transcript_regeneration_subchapter_generation",
                    )
                    subchapters = validate_subchapter_bounds(subchapters, chapter_start=0, chapter_end=chapter_duration)

                    chapter_segments = []
                    max_seg = max([s["end"] for s in segments]) if segments else chapter.end_time
                    eff_end = max_seg + 10.0 if chapter.end_time >= max_seg - 3.0 else chapter.end_time
                    for seg in segments:
                        if chapter.start_time <= seg["start"] < eff_end:
                            chapter_segments.append({
                                "start": seg["start"] - chapter.start_time,
                                "end": seg["end"] - chapter.start_time,
                                "text": seg["text"],
                            })

                    for sub_data in subchapters:
                        try:
                            sub_transcript = build_subchapter_transcript(
                                chapter_segments, sub_data["start_time"], sub_data["end_time"]
                            )
                            if not sub_transcript.strip():
                                continue
                            db.add(SubChapter(
                                id=str(uuid4()),
                                chapter_id=chapter.id,
                                title=sub_data["title"],
                                summary=sub_data.get("summary", ""),
                                start_time=sub_data["start_time"],
                                end_time=sub_data["end_time"],
                                transcript=sub_transcript,
                            ))
                        except Exception:
                            continue
                    db.commit()
            except Exception:
                continue

        resource.processing_status = "ready"
        db.commit()
        return {"message": f"Generated {len(chapters)} chapters"}

    except Exception as e:
        resource.processing_status = "ready"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Chapter generation failed: {str(e)}")


@app.post("/resources/{resource_id}/regenerate-structure")
def regenerate_media_structure(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Regenerate chapters and subchapters together for audio/video/youtube resources."""
    return _regenerate_media_structure(resource_id, db, current_user)


@app.post("/resources/{resource_id}/retry-chapters")
def retry_chapters(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Backward-compatible alias for regenerating chapters and subchapters together."""
    return _regenerate_media_structure(resource_id, db, current_user)


@app.get("/queue")
def get_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all processing jobs for the current user."""
    return get_queue_status(db, current_user_id=current_user.id)


@app.post("/queue/clear")
def clear_queue(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Clear completed and failed processing jobs from history."""
    count = clear_queue_history(db, current_user_id=current_user.id)
    return {"message": f"Cleared {count} finished jobs from queue history."}


@app.get("/queue/{resource_id}")
def get_resource_queue_status(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the status of a specific resource's processing job with ownership verification."""
    # First, verify the user owns the resource
    resource = _get_owned_resource(db, resource_id, current_user.id)

    # If the resource is not found in the main table, it might have been deleted,
    # but we still check the jobs table to see if any trace remains.
    job_status = get_job_status(db, resource_id)

    if not resource and not job_status:
        raise HTTPException(status_code=404, detail="Resource or Job not found")

    if not job_status:
        raise HTTPException(
            status_code=404, detail="No processing job history found for this resource"
        )
    return job_status


@app.post("/queue/{job_id}/pause")
def pause_queue_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.id == job_id, Resource.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status in ["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing"]:
        job.status = "paused"
        job.current_stage = "paused"
        db.commit()
        return {"message": "Job paused"}
    raise HTTPException(status_code=400, detail="Job cannot be paused")


@app.post("/queue/{job_id}/resume")
def resume_queue_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.id == job_id, Resource.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status == "paused":
        blocker = (
            db.query(ProcessingJob)
            .filter(
                ProcessingJob.resource_id == job.resource_id,
                ProcessingJob.id != job.id,
                ProcessingJob.status.in_(["queued", "processing"]),
            )
            .first()
        )
        job.status = "waiting" if blocker else "queued"
        job.blocked_by_job_id = blocker.id if blocker else None
        job.current_stage = "waiting_for_prerequisite" if blocker else "queued"
        db.commit()
        return {"message": "Job resumed", "status": job.status}
    raise HTTPException(status_code=400, detail="Job is not paused")


@app.post("/queue/{job_id}/retry")
def retry_queue_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import KnowledgeRun, ResourceKnowledgeState

    job = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.id == job_id, Resource.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status not in ["failed", "cancelled", "retrying_connection", "waiting_for_connection"]:
        raise HTTPException(status_code=400, detail="Only failed, cancelled, or connection-waiting jobs can be retried")

    blocker = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == job.resource_id,
            ProcessingJob.id != job.id,
            ProcessingJob.status.in_(["queued", "processing"]),
        )
        .first()
    )
    job.status = "waiting" if blocker else "queued"
    job.blocked_by_job_id = blocker.id if blocker else None
    job.current_stage = "waiting_for_prerequisite" if blocker else "queued"
    job.progress = 0
    job.started_at = None
    job.finished_at = None
    job.error_message = None
    job.retryable = 1
    if job.job_type == "knowledge_generation":
        run = db.query(KnowledgeRun).filter(KnowledgeRun.job_id == job.id).first()
        if run:
            run.status = job.status
            run.current_stage = job.current_stage
            run.progress = 0
            run.error_message = None
            run.finished_at = None
        state = db.query(ResourceKnowledgeState).filter(
            ResourceKnowledgeState.resource_id == job.resource_id
        ).first()
        if state:
            state.status = job.status
            state.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Job queued for retry", "status": job.status}


@app.post("/queue/{job_id}/start-over")
def start_over_knowledge_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import KnowledgeRun
    from services.knowledge_service import _cleanup_run_staging
    from services.queue_service import create_processing_job

    job = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.id == job_id, Resource.user_id == current_user.id)
        .first()
    )
    if not job or job.job_type != "knowledge_generation":
        raise HTTPException(status_code=404, detail="Knowledge job not found")
    if job.status == "processing":
        raise HTTPException(status_code=409, detail="Cancel the active job before starting over")
    run = db.query(KnowledgeRun).filter(KnowledgeRun.job_id == job.id).first()
    if run:
        _cleanup_run_staging(db, run.id)
        run.status = "superseded"
        run.finished_at = datetime.utcnow()
    job.status = "superseded"
    job.finished_at = datetime.utcnow()
    db.commit()
    replacement = create_processing_job(
        db, job.resource_id, job_type="knowledge_generation"
    )
    return {
        "message": "Knowledge generation started over",
        "job_id": replacement.id,
        "status": replacement.status,
    }


@app.delete("/queue/{job_id}")
def delete_queue_job(
    job_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import KnowledgeRun, ResourceKnowledgeState

    job = (
        db.query(ProcessingJob)
        .join(Resource, ProcessingJob.resource_id == Resource.id)
        .filter(ProcessingJob.id == job_id, Resource.user_id == current_user.id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status in ["queued", "waiting", "retrying_connection", "waiting_for_connection", "processing", "paused"]:
        job.status = "cancelled"
        job.current_stage = "cancelled"
        job.finished_at = datetime.utcnow()
        if job.job_type == "knowledge_generation":
            run = db.query(KnowledgeRun).filter(KnowledgeRun.job_id == job.id).first()
            if run:
                run.status = "cancelled"
                run.current_stage = "cancelled"
                run.finished_at = datetime.utcnow()
                from services.knowledge_service import _cleanup_run_staging
                _cleanup_run_staging(db, run.id)
            state = db.query(ResourceKnowledgeState).filter(
                ResourceKnowledgeState.resource_id == job.resource_id
            ).first()
            if state:
                state.status = "ready" if state.active_run_id else "not_generated"
                state.updated_at = datetime.utcnow()
        db.commit()
        return {"message": "Job cancelled"}

    db.delete(job)
    db.commit()
    return {"message": "Finished job removed"}


@app.get("/chapters")
def get_chapters(db: Session = Depends(get_db)):

    items = db.query(Chapter).all()
    return [serialize_chapter(c) for c in items]


@app.get("/subchapters")
def get_subchapters(db: Session = Depends(get_db)):

    items = db.query(SubChapter).all()
    return [serialize_subchapter(s) for s in items]


# ==================================================
# HELPER FUNCTIONS
# ==================================================


def detect_resource_type(filename: str):

    ext = os.path.splitext(filename)[1].lower()
    
    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
        return "video"
    if ext in ['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a']:
        return "audio"
    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']:
        return "image"
    if ext == '.pdf':
        return "pdf"
    if ext in ['.doc', '.docx']:
        return "docx"
    if ext in ['.txt', '.md', '.csv']:
        return "text"

    return "file"


# ==================================================
# Attachments and Chapter/SubChapter Creation Logic
# ==================================================
@app.post("/attachments/upload")
async def upload_attachment(
    resource_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    os.makedirs("attachments", exist_ok=True)

    file_path = os.path.join("attachments", file.filename)

    content = await file.read()

    with open(file_path, "wb") as f:
        f.write(content)

    attachment = Attachment(
        id=str(uuid4()),
        resource_id=resource_id,
        file_name=file.filename,
        file_path=file_path,
        file_type=detect_resource_type(file.filename),
        file_size=len(content),
    )

    db.add(attachment)

    db.commit()

    db.refresh(attachment)

    return {
        "id": attachment.id,
        "resource_id": attachment.resource_id,
        "chapter_id": attachment.chapter_id,
        "subchapter_id": attachment.subchapter_id,
        "file_name": attachment.file_name,
        "file_path": attachment.file_path,
        "file_type": attachment.file_type,
        "file_size": attachment.file_size,
        "created_at": _iso(attachment.created_at),
    }


@app.get("/attachments")
def get_attachments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    # Scope to the active workspace via the resource's folder storage_root.
    query = (
        db.query(Attachment)
        .join(Resource, Attachment.resource_id == Resource.id)
        .join(Folder, Resource.folder_id == Folder.id)
        .filter(Resource.user_id == current_user.id)
    )
    if current_user.storage_root:
        query = query.filter(Folder.storage_root == current_user.storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))
    items = query.all()

    def serialize(a: Attachment):
        return {
            "id": a.id,
            "resource_id": a.resource_id,
            "chapter_id": a.chapter_id,
            "subchapter_id": a.subchapter_id,
            "file_name": a.file_name,
            "file_path": a.file_path,
            "file_type": a.file_type,
            "file_size": a.file_size,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }

    return [serialize(a) for a in items]


@app.get("/resources/{resource_id}/attachments")
def get_resource_attachments(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    items = db.query(Attachment).filter(Attachment.resource_id == resource_id).all()

    def serialize(a: Attachment):
        return {
            "id": a.id,
            "resource_id": a.resource_id,
            "chapter_id": a.chapter_id,
            "subchapter_id": a.subchapter_id,
            "file_name": a.file_name,
            "file_path": a.file_path,
            "file_type": a.file_type,
            "file_size": a.file_size,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }

    return [serialize(a) for a in items]


# ==================================================
# Notebook and Note Creation Logic (File-based)
# ==================================================


class CreateNoteRequest(BaseModel):
    title: str = "Untitled"
    content: str = "[]"
    folder_id: str | None = None


@app.post("/playlists/{playlist_id}/notes")
async def create_note_file(
    playlist_id: str,
    body: CreateNoteRequest | None = None,
    title: str = "Untitled",
    content: str = "[]",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body:
        resolved_title = body.title
        resolved_content = body.content
        resolved_folder_id = body.folder_id
    else:
        resolved_title = title
        resolved_content = content
        resolved_folder_id = None

    if not resolved_content or resolved_content.strip() in ("", "[]"):
        raise HTTPException(status_code=400, detail="Note content cannot be empty.")

    if resolved_folder_id:
        folder = db.query(Folder).filter(
            Folder.id == resolved_folder_id,
            Folder.playlist_id == playlist_id,
            Folder.user_id == current_user.id,
            Folder.is_deleted == 0,
        ).first()
        if not folder:
            raise HTTPException(status_code=400, detail="Invalid folder for this notebook.")

    playlist = db.query(Playlist).filter(
        Playlist.id == playlist_id,
        Playlist.user_id == current_user.id,
    ).first()
    if not playlist:
        raise HTTPException(status_code=403, detail="You do not have access to this notebook.")

    note_service = NoteService(db)
    new_note = note_service.create_note(playlist_id, resolved_title, resolved_content, current_user)

    if resolved_folder_id:
        new_note.folder_id = resolved_folder_id
        db.commit()
        db.refresh(new_note)

    return serialize_note(new_note)


@app.post("/playlists/{playlist_id}/notes/refresh")
def refresh_notes_in_playlist(
    playlist_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note_service = NoteService(db)
    sync_stats = note_service.refresh_notes(playlist_id, current_user)
    return {"message": "Notes refreshed successfully", "sync_stats": sync_stats}


@app.post("/notes/{note_id}/link")
def link_note_to_resource_endpoint(
    note_id: str,
    resource_id: str = None,
    chapter_id: str = None,
    subchapter_id: str = None,
    db: Session = Depends(get_db),
):
    note_service = NoteService(db)
    updated_note = note_service.link_note_to_resource(note_id, resource_id, chapter_id, subchapter_id)
    return serialize_note(updated_note)


@app.post("/notes")
def create_note(
    title: str = "Untitled",
    content: str = "[]",
    note_type: str = "markdown",
    resource_id: str = None,
    chapter_id: str = None,
    subchapter_id: str = None,
    status: str = "draft",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note_service = NoteService(db)
    new_note = note_service.create_note(None, title, content, current_user)
    if status != "draft":
        new_note.status = status
        db.commit()
    if resource_id or chapter_id or subchapter_id:
        note_service.link_note_to_resource(new_note.id, resource_id, chapter_id, subchapter_id)
    return serialize_note(new_note)


@app.post("/notes/refresh")
def refresh_all_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.note_service import markdown_to_blocks

    # 0. Sync custom notebook folders and their notes first
    custom_folders = db.query(Folder).filter(
        Folder.user_id == current_user.id,
        Folder.playlist_id.isnot(None),
        Folder.parent_id.isnot(None)
    ).all()

    for folder in custom_folders:
        if folder.name.lower() in ("notes", "media", "resources", "root") and (not folder.parent_id or folder.parent_id == ""):
            continue
        try:
            physical_path = _notebook_build_physical_path(db, folder, current_user)
        except Exception:
            physical_path = None
            
        if not physical_path or not os.path.exists(physical_path):
            def _delete_recursive(fid: str):
                for child in db.query(Folder).filter(Folder.parent_id == fid).all():
                    _delete_recursive(child.id)
                    db.delete(child)
                for note in db.query(Note).filter(Note.folder_id == fid).all():
                    db.delete(note)
            _delete_recursive(folder.id)
            db.delete(folder)
            db.commit()
            continue

        physical_filenames = set()
        for file_name in os.listdir(physical_path):
            if file_name.endswith(".md"):
                physical_filenames.add(file_name)
                
        db_notes = db.query(Note).filter(Note.folder_id == folder.id).all()
        db_notes_map = {n.filename: n for n in db_notes if n.filename}
        matched_db_note_ids = set()
        
        for file_name in physical_filenames:
            file_path = os.path.join(physical_path, file_name)
            if file_name in db_notes_map:
                db_note = db_notes_map[file_name]
                matched_db_note_ids.add(db_note.id)
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                first_line = content.split('\n', 1)[0]
                new_title = first_line.lstrip('# ').strip()
                if not new_title: new_title = file_name.replace(".md", "").replace("-", " ").title()
                blocks = markdown_to_blocks(content)
                if db_note.content != blocks or db_note.title != new_title:
                    db_note.content = blocks
                    db_note.title = new_title
                    db_note.updated_at = datetime.utcnow()
                    db.add(db_note)
            else:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                first_line = content.split('\n', 1)[0]
                new_title = first_line.lstrip('# ').strip()
                if not new_title: new_title = file_name.replace(".md", "").replace("-", " ").title()
                blocks = markdown_to_blocks(content)
                note = Note(
                    id=str(uuid4()),
                    title=new_title,
                    content=blocks,
                    note_type="markdown",
                    playlist_id=folder.playlist_id,
                    folder_id=folder.id,
                    user_id=current_user.id,
                    is_favorite=0,
                    status="active",
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                    filename=file_name
                )
                db.add(note)
        db.commit()
        
        for db_note in db_notes:
            if db_note.id not in matched_db_note_ids:
                note_file_path = os.path.join(physical_path, db_note.filename) if db_note.filename else None
                if not note_file_path or not os.path.exists(note_file_path):
                    db.delete(db_note)
        db.commit()
    note_service = NoteService(db)
    
    # 2. Refresh notes for all user playlists
    playlists = db.query(Playlist).filter(Playlist.user_id == current_user.id).all()
    playlist_stats = []
    for p in playlists:
        stats = note_service.refresh_notes(p.id, current_user)
        playlist_stats.append({"playlist_id": p.id, "sync_stats": stats})
        
    return {
        "message": "All notes refreshed successfully",
        "playlist_sync_stats": playlist_stats
    }


@app.get("/notes")
def get_notes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Note).filter(Note.user_id == current_user.id)

    # Scope notes to the active workspace. A note belongs to a workspace through its
    # folder / playlist / resource. Build id-sets for the current workspace and keep
    # only notes linked into it (plus unlinked notes for the default workspace).
    sr = current_user.storage_root
    if sr:
        ws_folder_ids = db.query(Folder.id).filter(Folder.user_id == current_user.id, Folder.storage_root == sr)
        ws_playlist_ids = db.query(Playlist.id).filter(Playlist.user_id == current_user.id, Playlist.storage_root == sr)
        ws_resource_ids = (
            db.query(Resource.id)
            .join(Folder, Resource.folder_id == Folder.id)
            .filter(Resource.user_id == current_user.id, Folder.storage_root == sr)
        )
        query = query.filter(
            or_(
                Note.folder_id.in_(ws_folder_ids),
                Note.playlist_id.in_(ws_playlist_ids),
                Note.resource_id.in_(ws_resource_ids),
            )
        )
    else:
        # Default workspace: notes linked to default-storage containers, or unlinked.
        def_folder_ids = db.query(Folder.id).filter(Folder.user_id == current_user.id, Folder.storage_root.is_(None))
        def_playlist_ids = db.query(Playlist.id).filter(Playlist.user_id == current_user.id, Playlist.storage_root.is_(None))
        query = query.filter(
            or_(
                Note.folder_id.in_(def_folder_ids),
                Note.playlist_id.in_(def_playlist_ids),
                and_(Note.folder_id.is_(None), Note.playlist_id.is_(None), Note.resource_id.is_(None)),
            )
        )

    items = query.all()
    return [serialize_note(n) for n in items]


@app.get("/notes/{note_id}")
def get_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return serialize_note(note)


def _get_note_physical_dir_path(db: Session, user: User, playlist_id: str | None, folder_id: str | None) -> str:
    if folder_id:
        folder = db.query(Folder).filter(Folder.id == folder_id, Folder.user_id == user.id).first()
        if folder:
            return _get_folder_path(folder, db, user)
    
    # Fallback to playlist/global notes directory
    from services.note_service import NoteService
    ns = NoteService(db)
    return ns._get_note_dir(user, playlist_id)


@app.put("/notes/{note_id}")
def update_note(
    note_id: str,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    old_playlist_id = note.playlist_id
    old_folder_id = note.folder_id
    old_filename = note.filename
    location_changed = False

    if "playlist_id" in data:
        new_playlist_id = data["playlist_id"]
        if new_playlist_id == "null" or new_playlist_id == "":
            new_playlist_id = None
        if new_playlist_id != old_playlist_id:
            note.playlist_id = new_playlist_id
            location_changed = True

    if "folder_id" in data:
        new_folder_id = data["folder_id"]
        if new_folder_id == "null" or new_folder_id == "":
            new_folder_id = None
        if new_folder_id != old_folder_id:
            note.folder_id = new_folder_id
            location_changed = True

    if "title" in data:
        note.title = data["title"]
    if "content" in data:
        note.content = data["content"]
    if "is_favorite" in data:
        note.is_favorite = 1 if data["is_favorite"] else 0
    if "status" in data:
        note.status = data["status"]
    if "tags" in data:
        import json
        note.tags = json.dumps(data["tags"]) if isinstance(data["tags"], list) else data["tags"]

    note.updated_at = datetime.utcnow()
    log_user_activity(db, current_user.id, 'notebook', f'Updated note "{note.title}"')

    # Sync physical file
    # First, if location changed (playlist or custom folder):
    if location_changed and old_filename:
        try:
            old_notes_dir = _get_note_physical_dir_path(db, current_user, old_playlist_id, old_folder_id)
            old_path = os.path.join(old_notes_dir, old_filename)
            if os.path.exists(old_path):
                os.remove(old_path)
        except Exception as e:
            logger.error(f"Error removing old physical file: {e}")

    # Now, sync the physical file to its current directory:
    try:
        notes_dir = _get_note_physical_dir_path(db, current_user, note.playlist_id, note.folder_id)
        os.makedirs(notes_dir, exist_ok=True)
        
        sanitized_title = _sanitize_filename(note.title)
        new_filename = f"{sanitized_title}.md"
        
        if location_changed or new_filename != old_filename:
            counter = 1
            while os.path.exists(os.path.join(notes_dir, new_filename)):
                new_filename = f"{sanitized_title}-{counter}.md"
                counter += 1
            
            # If title changed but location didn't, delete old file in same directory
            if not location_changed and old_filename:
                old_path = os.path.join(notes_dir, old_filename)
                if os.path.exists(old_path):
                    os.remove(old_path)
            
            note.filename = new_filename
            
        file_path = os.path.join(notes_dir, note.filename)
        
        from services.note_service import blocks_to_markdown
        content_str = note.content
        if not isinstance(content_str, str):
            content_str = json.dumps(content_str)
        
        md_text = blocks_to_markdown(content_str)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(f"# {note.title}\n\n{md_text}")
    except Exception as e:
        logger.error(f"Error syncing physical file on update_note: {e}")

    db.commit()
    db.refresh(note)
    return serialize_note(note)


@app.delete("/notes/{note_id}")
def delete_note(
    note_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    
    # Delete physical file
    if note.filename:
        try:
            notes_dir = _get_note_physical_dir_path(db, current_user, note.playlist_id, note.folder_id)
            file_path = os.path.join(notes_dir, note.filename)
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception as e:
            logger.error(f"Error deleting physical file: {e}")
            
    db.delete(note)
    db.commit()
    return {"success": True}


# ==================================================
# Concept and ConceptLink Creation Logic
# ==================================================


@app.post("/concepts")
def create_concept(
    name: str,
    description: str = "",
    color: str = "#3B82F6",
    db: Session = Depends(get_db),
):
    existing = db.query(Concept).filter(Concept.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Concept with this name already exists")

    concept = Concept(id=str(uuid4()), name=name, description=description, color=color)
    db.add(concept)
    db.commit()
    db.refresh(concept)
    return serialize_concept(concept)


@app.get("/concepts")
def get_concepts(db: Session = Depends(get_db)):
    items = db.query(Concept).all()
    return [serialize_concept(c) for c in items]


@app.get("/concepts/{concept_id}")
def get_concept(concept_id: str, db: Session = Depends(get_db)):
    concept = db.query(Concept).filter(Concept.id == concept_id).first()
    return serialize_concept(concept) if concept else {"error": "Concept not found"}


@app.put("/concepts/{concept_id}")
def update_concept(
    concept_id: str,
    data: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if not concept:
            raise HTTPException(status_code=404, detail="Concept not found")

        if "name" in data:
            concept.name = data["name"]
        if "description" in data:
            concept.description = data["description"]
        if "color" in data:
            concept.color = data["color"]
        if "tags" in data:
            concept.tags = json.dumps(data["tags"]) if isinstance(data["tags"], list) else data["tags"]

        db.commit()
        db.refresh(concept)
        log_user_activity(db, current_user.id, 'concept', f'Updated concept "{concept.name}"')
        return serialize_concept(concept)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        sys_logger.error(f"Error updating concept {concept_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to update concept: {str(e)}")


@app.delete("/concepts/{concept_id}")
def delete_concept(
    concept_id: str,
    db: Session = Depends(get_db),
):
    concept = db.query(Concept).filter(Concept.id == concept_id).first()
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")

    # Delete all concept links involving this concept
    db.query(ConceptLink).filter(ConceptLink.concept_id == concept_id).delete()
    db.query(ConceptLink).filter((ConceptLink.source_type == "concept") & (ConceptLink.source_id == concept_id)).delete()

    db.delete(concept)
    db.commit()
    return {"success": True}


@app.post("/concept-links")
def create_concept_link(
    concept_id: str,
    source_type: str,
    source_id: str,
    link_type: str = "reference",
    db: Session = Depends(get_db),
):
    existing = db.query(ConceptLink).filter(
        (ConceptLink.concept_id == concept_id) & (ConceptLink.source_id == source_id)
    ).first()
    if existing:
        existing.link_type = link_type
        db.commit()
        db.refresh(existing)
        return serialize_conceptlink(existing, db)

    link = ConceptLink(
        id=str(uuid4()),
        concept_id=concept_id,
        source_type=source_type,
        source_id=source_id,
        link_type=link_type,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return serialize_conceptlink(link, db)


@app.get("/concept-links")
def get_concept_links(db: Session = Depends(get_db)):
    items = db.query(ConceptLink).all()
    res = []
    for link in items:
        serialized = serialize_conceptlink(link, db)
        if serialized["target_title"] != "Unknown Target":
            res.append(serialized)
    return res


@app.delete("/concept-links")
def delete_concept_link(
    concept_id: str,
    source_id: str,
    db: Session = Depends(get_db),
):
    # Find link in either direction
    link = db.query(ConceptLink).filter(
        ((ConceptLink.concept_id == concept_id) & (ConceptLink.source_id == source_id)) |
        ((ConceptLink.concept_id == source_id) & (ConceptLink.source_id == concept_id))
    ).first()

    if not link:
        return {"success": True}

    db.delete(link)
    db.commit()
    return {"success": True}


@app.get("/concepts/{concept_id}/details")
def get_concept_details(concept_id: str, db: Session = Depends(get_db)):

    concept = db.query(Concept).filter(Concept.id == concept_id).first()

    if not concept:
        return {"error": "Concept not found"}

    links = db.query(ConceptLink).filter(ConceptLink.concept_id == concept_id).all()

    resources = []
    chapters = []
    subchapters = []
    notes = []
    attachments = []

    for link in links:
        if link.source_type == "resource":
            item = db.query(Resource).filter(Resource.id == link.source_id).first()

            if item:
                resources.append(serialize_resource(item))

        elif link.source_type == "chapter":
            item = db.query(Chapter).filter(Chapter.id == link.source_id).first()

            if item:
                chapters.append(serialize_chapter(item))

        elif link.source_type == "subchapter":
            item = db.query(SubChapter).filter(SubChapter.id == link.source_id).first()

            if item:
                subchapters.append(serialize_subchapter(item))

        elif link.source_type == "note":
            item = db.query(Note).filter(Note.id == link.source_id).first()

            if item:
                notes.append(serialize_note(item))

        elif link.source_type == "attachment":
            item = db.query(Attachment).filter(Attachment.id == link.source_id).first()

            if item:
                attachments.append(
                    {
                        "id": item.id,
                        "resource_id": item.resource_id,
                        "chapter_id": item.chapter_id,
                        "subchapter_id": item.subchapter_id,
                        "file_name": item.file_name,
                        "file_path": item.file_path,
                        "file_type": item.file_type,
                        "file_size": item.file_size,
                        "created_at": _iso(item.created_at),
                    }
                )

    return {
        "concept": serialize_concept(concept),
        "resources": resources,
        "chapters": chapters,
        "subchapters": subchapters,
        "notes": notes,
        "attachments": attachments,
    }


# ==================================================
# GLOBAL SEARCH
# ==================================================


@app.get("/search")
def search(
    query: str,
    db: Session = Depends(get_db),
    authorization: str | None = Header(None)
):
    user_id = None
    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            user_id = validate_token(token, "access")
        except Exception:
            pass

    if user_id:
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            # Query user resources
            resources = (
                db.query(Resource)
                .filter(
                    Resource.user_id == user.id,
                    Resource.is_deleted == 0,
                    or_(
                        Resource.title.contains(query),
                        Resource.description.contains(query),
                        Resource.tags.contains(query),
                        Resource.transcript.contains(query),
                        Resource.summary.contains(query),
                    )
                )
                .all()
            )
            resources.sort(
                key=lambda r: (
                    query.lower() in (r.title or "").lower(),
                    query.lower() in (r.summary or "").lower(),
                ),
                reverse=True,
            )

            # Query user chapters
            chapters_query = (
                db.query(Chapter, Resource.title, Resource.type, Resource.local_path)
                .join(Resource, Chapter.resource_id == Resource.id)
                .filter(
                    Resource.user_id == user.id,
                    Resource.is_deleted == 0,
                    or_(
                        Chapter.title.contains(query),
                        Chapter.summary.contains(query),
                        Chapter.transcript.contains(query),
                    )
                )
                .all()
            )
            serialized_chapters = []
            for c, r_title, r_type, r_path in chapters_query:
                serialized = serialize_chapter(c)
                serialized["resource_title"] = r_title
                serialized["resource_type"] = r_type
                serialized["resource_local_path"] = r_path
                serialized_chapters.append(serialized)

            # Query user subchapters
            subchapters_query = (
                db.query(SubChapter, Resource.title, Resource.type, Resource.local_path, Chapter.id)
                .join(Chapter, SubChapter.chapter_id == Chapter.id)
                .join(Resource, Chapter.resource_id == Resource.id)
                .filter(
                    Resource.user_id == user.id,
                    Resource.is_deleted == 0,
                    or_(
                        SubChapter.title.contains(query),
                        SubChapter.summary.contains(query),
                        SubChapter.transcript.contains(query),
                    )
                )
                .all()
            )
            serialized_subchapters = []
            for s, r_title, r_type, r_path, c_id in subchapters_query:
                serialized = serialize_subchapter(s)
                serialized["resource_title"] = r_title
                serialized["resource_type"] = r_type
                serialized["resource_local_path"] = r_path
                serialized["chapter_id"] = c_id
                serialized_subchapters.append(serialized)

            # Query user notes
            notes = (
                db.query(Note)
                .filter(
                    Note.user_id == user.id,
                    Note.status != "deleted",
                    or_(Note.title.contains(query), Note.content.contains(query))
                )
                .all()
            )

            # Query user concepts
            concepts = (
                db.query(Concept)
                .filter(
                    or_(Concept.name.contains(query), Concept.description.contains(query))
                )
                .all()
            )

            # Query user folders
            folders = (
                db.query(Folder)
                .filter(
                    Folder.user_id == user.id,
                    Folder.is_deleted == 0,
                    Folder.name.contains(query)
                )
                .all()
            )

            return {
                "query": query,
                "counts": {
                    "resources": len(resources),
                    "chapters": len(serialized_chapters),
                    "subchapters": len(serialized_subchapters),
                    "notes": len(notes),
                    "concepts": len(concepts),
                    "folders": len(folders),
                },
                "resources": [serialize_resource(r) for r in resources],
                "chapters": serialized_chapters,
                "subchapters": serialized_subchapters,
                "notes": [serialize_note(n) for n in notes],
                "concepts": [serialize_concept(c) for c in concepts],
                "folders": [serialize_folder(f) for f in folders],
            }

    # Fallback to unauthenticated search
    resources = (
        db.query(Resource)
        .filter(
            or_(
                Resource.title.contains(query),
                Resource.description.contains(query),
                Resource.tags.contains(query),
                Resource.transcript.contains(query),
                Resource.summary.contains(query),
            )
        )
        .all()
    )
    resources.sort(
        key=lambda r: (
            query.lower() in (r.title or "").lower(),
            query.lower() in (r.summary or "").lower(),
        ),
        reverse=True,
    )
    chapters = (
        db.query(Chapter)
        .filter(
            or_(
                Chapter.title.contains(query),
                Chapter.summary.contains(query),
                Chapter.transcript.contains(query),
            )
        )
        .all()
    )
    subchapters = (
        db.query(SubChapter)
        .filter(
            or_(
                SubChapter.title.contains(query),
                SubChapter.summary.contains(query),
                SubChapter.transcript.contains(query),
            )
        )
        .all()
    )
    notes = (
        db.query(Note)
        .filter(or_(Note.title.contains(query), Note.content.contains(query)))
        .all()
    )
    concepts = (
        db.query(Concept)
        .filter(or_(Concept.name.contains(query), Concept.description.contains(query)))
        .all()
    )
    attachments = (
        db.query(Attachment).filter(Attachment.file_name.contains(query)).all()
    )

    return {
        "query": query,
        "counts": {
            "resources": len(resources),
            "chapters": len(chapters),
            "subchapters": len(subchapters),
            "notes": len(notes),
            "concepts": len(concepts),
            "attachments": len(attachments),
            "folders": 0,
        },
        "resources": [serialize_resource(r) for r in resources],
        "chapters": [serialize_chapter(c) for c in chapters],
        "subchapters": [serialize_subchapter(s) for s in subchapters],
        "notes": [serialize_note(n) for n in notes],
        "concepts": [serialize_concept(c) for c in concepts],
        "attachments": attachments,
        "folders": [],
    }


# ==================================================
# UNIFIED CROSS-LIBRARY SEARCH
# ==================================================


@app.get("/search/unified")
def unified_search(
    query: str,
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from core.metrics import log_unified_search
    from services.unified_search_service import run_unified_search

    safe_limit = max(1, min(int(limit), 50))
    payload = run_unified_search(db, current_user, query, limit=safe_limit)
    metrics = payload.get("metrics") or {}
    log_unified_search(
        query=query,
        latency_ms=metrics.get("latency_ms", 0.0),
        result_count=metrics.get("result_count", 0),
        content_type_distribution=metrics.get("content_type_distribution", {}),
        search_source_usage=metrics.get("search_source_usage", {}),
        cache_hit=metrics.get("cache_hit", False),
        user_id=current_user.id,
    )
    return payload


class UnifiedSearchClickRequest(BaseModel):
    query: str
    result_id: str
    result_type: str
    content_type: str | None = None
    source_id: str | None = None


@app.post("/search/unified/click")
def unified_search_click(
    payload: UnifiedSearchClickRequest,
    current_user: User = Depends(get_current_user),
):
    from core.metrics import log_unified_search_click

    log_unified_search_click(
        query=payload.query,
        result_id=payload.result_id,
        result_type=payload.result_type,
        content_type=payload.content_type or "",
        source_id=payload.source_id or "",
        user_id=current_user.id,
    )
    return {"ok": True}


# ==================================================
# SEARCH RESOURCES ONLY
# ==================================================


@app.get("/search/resources")
def search_resources(
    q: str, 
    db: Session = Depends(get_db),
    authorization: str | None = Header(None)
):
    query = db.query(Resource).outerjoin(DocumentInsight, DocumentInsight.resource_id == Resource.id).filter(Resource.is_deleted == 0)
    if authorization and authorization.startswith("Bearer "):
        try:
            token = authorization.split(" ")[1]
            user_id = validate_token(token, "access")
            if user_id:
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    query = query.filter(Resource.user_id == user.id)
                    if user.storage_root:
                        query = query.join(Folder, Resource.folder_id == Folder.id).filter(Folder.storage_root == user.storage_root)
        except Exception:
            pass

    resources = (
        query.filter(
            or_(
                Resource.title.contains(q),
                Resource.description.contains(q),
                Resource.summary.contains(q),
                Resource.transcript.contains(q),
                Resource.tags.contains(q),
                DocumentInsight.topics.contains(q),
                DocumentInsight.keywords.contains(q),
                DocumentInsight.key_concepts.contains(q),
                DocumentInsight.named_entities.contains(q),
                DocumentInsight.ai_tags.contains(q),
                DocumentInsight.difficulty_level.contains(q),
                DocumentInsight.document_type.contains(q),
            )
        )
        .limit(50)
        .all()
    )

    return [serialize_resource(r) for r in resources]


# ==================================================
# SEARCH INDEX VIEWER
# ==================================================


@app.get("/search-index")
def get_search_index(db: Session = Depends(get_db)):

    return db.query(SearchIndex).all()


# ==================================================
# UNIFIED INDEX SEARCH
# ==================================================


@app.get("/search/all")
def search_all(query: str, db: Session = Depends(get_db)):

    results = db.query(SearchIndex).filter(SearchIndex.content.contains(query)).all()

    return results


@app.get("/embeddings")
def get_embeddings(db: Session = Depends(get_db)):

    return db.query(Embedding).all()


class AskQuestionResponse(BaseModel):
    answer: str
    sources: list[CitationSource]
    hallucinations: list[dict] = []
    confidence: float | None = None
    confidence_label: str | None = None


@app.get("/semantic-search", response_model=AskQuestionResponse)
def semantic_search(query: str, resource_id: str, current_user: User = Depends(get_current_user)):
    # Consolidate semantic search to use the same authoritative RAG pipeline as Ask/Chat
    from services.rag_service import run_rag_pipeline
    from database import SessionLocal

    db = SessionLocal()
    try:
        # Use the standardized production RAG pipeline
        rag_result = run_rag_pipeline(
            db=db,
            user_id=current_user.id,
            resource_id=resource_id,
            question=query,
            n_results=5
        )

        return {
            "answer": rag_result["answer"],
            "sources": rag_result["sources"],
            "hallucinations": rag_result.get("hallucinations", []),
            "confidence": rag_result.get("confidence"),
            "confidence_label": rag_result.get("confidence_label"),
        }
    finally:
        db.close()


@app.get("/semantic-search/details")
def semantic_search_details(query: str, db: Session = Depends(get_db)):

    query_vector = json.loads(generate_fake_embedding(query))

    embeddings = db.query(Embedding).all()

    results = []

    for embedding in embeddings:
        stored_vector = json.loads(embedding.embedding_vector)

        similarity = calculate_similarity(query_vector, stored_vector)

        item_data = None

        if embedding.source_type == "resource":
            item_data = (
                db.query(Resource).filter(Resource.id == embedding.source_id).first()
            )

        elif embedding.source_type == "chapter":
            item_data = (
                db.query(Chapter).filter(Chapter.id == embedding.source_id).first()
            )

        elif embedding.source_type == "subchapter":
            item_data = (
                db.query(SubChapter)
                .filter(SubChapter.id == embedding.source_id)
                .first()
            )

        if item_data:
            results.append(
                {
                    "source_type": embedding.source_type,
                    "similarity_score": similarity,
                    "data": item_data,
                }
            )

    results.sort(key=lambda x: x["similarity_score"])

    return results[:10]


@app.get("/ask")
def ask_library(session_id: str, question: str):
    # Deprecated - use /resources/{resource_id}/chat instead
    return {
        "error": "Use POST /resources/{resource_id}/chat with session_id and question"
    }


class ChatSessionCreate(BaseModel):
    title: str
    source: str | None = "chat"
    resource_id: str | None = None


class ChatSessionOut(BaseModel):
    id: str
    title: str
    source: str | None = None
    resource_id: str | None = None
    saved_to_notebook: bool = False
    created_at: str | None = None


class ChatMessageOut(BaseModel):
    id: str
    role: str
    content: str
    sources: list[dict] | None = None
    details: dict | None = None
    created_at: str | None = None


class ResourceChatRequest(BaseModel):
    session_id: str
    question: str
    globe_on: bool = False


class CitationSource(BaseModel):
    chunk_index: int
    excerpt: str
    rerank_score: float | None = None
    hybrid_score: float | None = None
    resource_id: str | None = None
    resource_title: str | None = None
    resource_path: str | None = None


class ResourceChatResponse(BaseModel):
    question: str
    answer: str
    session_id: str
    context: str
    sources: list[CitationSource]
    hallucinations: list[dict] = []
    confidence: float | None = None
    confidence_label: str | None = None


class AskQuestionResponse(BaseModel):
    answer: str
    sources: list[CitationSource]
    hallucinations: list[dict] = []
    confidence: float | None = None
    confidence_label: str | None = None


@app.post("/chat/sessions", response_model=ChatSessionOut)
def create_chat_session(
    payload: ChatSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    session = ChatSession(
        id=str(uuid4()), title=payload.title, summary="", user_id=current_user.id,
        source=payload.source or "chat", resource_id=payload.resource_id
    )

    db.add(session)
    db.commit()
    db.refresh(session)

    return {
        "id": session.id,
        "title": session.title,
        "source": session.source,
        "resource_id": session.resource_id,
        "saved_to_notebook": bool(session.saved_to_notebook),
        "created_at": session.created_at.isoformat() if session.created_at else None,
    }


@app.put("/chat/sessions/{session_id}/saved-to-notebook")
def mark_chat_saved_to_notebook(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    session.saved_to_notebook = 1
    db.commit()
    return {"saved_to_notebook": True}


class ChatMessageBulkInput(BaseModel):
    session_id: str
    messages: List[dict]


@app.post("/chat/sessions/messages")
def save_chat_messages(
    payload: ChatMessageBulkInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == payload.session_id, ChatSession.user_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    for msg in payload.messages:
        chat_msg = ChatMessage(
            id=str(uuid4()),
            session_id=payload.session_id,
            role=msg.get("role", "user"),
            content=msg.get("content", ""),
            sources_json=msg.get("sources_json"),
            details_json=msg.get("details_json"),
        )
        db.add(chat_msg)
    db.commit()
    return {"saved": len(payload.messages)}


@app.get("/chat/sessions", response_model=List[ChatSessionOut])
def get_chat_sessions(
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)
):

    sessions = (
        db.query(ChatSession)
        .filter(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
        .all()
    )

    sys_logger.info(
        "Chat DB load: returning chat session list",
        extra={
            "user_id": current_user.id,
            "session_count": len(sessions),
        },
    )

    return [
        {
            "id": s.id,
            "title": s.title,
            "source": s.source,
            "resource_id": s.resource_id,
            "saved_to_notebook": bool(s.saved_to_notebook),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        }
        for s in sessions
    ]


@app.get("/chat/sessions/{session_id}/messages", response_model=List[ChatMessageOut])
def get_chat_messages(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    sys_logger.info(
        "Chat DB load: returning chat session messages",
        extra={
            "user_id": current_user.id,
            "session_id": session_id,
            "message_count": len(messages),
        },
    )

    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": json.loads(m.sources_json) if m.sources_json else None,
            "details": json.loads(m.details_json) if m.details_json else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]


@app.delete("/chat/sessions/{session_id}")
def delete_chat_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        db.query(ChatSession)
        .filter(ChatSession.id == session_id, ChatSession.user_id == current_user.id)
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete(synchronize_session=False)
        db.delete(session)
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(exc))
        
    return {"message": "Chat session deleted"}


@app.post("/resources/{resource_id}/chat", response_model=ResourceChatResponse)
def resource_chat(
    resource_id: str,
    payload: ResourceChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == payload.session_id, ChatSession.user_id == current_user.id
        )
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Save user message before calling LLM
    user_message = ChatMessage(
        id=str(uuid4()),
        session_id=payload.session_id,
        role="user",
        content=payload.question,
    )
    db.add(user_message)
    db.commit()

    # Load recent session messages and preserve relevant context
    recent = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == payload.session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    # If the conversation is long, summarize earlier turns to keep the prompt compact.
    if len(recent) > 10:
        history_to_summarize = "\n".join(
            [f"{m.role}: {m.content}" for m in recent[:-6]]
        )
        summarized = generate_chat_summary(
            history_to_summarize,
            user_id=current_user.id,
            resource_id=resource_id,
            feature="chat_history_summary",
        )
        final_history = (
            summarized
            + "\n\n"
            + "\n".join([f"{m.role}: {m.content}" for m in recent[-6:]])
        )
    else:
        final_history = "\n".join([f"{m.role}: {m.content}" for m in recent])

    # Build chat history list for rewriting (last 10 messages)
    chat_history = [
        {
            "role": m.role,
            "content": m.content,
        }
        for m in recent[-10:]
    ]

    # Use the standardized production RAG pipeline
    from services.rag_service import run_rag_pipeline
    
    rag_result = run_rag_pipeline(
        db=db,
        user_id=current_user.id,
        resource_id=resource_id,
        question=payload.question,
        chat_history=chat_history,
        final_history_str=final_history,
        n_results=12
    )

    answer = rag_result.get("answer", "")
    context = rag_result.get("context", "")
    sources = rag_result.get("sources", [])
    hallucinations = rag_result.get("hallucinations", [])
    confidence = rag_result.get("confidence")
    confidence_label = rag_result.get("confidence_label")

    assistant_message = ChatMessage(
        id=str(uuid4()), session_id=payload.session_id, role="assistant", content=answer,
        sources_json=json.dumps(sources) if sources else None,
        details_json=json.dumps({
            "confidence": confidence,
            "confidenceLabel": confidence_label,
            "hallucinationCount": len(hallucinations) if hallucinations else None,
            "hallucinationCheckPassed": len(hallucinations) == 0 if hallucinations is not None else None,
            "sourceCount": len(sources) if sources else None,
            "retrievalStrategy": rag_result.get("retrieval_strategy"),
            "processingTimeMs": rag_result.get("processing_time_ms"),
            "modulesExecuted": rag_result.get("modules_executed"),
            "reasoning": rag_result.get("reasoning"),
        }),
    )

    db.add(assistant_message)
    db.commit()

    return {
        "question": payload.question,
        "answer": answer,
        "session_id": payload.session_id,
        "context": context,
        "sources": sources,
        "hallucinations": hallucinations,
        "confidence": confidence,
        "confidence_label": confidence_label,
    }


class FeedbackRequest(BaseModel):
    question: str
    answer: str
    rating: int  # 1 or -1
    comment: str | None = None


@app.post("/resources/{resource_id}/feedback")
def submit_feedback(
    resource_id: str,
    payload: FeedbackRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.feedback_service import save_feedback
    feedback = save_feedback(
        db=db,
        user_id=current_user.id,
        resource_id=resource_id,
        question=payload.question,
        answer=payload.answer,
        rating=payload.rating,
        comment=payload.comment,
    )
    return {"status": "ok", "id": feedback.id}


@app.get("/api/metrics/dashboard")
def metrics_dashboard(
    limit: int = 2000,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from core.metrics import read_metrics
    from services.ai_cost_service import get_user_usage_summary, get_user_wallet_balance, read_ai_usage, reconcile_pending_ai_usage
    reconcile_pending_ai_usage(db, current_user.id)
    entries = read_metrics(limit=limit, user_id=current_user.id)
    ai_usage_entries = read_ai_usage(db=db, user_id=current_user.id, limit=limit)
    usage_summary = get_user_usage_summary(db, current_user.id)
    wallet_balance = get_user_wallet_balance(current_user.id)
    if not entries and not ai_usage_entries:
        return {
            "total_queries": 0,
            "avg_latency_ms": 0,
            "cache_hit_rate": 0,
            "avg_confidence": 0,
            "entries": [],
            "ai_usage_entries": [],
            "usage_summary": usage_summary,
            "wallet_balance": wallet_balance,
        }

    request_entries = [entry for entry in entries if not entry.get("type") and entry.get("query")]
    total = len(request_entries)
    avg_latency = sum(e.get("latency_ms", 0) for e in request_entries) / total if total > 0 else 0
    cache_hits = sum(1 for e in request_entries if e.get("cache_hit"))
    cache_rate = round(cache_hits / total * 100, 1) if total > 0 else 0
    avg_confidence = sum(e.get("confidence", 0) for e in request_entries) / total if total > 0 else 0
    return {
        "total_queries": total,
        "avg_latency_ms": round(avg_latency, 1),
        "cache_hit_rate": cache_rate,
        "avg_confidence": round(avg_confidence, 3),
        "entries": entries,
        "ai_usage_entries": ai_usage_entries,
        "usage_summary": usage_summary,
        "wallet_balance": wallet_balance,
    }

@app.get("/api/metrics/kb-health")
def metrics_kb_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        from embedding_service import get_collection
        from models import Resource, ChunkIndex, ProcessingJob
        from sqlalchemy import func
        
        # Get active embedded resource IDs for this user
        active_resource_ids = [
            r[0] for r in db.query(Resource.id)
            .filter(Resource.user_id == current_user.id)
            .filter(Resource.is_deleted == 0)
            .filter(Resource.is_embedded == "true")
            .all()
        ]

        # Get active processing jobs
        active_jobs = db.query(ProcessingJob).join(Resource, ProcessingJob.resource_id == Resource.id)\
            .filter(Resource.user_id == current_user.id)\
            .filter(ProcessingJob.status.in_(["queued", "processing"])).count()

        collection = get_collection(current_user.active_storage_path.path if current_user and current_user.active_storage_path else None)
        vectors_count = 0
        if active_resource_ids:
            try:
                user_vectors = collection.get(
                    where={"resource_id": {"$in": active_resource_ids}},
                    include=[]
                )
                vectors_count = len(user_vectors["ids"]) if user_vectors and "ids" in user_vectors else 0
            except Exception:
                pass

        types_query = db.query(Resource.type, func.count(ChunkIndex.id))\
            .join(ChunkIndex, Resource.id == ChunkIndex.resource_id)\
            .filter(Resource.user_id == current_user.id)\
            .filter(Resource.is_deleted == 0)\
            .filter(Resource.is_embedded == "true")\
            .group_by(Resource.type).all()
        
        chunks_count = sum(c for _, c in types_query)
        total_resources = chunks_count
        
        freshness = 100.0
        if chunks_count > 0:
            freshness = min(round((vectors_count / chunks_count) * 100, 1), 100.0)
        elif vectors_count > 0:
            freshness = 0.0
        
        namespaces = []
        colors = [
            "linear-gradient(90deg,#6366f1,#8b5cf6)",
            "linear-gradient(90deg,#0ea5e9,#6366f1)",
            "linear-gradient(90deg,#10b981,#059669)",
            "linear-gradient(90deg,#f59e0b,#f97316)",
            "linear-gradient(90deg,#f43f5e,#e11d48)"
        ]
        text_colors = [
            None, None, None, "#d97706", "#e11d48"
        ]
        
        for i, (t, count) in enumerate(types_query):
            if total_resources > 0:
                pct = round((count / total_resources) * 100)
                namespaces.append({
                    "name": t or "unknown",
                    "pct": pct,
                    "color": colors[i % len(colors)],
                    "textColor": text_colors[i % len(text_colors)]
                })

        namespaces.sort(key=lambda x: x["pct"], reverse=True)

        return {
            "chunks": chunks_count,
            "vectors": vectors_count,
            "freshness": freshness,
            "namespaces": namespaces,
            "active_jobs": active_jobs,
        }
    except Exception as e:
        import traceback
        return {"error": str(e), "traceback": traceback.format_exc()}


@app.post("/resources/{resource_id}/chat-stream")
def resource_chat_stream(
    resource_id: str,
    payload: ResourceChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    session = (
        db.query(ChatSession)
        .filter(
            ChatSession.id == payload.session_id, ChatSession.user_id == current_user.id
        )
        .first()
    )

    if not session:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Save user message
    user_message = ChatMessage(
        id=str(uuid4()),
        session_id=payload.session_id,
        role="user",
        content=payload.question,
    )
    db.add(user_message)
    db.commit()

    # Load recent session messages
    recent = (
        db.query(ChatMessage)
        .filter(ChatMessage.session_id == payload.session_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    if len(recent) > 10:
        history_to_summarize = "\n".join(
            [f"{m.role}: {m.content}" for m in recent[:-6]]
        )
        summarized = generate_chat_summary(
            history_to_summarize,
            user_id=current_user.id,
            resource_id=resource_id,
            feature="media_chat_history_summary",
        )
        final_history = (
            summarized
            + "\n\n"
            + "\n".join([f"{m.role}: {m.content}" for m in recent[-6:]])
        )
    else:
        final_history = "\n".join([f"{m.role}: {m.content}" for m in recent])

    chat_history = [
        {"role": m.role, "content": m.content} for m in recent[-10:]
    ]

    from services.rag_service import run_rag_pipeline_stream

    def event_generator():
        full_answer = ""
        collected_sources = []
        collected_details = {}
        try:
            for event in run_rag_pipeline_stream(
                user_id=current_user.id,
                resource_id=resource_id,
                question=payload.question,
                chat_history=chat_history,
                final_history_str=final_history,
                n_results=12,
                globe_on=payload.globe_on
            ):
                if event["type"] == "token":
                    yield f"data: {json.dumps(event)}\n\n"
                    full_answer += event["content"]
                elif event["type"] == "metadata":
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "sources":
                    collected_sources = event.get("sources", [])
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "final":
                    full_answer = event.get("answer", full_answer)
                    if event.get("sources"):
                        collected_sources = event["sources"]
                    collected_details = {
                        "confidence": event.get("confidence"),
                        "confidenceLabel": event.get("confidence_label"),
                        "hallucinationCount": len(event.get("hallucinations", [])) if event.get("hallucinations") else None,
                        "hallucinationCheckPassed": len(event.get("hallucinations", [])) == 0 if event.get("hallucinations") is not None else None,
                        "sourceCount": len(event.get("sources", [])) if event.get("sources") else None,
                        "retrievalStrategy": event.get("retrieval_strategy"),
                        "processingTimeMs": event.get("processing_time_ms"),
                        "modulesExecuted": event.get("modules_executed"),
                        "reasoning": event.get("reasoning"),
                    }
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "error":
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "done":
                    pass

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            if full_answer:
                with SessionLocal() as stream_db:
                    assistant_message = ChatMessage(
                        id=str(uuid4()),
                        session_id=payload.session_id,
                        role="assistant",
                        content=full_answer,
                        sources_json=json.dumps(collected_sources) if collected_sources else None,
                        details_json=json.dumps(collected_details) if collected_details else None
                    )
                    stream_db.add(assistant_message)
                    stream_db.commit()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ... flashcards ...


# ==================================================
# FLASHCARDS
# ==================================================


@app.get("/flashcards")
def get_flashcards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    query = (
        db.query(Flashcard)
        .join(Resource, Flashcard.resource_id == Resource.id)
        .join(Folder, Resource.folder_id == Folder.id)
        .filter(Resource.user_id == current_user.id)
    )
    if current_user.storage_root:
        query = query.filter(Folder.storage_root == current_user.storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))
    return query.all()


@app.get("/flashcards/{flashcard_id}")
def get_flashcard(flashcard_id: str, db: Session = Depends(get_db)):

    return db.query(Flashcard).filter(Flashcard.id == flashcard_id).first()


# ==================================================
# QUIZZES
# ==================================================


@app.get("/quizzes")
def get_quizzes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        db.query(Quiz)
        .join(Resource, Quiz.resource_id == Resource.id)
        .join(Folder, Resource.folder_id == Folder.id)
        .filter(Resource.user_id == current_user.id)
    )
    if current_user.storage_root:
        query = query.filter(Folder.storage_root == current_user.storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))
    return query.all()


@app.get("/resources/{resource_id}/quizzes")
def get_resource_quizzes(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    quizzes = db.query(Quiz).filter(Quiz.resource_id == resource_id).all()

    return quizzes


@app.post("/chapters/{chapter_id}/generate-summary")
def generate_chapter_summary(chapter_id: str, db: Session = Depends(get_db)):

    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()

    existing_summary = (
        db.query(Summary).filter(Summary.chapter_id == chapter_id).first()
    )

    if existing_summary:
        return {
            "message": "Summary already exists",
            "summary": existing_summary.summary,
        }

    if not chapter:
        return {"error": "Chapter not found"}

    content = chapter.transcript + "\n\n"

    subchapters = db.query(SubChapter).filter(SubChapter.chapter_id == chapter_id).all()

    for subchapter in subchapters:
        content += subchapter.transcript + "\n\n"

    resource = db.query(Resource).filter(Resource.id == chapter.resource_id).first()
    summary_text = generate_summary(
        content,
        user_id=resource.user_id if resource else None,
        resource_id=chapter.resource_id,
        feature="chapter_summary_generation",
    )

    summary = Summary(
        id=str(uuid4()),
        summary=summary_text,
        chapter_id=chapter_id,
    )

    db.add(summary)
    db.commit()

    return {
        "chapter_id": chapter_id,
        "summary": summary_text,
    }


@app.get("/chapters/{chapter_id}/summary")
def get_chapter_summary(chapter_id: str, db: Session = Depends(get_db)):

    summaries = db.query(Summary).filter(Summary.chapter_id == chapter_id).all()

    return summaries


@app.post("/resources/{resource_id}/generate-quiz")
def generate_resource_quiz(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    existing_quiz = db.query(Quiz).filter(Quiz.resource_id == resource_id).first()
    if existing_quiz:
        raise HTTPException(
            status_code=400,
            detail="Quiz already exists for this resource.",
        )

    log_user_activity(db, current_user.id, 'ai_features', 'Generating quiz', resource.title)
    quiz_data = generate_quiz(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="quiz_generation")

    save_quiz(
        db,
        resource,
        quiz_data,
    )

    return quiz_data


@app.get("/resources/{resource_id}/quiz")
def get_resource_quiz(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    quizzes = db.query(Quiz).filter(Quiz.resource_id == resource_id).all()

    return quizzes


@app.post("/resources/{resource_id}/regenerate-quiz")
def regenerate_resource_quiz(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    # Clear old quizzes
    db.query(Quiz).filter(Quiz.resource_id == resource_id).delete()

    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating quiz', resource.title)
    # Generate new quiz
    quiz_data = generate_quiz(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="quiz_regeneration")

    # Save
    save_quiz(
        db,
        resource,
        quiz_data,
    )

    return quiz_data


@app.post("/resources/{resource_id}/generate-flashcards")
def generate_resource_flashcards(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    existing_flashcard = (
        db.query(Flashcard).filter(Flashcard.resource_id == resource_id).first()
    )
    if existing_flashcard:
        raise HTTPException(
            status_code=400,
            detail="Flashcards already exist for this resource.",
        )

    log_user_activity(db, current_user.id, 'ai_features', 'Generating flashcards', resource.title)
    flashcards_data = generate_flashcards(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="flashcards_generation")

    save_flashcards(
        db,
        resource,
        flashcards_data,
    )

    return flashcards_data


@app.get("/resources/{resource_id}/flashcards")
def get_resource_flashcards(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    flashcards = db.query(Flashcard).filter(Flashcard.resource_id == resource_id).all()

    return flashcards


@app.post("/resources/{resource_id}/regenerate-flashcards")
def regenerate_resource_flashcards(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    # Clear old flashcards
    db.query(Flashcard).filter(Flashcard.resource_id == resource_id).delete()

    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating flashcards', resource.title)
    # Generate new flashcards
    flashcards_data = generate_flashcards(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="flashcards_regeneration")

    # Save
    save_flashcards(
        db,
        resource,
        flashcards_data,
    )

    return flashcards_data


@app.post("/resources/{resource_id}/generate-summary")
def generate_resource_summary(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    existing_summary = (
        db.query(Summary).filter(Summary.resource_id == resource_id).first()
    )
    if existing_summary or resource.summary:
        raise HTTPException(
            status_code=400,
            detail="Summary already exists for this resource.",
        )

    log_user_activity(db, current_user.id, 'ai_features', 'Generating summary', resource.title)
    summary = generate_summary(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="summary_generation")

    resource.summary = summary

    db.commit()

    return {"summary": summary}


@app.get("/resources/{resource_id}/summary")
def get_resource_summary(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    return {"summary": resource.summary}


@app.post("/resources/{resource_id}/regenerate-summary")
def regenerate_resource_summary(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    # Clear any old summary records
    db.query(Summary).filter(Summary.resource_id == resource_id).delete()

    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating summary', resource.title)
    # Generate new summary
    summary = generate_summary(resource.transcript, user_id=current_user.id, resource_id=resource.id, feature="summary_regeneration")
    resource.summary = summary
    resource.is_embedded = _add_outdated_flag(resource.is_embedded, "summary")
    db.commit()

    return {"summary": summary}


@app.post("/resources/{resource_id}/generate-mindmap")
def generate_resource_mindmap(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    existing_mindmap = (
        db.query(MindMap).filter(MindMap.resource_id == resource_id).first()
    )
    if existing_mindmap:
        try:
            data = json.loads(existing_mindmap.content)
            if data.get("children") or data.get("subtopics"):
                return data
        except Exception:
            pass
        db.delete(existing_mindmap)
        db.commit()

    chapters = db.query(Chapter).filter(Chapter.resource_id == resource.id).all()

    chapter_context = ""
    for chapter in chapters:
        chapter_context += f"""
Title: {chapter.title}

Summary:
{chapter.summary}

"""

    if not chapter_context.strip():
        if resource.transcript and resource.transcript.strip():
            chapter_context = resource.transcript
        elif resource.summary and resource.summary.strip():
            chapter_context = resource.summary
        elif resource.description and resource.description.strip():
            chapter_context = resource.description
        else:
            chapter_context = f"Title: {resource.title}"

    log_user_activity(db, current_user.id, 'ai_features', 'Generating mind map', resource.title)
    mindmap_data = generate_mindmap(chapter_context, user_id=current_user.id, resource_id=resource.id, feature="mindmap_generation")

    save_mindmap(
        db,
        resource,
        mindmap_data,
    )

    return mindmap_data


@app.get("/resources/{resource_id}/mindmap")
def get_resource_mindmap(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    resource = _get_owned_resource(db, resource_id, current_user.id)

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    mindmap = (
        db.query(MindMap)
        .filter(MindMap.resource_id == resource_id)
        .order_by(MindMap.created_at.desc())
        .first()
    )

    if not mindmap:
        raise HTTPException(
            status_code=404,
            detail="Mind map not found",
        )

    return json.loads(mindmap.content)


@app.post("/resources/{resource_id}/regenerate-mindmap")
def regenerate_resource_mindmap(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    # Clear old mindmaps
    db.query(MindMap).filter(MindMap.resource_id == resource_id).delete(synchronize_session=False)

    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating mind map', resource.title)
    # Generate new mindmap
    chapters = db.query(Chapter).filter(Chapter.resource_id == resource.id).all()
    chapter_context = ""
    for chapter in chapters:
        chapter_context += f"""
Title: {chapter.title}

Summary:
{chapter.summary}

"""

    if not chapter_context.strip():
        if resource.transcript and resource.transcript.strip():
            chapter_context = resource.transcript
        elif resource.summary and resource.summary.strip():
            chapter_context = resource.summary
        elif resource.description and resource.description.strip():
            chapter_context = resource.description
        else:
            chapter_context = f"Title: {resource.title}"
    mindmap_data = generate_mindmap(chapter_context, user_id=current_user.id, resource_id=resource.id, feature="mindmap_regeneration")

    # Save
    save_mindmap(
        db,
        resource,
        mindmap_data,
    )

    return mindmap_data


@app.get("/resources/{resource_id}/document-insights")
def get_document_insights(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.document_intelligence_service import serialize_document_insight

    insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource_id).first()
    return {
        "resource_id": resource_id,
        "enabled": True,
        "insight": serialize_document_insight(insight),
    }


@app.post("/resources/{resource_id}/document-insights/retry")
def retry_document_insights(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.document_intelligence_service import should_enable_document_intelligence

    if not should_enable_document_intelligence(resource):
        raise HTTPException(status_code=400, detail="Document intelligence is not enabled for this resource type.")

    existing_job = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource_id,
            ProcessingJob.status.in_(["queued", "processing"]),
            ProcessingJob.job_type == "document_intelligence",
        )
        .first()
    )
    if existing_job:
        raise HTTPException(status_code=409, detail="Document intelligence is already queued or processing.")

    insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource_id).first()
    if insight:
        insight.status = "pending"
        insight.error_message = None
        db.commit()

    create_processing_job(db, resource_id, job_type="document_intelligence")
    log_user_activity(db, current_user.id, 'ai_features', 'Retrying document intelligence', resource.title)
    return {"message": "Document intelligence queued"}


@app.get("/resources/{resource_id}/suggested-questions")
def get_resource_suggested_questions(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found",
        )

    raw_questions = getattr(resource, "suggested_questions", None)
    if not raw_questions:
        from services.llm_service import generate_suggested_questions

        duration = getattr(resource, "duration_seconds", None)
        questions = generate_suggested_questions(
            resource.transcript or "",
            duration_seconds=duration,
            user_id=current_user.id,
            resource_id=resource.id,
            feature="suggested_questions_generation",
        )
        normalized_questions = questions if isinstance(questions, list) else []
        resource.suggested_questions = json.dumps(normalized_questions)
        db.commit()
        log_user_activity(db, current_user.id, 'ai_features', 'Generated suggested questions', resource.title)
        sys_logger.info(
            "Suggested questions load: generated and saved initial questions",
            extra={
                "resource_id": resource.id,
                "user_id": current_user.id,
                "count": len(normalized_questions),
            },
        )
        return {"questions": normalized_questions}

    try:
        questions = json.loads(raw_questions) if isinstance(raw_questions, str) else raw_questions
    except json.JSONDecodeError:
        questions = []

    if not isinstance(questions, list) or len(questions) == 0:
        from services.llm_service import generate_suggested_questions

        duration = getattr(resource, "duration_seconds", None)
        questions = generate_suggested_questions(
            resource.transcript or "",
            duration_seconds=duration,
            user_id=current_user.id,
            resource_id=resource.id,
            feature="suggested_questions_generation",
        )
        normalized_questions = questions if isinstance(questions, list) else []
        resource.suggested_questions = json.dumps(normalized_questions)
        db.commit()
        sys_logger.info(
            "Suggested questions load: repaired empty saved questions by regenerating",
            extra={
                "resource_id": resource.id,
                "user_id": current_user.id,
                "count": len(normalized_questions),
            },
        )
        return {"questions": normalized_questions}

    sys_logger.info(
        "Suggested questions load: returning saved questions",
        extra={
            "resource_id": resource.id,
            "user_id": current_user.id,
            "count": len(questions) if isinstance(questions, list) else 0,
        },
    )
    return {"questions": questions if isinstance(questions, list) else []}


@app.post("/resources/{resource_id}/regenerate-suggested-questions")
def regenerate_resource_suggested_questions(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force-regenerate a fresh set of suggested questions (ignores cache)."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    from services.llm_service import generate_suggested_questions
    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating suggested questions', resource.title)
    duration = getattr(resource, "duration_seconds", None)
    questions = generate_suggested_questions(resource.transcript or "", duration_seconds=duration, user_id=current_user.id, resource_id=resource.id, feature="suggested_questions_regeneration")
    resource.suggested_questions = json.dumps(questions if isinstance(questions, list) else [])
    db.commit()
    sys_logger.info(
        "Suggested questions regenerate: saved fresh questions",
        extra={
            "resource_id": resource.id,
            "user_id": current_user.id,
            "count": len(questions) if isinstance(questions, list) else 0,
        },
    )
    return {"questions": questions}


# ==================================================
# STARRED TRANSCRIPTS
# ==================================================

class StarredTranscriptsRequest(BaseModel):
    starred: List[dict]

@app.get("/resources/{resource_id}/starred")
def get_resource_starred(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the starred transcript rows for a resource."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    starred_str = getattr(resource, "starred_transcripts", None)
    if starred_str:
        try:
            return {"starred": json.loads(starred_str)}
        except Exception:
            return {"starred": []}
    return {"starred": []}


@app.put("/resources/{resource_id}/starred")
def update_resource_starred(
    resource_id: str,
    req: StarredTranscriptsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the starred transcript rows for a resource."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    resource.starred_transcripts = json.dumps(req.starred)
    db.commit()
    log_user_activity(db, current_user.id, 'resource', f'Starred transcripts for {resource.title}')
    return {"starred": req.starred}


class TranslateRequest(BaseModel):
    text: str
    target_language: str

@app.post("/api/translate")
def translate_text(
    req: TranslateRequest,
    current_user: User = Depends(get_current_user)
):
    """Directly translate text to a target language without chat sessions."""
    from services.llm_service import generate_answer
    
    system_prompt = (
        f"You are a professional translator. Translate the text directly to {req.target_language}. "
        "Do NOT add any notes, chat context, pleasantries, metadata, explanation, or greetings. "
        "Output ONLY the translated text."
    )
    prompt = f"{system_prompt}\n\nText to translate:\n\"{req.text}\""
    
    translated = generate_answer(prompt, context="", user_id=current_user.id, feature="translation")
    log_user_activity(db, current_user.id, 'ai_features', f'Translated to {req.target_language}')
    return {"translation": translated.strip()}


# ==================================================
# STUDY NOTES
# ==================================================


@app.get("/resources/{resource_id}/notes")
def get_resource_notes(
    resource_id: str,
    only_saved: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the cached study notes for a resource from the database only.
    
    Notes Tab and Notebooks are independent systems:
    - Notes Tab reads/writes resource.study_notes (database)
    - Notebooks are one-way exports (Notes Tab → .md files on disk)
    The GET endpoint NEVER reads from notebook files.
    """
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    return {"notes": getattr(resource, "study_notes", None)}


class SaveNotesToNotebookRequest(BaseModel):
    notes: str


@app.post("/api/resources/{resource_id}/save-to-notebook")
def save_notes_to_notebook(
    resource_id: str,
    payload: SaveNotesToNotebookRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    import os
    import datetime
    from uuid import uuid4
    from services.note_service import NoteService, _sanitize_filename, markdown_to_blocks
    
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
        
    # Resolve the folder
    folder = None
    if resource.folder_id:
        folder = db.query(Folder).filter(Folder.id == resource.folder_id, Folder.user_id == current_user.id).first()
        
    # Resolve the playlist_id by walking up folder parents
    playlist_id = None
    curr_folder = folder
    while curr_folder:
        if curr_folder.playlist_id:
            playlist_id = curr_folder.playlist_id
            break
        if curr_folder.parent_id:
            curr_folder = db.query(Folder).filter(Folder.id == curr_folder.parent_id, Folder.user_id == current_user.id).first()
        else:
            break
            
    if not playlist_id:
        raise HTTPException(status_code=400, detail="Resource is not associated with any playlist folder.")
        
    note_service = NoteService(db)
    
    # Get note title
    if resource.local_path:
        note_title = os.path.splitext(os.path.basename(resource.local_path))[0]
    else:
        note_title = resource.title
        
    # Remove file extension if still present in title
    for ext in ['.mp4', '.mp3', '.wav', '.mkv']:
        if note_title.lower().endswith(ext):
            note_title = note_title[:-len(ext)]
            break
            
    sanitized_title = _sanitize_filename(note_title)
    filename = f"{sanitized_title}.md"
    
    notes_dir = note_service._get_note_dir(current_user, playlist_id)
    file_path = os.path.join(notes_dir, filename)
    
    notes_markdown = payload.notes
    
    # Check if a note already exists
    note = db.query(Note).filter(
        Note.playlist_id == playlist_id,
        Note.user_id == current_user.id,
        Note.filename == filename
    ).first()
    
    if note:
        # Link resource if not already done
        if not note.resource_id:
            note.resource_id = resource.id
        # Note exists in DB. Load existing content to prevent saving duplicates.
        existing_md = ""
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                existing_md = f.read()
                
        # Deduplication check
        new_content_clean = notes_markdown.strip()
        is_duplicate = False
        if existing_md:
            saved_blocks = [block.strip() for block in existing_md.split("\n\n---\n\n")]
            for block in saved_blocks:
                block_clean = block
                if block.startswith(f"# {note_title}"):
                    block_clean = block[len(f"# {note_title}"):].strip()
                if block_clean == new_content_clean or block == new_content_clean:
                    is_duplicate = True
                    break
                    
        if is_duplicate:
            raise HTTPException(
                status_code=400,
                detail="This note generation has already been saved to the notebook."
            )
            
        # Append new note content at the bottom
        if existing_md:
            updated_md = existing_md + "\n\n---\n\n" + notes_markdown
        else:
            updated_md = f"# {note_title}\n\n" + notes_markdown
            
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(updated_md)
            
        blocks_json = markdown_to_blocks(updated_md)
        note.content = blocks_json
        note.updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(note)
    else:
        # Note doesn't exist. Create it.
        updated_md = f"# {note_title}\n\n" + notes_markdown
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(updated_md)
            
        blocks_json = markdown_to_blocks(updated_md)
        
        note = Note(
            id=str(uuid4()),
            title=note_title,
            content=blocks_json,
            note_type="markdown",
            playlist_id=playlist_id,
            resource_id=resource.id,
            user_id=current_user.id,
            filename=filename,
            is_favorite=0,
            status="active",
            created_at=datetime.datetime.utcnow(),
            updated_at=datetime.datetime.utcnow()
        )
        db.add(note)
        db.commit()
        db.refresh(note)
        
    return {"message": "Notes saved to notebook successfully", "note_id": note.id}



def format_timestamp(seconds: float) -> str:
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    else:
        return f"{minutes:02d}:{secs:02d}"


def get_resource_segments(resource):
    from glob import glob
    import os
    from services.srt_parser import parse_srt
    from services.youtube_service import extract_video_id
    
    resource_id = resource.id
    
    # 1. Search in extraa_files/{resource_id}/*.srt
    srt_files = glob(os.path.join(EXTRAA_FILES_ROOT, resource_id, "*.srt"))
    if srt_files:
        try:
            return parse_srt(srt_files[0])
        except Exception:
            pass
            
    # 2. Check for YouTube video ID based SRT in temp_audio
    if resource.type == "youtube" and resource.description and resource.description.startswith("http"):
        video_id = extract_video_id(resource.description)
        if video_id:
            srt_path = os.path.join("temp_audio", f"{video_id}.srt")
            if os.path.exists(srt_path):
                try:
                    return parse_srt(srt_path)
                except Exception:
                    pass
                    
    # 3. Check for any srt files in temp_audio/ containing resource_id
    srt_files = glob(os.path.join("temp_audio", f"*{resource_id}*.srt"))
    if srt_files:
        try:
            return parse_srt(srt_files[0])
        except Exception:
            pass
            
    # 4. As a fallback, check if we have any srt file in the folder of resource.local_path
    if resource.local_path and os.path.exists(resource.local_path):
        base_name = os.path.splitext(resource.local_path)[0]
        srt_path = f"{base_name}.srt"
        if os.path.exists(srt_path):
            try:
                return parse_srt(srt_path)
            except Exception:
                pass
                
        # Or look for any srt in the same directory as local_path
        dir_name = os.path.dirname(resource.local_path)
        if dir_name:
            srt_files = glob(os.path.join(dir_name, "*.srt"))
            if srt_files:
                try:
                    return parse_srt(srt_files[0])
                except Exception:
                    pass
                    
    return []


def build_study_notes_content(db, resource):
    chapters = db.query(Chapter).filter(Chapter.resource_id == resource.id).all()
    segments = get_resource_segments(resource)
    
    content = ""
    if chapters:
        sorted_chapters = sorted(chapters, key=lambda c: c.start_time or 0)
        for ch in sorted_chapters:
            ts_str = format_timestamp(ch.start_time or 0)
            content += f"## {ch.title} [{ts_str}]\n\n"
            if ch.summary:
                content += f"{ch.summary}\n\n"
            
            if segments:
                ch_segments = [seg for seg in segments if (ch.start_time or 0) <= seg["start"] < (ch.end_time or ch.start_time or 0)]
                if ch_segments:
                    transcript_with_ts = ""
                    for seg in ch_segments:
                        seg_ts = format_timestamp(seg["start"])
                        transcript_with_ts += f"[{seg_ts}] {seg['text']}\n"
                    content += transcript_with_ts + "\n"
                else:
                    if ch.transcript:
                        content += f"{ch.transcript}\n\n"
            else:
                if ch.transcript:
                    content += f"{ch.transcript}\n\n"
    
    if not content.strip():
        if segments:
            transcript_with_ts = ""
            for seg in segments:
                seg_ts = format_timestamp(seg["start"])
                transcript_with_ts += f"[{seg_ts}] {seg['text']}\n"
            content = transcript_with_ts
        else:
            content = (
                resource.transcript
                or resource.summary
                or resource.description
                or resource.title
                or ""
            )
            
    return content


@app.post("/resources/{resource_id}/generate-notes")
def generate_resource_notes(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate deep study notes for a resource (first-time only)."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    existing_notes = getattr(resource, "study_notes", None)
    if existing_notes and existing_notes.strip():
        return {"notes": existing_notes}

    content = build_study_notes_content(db, resource)

    if not content.strip():
        raise HTTPException(
            status_code=400,
            detail="No content available to generate study notes from.",
        )

    notes = generate_study_notes(content, user_id=current_user.id, resource_id=resource.id, feature="notes_generation")
    resource.study_notes = notes
    db.commit()
    log_user_activity(db, current_user.id, 'ai_features', 'Generated study notes', resource.title)
    return {"notes": notes}


@app.post("/resources/{resource_id}/regenerate-notes")
def regenerate_resource_notes(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Force-regenerate study notes, overwriting any existing cached version."""
    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    content = build_study_notes_content(db, resource)

    if not content.strip():
        raise HTTPException(
            status_code=400,
            detail="No content available to generate study notes from.",
        )

    log_user_activity(db, current_user.id, 'ai_features', 'Regenerating study notes', resource.title)
    notes = generate_study_notes(content, user_id=current_user.id, resource_id=resource.id, feature="notes_regeneration")
    resource.study_notes = notes
    db.commit()
    return {"notes": notes}


class NotesUpdateRequest(BaseModel):
    notes: str


@app.put("/resources/{resource_id}/notes")
def update_resource_notes(
    resource_id: str,
    req: NotesUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the cached study notes for a resource and sync to notebook if it exists."""
    import os
    import datetime
    from services.note_service import NoteService, _sanitize_filename, markdown_to_blocks

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    
    resource.study_notes = req.notes
    db.commit()

    # Resolve folder and playlist_id for pathing fallback
    folder = None
    if resource.folder_id:
        folder = db.query(Folder).filter(Folder.id == resource.folder_id, Folder.user_id == current_user.id).first()
        
    playlist_id = None
    curr_folder = folder
    while curr_folder:
        if curr_folder.playlist_id:
            playlist_id = curr_folder.playlist_id
            break
        if curr_folder.parent_id:
            curr_folder = db.query(Folder).filter(Folder.id == curr_folder.parent_id, Folder.user_id == current_user.id).first()
        else:
            break

    # Look for existing note in notebook
    note = db.query(Note).filter(
        Note.resource_id == resource.id,
        Note.user_id == current_user.id
    ).first()

    was_created = False
    if not note and playlist_id:
        if resource.local_path:
            note_title = os.path.splitext(os.path.basename(resource.local_path))[0]
        else:
            note_title = resource.title
        for ext in ['.mp4', '.mp3', '.wav', '.mkv']:
            if note_title.lower().endswith(ext):
                note_title = note_title[:-len(ext)]
                break
        sanitized_title = _sanitize_filename(note_title)
        filename = f"{sanitized_title}.md"

        note = db.query(Note).filter(
            Note.playlist_id == playlist_id,
            Note.user_id == current_user.id,
            Note.filename == filename
        ).first()

        if not note:
            # Create a brand new note on disk and in the database
            try:
                from uuid import uuid4
                note_service = NoteService(db)
                notes_dir = note_service._get_note_dir(current_user, playlist_id)
                file_path = os.path.join(notes_dir, filename)
                
                updated_md = f"# {note_title}\n\n" + req.notes
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(updated_md)
                
                blocks_json = markdown_to_blocks(updated_md)
                note = Note(
                    id=str(uuid4()),
                    title=note_title,
                    content=blocks_json,
                    note_type="markdown",
                    playlist_id=playlist_id,
                    resource_id=resource.id,
                    user_id=current_user.id,
                    filename=filename,
                    is_favorite=0,
                    status="active",
                    created_at=datetime.datetime.utcnow(),
                    updated_at=datetime.datetime.utcnow()
                )
                db.add(note)
                db.commit()
                db.refresh(note)
                was_created = True
            except Exception as e:
                logger.error(f"Error automatically creating notebook note: {e}")
                note = None

    if note and not was_created:
        if not note.resource_id:
            note.resource_id = resource.id
        
        target_playlist_id = note.playlist_id or playlist_id
        if target_playlist_id:
            try:
                note_service = NoteService(db)
                notes_dir = note_service._get_note_dir(current_user, target_playlist_id)
                file_path = os.path.join(notes_dir, note.filename)
                
                updated_md = f"# {note.title}\n\n" + req.notes
                os.makedirs(os.path.dirname(file_path), exist_ok=True)
                with open(file_path, "w", encoding="utf-8") as f:
                    f.write(updated_md)
                
                blocks_json = markdown_to_blocks(updated_md)
                note.content = blocks_json
                note.updated_at = datetime.datetime.utcnow()
                db.commit()
            except Exception as e:
                logger.error(f"Error syncing study notes update to notebook note: {e}")

    return {"notes": resource.study_notes}



class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class AskQuestionRequest(BaseModel):
    question: str


import platform

@app.get("/auth/storage-suggestions")
def get_storage_suggestions():
    import os
    suggestions = []
    
    # 1. Add home directory suggestions
    home = os.path.expanduser("~")
    doc_dir = os.path.join(home, "Documents", "MyAILibrary")
    pic_dir = os.path.join(home, "Pictures", "MyAILibrary")
    suggestions.append({"name": "Documents Folder", "path": doc_dir})
    suggestions.append({"name": "Pictures Folder", "path": pic_dir})
    
    # 2. Check for other logical drives on Windows
    if platform.system() == "Windows":
        import string
        from ctypes import windll
        bitmask = windll.kernel32.GetLogicalDrives()
        for letter in string.ascii_uppercase:
            if bitmask & 1:
                # C: is standard, other drives are useful suggestions
                drive_path = f"{letter}:\\MyAILibrary"
                suggestions.append({"name": f"Local Drive ({letter}:)", "path": drive_path})
            bitmask >>= 1
    else:
        # macOS / Linux suggestions
        suggestions.append({"name": "Home Directory", "path": os.path.join(home, "MyAILibrary")})
        
    return suggestions


@app.get("/auth/select-folder")
def select_folder():
    import tkinter as tk
    from tkinter import filedialog
    try:
        root = tk.Tk()
        root.withdraw()  # Hide the main root window
        root.attributes('-topmost', True)  # Bring dialog to the front
        selected_path = filedialog.askdirectory(title="Select Library Workspace Folder")
        root.destroy()
        return {"path": selected_path if selected_path else None}
    except Exception as e:
        # Return fallback or error
        return {"path": None, "error": str(e)}


@app.get("/auth/check-username")
def check_username(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    return {"available": user is None}


@app.get("/auth/check-email")
def check_email(email: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == email).first()
    return {"available": user is None}


@app.get("/auth/resolve-email")
def resolve_email(username_or_email: str, db: Session = Depends(get_db)):
    if "@" in username_or_email:
        return {"email": username_or_email.strip()}
    user = db.query(User).filter(User.username == username_or_email.strip()).first()
    if user:
        return {"email": user.email}
    raise HTTPException(status_code=404, detail="Username not found")


@app.post("/auth/register")
def register(
    request: RegisterRequest,
    db: Session = Depends(get_db),
):
    # Perform validation
    validate_registration(request.username, request.email, request.password, db)

    user = User(
        id=str(uuid4()),
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    push_user(user)

    return {"message": "Account created"}


def _parse_user_agent(ua: str) -> tuple[str, str]:
    """Best-effort parse of a User-Agent string into (device, browser).
    No external dependency — simple substring matching covers the common cases."""
    ua = ua or ""
    u = ua.lower()

    # Operating system / device family
    if "iphone" in u:
        device = "iPhone"
    elif "ipad" in u:
        device = "iPad"
    elif "android" in u:
        device = "Android device"
    elif "windows" in u:
        device = "Windows PC"
    elif "mac os" in u or "macintosh" in u:
        device = "Mac"
    elif "linux" in u:
        device = "Linux PC"
    else:
        device = "Unknown device"

    # Browser (order matters: Edge/Opera spoof Chrome, Chrome spoofs Safari)
    if "edg/" in u or "edge" in u:
        browser = "Edge"
    elif "opr/" in u or "opera" in u:
        browser = "Opera"
    elif "firefox" in u:
        browser = "Firefox"
    elif "chrome" in u or "chromium" in u:
        browser = "Chrome"
    elif "safari" in u:
        browser = "Safari"
    else:
        browser = "Unknown browser"

    return device, browser


def record_session(db: Session, user_id: str, request: Request) -> None:
    """Upsert the current device's session. Keyed by (user_id, user_agent, ip)
    so repeated requests from the same device refresh `last_active` instead of
    creating duplicates."""
    if request is None:
        return
    try:
        ua = request.headers.get("user-agent", "")
        ip = request.client.host if request.client else None
        device, browser = _parse_user_agent(ua)

        session = (
            db.query(UserSession)
            .filter(
                UserSession.user_id == user_id,
                UserSession.user_agent == ua,
                UserSession.ip_address == ip,
            )
            .first()
        )

        now = datetime.utcnow()
        if session:
            session.last_active = now
        else:
            session = UserSession(
                id=str(uuid4()),
                user_id=user_id,
                user_agent=ua,
                device=device,
                browser=browser,
                ip_address=ip,
                created_at=now,
                last_active=now,
            )
            db.add(session)
        db.commit()
    except Exception as e:
        print(f"[SESSION TRACKING ERROR] {e}")
        db.rollback()


@app.post("/auth/login")
def login(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):

    user = db.query(User).filter((User.email == form_data.username) | (User.username == form_data.username)).first()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
        )

    access_token = create_access_token(user.id)
    refresh_token = create_refresh_token(user.id)

    # Record this device so it shows up under "Where you're logged in".
    record_session(db, user.id, request)

    push_user(user)

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
    }


@app.post("/auth/refresh")
def refresh(
    refresh_token: str,
    db: Session = Depends(get_db),
):
    from auth import validate_token
    user_id = validate_token(refresh_token, "refresh")
    
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    new_access_token = create_access_token(user.id)

    return {
        "access_token": new_access_token,
        "token_type": "bearer",
    }


class ProfileUpdateRequest(BaseModel):
    avatar_url: str | None = None
    banner_url: str | None = None


@app.get("/me")
def me(
    current_user: User = Depends(get_current_user),
):
    return {
        "user_id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "storage_root": current_user.storage_root,
        "avatar_url": current_user.avatar_url,
        "banner_url": current_user.banner_url,
    }


@app.get("/me/storage-usage")
def me_storage_usage(
    current_user: User = Depends(get_current_user),
):
    path = current_user.storage_root
    if not path or not os.path.exists(path):
        path = os.getcwd()

    try:
        # Calculate recursive directory size of the storage folder
        folder_size = 0
        for dirpath, dirnames, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                if not os.path.islink(fp):
                    try:
                        folder_size += os.path.getsize(fp)
                    except OSError:
                        pass

        # Calculate total partition capacity
        total, used, free = shutil.disk_usage(path)
        percent = (folder_size / total) * 100 if total > 0 else 0.0

        def format_sz(b: int) -> str:
            gb = b / (1024 ** 3)
            if gb >= 1000:
                return f"{gb / 1024:.2f} TB"
            return f"{gb:.2f} GB"

        formatted_used = format_sz(folder_size)
        formatted_total = format_sz(total)

        return {
            "total_bytes": total,
            "used_bytes": folder_size,
            "free_bytes": free,
            "used_percent": round(percent, 2),
            "formatted_used": formatted_used,
            "formatted_total": formatted_total,
            "formatted_text": f"Storage: {formatted_used} / {formatted_total} ({round(percent, 1)}%)"
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to scan path disk usage: {str(e)}"
        )


@app.patch("/me/profile")
def update_profile(
    request: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if request.avatar_url is not None:
        user.avatar_url = request.avatar_url
    if request.banner_url is not None:
        user.banner_url = request.banner_url

    db.commit()
    db.refresh(user)
    return {
        "message": "Profile updated successfully",
        "avatar_url": user.avatar_url,
        "banner_url": user.banner_url
    }


@app.patch("/me/reset-active-storage-path")
def reset_active_storage_path(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    # Fetch user fresh from the current session context
    user = db.query(User).filter(User.id == user_id).one()
    
    # Just deactivate, do not delete the StoragePath record
    user.active_storage_path_id = None
    user.storage_root = None
    
    db.commit()
    db.refresh(user)
    return {"message": "Active storage path reset to default. Custom paths remain saved.", "storage_root": None}


@app.post("/storage-paths")
def create_storage_path(
    name: str,
    path: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Check if path already exists
    if os.path.exists(path):
        raise HTTPException(
            status_code=400,
            detail="A folder at this path already exists. Please choose a different folder name or path."
        )
    
    # Attempt to create the folder
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create workspace directory: {str(e)}"
        )

    storage_path = StoragePath(id=str(uuid4()), name=name, path=path, user_id=current_user.id)
    db.add(storage_path)
    db.commit()
    db.refresh(storage_path)
    return {"id": storage_path.id, "name": storage_path.name, "path": storage_path.path}


@app.get("/storage-paths")
def get_storage_paths(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    paths = db.query(StoragePath).filter(StoragePath.user_id == current_user.id).all()
    return [{"id": p.id, "name": p.name, "path": p.path} for p in paths]


@app.patch("/me/active-storage-path")
def set_active_storage_path(
    path_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    # Verify path belongs to user
    path = db.query(StoragePath).filter(StoragePath.id == path_id, StoragePath.user_id == user_id).first()
    if not path:
        raise HTTPException(status_code=404, detail="Storage path not found")

    # Fetch user fresh from the current session context
    user = db.query(User).filter(User.id == user_id).one()
    
    user.active_storage_path_id = path_id
    user.storage_root = path.path
    
    db.commit()
    db.refresh(user)
    return {"message": "Active storage path updated", "path": path.path}


@app.post("/library/ask", response_model=AskQuestionResponse)
def ask_library_global(
    request: AskQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Search and synthesize answers across the entire user library.
    """
    from services.rag_service import run_rag_pipeline

    # Use the standardized production RAG pipeline, but pass resource_id=None for global search
    rag_result = run_rag_pipeline(
        db=db,
        user_id=current_user.id,
        resource_id=None,
        question=request.question,
        n_results=5,
        concise=True
    )

    return {
        "answer": rag_result["answer"],
        "sources": rag_result["sources"],
        "hallucinations": rag_result.get("hallucinations", []),
        "confidence": rag_result.get("confidence"),
        "confidence_label": rag_result.get("confidence_label"),
    }


# ==================================================
# QUOTES API
# ==================================================

QUOTES_POOL = [
    { "text": "The market is a device for transferring money from the impatient to the patient.", "author": "Warren Buffett", "role": "Chairman & CEO, Berkshire Hathaway" },
    { "text": "I believe the very best money is made at the market turns. Everyone says you get killed trying to pick tops and bottoms.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "The core of my philosophy is that I don't know. The fact that the financial markets are inherently unstable.", "author": "George Soros", "role": "Chair, Soros Fund Management" },
    { "text": "If most traders would learn to sit on their hands 50 percent of the time, they would make a lot more money.", "author": "Bill Lipschutz", "role": "Head of FX, Hathersage Capital" },
    { "text": "There is only one side of the market and it is not the bull side or the bear side, but the right side.", "author": "Jesse Livermore", "role": "Pioneer Day Trader" },
    { "text": "In trading/investing, it's not about how much you make but rather how much you don't lose.", "author": "Bernard Baruch", "role": "Financier" },
    { "text": "Amateurs think about how much money they can make. Professionals think about how much money they could lose.", "author": "Jack Schwager", "role": "Author, Market Wizards" },
    { "text": "The elements of good trading are: 1. Cutting losses, 2. Cutting losses, and 3. Cutting losses.", "author": "Ed Seykota", "role": "Commodities Trader" },
    { "text": "Do not anticipate and move without market confirmation - being a little late in your trade is your insurance.", "author": "Jesse Livermore", "role": "Pioneer Day Trader" },
    { "text": "Markets can remain irrational longer than you can remain solvent.", "author": "John Maynard Keynes", "role": "Economist" },
    { "text": "If you personalize losses, you can't trade.", "author": "Bruce Kovner", "role": "Chairman, Caxton Associates" },
    { "text": "Novice Traders trade 5 to 10 times too big. They take 5 to 10 percent risk on a trade they should take 1 to 2 percent on.", "author": "Bruce Kovner", "role": "Chairman, Caxton Associates" },
    { "text": "What seems to be hard is to hit the ball when it is pitched to you.", "author": "Warren Buffett", "role": "Chairman & CEO" },
    { "text": "Don't focus on making money; focus on protecting what you have.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "The hard part is discipline, patience and judgment.", "author": "Seth Klarman", "role": "CEO, Baupost Group" },
    { "text": "Price is what you pay. Value is what you get.", "author": "Warren Buffett", "role": "Chairman & CEO" },
    { "text": "Risk comes from not knowing what you're doing.", "author": "Warren Buffett", "role": "Chairman & CEO" },
    { "text": "You never know what kind of setup market will present to you, your objective should be to find opportunity where risk reward ratio is best.", "author": "Jaymin Shah", "role": "Trader & Investor" },
    { "text": "Trading is very competitive and you have to be able to handle getting your butt kicked.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "I always define my risk, and I don't have to worry about it.", "author": "Tony Saliba", "role": "Options Trader" },
    { "text": "The goal of a successful trader is to make the best trades. Money is secondary.", "author": "Alexander Elder", "role": "Author & Trader" },
    { "text": "There is the plain fool, who does the wrong thing at all times everywhere, but there is the Wall Street fool, who thinks he must trade all the time.", "author": "Jesse Livermore", "role": "Pioneer Day Trader" },
    { "text": "Every day I assume every position I have is wrong.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "I have two basic rules about winning in trading as well as in life: 1. If you don't bet, you can't win. 2. If you lose all your chips, you can't bet.", "author": "Larry Hite", "role": "Hedge Fund Manager" },
    { "text": "Where you want to be is always in control, never wishing, always trading, and always, first and foremost protecting your butt.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "The most important rule of trading is to play great defense, not great offense.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "Accepting losses is the most important single investment device to ensure safety of capital.", "author": "Gerald M. Loeb", "role": "Founding Partner, E.F. Hutton" },
    { "text": "I know where I'm getting out before I get in.", "author": "Bruce Kovner", "role": "Chairman, Caxton Associates" },
    { "text": "It's not whether you're right or wrong that's important, but how much money you make when you're right and how much you lose when you're wrong.", "author": "George Soros", "role": "Chair, Soros Fund Management" },
    { "text": "Dangers of watching every tick are twofold: overtrading and increased chances of prematurely liquidating good positions.", "author": "Jack Schwager", "role": "Author, Market Wizards" },
    { "text": "I've learned many things from George Soros, but the most important is that it’s not whether you're right or wrong, but how much money you make when you're right and how much you lose when you're wrong.", "author": "Stanley Druckenmiller", "role": "Duquesne Capital Founder" },
    { "text": "You have to minimize your losses and try to preserve your capital for those very few times when you can make a lot in a very short period of time.", "author": "Richard Dennis", "role": "Leader of the Turtle Traders" },
    { "text": "The secret to winning in the stock market is not to be right all the time, but to lose the least amount of money when you are wrong.", "author": "William O'Neil", "role": "Founder, Investor's Business Daily" },
    { "text": "In this business, if you're good, you're right six times out of ten. You're never going to be right nine times out of ten.", "author": "Peter Lynch", "role": "Manager, Magellan Fund" },
    { "text": "I just wait until there is money lying in the corner, and all I have to do is go over there and pick it up. I do nothing in the meantime.", "author": "Jim Rogers", "role": "Co-Founder, Quantum Fund" },
    { "text": "The desire for constant action irrespective of underlying conditions is responsible for many losses in Wall Street.", "author": "Jesse Livermore", "role": "Pioneer Day Trader" },
    { "text": "Do more of what is working and less of what is not.", "author": "Richard Dennis", "role": "Leader of the Turtle Traders" },
    { "text": "Patterns don't work 100% of the time. But they are still critical because they help you define your risk.", "author": "Dan Zanger", "role": "World Record Holding Trader" },
    { "text": "Sheer will and determination is no substitute for something that actually works.", "author": "Jason Klatt", "role": "President, Klatt Capital" },
    { "text": "It is not the strongest of the species that survives, nor the most intelligent; it is the one most adaptable to change.", "author": "Charles Darwin", "role": "Adapted for Markets" },
    { "text": "I know from experience that there is nothing new in the stock market. Speculation is as old as the hills.", "author": "Jesse Livermore", "role": "Pioneer Day Trader" },
    { "text": "Every trader has strengths and weaknesses. Some are good holders of winners, but may hold their losers a little too long.", "author": "Jack Schwager", "role": "Author, Market Wizards" },
    { "text": "Focus, dedication, and balance are the keys to long-term success as a trader.", "author": "Michael Marcus", "role": "Commodities Trader" },
    { "text": "If you don't stay with your winners, you are not going to be able to pay for the losers.", "author": "Michael Marcus", "role": "Commodities Trader" },
    { "text": "I think investment psychology is by far the most important element, followed by risk control, with the least important being the question of where you buy and sell.", "author": "Tom Basso", "role": "President, Trendstat" },
    { "text": "When in doubt, get out and get a good night's sleep.", "author": "Michael Marcus", "role": "Commodities Trader" },
    { "text": "Markets are constantly in a state of uncertainty and flux and money is made by discounting the obvious and betting on the unexpected.", "author": "George Soros", "role": "Founder, Quantum Fund" },
    { "text": "In trading, you have to be defensive. If you don't protect your capital, you won't have any left to trade.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "Losers average losers.", "author": "Paul Tudor Jones", "role": "Founder, Tudor Investment Corp" },
    { "text": "The trend is your friend until the end when it bends.", "author": "Ed Seykota", "role": "Commodities Trader" }
]

import random
import time
import urllib.request
import json

@app.get("/api/quotes/batch")
def get_quotes_batch(count: int = 15):
    shuffled = list(QUOTES_POOL)
    random.shuffle(shuffled)
    
    batch = []
    now_ms = int(time.time() * 1000)
    for i in range(count):
        q = shuffled[i % len(shuffled)]
        seed = random.randint(0, 999999999)
        image_url = f"https://picsum.photos/seed/{seed}/2560/1440"
        batch.append({
            "id": now_ms + i,
            "text": q["text"],
            "author": q["author"],
            "role": q["role"],
            "image": image_url
        })

    return batch


# ==================================================
# NOTEBOOK — ISOLATED FOLDER ENDPOINTS
# These endpoints are ONLY used by the notebook page.
# They have no relation to the existing /folders or /playlists endpoints.
# Physical path convention: storage/username/PlaylistName/Notes/FolderName/
# ==================================================

def _notebook_get_notes_folder_record(db, playlist_id: str, current_user) -> Folder:
    """
    Finds (or creates) the 'Notes' system folder DB record for a given playlist.
    Does NOT touch any other endpoint or shared logic.
    """
    notes_folder = db.query(Folder).filter(
        func.lower(Folder.name) == "notes",
        Folder.playlist_id == playlist_id,
        Folder.user_id == current_user.id,
        or_(Folder.parent_id.is_(None), Folder.parent_id == ""),
    ).first()

    if not notes_folder:
        playlist = db.query(Playlist).filter(
            Playlist.id == playlist_id,
            Playlist.user_id == current_user.id,
        ).first()
        playlist_name = playlist.name if playlist else playlist_id
        notes_folder = Folder(
            id=str(uuid4()),
            name="Notes",
            playlist_id=playlist_id,
            user_id=current_user.id,
            storage_root=current_user.storage_root,
            parent_id=None,
        )
        db.add(notes_folder)
        db.flush()
        root = current_user.storage_root or UPLOADS_ROOT
        os.makedirs(os.path.join(root, current_user.username, playlist_name, "Notes"), exist_ok=True)

    return notes_folder


def _notebook_build_physical_path(db, folder: Folder, current_user) -> str:
    """
    Resolves the physical directory path for a notebook custom folder.
    Always lives under: storage/username/PlaylistName/Notes/[nested/]FolderName/
    Self-contained — does NOT use _get_folder_path.
    """
    playlist = db.query(Playlist).filter(
        Playlist.id == folder.playlist_id,
        Playlist.user_id == current_user.id,
    ).first()
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    root = current_user.storage_root or UPLOADS_ROOT
    base = os.path.join(root, current_user.username, playlist.name, "Notes")

    # Walk up parent chain; stop at system folders (Notes/root)
    path_parts = [folder.name]
    curr = folder
    while curr.parent_id:
        parent = db.query(Folder).filter(
            Folder.id == curr.parent_id,
            Folder.user_id == current_user.id,
        ).first()
        if not parent or parent.name.lower() in ("notes", "root"):
            break
        path_parts.insert(0, parent.name)
        curr = parent

    return os.path.join(base, *path_parts)


@app.post("/notebook/folders")
def notebook_create_folder(
    playlist_id: str,
    name: str,
    parent_folder_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Creates a custom folder inside a playlist's Notes directory.
    Physical result:  storage/username/PlaylistName/Notes/[parent/]FolderName/
    """
    playlist = _get_owned_playlist(db, playlist_id, current_user.id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")

    if parent_folder_id in (None, "null", ""):
        parent_folder_id = None

    if parent_folder_id:
        parent = _get_owned_folder(db, parent_folder_id, current_user.id)
        if not parent:
            raise HTTPException(status_code=404, detail="Parent folder not found")
        effective_parent_id = parent_folder_id
    else:
        notes_folder = _notebook_get_notes_folder_record(db, playlist_id, current_user)
        effective_parent_id = notes_folder.id

    new_folder = Folder(
        id=str(uuid4()),
        name=name,
        playlist_id=playlist_id,
        user_id=current_user.id,
        storage_root=current_user.storage_root,
        parent_id=effective_parent_id,
    )
    db.add(new_folder)
    db.flush()

    physical_path = _notebook_build_physical_path(db, new_folder, current_user)
    os.makedirs(physical_path, exist_ok=True)

    db.commit()
    db.refresh(new_folder)

    return {
        "id": new_folder.id,
        "name": new_folder.name,
        "playlist_id": new_folder.playlist_id,
        "parent_id": new_folder.parent_id,
    }


@app.patch("/notebook/folders/{folder_id}")
def notebook_rename_folder(
    folder_id: str,
    name: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Renames a notebook custom folder and moves its physical directory.
    """
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    old_physical = _notebook_build_physical_path(db, folder, current_user)
    folder.name = name
    db.flush()

    new_physical = _notebook_build_physical_path(db, folder, current_user)
    if old_physical != new_physical and os.path.exists(old_physical):
        os.makedirs(os.path.dirname(new_physical), exist_ok=True)
        shutil.move(old_physical, new_physical)

    db.commit()
    return {
        "id": folder.id,
        "name": folder.name,
        "playlist_id": folder.playlist_id,
        "parent_id": folder.parent_id,
    }


@app.patch("/notebook/folders/{folder_id}/move")
def notebook_move_folder(
    folder_id: str,
    target_playlist_id: str,
    target_parent_folder_id: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Moves a notebook custom folder to a different playlist's Notes directory.
    - Physically moves the directory on disk.
    - Updates playlist_id + parent_id in DB.
    - Recursively updates all children's playlist_id.
    Example: ICT/Notes/OOP  ->  CRT/Notes/OOP
    After move, ICT's Notes folder no longer contains OOP.
    """
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    target_playlist = _get_owned_playlist(db, target_playlist_id, current_user.id)
    if not target_playlist:
        raise HTTPException(status_code=404, detail="Target playlist not found")

    if target_parent_folder_id in (None, "null", ""):
        target_parent_folder_id = None

    if target_parent_folder_id:
        target_parent = _get_owned_folder(db, target_parent_folder_id, current_user.id)
        if not target_parent:
            raise HTTPException(status_code=404, detail="Target parent folder not found")
        new_parent_id = target_parent_folder_id
    else:
        notes_folder = _notebook_get_notes_folder_record(db, target_playlist_id, current_user)
        new_parent_id = notes_folder.id

    # Compute old path before changing DB values
    old_physical = _notebook_build_physical_path(db, folder, current_user)

    folder.playlist_id = target_playlist_id
    folder.parent_id = new_parent_id
    db.flush()

    new_physical = _notebook_build_physical_path(db, folder, current_user)

    if old_physical != new_physical:
        if os.path.exists(old_physical):
            os.makedirs(os.path.dirname(new_physical), exist_ok=True)
            shutil.move(old_physical, new_physical)

    # Recursively update all child folders + notes to new playlist
    def _update_children(parent_folder_id: str, new_pl_id: str):
        for child in db.query(Folder).filter(
            Folder.parent_id == parent_folder_id,
            Folder.user_id == current_user.id,
        ).all():
            child.playlist_id = new_pl_id
            _update_children(child.id, new_pl_id)
        for note in db.query(Note).filter(
            Note.folder_id == parent_folder_id,
            Note.user_id == current_user.id,
        ).all():
            note.playlist_id = new_pl_id

    for note in db.query(Note).filter(
        Note.folder_id == folder.id,
        Note.user_id == current_user.id,
    ).all():
        note.playlist_id = target_playlist_id

    _update_children(folder.id, target_playlist_id)
    db.commit()

    return {
        "id": folder.id,
        "name": folder.name,
        "playlist_id": folder.playlist_id,
        "parent_id": folder.parent_id,
        "old_path": old_physical,
        "new_path": new_physical,
    }


@app.delete("/notebook/folders/{folder_id}")
def notebook_delete_folder(
    folder_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Permanently deletes a notebook custom folder.
    - Removes the physical directory (and all its contents) from disk.
    - Hard-deletes the folder and all its children recursively from DB.
    - Hard-deletes all notes inside the folder from DB.
    Isolated: does NOT touch any other endpoint.
    """
    folder = _get_owned_folder(db, folder_id, current_user.id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    # Safety: never delete system folders via this endpoint
    if folder.name.lower() in ("notes", "media", "resources", "root") and (
        not folder.parent_id or folder.parent_id == ""
    ):
        raise HTTPException(status_code=403, detail="System folders cannot be deleted")

    # Compute physical path before any DB changes
    try:
        physical_path = _notebook_build_physical_path(db, folder, current_user)
    except Exception:
        physical_path = None

    # Recursive DB cleanup: delete all descendants
    def _delete_recursive(fid: str):
        for child in db.query(Folder).filter(
            Folder.parent_id == fid,
            Folder.user_id == current_user.id,
        ).all():
            _delete_recursive(child.id)
            db.delete(child)
        for note in db.query(Note).filter(
            Note.folder_id == fid,
            Note.user_id == current_user.id,
        ).all():
            db.delete(note)

    _delete_recursive(folder_id)
    db.delete(folder)
    db.commit()

    # Remove physical directory (and everything inside)
    if physical_path and os.path.exists(physical_path):
        shutil.rmtree(physical_path, ignore_errors=True)

    return {"message": "Folder deleted", "id": folder_id}


class ChatMessageInput(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessageInput]
    session_id: str | None = None
    selected_resource_ids: List[str] = []
    cross_library_search: bool = False
    globe_on: bool = False


@app.post("/api/chat")
def api_chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        from services.rag_service import run_rag_pipeline

        if not payload.messages:
            raise HTTPException(status_code=400, detail="Messages list is empty")

        latest_question = payload.messages[-1].content
        if not latest_question.strip():
            raise HTTPException(status_code=400, detail="Latest message is empty")

        session = None
        if payload.session_id:
            session = (
                db.query(ChatSession)
                .filter(ChatSession.id == payload.session_id, ChatSession.user_id == current_user.id)
                .first()
            )
            if not session:
                raise HTTPException(status_code=404, detail="Session not found")

            db.query(ChatMessage).filter(ChatMessage.session_id == payload.session_id).delete(synchronize_session=False)
            for msg in payload.messages:
                db.add(
                    ChatMessage(
                        id=str(uuid4()),
                        session_id=payload.session_id,
                        role=msg.role,
                        content=msg.content,
                    )
                )
            db.commit()

        # Format chat history list
        chat_history_list = [{"role": m.role, "content": m.content} for m in payload.messages[:-1]]

        # Format chat history string
        chat_history_str = ""
        for msg in payload.messages[:-1]:
            role = "User" if msg.role == "user" else "Assistant"
            chat_history_str += f"{role}: {msg.content}\n"

        rag_result = run_rag_pipeline(
            db=db,
            user_id=current_user.id,
            resource_id=None,
            question=latest_question,
            chat_history=chat_history_list,
            final_history_str=chat_history_str or None,
            n_results=5,
            concise=False, # Full detail and depth answering
            selected_resource_ids=[] if payload.cross_library_search else payload.selected_resource_ids,
            globe_on=payload.globe_on,
        )

        if payload.session_id:
            import json
            assistant_message = ChatMessage(
                id=str(uuid4()),
                session_id=payload.session_id,
                role="assistant",
                content=rag_result["answer"],
                sources_json=json.dumps(rag_result["sources"]) if rag_result.get("sources") else None,
                details_json=json.dumps({
                    "confidence": rag_result.get("confidence"),
                    "confidenceLabel": rag_result.get("confidence_label"),
                    "hallucinationCount": len(rag_result.get("hallucinations", [])) if rag_result.get("hallucinations") else None,
                    "hallucinationCheckPassed": len(rag_result.get("hallucinations", [])) == 0 if rag_result.get("hallucinations") is not None else None,
                    "sourceCount": len(rag_result.get("sources", [])) if rag_result.get("sources") else None,
                    "retrievalStrategy": rag_result.get("retrieval_strategy"),
                    "processingTimeMs": rag_result.get("processing_time_ms"),
                    "modulesExecuted": rag_result.get("modules_executed"),
                    "reasoning": rag_result.get("reasoning"),
                }),
            )
            db.add(assistant_message)
            db.commit()

        return {
            "content": rag_result["answer"],
            "sources": rag_result["sources"]
        }
    except Exception as e:
        import openai
        error_detail = str(e)
        try:
            if isinstance(e, openai.OpenAIError):
                status_code = getattr(e, "status_code", "Unknown")
                body = getattr(e, "body", None)
                headers = getattr(e, "headers", None)
                
                error_detail = (
                    f"OpenAI Client Error (Status: {status_code}). "
                    f"Response Body: {body}. "
                    f"Original Exception: {e}"
                )
        except Exception as inner_e:
            error_detail = f"{str(e)} (Failed to parse OpenAIError details: {inner_e})"

        sys_logger.error(f"Error in api_chat: {error_detail}")
        raise HTTPException(status_code=500, detail=error_detail)


@app.post("/api/chat-stream")
def api_chat_stream(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.rag_service import run_rag_pipeline_stream

    if not payload.messages:
        raise HTTPException(status_code=400, detail="Messages list is empty")

    latest_question = payload.messages[-1].content
    if not latest_question.strip():
        raise HTTPException(status_code=400, detail="Latest message is empty")

    session = None
    if payload.session_id:
        session = (
            db.query(ChatSession)
            .filter(ChatSession.id == payload.session_id, ChatSession.user_id == current_user.id)
            .first()
        )
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")

        db.query(ChatMessage).filter(ChatMessage.session_id == payload.session_id).delete(synchronize_session=False)
        for msg in payload.messages:
            db.add(
                ChatMessage(
                    id=str(uuid4()),
                    session_id=payload.session_id,
                    role=msg.role,
                    content=msg.content,
                )
            )
        db.commit()

    chat_history_list = [{"role": m.role, "content": m.content} for m in payload.messages[:-1]]

    chat_history_str = ""
    for msg in payload.messages[:-1]:
        role = "User" if msg.role == "user" else "Assistant"
        chat_history_str += f"{role}: {msg.content}\n"

    def event_generator():
        full_answer = ""
        collected_sources = []
        collected_details = {}
        try:
            for event in run_rag_pipeline_stream(
                user_id=current_user.id,
                resource_id=None,
                question=latest_question,
                chat_history=chat_history_list,
                final_history_str=chat_history_str or None,
                n_results=5,
                globe_on=payload.globe_on,
            ):
                if event["type"] == "token":
                    full_answer += event["content"]
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "metadata":
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "sources":
                    collected_sources = event.get("sources", [])
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "final":
                    full_answer = event.get("answer", full_answer)
                    if event.get("sources"):
                        collected_sources = event["sources"]
                    collected_details = {
                        "confidence": event.get("confidence"),
                        "confidenceLabel": event.get("confidence_label"),
                        "hallucinationCount": len(event.get("hallucinations", [])) if event.get("hallucinations") else None,
                        "hallucinationCheckPassed": len(event.get("hallucinations", [])) == 0 if event.get("hallucinations") is not None else None,
                        "sourceCount": len(event.get("sources", [])) if event.get("sources") else None,
                        "retrievalStrategy": event.get("retrieval_strategy"),
                        "processingTimeMs": event.get("processing_time_ms"),
                        "modulesExecuted": event.get("modules_executed"),
                        "reasoning": event.get("reasoning"),
                    }
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "error":
                    yield f"data: {json.dumps(event)}\n\n"
                elif event["type"] == "done":
                    pass

        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        finally:
            if full_answer and payload.session_id:
                with SessionLocal() as stream_db:
                    assistant_message = ChatMessage(
                        id=str(uuid4()),
                        session_id=payload.session_id,
                        role="assistant",
                        content=full_answer,
                        sources_json=json.dumps(collected_sources) if collected_sources else None,
                        details_json=json.dumps(collected_details) if collected_details else None,
                    )
                    stream_db.add(assistant_message)
                    stream_db.commit()

    return StreamingResponse(event_generator(), media_type="text/event-stream")



# ==================================================
# USER SETTINGS & ACCOUNT MODELS
# ==================================================

class SettingsUpdateRequest(BaseModel):
    auto_sync: bool | None = None
    theme: str | None = None
    compact_mode: bool | None = None
    language: str | None = None
    rag_chunk_overlap: bool | None = None
    rag_query_routing: bool | None = None
    rag_nli_verification: bool | None = None
    rag_adaptive_rrf: bool | None = None
    rag_parent_child: bool | None = None
    rag_hierarchical: bool | None = None
    rag_contextual_enrichment: bool | None = None
    media_contextual_enrichment: bool | None = None
    # Cloud AI model configuration
    chat_base_url: str | None = None
    chat_api_key: str | None = None
    chat_model: str | None = None
    embedding_base_url: str | None = None
    embedding_api_key: str | None = None
    embedding_model: str | None = None
    reranker_base_url: str | None = None
    reranker_api_key: str | None = None
    reranker_model: str | None = None
    knowledge_base_url: str | None = None
    knowledge_api_key: str | None = None
    knowledge_model: str | None = None
    # AI Cost Tracking
    chat_cost_base_url: str | None = None
    chat_cost_api_key: str | None = None
    wallet_balance_base_url: str | None = None
    wallet_balance_api_key: str | None = None
    # Local Whisper configuration
    whisper_path: str | None = None
    whisper_model_path: str | None = None
    whisper_threads: int | None = None
    tesseract_path: str | None = None
    wtp_model_path: str | None = None
    # Notifications
    notifications_enabled: bool | None = None


class AccountUpdateRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    current_password: str | None = None
    password: str | None = None


@app.get("/me/settings")
def get_user_settings(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    if not settings:
        settings = UserSetting(
            id=str(uuid4()),
            user_id=user_id,
            whisper_path="",
            whisper_model_path="",
            auto_sync=1,
            theme="system",
            compact_mode=0,
            language="en",
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return {
        "whisper_path": settings.whisper_path or "",
        "whisper_model_path": settings.whisper_model_path or "",
        "auto_sync": (settings.auto_sync or 0) == 1,
        "theme": settings.theme or "system",
        "compact_mode": (settings.compact_mode or 0) == 1,
        "language": settings.language or "en",
        "rag_chunk_overlap": (getattr(settings, "rag_chunk_overlap", 0) or 0) == 1,
        "rag_query_routing": (getattr(settings, "rag_query_routing", 0) or 0) == 1,
        "rag_nli_verification": (getattr(settings, "rag_nli_verification", 0) or 0) == 1,
        "rag_adaptive_rrf": (getattr(settings, "rag_adaptive_rrf", 1) or 0) == 1,
        "rag_parent_child": (getattr(settings, "rag_parent_child", 0) or 0) == 1,
        "rag_hierarchical": (getattr(settings, "rag_hierarchical", 0) or 0) == 1,
        "rag_contextual_enrichment": (getattr(settings, "rag_contextual_enrichment", 0) or 0) == 1,
        "media_contextual_enrichment": (getattr(settings, "media_contextual_enrichment", 0) or 0) == 1,
        "chat_base_url": getattr(settings, "chat_base_url", "") or "",
        "chat_api_key": getattr(settings, "chat_api_key", "") or "",
        "chat_model": getattr(settings, "chat_model", "") or "deepseek/deepseek-v4-flash",
        "embedding_base_url": getattr(settings, "embedding_base_url", "") or "",
        "embedding_api_key": getattr(settings, "embedding_api_key", "") or "",
        "embedding_model": getattr(settings, "embedding_model", "") or "openai/text-embedding-3-large",
        "reranker_base_url": getattr(settings, "reranker_base_url", "") or "",
        "reranker_api_key": getattr(settings, "reranker_api_key", "") or "",
        "reranker_model": getattr(settings, "reranker_model", "") or "rerank-v4.0-fast",
        "knowledge_base_url": getattr(settings, "knowledge_base_url", "") or "",
        "knowledge_api_key": getattr(settings, "knowledge_api_key", "") or "",
        "knowledge_model": getattr(settings, "knowledge_model", "") or "",
        "chat_cost_base_url": getattr(settings, "chat_cost_base_url", "") or "",
        "chat_cost_api_key": getattr(settings, "chat_cost_api_key", "") or "",
        "wallet_balance_base_url": getattr(settings, "wallet_balance_base_url", "") or "",
        "wallet_balance_api_key": getattr(settings, "wallet_balance_api_key", "") or "",
        "whisper_threads": settings.whisper_threads if getattr(settings, "whisper_threads", None) is not None else 2,
        "tesseract_path": getattr(settings, "tesseract_path", "") or "",
        "wtp_model_path": getattr(settings, "wtp_model_path", "") or "",
        "notifications_enabled": (getattr(settings, "notifications_enabled", 1) or 0) == 1,
    }



@app.post("/ai/test-connection")
async def test_ai_connection_main(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    import requests as http_requests
    body = await request.json()
    service_type = body.get("type", "")
    base_url = (body.get("base_url") or "").strip().rstrip("/")
    api_key = (body.get("api_key") or "").strip()
    model = (body.get("model") or "").strip()

    if service_type not in {"chat", "embedding", "reranker", "knowledge"}:
        raise HTTPException(status_code=400, detail="Unknown connection type.")
    service_label = "Knowledge Model" if service_type == "knowledge" else service_type.title()
    if not base_url or not api_key or not model:
        missing = [name for value, name in ((base_url, "Base URL"), (api_key, "API key"), (model, "model")) if not value]
        return {"success": False, "code": "config_missing", "message": f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} required. Open Settings → {service_label}, complete the fields, and test again."}

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        if service_type in {"chat", "knowledge"}:
            resp = http_requests.post(
                f"{base_url}/chat/completions",
                json={"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                headers=headers, timeout=15,
            )
        elif service_type == "embedding":
            resp = http_requests.post(
                f"{base_url}/embeddings",
                json={"model": model, "input": "test"},
                headers=headers, timeout=15,
            )
        elif service_type == "reranker":
            resp = http_requests.post(
                base_url,
                json={"model": model, "query": "test", "documents": ["test document"], "top_n": 1},
                headers={**headers, "Accept": "application/json"}, timeout=15,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown connection type: {service_type}")

        if resp.status_code == 200:
            resp_data = {}
            try:
                resp_data = resp.json()
            except Exception:
                pass

            details = []
            if service_type in {"chat", "knowledge"}:
                usage = resp_data.get("usage", {})
                if usage:
                    details.append(f"Tokens used: {usage.get('total_tokens', 'N/A')}")
                model_used = resp_data.get("model", model)
                details.append(f"Model: {model_used}")
            elif service_type == "embedding":
                usage = resp_data.get("usage", {})
                if usage:
                    details.append(f"Tokens used: {usage.get('total_tokens', 'N/A')}")
                data_list = resp_data.get("data", [])
                if data_list and len(data_list) > 0:
                    dims = len(data_list[0].get("embedding", []))
                    if dims:
                        details.append(f"Embedding dimensions: {dims}")
                details.append(f"Model: {model}")
            elif service_type == "reranker":
                results = resp_data.get("results", resp_data.get("data", []))
                if results:
                    details.append(f"Results returned: {len(results)}")
                details.append(f"Model: {model}")

            msg = "Connected and ready."
            if details:
                msg += " " + " | ".join(details)

            return {"success": True, "message": msg}
        else:
            from services.dependency_failure_service import connection_test_failure_response
            return connection_test_failure_response(
                service=service_label,
                error=RuntimeError(f"HTTP {resp.status_code}: {resp.text}"),
                model=model,
            )

    except http_requests.exceptions.ConnectionError as error:
        from services.dependency_failure_service import connection_test_failure_response
        return connection_test_failure_response(service=service_label, error=error, model=model)
    except http_requests.exceptions.Timeout as error:
        from services.dependency_failure_service import connection_test_failure_response
        return connection_test_failure_response(service=service_label, error=error, model=model)
    except http_requests.exceptions.RequestException as error:
        from services.dependency_failure_service import connection_test_failure_response
        return connection_test_failure_response(service=service_label, error=error, model=model)


@app.post("/ai/test-local-dependency")
async def test_local_dependency(request: Request, user_id: str = Depends(get_current_user_id)):
    """Validate local Whisper or Tesseract paths without saving them."""
    body = await request.json()
    dependency = (body.get("type") or "").strip().lower()
    from services.dependency_failure_service import DependencyFailure, local_path_failure, missing_configuration

    try:
        if dependency == "whisper":
            executable = (body.get("whisper_path") or "").strip()
            model_path = (body.get("whisper_model_path") or "").strip()
            service, stage, section = "Whisper", "transcribing", "Whisper"
            required = ((executable, "Whisper executable path"), (model_path, "Whisper GGML model path"))
            command = [executable, "--help"]
        elif dependency == "tesseract":
            executable = (body.get("tesseract_path") or "").strip()
            model_path = ""
            service, stage, section = "Tesseract OCR", "indexing", "Tesseract OCR"
            required = ((executable, "Tesseract executable path"),)
            command = [executable, "--version"]
        elif dependency == "wtp":
            executable = ""
            model_path = (body.get("wtp_model_path") or "").strip()
            service, stage, section = "WTP Canine", "chunking", "WTP Canine Sentence Model"
            required = ((model_path, "WTP Canine model path"),)
            command = []
        else:
            raise HTTPException(status_code=400, detail="Unknown local dependency.")

        missing_fields = [label for value, label in required if not value]
        if missing_fields:
            raise missing_configuration(service=service, stage=stage, settings_section=section, fields=missing_fields)
        if dependency == "wtp":
            if not os.path.isdir(model_path):
                raise local_path_failure(code="path_not_found", service=service, stage=stage, settings_section=section, path_label="WTP Canine model folder")
            try:
                from wtpsplit import SaT
                with open(os.devnull, "w") as devnull:
                    with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                        model = SaT(model_path)
                        model.split("This is a test. This is another sentence.")
            except Exception:
                raise local_path_failure(code="path_not_loadable", service=service, stage=stage, settings_section=section, path_label="WTP Canine model folder")
            return {"success": True, "message": f"{service} configuration is ready."}
        if not os.path.isfile(executable):
            raise local_path_failure(code="path_not_found", service=service, stage=stage, settings_section=section, path_label=f"{service} executable path")
        if model_path and not os.path.isfile(model_path):
            raise local_path_failure(code="path_not_found", service=service, stage=stage, settings_section=section, path_label="Whisper GGML model path")
        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, check=False)
        if completed.returncode != 0:
            raise local_path_failure(code="path_not_executable", service=service, stage=stage, settings_section=section, path_label=f"{service} executable path")
        return {"success": True, "message": f"{service} configuration is ready."}
    except DependencyFailure as failure:
        title, message = failure.notification_for("Connection test")
        return {"success": False, "code": failure.code, "message": f"{title}. {message}"}
    except (OSError, subprocess.TimeoutExpired):
        failure = local_path_failure(code="path_not_executable", service="Whisper" if dependency == "whisper" else "Tesseract OCR", stage="transcribing" if dependency == "whisper" else "indexing", settings_section="Whisper" if dependency == "whisper" else "Tesseract OCR", path_label="configured executable path")
        title, message = failure.notification_for("Connection test")
        return {"success": False, "code": failure.code, "message": f"{title}. {message}"}

@app.put("/me/settings")
def update_user_settings(
    request: SettingsUpdateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    if not settings:
        settings = UserSetting(
            id=str(uuid4()),
            user_id=user_id,
        )
        db.add(settings)

    if request.whisper_path is not None:
        settings.whisper_path = request.whisper_path
    if request.whisper_model_path is not None:
        settings.whisper_model_path = request.whisper_model_path
    if request.auto_sync is not None:
        settings.auto_sync = 1 if request.auto_sync else 0
    if request.theme is not None:
        settings.theme = request.theme
    if request.compact_mode is not None:
        settings.compact_mode = 1 if request.compact_mode else 0
    if request.language is not None:
        settings.language = request.language
    if request.rag_chunk_overlap is not None:
        settings.rag_chunk_overlap = 1 if request.rag_chunk_overlap else 0
    if request.rag_query_routing is not None:
        settings.rag_query_routing = 1 if request.rag_query_routing else 0
    if request.rag_nli_verification is not None:
        settings.rag_nli_verification = 1 if request.rag_nli_verification else 0
    if request.rag_adaptive_rrf is not None:
        settings.rag_adaptive_rrf = 1 if request.rag_adaptive_rrf else 0
    if request.rag_parent_child is not None:
        settings.rag_parent_child = 1 if request.rag_parent_child else 0
    if request.rag_hierarchical is not None:
        settings.rag_hierarchical = 1 if request.rag_hierarchical else 0
    if request.rag_contextual_enrichment is not None:
        settings.rag_contextual_enrichment = 1 if request.rag_contextual_enrichment else 0
    if request.media_contextual_enrichment is not None:
        settings.media_contextual_enrichment = 1 if request.media_contextual_enrichment else 0
    if request.chat_base_url is not None:
        settings.chat_base_url = request.chat_base_url
    if request.chat_api_key is not None:
        settings.chat_api_key = request.chat_api_key
    if request.chat_model is not None:
        settings.chat_model = request.chat_model
    if request.embedding_base_url is not None:
        settings.embedding_base_url = request.embedding_base_url
    if request.embedding_api_key is not None:
        settings.embedding_api_key = request.embedding_api_key
    if request.embedding_model is not None:
        settings.embedding_model = request.embedding_model
    if request.reranker_base_url is not None:
        settings.reranker_base_url = request.reranker_base_url
    if request.reranker_api_key is not None:
        settings.reranker_api_key = request.reranker_api_key
    if request.reranker_model is not None:
        settings.reranker_model = request.reranker_model
    if request.knowledge_base_url is not None:
        settings.knowledge_base_url = request.knowledge_base_url
    if request.knowledge_api_key is not None:
        settings.knowledge_api_key = request.knowledge_api_key
    if request.knowledge_model is not None:
        settings.knowledge_model = request.knowledge_model
    if request.chat_cost_base_url is not None:
        settings.chat_cost_base_url = request.chat_cost_base_url
    if request.chat_cost_api_key is not None:
        settings.chat_cost_api_key = request.chat_cost_api_key
    if request.wallet_balance_base_url is not None:
        settings.wallet_balance_base_url = request.wallet_balance_base_url
    if request.wallet_balance_api_key is not None:
        settings.wallet_balance_api_key = request.wallet_balance_api_key

    if request.whisper_threads is not None:
        settings.whisper_threads = max(0, request.whisper_threads)
    if request.tesseract_path is not None:
        settings.tesseract_path = request.tesseract_path
    if request.wtp_model_path is not None:
        settings.wtp_model_path = request.wtp_model_path
    if request.notifications_enabled is not None:
        settings.notifications_enabled = 1 if request.notifications_enabled else 0

    db.commit()
    log_user_activity(db, user_id, 'settings', 'Updated settings')

    # Only notify about missing AI config when AI fields were actually changed
    ai_fields_changed = any([
        request.chat_base_url is not None,
        request.chat_api_key is not None,
        request.embedding_base_url is not None,
        request.embedding_api_key is not None,
        request.reranker_base_url is not None,
        request.reranker_api_key is not None,
    ])

    if ai_fields_changed:
        missing = []
        if not settings.chat_base_url or not settings.chat_api_key:
            missing.append("Chat")
        if not settings.embedding_base_url or not settings.embedding_api_key:
            missing.append("Embedding")
        if not settings.reranker_base_url or not settings.reranker_api_key:
            missing.append("Reranker")

        if missing:
            create_notification(
                db=db,
                user_id=user_id,
                category="system",
                title="AI Config Incomplete",
                message=f"Settings saved, but the following services are not configured: {', '.join(missing)}.",
                link="/settings"
            )

    return {"message": "Settings updated successfully"}


@app.delete("/me/cache")
def clear_user_cache(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Clear all semantic cache entries for the current user's resources."""
    from models import SemanticCache, Resource

    # Find all resource IDs owned by this user
    user_resource_ids = [
        row[0]
        for row in db.query(Resource.id).filter(Resource.user_id == user_id).all()
    ]

    if not user_resource_ids:
        return {"message": "Cache cleared", "deleted": 0}

    # Delete cache entries for those resources
    deleted = (
        db.query(SemanticCache)
        .filter(SemanticCache.resource_id.in_(user_resource_ids))
        .delete(synchronize_session=False)
    )
    db.commit()

    log_user_activity(db, user_id, 'settings', 'Cleared RAG cache', f'Deleted {deleted} entries')
    return {"message": "Cache cleared", "deleted": deleted}


@app.post("/ai/test-cost-connection")
async def test_cost_connection(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    import requests as http_requests
    from openai import OpenAI

    body = await request.json()
    base_url = body.get("base_url", "").strip()
    api_key = body.get("api_key", "").strip()
    if not base_url or not api_key:
        raise HTTPException(status_code=400, detail="Cost Base URL and API key are required.")

    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    if not settings or not settings.chat_base_url or not settings.chat_api_key:
        raise HTTPException(status_code=400, detail="Chat Base URL and API key must be configured first.")

    cost_url = base_url.split("?")[0].replace("<Request_ID>", "").replace("<request_id>", "").rstrip("/")
    cost_key = api_key

    # Step 1: Send a minimal chat request to get a request ID
    try:
        client = OpenAI(base_url=settings.chat_base_url, api_key=settings.chat_api_key, timeout=30.0)
        chat_response = client.chat.completions.create(
            model=settings.chat_model or "deepseek/deepseek-v4-flash",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
        )
        request_id = chat_response.id
    except Exception as e:
        return {"success": False, "message": f"Failed to send test LLM request: {str(e)}"}

    # Step 2: Wait for cost indexing (poll every 30 seconds, up to 10 minutes)
    import time
    cost_headers = {"Authorization": f"Bearer {cost_key}", "Content-Type": "application/json"}
    max_wait = 600  # 10 minutes
    poll_interval = 30
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval

        try:
            cost_response = http_requests.get(f"{cost_url}?id={request_id}", headers=cost_headers, timeout=30)
        except http_requests.exceptions.RequestException:
            continue

        if cost_response.status_code != 200:
            continue

        try:
            data = cost_response.json()
        except Exception:
            continue

        # Extract results
        if isinstance(data, dict) and "data" in data:
            raw = data["data"]
            results = raw if isinstance(raw, list) else [raw]
        elif isinstance(data, dict) and "result" in data:
            raw = data["result"]
            results = raw if isinstance(raw, list) else [raw]
        elif isinstance(data, list):
            results = data
        else:
            results = [data]

        # Check if we have actual cost data
        if results and any(r.get("total_cost") or r.get("cost") or r.get("usage") for r in results):
            # Format the cost message
            cost_parts = []
            for r in results[:3]:
                if isinstance(r, dict):
                    cost = r.get("total_cost") or r.get("cost")
                    if cost:
                        cost_parts.append(f"${float(cost):.6f}")
                    usage = r.get("usage", {})
                    if usage:
                        tokens = usage.get("total_tokens", usage.get("prompt_tokens", 0))
                        if tokens:
                            cost_parts.append(f"{tokens} tokens")

            msg = f"Cost data received for request {request_id[:16]}..."
            if cost_parts:
                msg += f": {', '.join(cost_parts)}"

            return {"success": True, "message": msg, "request_id": request_id, "results": results}

    return {
        "success": False,
        "message": f"Cost data not available yet after {max_wait // 60} minutes. Request ID: {request_id[:16]}... The provider may need more time to index."
    }


@app.post("/ai/test-wallet-balance")
async def test_wallet_balance(
    request: Request,
    user_id: str = Depends(get_current_user_id),
):
    import requests as http_requests

    body = await request.json()
    base_url = body.get("base_url", "").strip()
    api_key = body.get("api_key", "").strip()
    if not base_url or not api_key:
        raise HTTPException(status_code=400, detail="Wallet Balance Base URL and API key are required.")

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        response = http_requests.get(base_url, headers=headers, timeout=15)
        if response.status_code == 200:
            try:
                data = response.json()
                balance = data.get("balance") or data.get("credits") or data.get("total_credits") or data.get("remaining")
                if balance is not None:
                    return {"success": True, "message": f"Wallet balance: ${float(balance):.4f}"}
                return {"success": True, "message": f"Connected. Response: {str(data)[:200]}"}
            except Exception:
                return {"success": True, "message": f"Connected. Response: {response.text[:200]}"}
        else:
            return {"success": False, "message": f"HTTP {response.status_code}: {response.text[:200]}"}
    except http_requests.exceptions.ConnectionError:
        return {"success": False, "message": "Connection failed. Check the base URL."}
    except http_requests.exceptions.Timeout:
        return {"success": False, "message": "Connection timed out after 15 seconds."}
    except http_requests.exceptions.RequestException as e:
        return {"success": False, "message": f"Request failed: {str(e)}"}


@app.post("/ai/install-tesseract")
async def install_tesseract(user_id: str = Depends(get_current_user_id)):
    """Install Tesseract OCR via winget and detect the path."""
    import subprocess
    import shutil

    # Check if already installed
    tesseract_path = shutil.which("tesseract")
    if tesseract_path:
        return {"success": True, "message": f"Tesseract already installed at: {tesseract_path}", "path": tesseract_path}

    # Try common installation paths
    common_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for path in common_paths:
        if os.path.exists(path):
            return {"success": True, "message": f"Tesseract found at: {path}", "path": path}

    # Try to install via winget
    try:
        result = subprocess.run(
            ["winget", "install", "UB-Mannheim.TesseractOCR", "--accept-package-agreements", "--accept-source-agreements"],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            # Re-check common paths after installation
            for path in common_paths:
                if os.path.exists(path):
                    return {"success": True, "message": f"Tesseract installed successfully at: {path}", "path": path}
            # Try shutil.which again
            tesseract_path = shutil.which("tesseract")
            if tesseract_path:
                return {"success": True, "message": f"Tesseract installed successfully at: {tesseract_path}", "path": tesseract_path}
            return {"success": False, "message": "Tesseract installed but path not found. Please restart and check manually."}
        else:
            return {"success": False, "message": f"Installation failed: {result.stderr[:300]}"}
    except subprocess.TimeoutExpired:
        return {"success": False, "message": "Installation timed out. Please install manually."}
    except Exception as e:
        return {"success": False, "message": f"Installation error: {str(e)}"}


@app.get("/ai/detect-tesseract")
async def detect_tesseract(user_id: str = Depends(get_current_user_id)):
    """Detect Tesseract installation and return path."""
    import shutil

    # Check PATH
    tesseract_path = shutil.which("tesseract")
    if tesseract_path:
        return {"success": True, "path": tesseract_path, "installed": True}

    # Check common paths
    common_paths = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for path in common_paths:
        if os.path.exists(path):
            return {"success": True, "path": path, "installed": True}

    return {"success": False, "path": "", "installed": False}


@app.get("/ai/fetch-costs")
def fetch_provider_costs(
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    import requests as http_requests
    from openai import OpenAI

    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    if not settings or not settings.chat_cost_base_url or not settings.chat_cost_api_key:
        raise HTTPException(status_code=400, detail="Cost Base URL and API key are not configured.")
    if not settings.chat_base_url or not settings.chat_api_key:
        raise HTTPException(status_code=400, detail="Chat Base URL and API key are not configured.")

    cost_url = settings.chat_cost_base_url.strip().split("?")[0].rstrip("/")
    cost_key = settings.chat_cost_api_key.strip()

    # Step 1: Send a minimal chat request to get a request ID
    try:
        client = OpenAI(base_url=settings.chat_base_url, api_key=settings.chat_api_key, timeout=30.0)
        chat_response = client.chat.completions.create(
            model=settings.chat_model or "deepseek/deepseek-v4-flash",
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=1,
        )
        request_id = chat_response.id
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to make test LLM request: {str(e)}")

    # ChatQT needs a few seconds to index the generation before we query its cost
    import time
    time.sleep(10.0)

    # Step 2: Use that request ID to fetch cost data
    cost_headers = {"Authorization": f"Bearer {cost_key}", "Content-Type": "application/json"}
    try:
        cost_response = http_requests.get(f"{cost_url}?id={request_id}", headers=cost_headers, timeout=30)
    except http_requests.exceptions.RequestException as e:
        return {"success": False, "detail": f"Cost lookup failed: {str(e)}", "request_id": request_id, "results": []}

    # Surface the real API error body instead of swallowing it
    if cost_response.status_code != 200:
        try:
            err_body = cost_response.json()
        except Exception:
            err_body = cost_response.text[:500]
        return {
            "success": False,
            "detail": f"ChatQT cost API returned HTTP {cost_response.status_code}: {err_body}",
            "request_id": request_id,
            "results": [],
        }

    try:
        data = cost_response.json()
    except Exception:
        return {"success": False, "detail": "Cost API returned non-JSON response.", "request_id": request_id, "results": []}

    if isinstance(data, dict) and "data" in data:
        raw = data["data"]
        results = raw if isinstance(raw, list) else [raw]
    elif isinstance(data, dict) and "result" in data:
        raw = data["result"]
        results = raw if isinstance(raw, list) else [raw]
    elif isinstance(data, list):
        results = data
    else:
        results = [data]
    return {"success": True, "results": results, "request_id": request_id}


@app.patch("/me/account")
def update_account_details(
    request: AccountUpdateRequest,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if request.username is not None and request.username.strip() != "" and request.username != user.username:
        # Enforce a 14-day cooldown between username changes.
        if user.username_changed_at is not None:
            next_allowed = user.username_changed_at + timedelta(days=14)
            if datetime.utcnow() < next_allowed:
                days_left = (next_allowed - datetime.utcnow()).days + 1
                raise HTTPException(
                    status_code=429,
                    detail=f"You can only change your username once every 14 days. Try again in {days_left} day(s).",
                )
        # Check if username is available
        existing_user = db.query(User).filter(User.username == request.username).first()
        if existing_user:
            raise HTTPException(status_code=400, detail="Username already exists")
        user.username = request.username
        user.username_changed_at = datetime.utcnow()

    # Email is immutable and cannot be changed after registration.
    if request.email is not None and request.email.strip() != "" and request.email != user.email:
        raise HTTPException(status_code=403, detail="Email address cannot be changed.")

    if request.password is not None and request.password.strip() != "":
        if user.password_hash == "firebase_managed":
            raise HTTPException(
                status_code=400,
                detail="Your account is managed by Firebase. Please use the 'Forgot Password' link on the login page to reset your password."
            )
        # Require the current password to be supplied and correct.
        if not request.current_password or request.current_password.strip() == "":
            raise HTTPException(status_code=400, detail="Current password is required to set a new password.")
        if not verify_password(request.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect.")
        # Enforce a minimum length of 8 characters for the new password.
        if len(request.password) < 8:
            raise HTTPException(status_code=400, detail="New password must be at least 8 characters.")
        user.password_hash = hash_password(request.password)

    db.commit()
    db.refresh(user)
    return {
        "message": "Account details updated successfully",
        "username": user.username,
        "email": user.email,
    }


@app.get("/me/sessions")
def get_my_sessions(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Return the devices/browsers this user is logged in on. Records the current
    request as a session first, so the device viewing this page always appears
    and is marked active."""
    # Refresh/insert the current device, then read everything back.
    record_session(db, user_id, request)

    current_ua = request.headers.get("user-agent", "")
    current_ip = request.client.host if request.client else None

    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == user_id)
        .order_by(UserSession.last_active.desc())
        .all()
    )

    now = datetime.utcnow()
    result = []
    for s in sessions:
        is_current = s.user_agent == current_ua and s.ip_address == current_ip
        # "Active now" if seen within the last 5 minutes.
        is_active = s.last_active is not None and (now - s.last_active) <= timedelta(minutes=5)
        result.append({
            "id": s.id,
            "device": s.device or "Unknown device",
            "browser": s.browser or "Unknown browser",
            "ip_address": s.ip_address,
            "last_active": s.last_active.isoformat() if s.last_active else None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "is_current": is_current,
            "is_active": is_active,
        })

    return result


@app.delete("/me/sessions/{session_id}")
def terminate_session(
    session_id: str,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from models import UserSession
    session = (
        db.query(UserSession)
        .filter(UserSession.id == session_id, UserSession.user_id == user_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"message": "Session terminated"}


@app.delete("/me/sessions")
def terminate_all_other_sessions(
    request: Request,
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    from models import UserSession
    current_ua = request.headers.get("user-agent", "")
    current_ip = request.client.host if request.client else None
    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == user_id)
        .all()
    )
    deleted = 0
    for s in sessions:
        is_current = s.user_agent == current_ua and s.ip_address == current_ip
        if not is_current:
            db.delete(s)
            deleted += 1
    db.commit()
    return {"message": f"Terminated {deleted} session(s)", "deleted": deleted}


# ==================================================


# ==================================================
# NOTIFICATIONS
# ==================================================


@app.get("/notifications")
def get_notifications(
    tab: str = "General",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Notification).filter(Notification.user_id == current_user.id)

    if tab == "Archive":
        query = query.filter(Notification.is_archived == 1)
    elif tab == "Mentions":
        query = query.filter(
            Notification.is_archived == 0,
            Notification.category.in_(["share", "team"])
        )
    elif tab == "General":
        query = query.filter(
            Notification.is_archived == 0,
            Notification.category.in_(["download", "processing", "system"])
        )
    else:
        query = query.filter(Notification.is_archived == 0)

    notifications = query.order_by(Notification.created_at.desc()).all()
    return [serialize_notification(n, db) for n in notifications]


@app.put("/notifications/{notification_id}/read")
def read_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()

    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_read = 1
    db.commit()
    return {"message": "Notification marked as read"}


@app.put("/notifications/read-all")
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == 0
    ).update({Notification.is_read: 1}, synchronize_session=False)
    db.commit()
    return {"message": "All notifications marked as read"}


@app.put("/notifications/{notification_id}/archive")
def archive_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()

    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_archived = 1
    db.commit()
    return {"message": "Notification archived successfully"}


@app.delete("/notifications/archive")
def delete_all_archived_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_archived == 1
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": "All archived notifications permanently deleted"}


@app.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.query(Notification).filter(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).first()

    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    db.delete(notif)
    db.commit()
    return {"message": "Notification permanently deleted"}


# ==================================================
# ACTIVITY LOGS
# ==================================================

class ActivityLogEntry(BaseModel):
    category: str
    action: str
    detail: str = None
    created_at: str = None

class ActivityLogBatch(BaseModel):
    entries: List[ActivityLogEntry]


@app.post("/activity-logs")
def create_activity_logs(
    payload: ActivityLogBatch,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    created = 0
    for entry in payload.entries:
        # Always use server time to avoid timezone issues
        log = ActivityLog(
            id=str(uuid4()),
            user_id=current_user.id,
            category=entry.category,
            action=entry.action,
            detail=entry.detail,
            created_at=datetime.utcnow(),
        )
        db.add(log)
        created += 1
    db.commit()
    return {"created": created}


@app.get("/activity-logs")
def list_activity_logs(
    category: str = None,
    search: str = None,
    limit: int = 15,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(ActivityLog).filter(ActivityLog.user_id == current_user.id)

    if category:
        query = query.filter(ActivityLog.category == category)
    if search:
        query = query.filter(
            ActivityLog.action.ilike(f"%{search}%") |
            ActivityLog.detail.ilike(f"%{search}%")
        )

    total = query.count()
    items = (
        query.order_by(ActivityLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "items": [
            {
                "id": item.id,
                "category": item.category,
                "action": item.action,
                "detail": item.detail,
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in items
        ],
    }


@app.delete("/activity-logs/{log_id}")
def delete_single_activity_log(
    log_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    entry = db.query(ActivityLog).filter(
        ActivityLog.id == log_id,
        ActivityLog.user_id == current_user.id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Log entry not found")
    db.delete(entry)
    db.commit()
    return {"deleted": 1}


@app.delete("/activity-logs")
def clear_activity_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    deleted = db.query(ActivityLog).filter(ActivityLog.user_id == current_user.id).delete()
    db.commit()
    return {"deleted": deleted}


@app.post("/activity-logs/cleanup")
def cleanup_activity_logs(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trim all users' activity logs to max 15 entries each."""
    from core.activity_log import cleanup_all_users, MAX_ENTRIES_PER_USER
    deleted = cleanup_all_users(db)
    return {"deleted": deleted, "max_per_user": MAX_ENTRIES_PER_USER}



@app.get("/api/settings/download-whisper")
def download_whisper_model(model: str, dest_path: str):
    import requests
    import os
    import json
    import time
    from fastapi.responses import StreamingResponse

    url = f"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{model}"
    MAX_RETRIES = 5

    def generate():
        if os.path.isdir(dest_path):
            final_path = os.path.join(dest_path, model)
        else:
            final_path = dest_path

        last_percent = -1
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resume_headers = {}
                bytes_already = 0
                if os.path.exists(final_path):
                    bytes_already = os.path.getsize(final_path)
                    if bytes_already > 0:
                        resume_headers['Range'] = f'bytes={bytes_already}-'

                with requests.get(url, stream=True, headers=resume_headers, timeout=30) as r:
                    if r.status_code == 416:
                        yield f"data: {json.dumps({"progress": 100, "status": "completed", "final_path": final_path.replace(os.sep, "/")})}\n\n"
                        return
                    r.raise_for_status()
                    total_length = r.headers.get('content-length')
                    content_range = r.headers.get('content-range')

                    mode = 'ab' if bytes_already > 0 and r.status_code == 206 else 'wb'

                    if total_length is None:
                        with open(final_path, mode) as f:
                            for chunk in r.iter_content(chunk_size=8192):
                                if chunk:
                                    f.write(chunk)
                        yield f"data: {json.dumps({"progress": 100, "status": "completed"})}\n\n"
                        return
                    else:
                        dl = bytes_already if mode == 'ab' else 0
                        if content_range and '/' in content_range:
                            total_length = int(content_range.split('/')[-1])
                        else:
                            total_length = int(total_length) + (bytes_already if mode == 'ab' else 0)
                        with open(final_path, mode) as f:
                            for chunk in r.iter_content(chunk_size=8192*4):
                                if chunk:
                                    dl += len(chunk)
                                    f.write(chunk)
                                    done = int(100 * dl / total_length)
                                    if done > last_percent:
                                        last_percent = done
                                        yield f"data: {json.dumps({"progress": done, "status": "downloading"})}\n\n"
                        yield f"data: {json.dumps({"progress": 100, "status": "completed", "final_path": final_path.replace(os.sep, "/")})}\n\n"
                        return
            except Exception as e:
                if attempt < MAX_RETRIES:
                    wait = min(2 ** attempt, 30)
                    time.sleep(wait)
                    last_percent = -1
                    yield f"data: {json.dumps({"progress": last_percent if last_percent > 0 else 0, "status": "retrying", "attempt": attempt})}\n\n"
                else:
                    yield f"data: {json.dumps({"error": str(e)})}\n\n"
                    return

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/api/settings/download-wtp-model")
def download_wtp_model(model: str = "sat-3l", dest_path: str = ""):
    import json
    import os
    import threading
    import time
    from fastapi.responses import StreamingResponse

    allowed_models = {
        "sat-3l": "segment-any-text/sat-3l",
        "sat-6l": "segment-any-text/sat-6l",
        "sat-12l": "segment-any-text/sat-12l",
    }
    expected_sizes = {
        "sat-3l": 350 * 1024 * 1024,
        "sat-6l": 600 * 1024 * 1024,
        "sat-12l": 1200 * 1024 * 1024,
    }
    repo_id = allowed_models.get(model)
    expected_size = expected_sizes.get(model, 600 * 1024 * 1024)
    MAX_RETRIES = 5

    def get_dir_size(path):
        total = 0
        try:
            for dirpath, dirnames, filenames in os.walk(path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass
        except OSError:
            pass
        return total

    def generate():
        if not repo_id:
            yield f"data: {json.dumps({"error": "Unknown WTP Canine model."})}\n\n"
            return
        if not dest_path:
            yield f"data: {json.dumps({"error": "Destination folder is required."})}\n\n"
            return

        try:
            from huggingface_hub import snapshot_download

            os.makedirs(dest_path, exist_ok=True)
            local_dir = os.path.join(dest_path, model)

            result = {"path": None, "error": None}

            def run_download():
                for attempt in range(1, MAX_RETRIES + 1):
                    try:
                        result["path"] = snapshot_download(
                            repo_id=repo_id,
                            local_dir=local_dir,
                        )
                        result["error"] = None
                        return
                    except Exception as exc:
                        result["error"] = exc
                        if attempt < MAX_RETRIES:
                            wait = min(2 ** attempt, 30)
                            time.sleep(wait)
                            result["error"] = None

            dl_thread = threading.Thread(target=run_download, daemon=True)
            dl_thread.start()

            yield f"data: {json.dumps({"progress": 1, "status": "preparing"})}\n\n"

            last_pct = 1
            while dl_thread.is_alive():
                dl_thread.join(timeout=2)
                current_size = get_dir_size(local_dir)
                pct = min(95, max(1, int((current_size / expected_size) * 95)))
                if pct != last_pct:
                    last_pct = pct
                    yield f"data: {json.dumps({"progress": pct, "status": "downloading"})}\n\n"

            if result["error"]:
                yield f"data: {json.dumps({"error": str(result["error"])})}\n\n"
                return

            normalized = result["path"].replace(os.sep, "/")
            yield f"data: {json.dumps({"progress": 100, "status": "completed", "final_path": normalized})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({"error": str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/auth/select-file")
def select_file():
    import tkinter as tk
    from tkinter import filedialog
    try:
        root = tk.Tk()
        root.withdraw()  # Hide the main root window
        root.attributes('-topmost', True)  # Bring dialog to the front
        selected_path = filedialog.askopenfilename(title="Select File")
        root.destroy()
        return {"path": selected_path if selected_path else None}
    except Exception as e:
        # Return fallback or error
        return {"path": None, "error": str(e)}

@app.get("/api/system-info")
def get_system_info():
    """Return CPU core count and total RAM in GB for system-aware recommendations."""
    import platform
    import subprocess

    cpu_cores = os.cpu_count() or 2

    ram_gb = 8.0
    try:
        system = platform.system()
        if system == "Windows":
            try:
                result = subprocess.run(
                    ["powershell", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"],
                    capture_output=True, text=True, timeout=10
                )
                bytes_val = int(result.stdout.strip())
                ram_gb = round(bytes_val / (1024 ** 3), 1)
            except Exception:
                try:
                    result = subprocess.run(
                        ["wmic", "OS", "get", "TotalVisibleMemorySize", "/Value"],
                        capture_output=True, text=True, timeout=5
                    )
                    for line in result.stdout.splitlines():
                        if line.strip().startswith("TotalVisibleMemorySize="):
                            kb = int(line.split("=")[1].strip())
                            ram_gb = round(kb / (1024 * 1024), 1)
                            break
                except Exception:
                    pass
        elif system == "Linux":
            with open("/proc/meminfo", "r") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        ram_gb = round(kb / (1024 * 1024), 1)
                        break
        elif system == "Darwin":
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=5
            )
            bytes_val = int(result.stdout.strip())
            ram_gb = round(bytes_val / (1024 ** 3), 1)
    except Exception:
        pass

    return {"cpu_cores": cpu_cores, "ram_gb": ram_gb}


# ==================================================
# GLOBAL KNOWLEDGE GRAPH
# ==================================================

class AliasCandidateResolutionRequest(BaseModel):
    decision: str


class StudyEventRequest(BaseModel):
    event_type: str
    concept_id: str | None = None
    resource_id: str | None = None
    metadata: dict | None = None


@app.post("/resources/{resource_id}/knowledge-runs", status_code=202)
def create_knowledge_run(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import (
        _source_fingerprint,
        get_or_create_knowledge_state,
        has_usable_text,
        serialize_knowledge_state,
    )

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource or getattr(resource, "is_deleted", 0) == 1:
        raise HTTPException(status_code=404, detail="Resource not found")
    if not has_usable_text(resource, db):
        raise HTTPException(
            status_code=409,
            detail="Knowledge generation requires timestamped transcript text assigned to a chapter or subchapter.",
        )

    fingerprint = _source_fingerprint(resource, db)
    job = create_processing_job(
        db,
        resource_id,
        job_type="knowledge_generation",
        input_fingerprint=fingerprint,
    )
    state = get_or_create_knowledge_state(db, resource)
    from models import KnowledgeRun
    run = db.query(KnowledgeRun).filter(KnowledgeRun.job_id == job.id).first()
    if not run:
        run = KnowledgeRun(
            id=str(uuid4()),
            resource_id=resource.id,
            user_id=current_user.id,
            job_id=job.id,
            version=(state.active_version or 0) + 1,
            status=job.status,
            input_fingerprint=fingerprint,
            current_stage=job.current_stage,
            progress=job.progress or 0,
            created_at=datetime.utcnow(),
        )
        db.add(run)
    state.status = "waiting" if job.status == "waiting" else "queued"
    state.updated_at = datetime.utcnow()
    db.commit()
    log_user_activity(
        db,
        current_user.id,
        "ai_features",
        "Queued knowledge generation",
        resource.title,
    )
    return {
        "message": "Knowledge generation queued",
        "run_id": run.id,
        "job_id": job.id,
        "job_status": job.status,
        "knowledge": serialize_knowledge_state(db, resource),
    }


@app.get("/resources/{resource_id}/knowledge-status")
def get_resource_knowledge_status(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import serialize_knowledge_state

    resource = _get_owned_resource(db, resource_id, current_user.id)
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")
    return serialize_knowledge_state(db, resource)


class KnowledgeFavoriteRequest(BaseModel):
    favorite: bool

class KnowledgeConceptRenameRequest(BaseModel):
    name: str


class KnowledgeViewPreferencesRequest(BaseModel):
    distance: int | None = None
    node_distance: int | None = None
    graph_layout: str | None = None
    explorer_group: str | None = None
    filters: dict | None = None


@app.get("/knowledge/graph")
def get_global_knowledge_graph(
    domain: str | None = None,
    resource_id: str | None = None,
    concept_type: str | None = None,
    min_confidence: float = 0.0,
    difficulty: str | None = None,
    relationship_type: str | None = None,
    playlist_id: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import graph_payload

    if resource_id and not _get_owned_resource(db, resource_id, current_user.id):
        raise HTTPException(status_code=404, detail="Resource not found")
    return graph_payload(
        db,
        current_user.id,
        domain=domain,
        resource_id=resource_id,
        concept_type=concept_type,
        min_confidence=max(0.0, min(1.0, min_confidence)),
        difficulty=difficulty,
        relationship_type=relationship_type,
        playlist_id=playlist_id,
    )


@app.get("/knowledge/concepts/{concept_id}")
def get_global_knowledge_concept(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import concept_payload

    payload = concept_payload(db, current_user.id, concept_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Concept not found")
    return payload


@app.put("/knowledge/concepts/{concept_id}/favorite")
def set_global_knowledge_concept_favorite(
    concept_id: str,
    payload: KnowledgeFavoriteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import set_concept_favorite

    concept = set_concept_favorite(db, current_user.id, concept_id, payload.favorite)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return {"concept_id": concept.id, "favorite": bool(concept.is_favorite)}


@app.patch("/knowledge/concepts/{concept_id}")
def rename_global_knowledge_concept(
    concept_id: str,
    payload: KnowledgeConceptRenameRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import rename_concept

    try:
        concept = rename_concept(db, current_user.id, concept_id, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return {"id": concept.id, "name": concept.canonical_name}


@app.delete("/knowledge/concepts/{concept_id}")
def delete_global_knowledge_concept(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import delete_concept

    concept = delete_concept(db, current_user.id, concept_id)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return {"id": concept.id, "deleted": True, "suppressed": True}


@app.post("/knowledge/concepts/{concept_id}/restore")
def restore_global_knowledge_concept(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import restore_concept

    concept = restore_concept(db, current_user.id, concept_id)
    if not concept:
        raise HTTPException(status_code=404, detail="Concept not found")
    return {"id": concept.id, "restored": True}


@app.put("/knowledge/source-sections/{section_id}/favorite")
def favorite_knowledge_source_section(
    section_id: str,
    payload: KnowledgeFavoriteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import set_source_section_favorite

    section = set_source_section_favorite(
        db, current_user.id, section_id, payload.favorite
    )
    if not section:
        raise HTTPException(status_code=404, detail="Source section not found")
    return {"section_id": section.id, "favorite": payload.favorite}


@app.put("/knowledge/preferences/node-distance")
def update_knowledge_node_distance(
    payload: KnowledgeViewPreferencesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import set_knowledge_node_distance, set_knowledge_view_preferences

    payload_data = payload.dict(exclude_unset=True)
    if any(key in payload_data for key in ("graph_layout", "explorer_group", "filters", "node_distance")):
        if "distance" in payload_data and "node_distance" not in payload_data:
            payload_data["node_distance"] = payload_data["distance"]
        preferences = set_knowledge_view_preferences(db, current_user.id, payload_data)
        return {"node_distance": preferences["node_distance"], "preferences": preferences}

    distance_value = payload.distance if payload.distance is not None else payload.node_distance
    if distance_value is None:
        raise HTTPException(status_code=400, detail="distance is required")
    distance = set_knowledge_node_distance(db, current_user.id, distance_value)
    return {"node_distance": distance}


@app.put("/knowledge/preferences/view")
def update_knowledge_view_preferences(
    payload: KnowledgeViewPreferencesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import set_knowledge_view_preferences

    preferences = set_knowledge_view_preferences(
        db, current_user.id, payload.dict(exclude_unset=True)
    )
    return {"preferences": preferences}


@app.get("/knowledge/concepts/{concept_id}/references")
def get_global_knowledge_references(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import concept_references

    return concept_references(db, current_user.id, concept_id)


@app.get("/knowledge/concepts/{concept_id}/timeline")
def get_global_knowledge_timeline(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import timeline_payload

    return timeline_payload(db, current_user.id, concept_id)


@app.get("/knowledge/concepts/{concept_id}/analytics")
def get_global_knowledge_analytics(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import analytics_payload

    payload = analytics_payload(db, current_user.id, concept_id)
    if not payload:
        raise HTTPException(status_code=404, detail="Concept analytics not found")
    return payload


@app.get("/knowledge/concepts/{concept_id}/recommendations")
def get_concept_recommendations(
    concept_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import recommendation_payload

    return recommendation_payload(db, current_user.id, concept_id=concept_id)


@app.get("/knowledge/recommendations")
def get_global_knowledge_recommendations(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import recommendation_payload

    return recommendation_payload(db, current_user.id, limit=max(1, min(200, limit)))


@app.get("/knowledge/alias-candidates")
def get_alias_candidates(
    status: str = "pending",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import AliasCandidate, KnowledgeRun

    rows = (
        db.query(AliasCandidate)
        .join(KnowledgeRun, KnowledgeRun.id == AliasCandidate.run_id)
        .filter(
            AliasCandidate.user_id == current_user.id,
            AliasCandidate.status == status,
            KnowledgeRun.status == "completed",
        )
        .order_by(AliasCandidate.created_at.desc())
        .all()
    )
    return [{
        "id": row.id,
        "run_id": row.run_id,
        "concept_id": row.concept_id,
        "alias": row.alias,
        "normalized_alias": row.normalized_alias,
        "domain": row.domain,
        "confidence": row.confidence,
        "reason": row.reason,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    } for row in rows]


@app.post("/knowledge/alias-candidates/{candidate_id}/resolve")
def resolve_global_alias_candidate(
    candidate_id: str,
    payload: AliasCandidateResolutionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from services.knowledge_service import resolve_alias_candidate

    try:
        candidate = resolve_alias_candidate(db, current_user.id, candidate_id, payload.decision)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not candidate:
        raise HTTPException(status_code=404, detail="Pending alias candidate not found")
    return {"id": candidate.id, "status": candidate.status}


@app.get("/knowledge/relationship-candidates")
def get_relationship_review_candidates(
    status: str = "pending",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import RelationshipReviewCandidate

    rows = db.query(RelationshipReviewCandidate).filter(
        RelationshipReviewCandidate.user_id == current_user.id,
        RelationshipReviewCandidate.status == status,
    ).order_by(RelationshipReviewCandidate.created_at.desc()).all()
    return [{
        "id": row.id,
        "source_concept_id": row.source_concept_id,
        "target_concept_id": row.target_concept_id,
        "relationship_type": row.relationship_type,
        "confidence": row.confidence,
        "evidence_text": row.evidence_text,
        "start_seconds": row.start_seconds,
        "end_seconds": row.end_seconds,
        "status": row.status,
    } for row in rows]


@app.post("/knowledge/relationship-candidates/{candidate_id}/resolve")
def resolve_relationship_review_candidate(
    candidate_id: str,
    payload: AliasCandidateResolutionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import (
        ConceptRelationship, RelationshipEvidence,
        RelationshipReviewCandidate,
    )

    candidate = db.query(RelationshipReviewCandidate).filter(
        RelationshipReviewCandidate.id == candidate_id,
        RelationshipReviewCandidate.user_id == current_user.id,
        RelationshipReviewCandidate.status == "pending",
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Relationship candidate not found")
    if payload.decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="Decision must be approve or reject")
    if payload.decision == "approve":
        relationship = db.query(ConceptRelationship).filter(
            ConceptRelationship.user_id == current_user.id,
            ConceptRelationship.source_concept_id == candidate.source_concept_id,
            ConceptRelationship.target_concept_id == candidate.target_concept_id,
            ConceptRelationship.relationship_type == candidate.relationship_type,
        ).first()
        if not relationship:
            relationship = ConceptRelationship(
                id=str(uuid4()), user_id=current_user.id,
                source_concept_id=candidate.source_concept_id,
                target_concept_id=candidate.target_concept_id,
                relationship_type=candidate.relationship_type,
                confidence=max(0.85, candidate.confidence),
                evidence_count=0, archived=0,
            )
            db.add(relationship)
            db.flush()
        db.add(RelationshipEvidence(
            id=str(uuid4()), relationship_id=relationship.id,
            run_id=candidate.run_id, resource_id=candidate.resource_id,
            evidence_text=candidate.evidence_text,
            confidence=max(0.85, candidate.confidence),
            start_seconds=candidate.start_seconds,
            end_seconds=candidate.end_seconds,
        ))
        candidate.status = "approved"
        from services.knowledge_service import (
            _rebuild_recommendations, _recalculate_graph,
        )
        affected = {candidate.source_concept_id, candidate.target_concept_id}
        _recalculate_graph(db, current_user.id, affected)
        _rebuild_recommendations(db, current_user.id, affected)
    else:
        candidate.status = "rejected"
    db.commit()
    return {"id": candidate.id, "status": candidate.status}


@app.post("/knowledge/study-events", status_code=201)
def create_knowledge_study_event(
    payload: StudyEventRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from models import StudyEvent

    if payload.resource_id and not _get_owned_resource(db, payload.resource_id, current_user.id):
        raise HTTPException(status_code=404, detail="Resource not found")
    if payload.concept_id:
        concept = db.query(Concept).filter(
            Concept.id == payload.concept_id,
            Concept.user_id == current_user.id,
            Concept.archived == 0,
        ).first()
        if not concept:
            raise HTTPException(status_code=404, detail="Concept not found")
    event = StudyEvent(
        id=str(uuid4()),
        user_id=current_user.id,
        concept_id=payload.concept_id,
        resource_id=payload.resource_id,
        event_type=payload.event_type,
        metadata_json=json.dumps(payload.metadata or {}),
        created_at=datetime.utcnow(),
    )
    db.add(event)
    db.commit()
    return {"id": event.id, "created_at": event.created_at.isoformat()}
