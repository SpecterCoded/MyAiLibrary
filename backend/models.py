from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, Float

from database import Base


class Playlist(Base):
    __tablename__ = "playlists"

    id = Column(String, primary_key=True)

    name = Column(String)

    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    storage_root = Column(String, nullable=True)
    description = Column(String, nullable=True)
    icon_type = Column(String, default="standup")
    is_favorite = Column(Integer, default=0)
    created_at = Column(String, nullable=True)
    updated_at = Column(String, nullable=True)


from sqlalchemy.orm import relationship

class Folder(Base):
    __tablename__ = "folders"

    id = Column(String, primary_key=True)

    name = Column(String)

    playlist_id = Column(String, ForeignKey("playlists.id"), nullable=True)
    playlist = relationship("Playlist")

    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    storage_root = Column(String, nullable=True)
    parent_id = Column(String, ForeignKey("folders.id"), nullable=True)
    
    parent = relationship("Folder", remote_side=[id], backref="subfolders")
    is_deleted = Column(Integer, default=0)


class Resource(Base):
    __tablename__ = "resources"

    id = Column(String, primary_key=True)

    title = Column(String)

    description = Column(String)

    tags = Column(String)

    type = Column(String)

    local_path = Column(String)

    content_hash = Column(String)

    thumbnail_path = Column(String)

    file_size = Column(Integer)

    duration_seconds = Column(Integer)

    processing_status = Column(String)

    transcript = Column(Text)

    summary = Column(Text)

    study_notes = Column(Text)

    suggested_questions = Column(Text, nullable=True)

    chapters_json = Column(Text)

    is_embedded = Column(String, default="false")

    starred_transcripts = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    folder_id = Column(String, ForeignKey("folders.id"))
    user_id = Column(
        String,
        ForeignKey("users.id"),
        nullable=True,
    )
    is_deleted = Column(Integer, default=0)

    health_history = Column(Text, nullable=True, default="[]")


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(String, primary_key=True)

    resource_id = Column(String, ForeignKey("resources.id"))

    title = Column(String)

    start_time = Column(Integer)

    end_time = Column(Integer)

    summary = Column(String)

    transcript = Column(String)

    is_favorite = Column(Integer, default=0)


class SubChapter(Base):
    __tablename__ = "subchapters"

    id = Column(String, primary_key=True)

    chapter_id = Column(String, ForeignKey("chapters.id"))

    title = Column(String)

    start_time = Column(Integer)

    end_time = Column(Integer)

    summary = Column(String)

    transcript = Column(String)

    is_favorite = Column(Integer, default=0)


class Attachment(Base):
    __tablename__ = "attachments"

    id = Column(String, primary_key=True)

    resource_id = Column(String, ForeignKey("resources.id"))

    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)

    subchapter_id = Column(String, ForeignKey("subchapters.id"), nullable=True)

    file_name = Column(String)

    file_path = Column(String)

    file_type = Column(String)

    file_size = Column(Integer)

    created_at = Column(DateTime, default=datetime.utcnow)


class Note(Base):
    __tablename__ = "notes"

    id = Column(String, primary_key=True)

    title = Column(String)

    content = Column(Text)

    note_type = Column(String)

    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)

    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)

    subchapter_id = Column(String, ForeignKey("subchapters.id"), nullable=True)

    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True)

    playlist_id = Column(String, ForeignKey("playlists.id"), nullable=True) # New column
    folder_id = Column(String, ForeignKey("folders.id"), nullable=True) # Link to custom folders
    user_id = Column(String, ForeignKey("users.id"), nullable=True) # New column
    filename = Column(String, nullable=True) # New column to store the sanitized filename
    is_favorite = Column(Integer, default=0) # New column
    status = Column(String, default="active") # New column
    tags = Column(Text, nullable=True) # New column

    created_at = Column(DateTime, default=datetime.utcnow)

    updated_at = Column(DateTime, default=datetime.utcnow)



