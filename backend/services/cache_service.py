import json
from uuid import uuid4
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from models import SemanticCache
from embedding_service import embed_text
import math
from core.config import CACHE_TTL_HOURS, CACHE_MAX_ENTRIES

# Cache similarity threshold (for cosine similarity, 0.9+ is high)
CACHE_THRESHOLD = 0.90

def cosine_similarity(v1, v2):
    if len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)

def get_cached_answer(
    db: Session,
    resource_id: str,
    rewritten_question: str,
    user_id: str | None = None,
):
    """Search for a cached answer."""
    question_embedding = embed_text(
        rewritten_question,
        user_id=user_id,
        resource_id=resource_id,
        feature="semantic_cache_lookup_embedding",
    )
    
    # Get all cache entries for this resource
    entries = db.query(SemanticCache).filter(SemanticCache.resource_id == resource_id).all()
    
    for entry in entries:
        try:
            # TTL check: skip expired entries
            if entry.created_at:
                age = datetime.utcnow() - entry.created_at
                if age > timedelta(hours=CACHE_TTL_HOURS):
                    continue

            stored_embedding = json.loads(entry.embedding_vector)
            
            # Skip if dimensions do not match (e.g. from previous embedding model)
            if len(question_embedding) != len(stored_embedding):
                continue
                
            similarity = cosine_similarity(question_embedding, stored_embedding)
            
            if similarity >= CACHE_THRESHOLD:
                print(f"[CACHE HIT] Resource: {resource_id}, Similarity: {similarity}")
                return {
                    "answer": entry.answer,
                    "sources": json.loads(entry.sources),
                    "confidence": entry.confidence
                }
        except Exception:
            continue
            
    print(f"[CACHE MISS] Resource: {resource_id}")
    return None

def save_to_cache(
    db: Session,
    resource_id: str,
    rewritten_question: str,
    answer: str,
    sources: list,
    confidence: float,
    user_id: str | None = None,
):
    """Save a result to cache."""
    try:
        from core.activity_log import log_user_activity
        log_user_activity(db, user_id, 'ai_chat', 'Cached RAG result', f'Confidence: {confidence:.2f}')
    except Exception:
        pass
    embedding = embed_text(
        rewritten_question,
        user_id=user_id,
        resource_id=resource_id,
        feature="semantic_cache_store_embedding",
    )
    
    cache_entry = SemanticCache(
        id=str(uuid4()),
        resource_id=resource_id,
        rewritten_question=rewritten_question,
        embedding_vector=json.dumps(embedding),
        answer=answer,
        sources=json.dumps(sources),
        confidence=confidence
    )
    
    db.add(cache_entry)

    # Size limit: delete oldest entries if over limit
    try:
        count = db.query(SemanticCache).filter(SemanticCache.resource_id == resource_id).count()
        if count > CACHE_MAX_ENTRIES:
            excess = count - CACHE_MAX_ENTRIES
            oldest = (
                db.query(SemanticCache)
                .filter(SemanticCache.resource_id == resource_id)
                .order_by(SemanticCache.created_at.asc())
                .limit(excess)
                .all()
            )
            for old_entry in oldest:
                db.delete(old_entry)
    except Exception:
        pass

    db.commit()
