import os
import time

from core.logger import get_logger
from .ai_cost_service import record_chat_completion_usage
logger = get_logger("CONTEXTUAL")

# On by default — enabling adds one LLM call per chunk at ingestion time.
CONTEXTUAL_ENRICHMENT = os.getenv("CONTEXTUAL_ENRICHMENT", "true").lower() in ("1", "true", "yes")

# Cap how much of the document we send as context to keep token cost bounded.
MAX_DOC_CHARS = 8000

# Track consecutive failures to skip enrichment when API is unreachable
_consecutive_failures = 0
_last_failure_time = 0.0
_CIRCUIT_BREAKER_THRESHOLD = 3
_CIRCUIT_BREAKER_COOLDOWN = 60  # seconds


def is_enabled() -> bool:
    return CONTEXTUAL_ENRICHMENT


CONTEXTUAL_SKIP_TYPES = {"pdf", "docx", "image"}
MEDIA_TYPES = {"video", "audio", "youtube"}


def _user_wants_enrichment(user_id: str | None) -> bool:
    """Check if the user has enabled contextual enrichment in their settings."""
    if not user_id:
        return False
    try:
        from database import SessionLocal
        from models import UserSetting
        db = SessionLocal()
        try:
            row = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
            if row is None:
                return False
            return getattr(row, "rag_contextual_enrichment", 0) == 1
        finally:
            db.close()
    except Exception:
        return False


def _user_wants_media_enrichment(user_id: str | None) -> bool:
    """Check if the user has enabled media contextual enrichment in their settings."""
    if not user_id:
        return False
    try:
        from database import SessionLocal
        from models import UserSetting
        db = SessionLocal()
        try:
            row = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
            if row is None:
                return False
            return getattr(row, "media_contextual_enrichment", 0) == 1
        finally:
            db.close()
    except Exception:
        return False


def contextualize_chunk(
    document: str,
    chunk: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "chunk_contextualization",
    resource_type: str | None = None,
) -> str:
    """Return a short situating sentence for `chunk` within `document`.

    Implements Anthropic's "Contextual Retrieval": a one-sentence description of
    where the chunk sits in the larger document, prepended to the chunk before
    embedding so isolated chunks retain document-level meaning.

    Returns an empty string on any failure so the caller embeds the raw chunk.
    """
    global _consecutive_failures, _last_failure_time

    if not CONTEXTUAL_ENRICHMENT:
        return ""

    # Skip document types unless user has enabled contextual enrichment
    if (resource_type or "").lower() in CONTEXTUAL_SKIP_TYPES:
        if not _user_wants_enrichment(user_id):
            return ""

    # Skip media types unless user has enabled media contextual enrichment
    if (resource_type or "").lower() in MEDIA_TYPES:
        if not _user_wants_media_enrichment(user_id):
            return ""

    # Circuit breaker: skip enrichment if API has been failing repeatedly
    if _consecutive_failures >= _CIRCUIT_BREAKER_THRESHOLD:
        if time.time() - _last_failure_time < _CIRCUIT_BREAKER_COOLDOWN:
            return ""
        # Reset after cooldown
        _consecutive_failures = 0

    try:
        from .llm_service import get_user_chat_client

        doc_excerpt = document[:MAX_DOC_CHARS]
        prompt = f"""<document>
{doc_excerpt}
</document>

Here is a chunk from the document:
<chunk>
{chunk}
</chunk>

Give a short, single-sentence context that situates this chunk within the overall document, to improve search retrieval. Answer ONLY with the sentence, nothing else."""
        _client, _model = get_user_chat_client(user_id)
        response = _client.chat.completions.create(
            model=_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            timeout=15.0,
        )
        context = response.choices[0].message.content.strip()
        record_chat_completion_usage(
            response=response,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
            operation="chunk_contextualization",
            model=_model,
            prompt_text=prompt,
            completion_text=context,
        )
        # Guard against runaway output
        if len(context) > 500:
            return ""
        return context
    except Exception as e:
        _consecutive_failures += 1
        _last_failure_time = time.time()
        if _consecutive_failures >= _CIRCUIT_BREAKER_THRESHOLD:
            logger.warning(f"Chunk contextualization circuit breaker tripped after {_consecutive_failures} failures; skipping enrichment for remaining chunks.")
        else:
            logger.warning(f"Chunk contextualization failed ({e}); embedding raw chunk.")
        return ""


def build_embedding_text(
    document: str,
    chunk: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "chunk_contextualization",
    resource_type: str | None = None,
) -> str:
    """Text to embed: enriched (context + chunk) when enabled, else the raw chunk."""
    context = contextualize_chunk(
        document,
        chunk,
        user_id=user_id,
        resource_id=resource_id,
        feature=feature,
        resource_type=resource_type,
    )
    if context:
        return f"{context}\n\n{chunk}"
    return chunk