class Concept(Base):
    __tablename__ = "concepts"

    id = Column(String, primary_key=True)

    name = Column(String, unique=True)

    canonical_name = Column(String, nullable=True)

    normalized_name = Column(String, nullable=True, index=True)

    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)

    domain = Column(String, nullable=True, index=True)

    concept_type = Column(String, nullable=True, default="concept")

    origin = Column(String, nullable=True, default="manual")

    confidence = Column(Float, nullable=True)

    difficulty = Column(String, nullable=True)

    summary = Column(Text, nullable=True)

    prerequisites = Column(Text, nullable=True)

    examples = Column(Text, nullable=True)

    common_mistakes = Column(Text, nullable=True)

    recommended_next_topic = Column(String, nullable=True)

    learning_stage = Column(String, nullable=True)

    archived = Column(Integer, default=0)

    is_favorite = Column(Integer, default=0)

    description = Column(String)

    color = Column(String)

    tags = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptLink(Base):
    __tablename__ = "concept_links"

    id = Column(String, primary_key=True)

    concept_id = Column(String, ForeignKey("concepts.id"))

    source_type = Column(String)

    source_id = Column(String)

    link_type = Column(String, default="reference")


class SearchIndex(Base):
    __tablename__ = "search_index"

    id = Column(String, primary_key=True)

    source_type = Column(String)

    source_id = Column(String)

    content = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)


class ChunkIndex(Base):
    __tablename__ = "chunk_index"

    id = Column(String, primary_key=True)
    resource_id = Column(String)
    chunk_index = Column(Integer)
    content = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Embedding(Base):
    __tablename__ = "embeddings"

    id = Column(String, primary_key=True)

    source_type = Column(String)

    source_id = Column(String)

    embedding_vector = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id = Column(String, primary_key=True)

    title = Column(String)

    summary = Column(Text)

    user_id = Column(
        String,
        ForeignKey("users.id"),
        nullable=True,
    )

    source = Column(String, nullable=True, default="chat")

    resource_id = Column(String, nullable=True)

    saved_to_notebook = Column(Integer, default=0)

    created_at = Column(DateTime, default=datetime.utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String, primary_key=True)

    session_id = Column(String, ForeignKey("chat_sessions.id"))

    role = Column(String)

    content = Column(Text)

    sources_json = Column(Text, nullable=True)

    details_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(String, primary_key=True)

    front = Column(Text)

    back = Column(Text)

    resource_id = Column(
        String,
        ForeignKey("resources.id"),
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(String, primary_key=True)

    question = Column(Text)

    option_a = Column(Text)

    option_b = Column(Text)

    option_c = Column(Text)

    option_d = Column(Text)

    correct_answer = Column(String)

    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)

    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)

    subchapter_id = Column(String, ForeignKey("subchapters.id"), nullable=True)

    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class Summary(Base):
    __tablename__ = "summaries"

    id = Column(String, primary_key=True)

    summary = Column(Text, nullable=False)

    resource_id = Column(String, nullable=True)

    chapter_id = Column(String, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)


class MindMap(Base):
    __tablename__ = "mindmaps"

    id = Column(String, primary_key=True)

    resource_id = Column(
        String,
        ForeignKey("resources.id"),
        nullable=False,
    )

    content = Column(Text)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )


class StoragePath(Base):
    __tablename__ = "storage_paths"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    path = Column(String, nullable=False)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    user = relationship("User", foreign_keys=[user_id], backref="storage_paths")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)

    username = Column(
        String,
        unique=True,
        nullable=False,
    )

    email = Column(
        String,
        unique=True,
        nullable=False,
    )

    password_hash = Column(
        String,
        nullable=False,
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
    )

    storage_root = Column(String, nullable=True)
    active_storage_path_id = Column(String, ForeignKey("storage_paths.id"), nullable=True)
    active_storage_path = relationship("StoragePath", foreign_keys=[active_storage_path_id])
    avatar_url = Column(String, nullable=True)
    banner_url = Column(String, nullable=True)
    # Timestamp of the last username change, used to enforce a 14-day cooldown.
    username_changed_at = Column(DateTime, nullable=True)


class UserSession(Base):
    """A device/browser that has logged in. Used by the 'Where you're logged in'
    section to show real, active sessions instead of hardcoded entries."""
    __tablename__ = "user_sessions"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    # Raw User-Agent string of the device, plus parsed, human-friendly parts.
    user_agent = Column(Text, nullable=True)
    device = Column(String, nullable=True)   # e.g. "Windows PC", "iPhone"
    browser = Column(String, nullable=True)  # e.g. "Chrome", "Safari"
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_active = Column(DateTime, default=datetime.utcnow)



