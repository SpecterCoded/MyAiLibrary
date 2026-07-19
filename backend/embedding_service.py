import os
import re
import json
from pathlib import Path
from datetime import datetime, timezone

from services.chunking_router import chunk_resource
from services.parent_child_service import chunk_parent_metadata
from services.llm_service import answer_question as llm_answer_question
from services.hallucination_service import detect_hallucinations
from core.activity_log import log_user_activity
from core.paths import CHROMA_DIR, EXTRA_FILES_DIR, TEMP_DIR

from core.logger import get_logger
logger = get_logger("EMBEDDING")

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
import contextlib

import hashlib

import chromadb
from transformers.utils import logging
from services.ai_cost_service import record_ai_usage

logging.set_verbosity_error()
BASE_DIR = Path(__file__).resolve().parent
CHROMA_PATH = CHROMA_DIR
# Increase the threshold slightly to allow valid related queries
# while still filtering out unrelated garbage.
MAX_DISTANCE = 1.8
DEBUG_RETRIEVAL = os.getenv("DEBUG_RETRIEVAL", "false").lower() in ("1", "true", "yes")


def _sanitize_metadata_for_chroma(metadata: dict) -> dict:
    """Strip None values and convert lists to comma-joined strings for ChromaDB."""
    sanitized = {}
    for key, value in metadata.items():
        if value is None:
            continue
        if isinstance(value, list):
            sanitized[key] = ", ".join(str(v) for v in value)
        elif isinstance(value, (str, int, float, bool)):
            sanitized[key] = value
        else:
            sanitized[key] = str(value)
    return sanitized

client = chromadb.PersistentClient(path=str(CHROMA_PATH))


# Default workspace collection name (used when a user has no active storage path).
DEFAULT_COLLECTION_NAME = "resource_chunks_v2"


def collection_name_for_storage_root(storage_root: str | None) -> str:
    """Map a workspace (storage path) to a Chroma collection name.
    Each workspace gets its own collection so vector search never mixes workspaces."""
    if not storage_root:
        return DEFAULT_COLLECTION_NAME
    digest = hashlib.sha1(storage_root.encode("utf-8")).hexdigest()[:16]
    return f"ws_{digest}_v2"


# Cache collection handles so we don't re-create them on every call.
_collection_cache: dict[str, "chromadb.api.models.Collection.Collection"] = {}


def get_collection(storage_root: str | None = None):
    """Return the Chroma collection for the given workspace, creating it if needed."""
    name = collection_name_for_storage_root(storage_root)
    cached = _collection_cache.get(name)
    if cached is None:
        cached = client.get_or_create_collection(name=name)
        _collection_cache[name] = cached
    return cached


def resolve_storage_root_for_resource(db, resource_id: str) -> str | None:
    """Resolve which workspace a resource belongs to: its folder's storage_root,
    falling back to the owning user's active storage_root."""
    from models import Resource, Folder, User
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        return None
    if getattr(resource, "folder_id", None):
        folder = db.query(Folder).filter(Folder.id == resource.folder_id).first()
        if folder and folder.storage_root:
            return folder.storage_root
    if getattr(resource, "user_id", None):
        user = db.query(User).filter(User.id == resource.user_id).first()
        if user and user.storage_root:
            return user.storage_root
    return None


# Backwards-compatible default-collection handle (default workspace).
collection = get_collection(None)

_user_embedding_cache: dict[str, tuple] = {}
import time as _time


def get_user_embedding_client(user_id: str | None):
    """Return (client, model, provider) configured from the user's settings.

    Results are cached for 5 minutes per user.
    Raises ValueError if the user has no configured embedding settings.
    """
    if not user_id:
        raise ValueError("No user ID provided. Each user must configure their own Embedding settings.")

    now = _time.time()
    if user_id in _user_embedding_cache:
        cached_client, cached_model, cached_provider, cached_at = _user_embedding_cache[user_id]
        if now - cached_at < 300:
            return cached_client, cached_model, cached_provider

    from database import SessionLocal
    from models import UserSetting
    db = SessionLocal()
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if not settings or not settings.embedding_base_url or not settings.embedding_api_key:
            raise ValueError("Embedding Base URL and API Key are not configured. Please set them in Settings > Embedding.")
        from openai import OpenAI
        user_client = OpenAI(
            api_key=settings.embedding_api_key,
            base_url=settings.embedding_base_url,
            timeout=30.0,
        )
        model = settings.embedding_model or "openai/text-embedding-3-large"
        _user_embedding_cache[user_id] = (user_client, model, "openai", now)
        return user_client, model, "openai"
    finally:
        db.close()


