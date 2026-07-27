import json
from uuid import uuid4
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from models import SemanticCache
from embedding_service import embed_text
import math
from core.config import CACHE_TTL_HOURS, CACHE_MAX_ENTRIES
from core.time import utc_now

# Cache similarity threshold (for cosine similarity, 0.9+ is high)
CACHE_THRESHOLD = 0.90
# Only overwrite an existing row when the questions are effectively identical.
CACHE_DEDUPE_THRESHOLD = 0.995

def cosine_similarity(v1, v2):
    if len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


def _require_user_id(user_id: str | None) -> str:
    normalized = (user_id or "").strip()
    if not normalized:
        raise ValueError("Semantic cache operations require an authenticated user_id")
    return normalized


def _scoped_entries(db: Session, user_id: str, resource_id: str | None):
    query = db.query(SemanticCache).filter(SemanticCache.user_id == user_id)
    if resource_id is None:
        return query.filter(SemanticCache.resource_id.is_(None))
    return query.filter(SemanticCache.resource_id == resource_id)


def _entry_rank(entry: SemanticCache, similarity: float):
    created_at = entry.created_at or datetime.min
    return (
        similarity,
        float(entry.confidence or 0.0),
        created_at,
        entry.id or "",
    )

def get_cached_answer(
    db: Session,
    resource_id: str | None,
    rewritten_question: str,
    user_id: str | None = None,
):
    """Search for a cached answer."""
    owner_id = _require_user_id(user_id)
    question_embedding = embed_text(
        rewritten_question,
        user_id=owner_id,
        resource_id=resource_id,
        feature="semantic_cache_lookup_embedding",
    )

    entries = _scoped_entries(db, owner_id, resource_id).all()
    best_match = None
    best_rank = None

    for entry in entries:
        try:
            # TTL check: skip expired entries
            if entry.created_at:
                age = utc_now() - entry.created_at
                if age > timedelta(hours=CACHE_TTL_HOURS):
                    continue

            stored_embedding = json.loads(entry.embedding_vector)
            
            # Skip if dimensions do not match (e.g. from previous embedding model)
            if len(question_embedding) != len(stored_embedding):
                continue
                
            similarity = cosine_similarity(question_embedding, stored_embedding)

            if similarity >= CACHE_THRESHOLD:
                rank = _entry_rank(entry, similarity)
                if best_rank is None or rank > best_rank:
                    best_match = entry
                    best_rank = rank
        except Exception:
            continue

    if best_match is not None:
        try:
            sources = json.loads(best_match.sources)
        except (TypeError, ValueError):
            sources = []
        print(
            f"[CACHE HIT] Resource: {resource_id}, "
            f"Similarity: {best_rank[0]:.4f}"
        )
        return {
            "answer": best_match.answer,
            "sources": sources,
            "confidence": best_match.confidence,
        }

    print(f"[CACHE MISS] Resource: {resource_id}")
    return None

def save_to_cache(
    db: Session,
    resource_id: str | None,
    rewritten_question: str,
    answer: str,
    sources: list,
    confidence: float,
    user_id: str | None = None,
):
    """Save a result to cache."""
    owner_id = _require_user_id(user_id)
    try:
        from core.activity_log import log_user_activity
        log_user_activity(db, owner_id, 'ai_chat', 'Cached RAG result', f'Confidence: {confidence:.2f}')
    except Exception:
        pass
    embedding = embed_text(
        rewritten_question,
        user_id=owner_id,
        resource_id=resource_id,
        feature="semantic_cache_store_embedding",
    )

    existing_entry = None
    existing_rank = None
    duplicate_entries = []
    for entry in _scoped_entries(db, owner_id, resource_id).all():
        try:
            stored_embedding = json.loads(entry.embedding_vector)
            similarity = cosine_similarity(embedding, stored_embedding)
        except Exception:
            continue
        if similarity < CACHE_DEDUPE_THRESHOLD:
            continue
        duplicate_entries.append(entry)
        rank = _entry_rank(entry, similarity)
        if existing_rank is None or rank > existing_rank:
            existing_entry = entry
            existing_rank = rank

    if existing_entry is None:
        cache_entry = SemanticCache(
            id=str(uuid4()),
            user_id=owner_id,
            resource_id=resource_id,
            rewritten_question=rewritten_question,
            embedding_vector=json.dumps(embedding),
            answer=answer,
            sources=json.dumps(sources),
            confidence=confidence,
        )
        db.add(cache_entry)
    else:
        existing_entry.rewritten_question = rewritten_question
        existing_entry.embedding_vector = json.dumps(embedding)
        existing_entry.answer = answer
        existing_entry.sources = json.dumps(sources)
        existing_entry.confidence = confidence
        existing_entry.created_at = utc_now()
        for duplicate in duplicate_entries:
            if duplicate.id != existing_entry.id:
                db.delete(duplicate)

    # Size limit: delete oldest entries if over limit
    try:
        scoped_entries = _scoped_entries(db, owner_id, resource_id)
        count = scoped_entries.count()
        if count > CACHE_MAX_ENTRIES:
            excess = count - CACHE_MAX_ENTRIES
            oldest = (
                scoped_entries
                .order_by(SemanticCache.created_at.asc(), SemanticCache.id.asc())
                .limit(excess)
                .all()
            )
            for old_entry in oldest:
                db.delete(old_entry)
    except Exception:
        pass

    db.commit()


def invalidate_resource_cache(db: Session, resource_id: str | None) -> int:
    """Delete all cached answers tied to a resource.

    Called after a resource is re-indexed: its underlying content changed, so any
    previously cached answers for it are stale and must not be served again.
    Returns the number of cache rows removed. Best-effort and safe to call even if
    there is nothing to remove.
    """
    if not resource_id:
        return 0
    try:
        entries = (
            db.query(SemanticCache)
            .filter(SemanticCache.resource_id == resource_id)
            .all()
        )
        removed = 0
        for entry in entries:
            db.delete(entry)
            removed += 1
        if removed:
            db.commit()
        return removed
    except Exception:
        db.rollback()
        return 0