class SemanticCache(Base):
    __tablename__ = "semantic_cache"

    id = Column(String, primary_key=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)
    rewritten_question = Column(Text, nullable=False)
    embedding_vector = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    sources = Column(Text, nullable=False)  # JSON stored as text
    confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id = Column(String, primary_key=True)

    resource_id = Column(String, ForeignKey("resources.id"), nullable=False)

    status = Column(String, default="queued")

    job_type = Column(String, default="full")  # "full" or "reindex"

    created_at = Column(DateTime, default=datetime.utcnow)

    started_at = Column(DateTime, nullable=True)

    finished_at = Column(DateTime, nullable=True)

    error_message = Column(Text, nullable=True)

    progress = Column(Integer, default=0)

    current_stage = Column(String, nullable=True)

    attempt_count = Column(Integer, default=0)

    heartbeat_at = Column(DateTime, nullable=True)

    retryable = Column(Integer, default=1)

    blocked_by_job_id = Column(String, nullable=True)

    input_fingerprint = Column(String, nullable=True)

    next_retry_at = Column(DateTime, nullable=True, index=True)

    retry_schedule_step = Column(Integer, default=0)

    last_error_code = Column(String, nullable=True)


class DocumentInsight(Base):
    __tablename__ = "document_insights"

    id = Column(String, primary_key=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, unique=True)
    status = Column(String, default="pending")
    content_hash = Column(String, nullable=True)
    short_summary = Column(Text, nullable=True)
    detailed_summary = Column(Text, nullable=True)
    topics = Column(Text, nullable=True)
    keywords = Column(Text, nullable=True)
    key_concepts = Column(Text, nullable=True)
    named_entities = Column(Text, nullable=True)
    difficulty_level = Column(String, nullable=True)
    estimated_reading_minutes = Column(Integer, nullable=True)
    document_language = Column(String, nullable=True)
    document_type = Column(String, nullable=True)
    suggested_questions = Column(Text, nullable=True)
    related_documents = Column(Text, nullable=True)
    ai_tags = Column(Text, nullable=True)
    analysis_duration_ms = Column(Float, nullable=True)
    llm_usage = Column(Text, nullable=True)
    token_usage = Column(Text, nullable=True)
    estimated_cost = Column(Float, nullable=True)
    retry_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class AiUsageEvent(Base):
    __tablename__ = "ai_usage_events"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)
    feature = Column(String, nullable=False)
    operation = Column(String, nullable=False)  # chat, stream_chat, embedding, document_intelligence, etc.
    provider = Column(String, nullable=True)
    model = Column(String, nullable=True)
    request_id = Column(String, nullable=True)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    provider_cost_usd = Column(Float, nullable=True)
    billable_cost_usd = Column(Float, nullable=True)
    unit_tokens = Column(Integer, nullable=True)
    unit_price_usd = Column(Float, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class DownloadTask(Base):
    __tablename__ = "download_tasks"

    id = Column(String, primary_key=True)
    url = Column(String, nullable=False)
    status = Column(String, default="queued") # queued, processing, completed, failed
    progress = Column(Integer, default=0) # 0-100
    file_name = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    folder_id = Column(String, nullable=True)
    playlist_id = Column(String, nullable=True)
    task_type = Column(String, nullable=True)
    username = Column(String, nullable=True)
    quality = Column(String, nullable=True)  # e.g., "best", "720", "480", "360"


class UserSetting(Base):
    __tablename__ = "user_settings"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), unique=True)
    whisper_path = Column(String, nullable=True)
    whisper_model_path = Column(String, nullable=True)
    auto_sync = Column(Integer, default=1)  # 1 = True, 0 = False
    theme = Column(String, default="system")
    compact_mode = Column(Integer, default=0)  # 1 = True, 0 = False
    language = Column(String, default="en")
    # RAG Enhancement toggles
    rag_chunk_overlap = Column(Integer, default=0)  # 1 = True, 0 = False
    rag_query_routing = Column(Integer, default=0)  # 1 = True, 0 = False
    rag_nli_verification = Column(Integer, default=0)  # 1 = True, 0 = False
    rag_adaptive_rrf = Column(Integer, default=1)  # 1 = True, 0 = False (on by default)
    rag_parent_child = Column(Integer, default=0)  # 1 = True, 0 = False
    rag_hierarchical = Column(Integer, default=0)  # 1 = True, 0 = False
    rag_contextual_enrichment = Column(Integer, default=0)  # 1 = True, 0 = False
    media_contextual_enrichment = Column(Integer, default=0)  # 1 = True, 0 = False
    # AI Model Configuration (per-service)
    chat_base_url = Column(String, nullable=True)
    chat_api_key = Column(String, nullable=True)
    chat_model = Column(String, nullable=True)
    embedding_base_url = Column(String, nullable=True)
    embedding_api_key = Column(String, nullable=True)
    embedding_model = Column(String, nullable=True)
    reranker_base_url = Column(String, nullable=True)
    reranker_api_key = Column(String, nullable=True)
    reranker_model = Column(String, nullable=True)
    knowledge_base_url = Column(String, nullable=True)
    knowledge_api_key = Column(String, nullable=True)
    knowledge_model = Column(String, nullable=True)
    knowledge_node_distance = Column(Integer, nullable=True, default=140)
    knowledge_view_preferences = Column(Text, nullable=True)
    # AI Cost Tracking (chat provider billing endpoint)
    chat_cost_base_url = Column(String, nullable=True)
    chat_cost_api_key = Column(String, nullable=True)
    wallet_balance_base_url = Column(String, nullable=True)
    wallet_balance_api_key = Column(String, nullable=True)
    # Whisper threads (auto-detected, user-adjustable)
    whisper_threads = Column(Integer, default=0)  # 0 = auto-detect
    # Tesseract OCR path
    tesseract_path = Column(String, nullable=True)
    # WTP/SaT sentence segmentation model path
    wtp_model_path = Column(String, nullable=True)
    # Notification preferences
    notifications_enabled = Column(Integer, default=1)  # 1 = True, 0 = False


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    category = Column(String, nullable=False)  # 'download', 'processing', 'share', 'team', 'system'
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)
    link = Column(String, nullable=True)
    item_thumb = Column(String, nullable=True)
    item_meta = Column(Text, nullable=True)  # JSON-encoded additional info
    is_read = Column(Integer, default=0)
    is_archived = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class AnswerFeedback(Base):
    __tablename__ = "answer_feedback"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    rating = Column(Integer, nullable=False)  # 1 = helpful, -1 = not helpful
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    category = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)