def embed_text(
    text: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "embedding",
):
    _client, _model, _provider = get_user_embedding_client(user_id)
    if not text.strip():
        return [0.0] * 3072
    try:
        response = _client.embeddings.create(
            model=_model,
            input=text,
        )
        usage = getattr(response, "usage", None)
        prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
        total_tokens = int(getattr(usage, "total_tokens", prompt_tokens) or prompt_tokens)
        try:
            record_ai_usage(
                user_id=user_id,
                resource_id=resource_id,
                feature=feature,
                operation="embedding",
                model=_model,
                prompt_tokens=prompt_tokens,
                completion_tokens=0,
                total_tokens=total_tokens,
                request_id=str(getattr(response, "id", "")) or None,
                metadata={
                    "provider": "chatqt_embedding",
                    "exact_tokens": total_tokens > 0,
                    "exact_provider_cost": False,
                },
            )
        except Exception:
            pass
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Error calling embedding API: {e}")
        raise e


def split_text_into_sentences(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", text) if p.strip()]
    sentences: list[str] = []

    for paragraph in paragraphs:
        # Use punctuation boundaries to preserve sentence semantics
        pieces = re.split(r"(?<=[.!?])\s+", paragraph)
        for piece in pieces:
            piece = piece.strip()
            if piece:
                sentences.append(piece)

    return sentences


def chunk_text(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 200,
):
    sentences = split_text_into_sentences(text)
    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        if not current:
            current = sentence
            continue

        if len(current) + len(sentence) + 1 <= chunk_size:
            current = f"{current} {sentence}"
            continue

        chunks.append(current.strip())

        # Keep some overlap from the end of the previous chunk to preserve context
        if overlap > 0:
            overlap_text = current[-overlap:]
            if overlap_text and not overlap_text.startswith(" "):
                overlap_text = f" {overlap_text}"
            current = f"{overlap_text} {sentence}".strip()
        else:
            current = sentence

        # If the next sentence alone is too large, split it directly
        if len(current) > chunk_size:
            start = 0
            while start < len(current):
                end = start + chunk_size
                chunks.append(current[start:end].strip())
                start = end - overlap if overlap and end < len(current) else end
            current = ""

    if current:
        chunks.append(current.strip())

    return chunks


def delete_resource_embeddings(
    resource_id: str,
    storage_root: str | None = None,
):
    try:
        # Resolve the workspace if the caller didn't supply it (while the resource
        # row still exists), so we delete from the correct per-workspace collection.
        if storage_root is None:
            from database import SessionLocal
            db = SessionLocal()
            try:
                storage_root = resolve_storage_root_for_resource(db, resource_id)
            finally:
                db.close()
        get_collection(storage_root).delete(where={"resource_id": resource_id})
        logger.info(f"Deleted embeddings for resource {resource_id}")
    except Exception as e:
        logger.error(f"Error deleting embeddings for resource {resource_id}: {str(e)}")


def _normalize_chunk_metadata(metadata: dict | None) -> dict:
    """Normalize retrieval-relevant metadata for stable chunk comparisons."""

    metadata = dict(metadata or {})
    ignored = {
        "chunk_index",
        "chunk_id",
        "chunk_signature",
        "estimated_tokens",
        "reindex_signature",
        "resource_id",
        "storage_root",
        "user_id",
    }
    normalized: dict = {}
    for key in sorted(metadata.keys()):
        if key in ignored:
            continue
        value = metadata[key]
        if isinstance(value, dict):
            normalized[key] = {sub_key: value[sub_key] for sub_key in sorted(value.keys())}
        elif isinstance(value, list):
            normalized[key] = list(value)
        else:
            normalized[key] = value
    return normalized


def _chunk_signature(content: str, metadata: dict | None) -> str:
    """Create a stable chunk signature for reuse and no-op detection."""

    payload = {
        "content": (content or "").strip(),
        "metadata": _normalize_chunk_metadata(metadata),
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _resource_reindex_signature(transcript: str, records: list[dict]) -> str:
    """Fingerprint the retrieval state for a full-resource re-index."""

    payload = {
        "transcript_hash": hashlib.sha1((transcript or "").encode("utf-8")).hexdigest(),
        "chunk_count": len(records),
        "chunk_signatures": [record["signature"] for record in records],
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def _prepare_chunk_records(
    resource_id: str,
    transcript: str,
    user_id: str,
    storage_root: str | None,
    db,
) -> list[dict]:
    """Build final chunk records before embedding writes occur."""

    chunk_payloads = chunk_resource(resource_id, transcript, db)
    chunks = [payload.content for payload in chunk_payloads]
    chunk_strategy_metadata = [payload.metadata for payload in chunk_payloads]
    parent_metadata = chunk_parent_metadata(resource_id, chunks)
    logger.info(f"Semantic chunks created: {len(chunks)}")

    chunk_timestamps = []
    try:
        for chunk, metadata in zip(chunks, chunk_strategy_metadata):
            ts = metadata.get("start_time")
            if ts is None:
                ts = find_chunk_timestamp(resource_id, chunk)
            chunk_timestamps.append(ts)
    except Exception:
        chunk_timestamps = []

    records: list[dict] = []
    for i, chunk in enumerate(chunks):
        metadata = {
            "resource_id": resource_id,
            "chunk_index": i,
            "user_id": user_id,
            "storage_root": storage_root or "",
        }
        metadata.update(chunk_strategy_metadata[i] if i < len(chunk_strategy_metadata) else {})
        metadata.update(parent_metadata[i] if i < len(parent_metadata) else {})

        if (
            chunk_timestamps and i < len(chunk_timestamps)
            and "start_time" not in metadata
        ):
            start_time = chunk_timestamps[i]
            if start_time is not None:
                end_time = chunk_timestamps[i + 1] if i + 1 < len(chunk_timestamps) else start_time + 30
                metadata["start_time"] = start_time
                metadata["end_time"] = end_time

        page_match = re.search(r'\[Page (\d+)\]', chunk)
        if page_match:
            metadata["page_number"] = int(page_match.group(1))

        # --- Additive metadata enrichment (safe, no-op on failure) ---
        try:
            _stop = {"the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","his","how","its","may","new","now","old","see","way","who","did","get","let","say","she","too","use","this","that","with","have","from","they","been","said","each","which","their","will","would","there","what","about","when","make","like","time","just","know","take","people","into","year","your","good","some","could","them","other","than","then","look","only","come","over","think","also","back","after","work","first","well","even","want","because","give","most"}
            _words = re.findall(r'\b[a-zA-Z]{3,}\b', chunk.lower())
            _terms = list(dict.fromkeys(w for w in _words if w not in _stop))[:8]
            if _terms:
                metadata["key_terms"] = _terms
            _n = len(chunks)
            if _n <= 1:
                metadata["chunk_position"] = "standalone"
            elif i == 0:
                metadata["chunk_position"] = "beginning"
            elif i >= _n - 1:
                metadata["chunk_position"] = "end"
            else:
                metadata["chunk_position"] = "middle"
            _sent = re.split(r'[.!?]\s', chunk, maxsplit=1)[0].strip()
            if _sent:
                if not _sent.endswith((".", "!", "?")):
                    _sent += "."
                metadata["chunk_summary"] = _sent[:120]
            # Token count estimate (words * 1.3)
            metadata["chunk_token_count"] = max(1, int(len(chunk.split()) * 1.3))
            metadata["chunk_char_count"] = len(chunk)
            # Content type hints
            if re.search(r'\b(equation|formula|function|theorem|proof)\b', chunk, re.IGNORECASE):
                metadata["content_type"] = "technical"
            elif re.search(r'\b(step|first|second|then|finally|instructions?)\b', chunk, re.IGNORECASE):
                metadata["content_type"] = "procedural"
            elif re.search(r'\b(compare|difference|versus|similar|contrast)\b', chunk, re.IGNORECASE):
                metadata["content_type"] = "comparative"
            else:
                metadata["content_type"] = "informational"
        except Exception:
            pass
        # --- End metadata enrichment ---

        records.append(
            {
                "chunk_index": i,
                "content": chunk,
                "metadata": metadata,
                "signature": _chunk_signature(chunk, metadata),
            }
        )

    # --- Additive parent-child metadata (safe, no-op on failure) ---
    try:
        _sections: dict[str, list[int]] = {}
        for _idx, _rec in enumerate(records):
            _meta = _rec.get("metadata") or {}
            _section_key = (
                _meta.get("section_title")
                or _meta.get("chapter_title")
                or _meta.get("chapter_id")
                or "_default"
            )
            _sections.setdefault(_section_key, []).append(_idx)
        for _indices in _sections.values():
            _count = len(_indices)
            for _pos, _idx in enumerate(_indices):
                records[_idx]["metadata"]["section_chunk_count"] = _count
                records[_idx]["metadata"]["section_chunk_index"] = _pos
    except Exception:
        pass
    # --- End parent-child metadata ---

    # --- Additive chunk quality scoring (safe, no-op on failure) ---
    try:
        for _rec in records:
            _content = (_rec.get("content") or "").strip()
            _meta = _rec.get("metadata") or {}
            _score = 0.5
            # Length: penalize very short or very long
            _len = len(_content)
            if _len < 100:
                _score -= 0.15
            elif _len > 2000:
                _score -= 0.1
            elif 200 <= _len <= 1200:
                _score += 0.1
            # Sentence completeness
            if _content and _content[-1] in ".!?":
                _score += 0.1
            # Information density: unique words / total words
            _words = _content.lower().split()
            if len(_words) >= 3:
                _unique = len(set(_words)) / len(_words)
                _score += _unique * 0.15
            # Structural bonus
            if _meta.get("page_number") or _meta.get("section_title") or _meta.get("chapter_title"):
                _score += 0.1
            _rec["metadata"]["quality_score"] = round(max(0.0, min(1.0, _score)), 2)
    except Exception:
        pass
    # --- End chunk quality scoring ---

    reindex_signature = _resource_reindex_signature(transcript, records)
    for record in records:
        record["metadata"]["reindex_signature"] = reindex_signature
        record["metadata"]["chunk_signature"] = record["signature"]
    return records


def _fetch_existing_chunk_records(ws_collection, resource_id: str) -> list[dict]:
    """Load current stored chunks plus embeddings for reuse decisions."""

    import concurrent.futures

    def _do_fetch():
        return ws_collection.get(
            where={"resource_id": resource_id},
            include=["embeddings", "documents", "metadatas"],
        )

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(_do_fetch)
            existing = future.result(timeout=30)
    except concurrent.futures.TimeoutError:
        logger.warning(f"ChromaDB get timed out for resource {resource_id}, returning empty")
        return []
    except Exception as e:
        logger.warning(f"ChromaDB get failed for resource {resource_id}: {e}")
        return []

    def _safe_list(value):
        if value is None:
            return []
        try:
            return list(value)
        except Exception:
            return []

    ids = _safe_list(existing.get("ids"))
    documents = _safe_list(existing.get("documents"))
    metadatas = _safe_list(existing.get("metadatas"))
    embeddings = _safe_list(existing.get("embeddings"))

    records: list[dict] = []
    for idx, document in enumerate(documents):
        metadata = dict(metadatas[idx] or {}) if idx < len(metadatas) else {}
        embedding = embeddings[idx] if idx < len(embeddings) else None
        records.append(
            {
                "id": ids[idx] if idx < len(ids) else None,
                "content": document,
                "metadata": metadata,
                "embedding": embedding,
                "signature": _chunk_signature(document, metadata),
            }
        )
    return records


def _reindex_is_noop(existing_records: list[dict], new_records: list[dict]) -> bool:
    """Return True when the stored retrieval state already matches current state."""

    if len(existing_records) != len(new_records):
        return False

    for existing, current in zip(existing_records, new_records):
        if (existing.get("content") or "").strip() != (current.get("content") or "").strip():
            return False
        if _normalize_chunk_metadata(existing.get("metadata")) != _normalize_chunk_metadata(current.get("metadata")):
            return False

    return True


def _build_reusable_embedding_pool(existing_records: list[dict]) -> dict[str, list]:
    """Group existing embeddings by signature so unchanged chunks can reuse them."""

    pool: dict[str, list] = {}
    for record in existing_records:
        signature = record.get("signature")
        embedding = record.get("embedding")
        if not signature or embedding is None:
            continue
        pool.setdefault(signature, []).append(embedding)
    return pool


def _diff_chunk_records(existing_records: list[dict], new_records: list[dict]) -> dict[str, list]:
    """Compare old/new chunk states and return per-chunk actions."""

    existing_by_index = {
        int((record.get("metadata") or {}).get("chunk_index", record.get("chunk_index", -1))): record
        for record in existing_records
        if int((record.get("metadata") or {}).get("chunk_index", record.get("chunk_index", -1))) >= 0
    }
    new_by_index = {
        int((record.get("metadata") or {}).get("chunk_index", record.get("chunk_index", -1))): record
        for record in new_records
        if int((record.get("metadata") or {}).get("chunk_index", record.get("chunk_index", -1))) >= 0
    }

    added: list[dict] = []
    updated: list[dict] = []
    unchanged: list[dict] = []
    removed: list[dict] = []

    for chunk_index, record in sorted(new_by_index.items()):
        existing = existing_by_index.get(chunk_index)
        if existing is None:
            added.append(record)
        elif existing.get("signature") == record.get("signature"):
            unchanged.append(record)
        else:
            updated.append(record)

    for chunk_index, record in sorted(existing_by_index.items()):
        if chunk_index not in new_by_index:
            removed.append(record)

    return {
        "added": added,
        "updated": updated,
        "unchanged": unchanged,
        "removed": removed,
    }


def store_resource_embeddings(
    resource_id: str,
    transcript: str,
    user_id: str,
    storage_root: str | None = None,
    resource_type: str | None = None,
):
    from database import SessionLocal
    from models import ChunkIndex
    from uuid import uuid4

    db = SessionLocal()

    # Resolve which workspace this resource lives in, then target that collection.
    if storage_root is None:
        storage_root = resolve_storage_root_for_resource(db, resource_id)
    ws_collection = get_collection(storage_root)

    logger.info(f"STORE EMBEDDINGS: Preparing chunk records for resource {resource_id}")
    chunk_records = _prepare_chunk_records(
        resource_id=resource_id,
        transcript=transcript,
        user_id=user_id,
        storage_root=storage_root,
        db=db,
    )
    logger.info(f"STORE EMBEDDINGS: {len(chunk_records)} chunks prepared for resource {resource_id}")
    logger.info(f"STORE EMBEDDINGS: Fetching existing records from ChromaDB for resource {resource_id}")
    existing_records = _fetch_existing_chunk_records(ws_collection, resource_id)
    logger.info(f"STORE EMBEDDINGS: {len(existing_records)} existing records found")

    if _reindex_is_noop(existing_records, chunk_records):
        from services.bm25_service import invalidate_bm25_cache

        invalidate_bm25_cache(resource_id)
        logger.info(
            f"REINDEX NO-OP: {json.dumps({'resource_id': resource_id, 'chunk_count': len(chunk_records), 'reason': 'unchanged_retrieval_state'}, ensure_ascii=False)}"
        )
        db.close()
        return True

    reusable_embeddings = _build_reusable_embedding_pool(existing_records)
    diff = _diff_chunk_records(existing_records, chunk_records)
    changed_records = list(diff["added"]) + list(diff["updated"])
    removed_records = list(diff["removed"])
    logger.info(f"STORE EMBEDDINGS: {len(changed_records)} changed, {len(removed_records)} removed")

    changed_ids = [f"{resource_id}_{record['chunk_index']}" for record in changed_records]
    removed_ids = [
        record.get("id") or f"{resource_id}_{(record.get('metadata') or {}).get('chunk_index', record.get('chunk_index'))}"
        for record in removed_records
    ]

    if changed_ids or removed_ids:
        try:
            import concurrent.futures

            def _do_delete():
                if removed_ids:
                    ws_collection.delete(ids=removed_ids)
                if changed_ids:
                    ws_collection.delete(ids=changed_ids)

            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_do_delete)
                future.result(timeout=30)
        except concurrent.futures.TimeoutError:
            logger.warning("ChromaDB delete timed out, attempting fallback delete by resource_id")
            try:
                ws_collection.delete(where={"resource_id": resource_id})
            except Exception:
                pass

    existing_chunk_rows = {
        int(row.chunk_index): row
        for row in db.query(ChunkIndex)
        .filter(ChunkIndex.resource_id == resource_id)
        .all()
    }

    from services.contextual_service import build_embedding_text
    reused_count = 0
    embedded_count = 0

    def _build_embedding_text_compat(document: str, chunk: str) -> str:
        try:
            return build_embedding_text(
                document,
                chunk,
                user_id=user_id,
                resource_id=resource_id,
                feature="chunk_contextualization",
                resource_type=resource_type,
            )
        except TypeError:
            # Older test doubles and legacy helpers still use the original
            # two-argument signature.
            return build_embedding_text(document, chunk)

    def _embed_text_compat(text: str):
        try:
            return embed_text(
                text,
                user_id=user_id,
                resource_id=resource_id,
                feature="resource_index_embedding",
            )
        except TypeError:
            # Older test doubles and legacy helpers still use the original
            # single-argument signature.
            return embed_text(text)

    for record in removed_records:
        chunk_index = int((record.get("metadata") or {}).get("chunk_index", record.get("chunk_index", -1)))
        existing_row = existing_chunk_rows.get(chunk_index)
        if existing_row is not None:
            db.delete(existing_row)

    logger.info(f"STORE EMBEDDINGS: Starting embedding loop for {len(changed_records)} chunks")
    for record_idx, record in enumerate(changed_records):
        # Store in ChunkIndex (always the raw chunk — keeps displayed text and BM25 clean)
        chunk_index = int(record["chunk_index"])
        existing_row = existing_chunk_rows.get(chunk_index)
        if existing_row is None:
            chunk_index_entry = ChunkIndex(
                id=str(uuid4()),
                resource_id=resource_id,
                chunk_index=chunk_index,
                content=record["content"]
            )
            db.add(chunk_index_entry)
        else:
            existing_row.content = record["content"]

        reusable_bucket = reusable_embeddings.get(record["signature"]) or []
        if reusable_bucket:
            embedding = reusable_bucket.pop()
            reused_count += 1
        else:
            if record_idx % 5 == 0:
                logger.info(f"STORE EMBEDDINGS: Embedding chunk {record_idx + 1}/{len(changed_records)}")
            embedding = _embed_text_compat(
                _build_embedding_text_compat(transcript, record["content"])
            )
            embedded_count += 1

        # Wrap ChromaDB add with timeout to prevent hanging
        import concurrent.futures
        vector_metadata = _sanitize_metadata_for_chroma(
            {
                **(record.get("metadata") or {}),
                "indexed_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        def _do_add():
            ws_collection.add(
                ids=[f"{resource_id}_{record['chunk_index']}"],
                embeddings=[embedding],
                documents=[record["content"]],
                metadatas=[vector_metadata],
            )

        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_do_add)
                future.result(timeout=30)
        except concurrent.futures.TimeoutError:
            logger.error(f"ChromaDB add timed out for chunk {record['chunk_index']}, skipping")
            continue

    logger.info(f"STORE EMBEDDINGS: Loop complete. embedded={embedded_count} reused={reused_count}")
    log_user_activity(db, user_id, 'ai_features', 'Chunks created', f'{len(chunk_records)} chunks from transcript')
    log_user_activity(db, user_id, 'ai_features', 'Embeddings stored', f'{embedded_count} new, {reused_count} reused, {len(diff["removed"])} removed')
    db.commit()
    db.close()

    # Invalidate BM25 cache for this resource so next search rebuilds the index
    from services.bm25_service import invalidate_bm25_cache
    invalidate_bm25_cache(resource_id)

    logger.info(
        f"REINDEX SUMMARY: {json.dumps({'resource_id': resource_id, 'chunk_count': len(chunk_records), 'embedded_count': embedded_count, 'reused_embedding_count': reused_count, 'added_count': len(diff['added']), 'updated_count': len(diff['updated']), 'removed_count': len(diff['removed']), 'unchanged_count': len(diff['unchanged']), 'reindex_signature': chunk_records[0]['metadata'].get('reindex_signature') if chunk_records else ''}, ensure_ascii=False)}"
    )
    logger.info(f"Stored {len(chunk_records)} chunks for resource {resource_id} (User: {user_id})")
    return True


def search_embeddings(
    query: str,
    n_results: int = 5,
    storage_root: str | None = None,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "search_embedding",
):

    query_embedding = embed_text(query, user_id=user_id, resource_id=resource_id, feature=feature)

    results = get_collection(storage_root).query(
        query_embeddings=[query_embedding],
        n_results=n_results,
    )

    return results["documents"][0]

def search_resource(
    resource_id: str,
    query: str,
    user_id: str,
    n_results: int = 5,
    storage_root: str | None = None,
):

    query_embedding = embed_text(
        query,
        user_id=user_id,
        resource_id=resource_id,
        feature="resource_search_embedding",
    )

    results = get_collection(storage_root).query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        where={"$and": [{"resource_id": resource_id}, {"user_id": user_id}]},
    )

    distances = results.get("distances", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    if DEBUG_RETRIEVAL:
        logger.debug("DISTANCES:")
        logger.debug(distances)
        logger.debug("METADATAS:")
        logger.debug(metadatas)

    filtered_documents: list[str] = []
    filtered_metadatas: list[dict] = []
    filtered_distances: list[float] = []

    for document, metadata, distance in zip(documents, metadatas, distances):
        if distance is None or distance > MAX_DISTANCE:
            continue
        filtered_documents.append(document)
        filtered_metadatas.append(metadata)
        filtered_distances.append(distance)

    return {
        "documents": filtered_documents,
        "metadatas": filtered_metadatas,
        "distances": filtered_distances,
    }


def search_all_resources(
    query: str,
    user_id: str,
    n_results: int = 10,
    selected_resource_ids: list[str] = None,
    storage_root: str | None = None,
):

    query_embedding = embed_text(
        query,
        user_id=user_id,
        feature="global_search_embedding",
    )

    if selected_resource_ids:
        where_clause = {
            "$and": [
                {"user_id": user_id},
                {"resource_id": {"$in": selected_resource_ids}}
            ]
        }
    else:
        where_clause = {"user_id": user_id}

    results = get_collection(storage_root).query(
        query_embeddings=[query_embedding],
        n_results=n_results,
        where=where_clause,
    )

    distances = results.get("distances", [[]])[0]
    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]

    if DEBUG_RETRIEVAL:
        logger.debug("DISTANCES:")
        logger.debug(distances)
        logger.debug("METADATAS:")
        logger.debug(metadatas)

    filtered_documents: list[str] = []
    filtered_metadatas: list[dict] = []
    filtered_distances: list[float] = []

    for document, metadata, distance in zip(documents, metadatas, distances):
        if distance is None or distance > MAX_DISTANCE:
            continue
        filtered_documents.append(document)
        filtered_metadatas.append(metadata)
        filtered_distances.append(distance)

    return {
        "documents": filtered_documents,
        "metadatas": filtered_metadatas,
        "distances": filtered_distances,
    }


def build_context(
    results: list[dict],
):
    """
    Standard context builder for RAG.
    Adds clear chunk markers to help the LLM distinguish between retrieved segments.
    Uses the canonical chunk_index from metadata for numbering.
    Includes timestamps (video/audio) and page numbers (PDF) when available.
    """
    def _fmt_ts(seconds):
        m, s = divmod(int(seconds), 60)
        h, m = divmod(m, 60)
        return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"

    context = ""
    for res in results:
        # Support both flat results and Chroma-style results
        content = res.get("content")
        chunk_index = res.get("chunk_index")
        metadata = res.get("metadata") or {}

        if chunk_index is None:
            chunk_index = metadata.get("chunk_index")

        if content is None and "document" in res:
            content = res.get("document")

        if chunk_index is None:
            raise ValueError(f"CRITICAL: Result missing chunk_index. Cannot build context reliably. Result: {res}")

        # Build label with optional timestamp and page info
        label_parts = [f"Chunk {chunk_index}"]
        start_time = metadata.get("start_time")
        end_time = metadata.get("end_time")
        if start_time is not None and end_time is not None:
            label_parts.append(f"{_fmt_ts(start_time)}-{_fmt_ts(end_time)}")
        page_number = metadata.get("page_number")
        if page_number is not None:
            label_parts.append(f"Page {page_number}")

        context += f"[{' | '.join(label_parts)}]\n{content}\n\n"

    return context.strip()


def deduplicate_results(results: list[dict]) -> list[dict]:
    """
    Deduplicate results by content (stripped), keeping the first occurrence (highest score).
    ChromaDB can return the same chunk from different resource_id instances — this collapses
    identical content into a single entry so the LLM doesn't see duplicates and sources aren't
    repeated in the response.
    """
    seen = set()
    unique = []
    for res in results:
        content = (res.get("content") or res.get("document") or "").strip()
        # Use a normalized hash — ignore minor whitespace differences
        key = content.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(res)
    return unique


def find_chunk_timestamp(resource_id: str, chunk_content: str) -> float:
    import glob
    import os
    import re

    srt_files = glob.glob(os.path.join(str(EXTRA_FILES_DIR), resource_id, "*.srt"))
    if not srt_files:
        srt_files = glob.glob(os.path.join(str(TEMP_DIR), "*.srt"))
        
    if not srt_files:
        return 0.0
        
    srt_path = srt_files[0]
    try:
        from services.srt_parser import parse_srt
        segments = parse_srt(srt_path)
    except Exception:
        return 0.0
        
    if not segments:
        return 0.0
        
    best_time = 0.0
    max_overlap = 0
    cleaned_chunk = re.sub(r'\s+', ' ', chunk_content.lower()).strip()
    
    for seg in segments:
        seg_text = re.sub(r'\s+', ' ', seg["text"].lower()).strip()
        if not seg_text:
            continue
        if seg_text in cleaned_chunk:
            overlap_weight = len(seg_text)
            if overlap_weight > max_overlap:
                max_overlap = overlap_weight
                best_time = seg["start"]
        else:
            seg_words = set(seg_text.split())
            chunk_words = set(cleaned_chunk.split())
            common_words = seg_words.intersection(chunk_words)
            overlap_weight = len(common_words)
            if overlap_weight > max_overlap:
                max_overlap = overlap_weight
                best_time = seg["start"]
                
    return best_time


def extract_rich_sources(
    reranked_results: list[dict],
    answer: str = None,
):
    """
    Extracts detailed citation information from reranked results.
    Includes chunk_index, excerpt, rerank_score, hybrid_score, resource_title, and resource_path.

    Deduplicates by content so identical chunks from different resource instances
    produce only one source entry.
    """
    from services.evidence_service import extract_best_evidence
    from database import SessionLocal
    from models import Resource

    sources = []
    seen_content = set()
    db = SessionLocal()

    try:
        for res in reranked_results:
            metadata = res.get("metadata", {})
            chunk_index = res.get("chunk_index")
            if chunk_index is None:
                chunk_index = metadata.get("chunk_index")

            content = res.get("content", "")
            if not content and "document" in res:
                content = res.get("document", "")

            # Retrieve resource information
            resource_id = metadata.get("resource_id")
            resource_title = "Unknown"
            resource_path = ""
            if resource_id:
                resource = db.query(Resource).filter(Resource.id == resource_id).first()
                if resource:
                    resource_title = resource.title
                    resource_path = resource.local_path
                else:
                    # Resource not found in DB - skip this result
                    continue

            if answer:
                excerpt = extract_best_evidence(answer, content)
            else:
                excerpt = content[:200]
                if len(content) > 200:
                    last_sentence_end = max(excerpt.rfind("."), excerpt.rfind("!"), excerpt.rfind("?"))
                    if last_sentence_end > 100:
                        excerpt = excerpt[:last_sentence_end + 1]
                    else:
                        excerpt = excerpt.strip() + "..."

            # Deduplicate by content to avoid returning identical chunks multiple times
            content_key = content.strip().lower()
            if content_key in seen_content:
                continue
            seen_content.add(content_key)

            timestamp_seconds = 0.0
            try:
                timestamp_seconds = find_chunk_timestamp(resource_id, content)
            except Exception as e:
                pass

            def fmt_seconds(sec):
                h = int(sec // 3600)
                m = int((sec % 3600) // 60)
                s = int(sec % 60)
                if h > 0:
                    return f"{h:02d}:{m:02d}:{s:02d}"
                return f"{m:02d}:{s:02d}"

            source = {
                "chunk_index": chunk_index,
                "excerpt": excerpt,
                "rerank_score": res.get("rerank_score"),
                "hybrid_score": res.get("hybrid_score"),
                "resource_id": resource_id,
                "resource_title": resource_title,
                "resource_path": resource_path,
                "timestamp": timestamp_seconds,
                "timestamp_label": fmt_seconds(timestamp_seconds)
            }
            sources.append(source)
    finally:
        db.close()

    return sources


def extract_sources_from_metadatas(
    metadatas: list[dict],
):
    sources: list[dict[str, int]] = []
    seen_chunk_indexes: set[int] = set()

    for metadata in metadatas:
        chunk_index = metadata.get("chunk_index")
        if chunk_index is None or chunk_index in seen_chunk_indexes:
            continue

        seen_chunk_indexes.add(chunk_index)
        sources.append({"chunk_index": chunk_index})

    return sources


def answer_question(
    resource_id: str,
    question: str,
):
    """
    Production entry point for single-question answering (Ask Resource).
    Uses the unified RAG pipeline.
    """
    from services.rag_service import run_rag_pipeline

    # For /ask, there is no conversation history, so we pass None
    result = run_rag_pipeline(
        resource_id=resource_id,
        question=question,
        chat_history=None,
        final_history_str=None
    )

    return {
        "answer": result["answer"],
        "sources": result["sources"],
        "hallucinations": result["hallucinations"],
        "confidence": result.get("confidence"),
        "confidence_label": result.get("confidence_label"),
    }


def get_resource_context(resource_id: str, query: str, n_results: int = 5):
    search_results = search_resource(resource_id, query, n_results=n_results)
    
    # Transform into list of dicts for build_context
    results = []
    for doc, meta in zip(search_results["documents"], search_results["metadatas"]):
        results.append({
            "content": doc,
            "metadata": meta
        })

    return build_context(results)