class KnowledgeRun(Base):
    __tablename__ = "knowledge_runs"
    id = Column(String, primary_key=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    job_id = Column(String, ForeignKey("processing_jobs.id"), nullable=True)
    version = Column(Integer, nullable=False)
    status = Column(String, default="queued", index=True)
    input_fingerprint = Column(String, nullable=False)
    current_stage = Column(String, nullable=True)
    progress = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    published_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    resume_cursor = Column(Text, nullable=True)
    checkpoint_json = Column(Text, nullable=True, default="{}")
    metrics_json = Column(Text, nullable=True, default="{}")
    rule_version = Column(String, nullable=True)
    model_version = Column(String, nullable=True)


class ResourceKnowledgeState(Base):
    __tablename__ = "resource_knowledge_states"
    resource_id = Column(String, ForeignKey("resources.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    status = Column(String, default="not_generated", index=True)
    active_run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=True)
    active_version = Column(Integer, nullable=True)
    source_fingerprint = Column(String, nullable=True)
    stale_reasons = Column(Text, nullable=True, default="[]")
    generated_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)


class ResourceKnowledgeProfile(Base):
    __tablename__ = "resource_knowledge_profiles"
    id = Column(String, primary_key=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, unique=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    summary = Column(Text, nullable=True)
    topics = Column(Text, nullable=True)
    language = Column(String, nullable=True)
    domain = Column(String, nullable=True, index=True)
    difficulty = Column(String, nullable=True)
    estimated_minutes = Column(Integer, nullable=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class KnowledgeSourceSection(Base):
    __tablename__ = "knowledge_source_sections"
    id = Column(String, primary_key=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    source_type = Column(String, nullable=False, index=True)
    source_id = Column(String, nullable=False, index=True)
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True, index=True)
    subchapter_id = Column(String, ForeignKey("subchapters.id"), nullable=True, index=True)
    title = Column(String, nullable=False)
    summary = Column(Text, nullable=True)
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptCoverage(Base):
    __tablename__ = "concept_coverages"
    id = Column(String, primary_key=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    section_id = Column(String, ForeignKey("knowledge_source_sections.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    confidence = Column(Float, nullable=False, default=0.0)
    occurrence_role = Column(String, nullable=False, default="explained")
    discussion_duration = Column(Float, nullable=False, default=0.0)
    evidence_count = Column(Integer, nullable=False, default=1)
    evidence_json = Column(Text, nullable=True, default="[]")
    start_seconds = Column(Float, nullable=False)
    end_seconds = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptAlias(Base):
    __tablename__ = "concept_aliases"
    id = Column(String, primary_key=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    alias = Column(String, nullable=False)
    normalized_alias = Column(String, nullable=False, index=True)
    language = Column(String, nullable=True)
    domain = Column(String, nullable=True, index=True)
    confidence = Column(Float, nullable=False, default=1.0)
    status = Column(String, default="approved", index=True)
    provenance = Column(String, nullable=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptMention(Base):
    __tablename__ = "concept_mentions"
    id = Column(String, primary_key=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    source_type = Column(String, nullable=False)
    source_id = Column(String, nullable=True)
    occurrence_role = Column(String, default="explained")
    evidence_text = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    start_seconds = Column(Float, nullable=True)
    end_seconds = Column(Float, nullable=True)
    page_number = Column(Integer, nullable=True)
    paragraph_index = Column(Integer, nullable=True)
    text_start = Column(Integer, nullable=True)
    text_end = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class EntityIdentity(Base):
    __tablename__ = "entity_identities"
    id = Column(String, primary_key=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    entity_type = Column(String, nullable=False)
    canonical_identifier = Column(String, nullable=True)
    attributes_json = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptRelationship(Base):
    __tablename__ = "concept_relationships"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    source_concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    target_concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    relationship_type = Column(String, nullable=False, index=True)
    confidence = Column(Float, nullable=False, default=0.0)
    evidence_count = Column(Integer, default=0)
    archived = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class RelationshipEvidence(Base):
    __tablename__ = "relationship_evidence"
    id = Column(String, primary_key=True)
    relationship_id = Column(String, ForeignKey("concept_relationships.id"), nullable=False, index=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    evidence_text = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    start_seconds = Column(Float, nullable=True)
    end_seconds = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class RelationshipReviewCandidate(Base):
    __tablename__ = "relationship_review_candidates"
    id = Column(String, primary_key=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=False, index=True)
    source_concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    target_concept_id = Column(String, ForeignKey("concepts.id"), nullable=False, index=True)
    relationship_type = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)
    evidence_text = Column(Text, nullable=False)
    start_seconds = Column(Float, nullable=True)
    end_seconds = Column(Float, nullable=True)
    status = Column(String, default="pending", index=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class AliasCandidate(Base):
    __tablename__ = "alias_candidates"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    run_id = Column(String, ForeignKey("knowledge_runs.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True)
    alias = Column(String, nullable=False)
    normalized_alias = Column(String, nullable=False)
    domain = Column(String, nullable=True)
    confidence = Column(Float, nullable=False)
    reason = Column(Text, nullable=True)
    status = Column(String, default="pending", index=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class ConceptSuppression(Base):
    __tablename__ = "concept_suppressions"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True, index=True)
    domain = Column(String, nullable=False, index=True)
    normalized_name = Column(String, nullable=False, index=True)
    reason = Column(Text, nullable=True)
    active = Column(Integer, nullable=False, default=1, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    restored_at = Column(DateTime, nullable=True)


class ConceptAnalytics(Base):
    __tablename__ = "concept_analytics"
    concept_id = Column(String, ForeignKey("concepts.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    mention_count = Column(Integer, default=0)
    meaningful_occurrence_count = Column(Integer, default=0)
    discussion_duration_seconds = Column(Float, default=0.0)
    raw_phrase_occurrences = Column(Integer, default=0)
    resource_count = Column(Integer, default=0)
    chapter_count = Column(Integer, default=0)
    relationship_count = Column(Integer, default=0)
    popularity = Column(Float, default=0.0)
    average_confidence = Column(Float, default=0.0)
    difficulty_score = Column(Float, default=0.0)
    learning_order = Column(Integer, nullable=True)
    growth = Column(Float, default=0.0)
    updated_at = Column(DateTime, default=datetime.utcnow)


class ConceptRecommendation(Base):
    __tablename__ = "concept_recommendations"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True, index=True)
    recommended_concept_id = Column(String, ForeignKey("concepts.id"), nullable=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=True)
    recommendation_type = Column(String, nullable=False, index=True)
    score = Column(Float, nullable=False)
    explanation = Column(Text, nullable=False)
    jump_target_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)


class StudyEvent(Base):
    __tablename__ = "study_events"
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    concept_id = Column(String, ForeignKey("concepts.id"), nullable=True, index=True)
    resource_id = Column(String, ForeignKey("resources.id"), nullable=True, index=True)
    event_type = Column(String, nullable=False, index=True)
    metadata_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
