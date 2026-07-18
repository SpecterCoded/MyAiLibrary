"""Unified cross-library search service.

This service adds a ranked, workspace-scoped search layer on top of the
existing vector search, BM25 search, and SQL metadata search capabilities.
It is intentionally additive and does not modify the production RAG pipeline.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from time import perf_counter, time
from typing import Any

from sqlalchemy import or_
from sqlalchemy.orm import Session

from embedding_service import search_all_resources
from models import Chapter, Concept, DocumentInsight, Folder, Note, Resource, SubChapter, User
from services.bm25_service import search_global_bm25

_CACHE_TTL_SECONDS = 60
_CACHE_MAX_SIZE = 128
_search_cache: dict[str, dict[str, Any]] = {}


@dataclass(slots=True)
class UnifiedSearchResult:
    """A single ranked search result returned to the frontend."""

    id: str
    result_type: str
    content_type: str
    title: str
    snippet: str
    source_name: str
    source_id: str
    resource_id: str | None
    resource_title: str | None
    resource_type: str | None
    page: int | None
    timestamp: int | None
    relevance_score: float
    matching_reason: str
    matching_reasons: list[str]
    preview_url: str | None
    folder_id: str | None
    local_path: str | None
    metadata: dict[str, Any]


@dataclass(slots=True)
class UnifiedSearchResponse:
    """Structured response payload for the unified-search endpoint."""

    query: str
    results: list[dict[str, Any]]
    facets: dict[str, int]
    metrics: dict[str, Any]


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize(value: str) -> str:
    return value.casefold().strip()


def _contains(haystack: Any, needle: str) -> bool:
    return needle in _normalize(_safe_text(haystack))


def _make_snippet(text: str, query: str, *, limit: int = 220) -> str:
    content = " ".join(_safe_text(text).split())
    if not content:
        return ""

    q = _normalize(query)
    pos = _normalize(content).find(q)
    if pos < 0:
        return content[:limit].strip()

    start = max(0, pos - int(limit * 0.35))
    end = min(len(content), start + limit)
    snippet = content[start:end].strip()
    if start > 0:
        snippet = f"…{snippet}"
    if end < len(content):
        snippet = f"{snippet}…"
    return snippet


def _resource_preview_url(resource: Resource) -> str | None:
    if resource.thumbnail_path:
        return f"/resources/{resource.id}/thumbnail"
    if resource.type == "image":
        return f"/resources/{resource.id}/file"
    if resource.type == "video":
        return f"/resources/{resource.id}/thumbnail"
    return None


def _resource_scope_query(db: Session, user: User):
    query = db.query(Resource).filter(Resource.user_id == user.id, Resource.is_deleted == 0)
    if getattr(user, "storage_root", None):
        query = query.join(Folder, Resource.folder_id == Folder.id).filter(Folder.storage_root == user.storage_root)
    return query


def _cache_key(user: User, query: str, limit: int) -> str:
    return f"{user.id}|{getattr(user, 'storage_root', '')}|{limit}|{_normalize(query)}"


def _get_cached_response(user: User, query: str, limit: int) -> dict[str, Any] | None:
    key = _cache_key(user, query, limit)
    cached = _search_cache.get(key)
    if not cached:
        return None
    if time() - float(cached["timestamp"]) > _CACHE_TTL_SECONDS:
        _search_cache.pop(key, None)
        return None
    return cached["payload"]


def _set_cached_response(user: User, query: str, limit: int, payload: dict[str, Any]) -> None:
    if len(_search_cache) >= _CACHE_MAX_SIZE:
        oldest_key = min(_search_cache.keys(), key=lambda item: float(_search_cache[item]["timestamp"]))
        _search_cache.pop(oldest_key, None)
    _search_cache[_cache_key(user, query, limit)] = {"timestamp": time(), "payload": payload}


def _extract_matching_reason(resource: Resource, insight: DocumentInsight | None, query: str) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if _contains(resource.title, query):
        reasons.append("filename")
    if _contains(resource.tags, query):
        reasons.append("tag")
    if insight:
        if _contains(insight.named_entities, query):
            reasons.append("entity")
        if any(
            _contains(value, query)
            for value in (
                insight.topics,
                insight.keywords,
                insight.key_concepts,
                insight.ai_tags,
                insight.difficulty_level,
                insight.document_type,
            )
        ):
            reasons.append("metadata")
    if any(_contains(value, query) for value in (resource.description, resource.summary, resource.transcript)):
        reasons.append("text")
    if not reasons:
        reasons.append("metadata")
    return reasons[0], sorted(set(reasons))


def _facet_key(result: UnifiedSearchResult) -> str:
    return result.content_type or result.result_type


def _result_to_dict(result: UnifiedSearchResult) -> dict[str, Any]:
    payload = asdict(result)
    payload["relevance_score"] = round(float(payload["relevance_score"]), 4)
    return payload


def _merge_result(
    bucket: dict[str, UnifiedSearchResult],
    result: UnifiedSearchResult,
) -> None:
    existing = bucket.get(result.id)
    if existing is None:
        bucket[result.id] = result
        return

    existing.relevance_score = max(existing.relevance_score, result.relevance_score)
    merged_reasons = sorted(set(existing.matching_reasons + result.matching_reasons))
    existing.matching_reasons = merged_reasons
    existing.matching_reason = merged_reasons[0]
    if len(existing.snippet) < len(result.snippet):
        existing.snippet = result.snippet
    if existing.timestamp is None:
        existing.timestamp = result.timestamp
    if existing.page is None:
        existing.page = result.page


def run_unified_search(
    db: Session,
    user: User,
    query: str,
    *,
    limit: int = 30,
) -> dict[str, Any]:
    """Search across the current user's library using existing search primitives."""

    started = perf_counter()
    clean_query = _safe_text(query)
    if not clean_query:
        return _result_to_response(
            UnifiedSearchResponse(
                query="",
                results=[],
                facets={},
                metrics={
                    "latency_ms": 0.0,
                    "cache_hit": False,
                    "result_count": 0,
                    "content_type_distribution": {},
                    "search_source_usage": {},
                },
            )
        )

    cached = _get_cached_response(user, clean_query, limit)
    if cached is not None:
        cached_metrics = dict(cached.get("metrics") or {})
        cached_metrics["cache_hit"] = True
        cached_metrics["latency_ms"] = round((perf_counter() - started) * 1000, 1)
        return {**cached, "metrics": cached_metrics}

    scoped_resources = _resource_scope_query(db, user).all()
    resource_map = {resource.id: resource for resource in scoped_resources}
    resource_ids = list(resource_map)
    if not resource_ids:
        payload = _result_to_response(
            UnifiedSearchResponse(
                query=clean_query,
                results=[],
                facets={},
                metrics={
                    "latency_ms": round((perf_counter() - started) * 1000, 1),
                    "cache_hit": False,
                    "result_count": 0,
                    "content_type_distribution": {},
                    "search_source_usage": {},
                },
            )
        )
        _set_cached_response(user, clean_query, limit, payload)
        return payload

    search_depth = max(limit * 3, 20)
    vector_results = search_all_resources(
        clean_query,
        user.id,
        n_results=search_depth,
        selected_resource_ids=resource_ids,
        storage_root=getattr(user, "storage_root", None),
    )
    keyword_results = search_global_bm25(resource_ids, clean_query, top_k=search_depth)

    metadata_rows = (
        db.query(Resource, DocumentInsight)
        .outerjoin(DocumentInsight, DocumentInsight.resource_id == Resource.id)
        .filter(Resource.id.in_(resource_ids))
        .filter(
            or_(
                Resource.title.contains(clean_query),
                Resource.description.contains(clean_query),
                Resource.summary.contains(clean_query),
                Resource.transcript.contains(clean_query),
                Resource.tags.contains(clean_query),
                DocumentInsight.topics.contains(clean_query),
                DocumentInsight.keywords.contains(clean_query),
                DocumentInsight.key_concepts.contains(clean_query),
                DocumentInsight.named_entities.contains(clean_query),
                DocumentInsight.ai_tags.contains(clean_query),
                DocumentInsight.difficulty_level.contains(clean_query),
                DocumentInsight.document_type.contains(clean_query),
            )
        )
        .limit(search_depth)
        .all()
    )

    note_rows = (
        db.query(Note)
        .filter(
            Note.user_id == user.id,
            Note.status != "deleted",
            or_(
                Note.title.contains(clean_query),
                Note.content.contains(clean_query),
                Note.tags.contains(clean_query),
            ),
        )
        .limit(search_depth)
        .all()
    )

    chapter_rows = (
        db.query(Chapter, Resource)
        .join(Resource, Chapter.resource_id == Resource.id)
        .filter(Resource.id.in_(resource_ids))
        .filter(
            or_(
                Chapter.title.contains(clean_query),
                Chapter.summary.contains(clean_query),
                Chapter.transcript.contains(clean_query),
            )
        )
        .limit(search_depth)
        .all()
    )

    subchapter_rows = (
        db.query(SubChapter, Chapter, Resource)
        .join(Chapter, SubChapter.chapter_id == Chapter.id)
        .join(Resource, Chapter.resource_id == Resource.id)
        .filter(Resource.id.in_(resource_ids))
        .filter(
            or_(
                SubChapter.title.contains(clean_query),
                SubChapter.summary.contains(clean_query),
                SubChapter.transcript.contains(clean_query),
            )
        )
        .limit(search_depth)
        .all()
    )

    concept_rows = (
        db.query(Concept)
        .filter(
            or_(
                Concept.name.contains(clean_query),
                Concept.description.contains(clean_query),
            )
        )
        .limit(search_depth)
        .all()
    )

    bucket: dict[str, UnifiedSearchResult] = {}
    source_usage = {
        "semantic": 0,
        "keyword": 0,
        "metadata": 0,
        "notes": 0,
        "chapters": 0,
        "subchapters": 0,
        "concepts": 0,
    }

    distances = vector_results.get("distances", [])
    documents = vector_results.get("documents", [])
    metadatas = vector_results.get("metadatas", [])
    for document, metadata, distance in zip(documents, metadatas, distances):
        resource_id = str((metadata or {}).get("resource_id") or "")
        resource = resource_map.get(resource_id)
        if resource is None:
            continue
        chunk_id = str((metadata or {}).get("chunk_id") or (metadata or {}).get("chunk_index") or resource_id)
        score = max(0.0, 1.0 - float(distance))
        result = UnifiedSearchResult(
            id=f"resource-chunk:{resource_id}:{chunk_id}",
            result_type="resource_chunk",
            content_type=_safe_text(resource.type).lower() or "resource",
            title=_safe_text(resource.title) or "Untitled Resource",
            snippet=_make_snippet(_safe_text(document), clean_query),
            source_name=_safe_text(resource.title) or "Untitled Resource",
            source_id=resource.id,
            resource_id=resource.id,
            resource_title=resource.title,
            resource_type=resource.type,
            page=(metadata or {}).get("page_number"),
            timestamp=(metadata or {}).get("start_time"),
            relevance_score=score,
            matching_reason="semantic",
            matching_reasons=["semantic"],
            preview_url=_resource_preview_url(resource),
            folder_id=resource.folder_id,
            local_path=resource.local_path,
            metadata={
                "chunk_index": (metadata or {}).get("chunk_index"),
                "end_time": (metadata or {}).get("end_time"),
            },
        )
        source_usage["semantic"] += 1
        _merge_result(bucket, result)

    top_keyword_score = max((float(item.get("score") or 0.0) for item in keyword_results), default=0.0)
    for item in keyword_results:
        resource = resource_map.get(str(item.get("resource_id") or ""))
        if resource is None:
            continue
        raw_score = float(item.get("score") or 0.0)
        score = raw_score / top_keyword_score if top_keyword_score > 0 else 0.0
        chunk_index = item.get("chunk_index")
        result = UnifiedSearchResult(
            id=f"resource-bm25:{resource.id}:{chunk_index}",
            result_type="resource_chunk",
            content_type=_safe_text(resource.type).lower() or "resource",
            title=_safe_text(resource.title) or "Untitled Resource",
            snippet=_make_snippet(_safe_text(item.get("content")), clean_query),
            source_name=_safe_text(resource.title) or "Untitled Resource",
            source_id=resource.id,
            resource_id=resource.id,
            resource_title=resource.title,
            resource_type=resource.type,
            page=None,
            timestamp=None,
            relevance_score=score,
            matching_reason="text",
            matching_reasons=["text"],
            preview_url=_resource_preview_url(resource),
            folder_id=resource.folder_id,
            local_path=resource.local_path,
            metadata={"chunk_index": chunk_index},
        )
        source_usage["keyword"] += 1
        _merge_result(bucket, result)

    for resource, insight in metadata_rows:
        reason, reasons = _extract_matching_reason(resource, insight, clean_query)
        result = UnifiedSearchResult(
            id=f"resource:{resource.id}",
            result_type="resource",
            content_type=_safe_text(resource.type).lower() or "resource",
            title=_safe_text(resource.title) or "Untitled Resource",
            snippet=_make_snippet(
                "\n".join(
                    part
                    for part in (
                        resource.description,
                        resource.summary,
                        resource.tags,
                        getattr(insight, "topics", None) if insight else None,
                        getattr(insight, "keywords", None) if insight else None,
                        getattr(insight, "key_concepts", None) if insight else None,
                        getattr(insight, "named_entities", None) if insight else None,
                        getattr(insight, "ai_tags", None) if insight else None,
                    )
                    if _safe_text(part)
                ),
                clean_query,
            ),
            source_name=_safe_text(resource.title) or "Untitled Resource",
            source_id=resource.id,
            resource_id=resource.id,
            resource_title=resource.title,
            resource_type=resource.type,
            page=None,
            timestamp=None,
            relevance_score=0.82,
            matching_reason=reason,
            matching_reasons=reasons,
            preview_url=_resource_preview_url(resource),
            folder_id=resource.folder_id,
            local_path=resource.local_path,
            metadata={
                "document_insight_status": getattr(insight, "status", None) if insight else None,
            },
        )
        source_usage["metadata"] += 1
        _merge_result(bucket, result)

    for note in note_rows:
        result = UnifiedSearchResult(
            id=f"note:{note.id}",
            result_type="note",
            content_type="note",
            title=_safe_text(note.title) or "Untitled Note",
            snippet=_make_snippet("\n".join(part for part in (note.content, note.tags) if _safe_text(part)), clean_query),
            source_name=_safe_text(note.title) or "Untitled Note",
            source_id=note.id,
            resource_id=note.resource_id,
            resource_title=None,
            resource_type=None,
            page=None,
            timestamp=None,
            relevance_score=0.74,
            matching_reason="text",
            matching_reasons=["text"],
            preview_url=None,
            folder_id=note.folder_id,
            local_path=None,
            metadata={
                "playlist_id": note.playlist_id,
                "concept_id": note.concept_id,
            },
        )
        source_usage["notes"] += 1
        _merge_result(bucket, result)

    for chapter, resource in chapter_rows:
        result = UnifiedSearchResult(
            id=f"chapter:{chapter.id}",
            result_type="chapter",
            content_type=_safe_text(resource.type).lower() or "chapter",
            title=_safe_text(chapter.title) or "Untitled Chapter",
            snippet=_make_snippet("\n".join(part for part in (chapter.summary, chapter.transcript) if _safe_text(part)), clean_query),
            source_name=_safe_text(resource.title) or "Untitled Resource",
            source_id=chapter.id,
            resource_id=resource.id,
            resource_title=resource.title,
            resource_type=resource.type,
            page=None,
            timestamp=chapter.start_time,
            relevance_score=0.78,
            matching_reason="text",
            matching_reasons=["text"],
            preview_url=_resource_preview_url(resource),
            folder_id=resource.folder_id,
            local_path=resource.local_path,
            metadata={"end_time": chapter.end_time},
        )
        source_usage["chapters"] += 1
        _merge_result(bucket, result)

    for subchapter, chapter, resource in subchapter_rows:
        result = UnifiedSearchResult(
            id=f"subchapter:{subchapter.id}",
            result_type="subchapter",
            content_type=_safe_text(resource.type).lower() or "subchapter",
            title=_safe_text(subchapter.title) or "Untitled Subchapter",
            snippet=_make_snippet("\n".join(part for part in (subchapter.summary, subchapter.transcript) if _safe_text(part)), clean_query),
            source_name=_safe_text(resource.title) or "Untitled Resource",
            source_id=subchapter.id,
            resource_id=resource.id,
            resource_title=resource.title,
            resource_type=resource.type,
            page=None,
            timestamp=subchapter.start_time,
            relevance_score=0.76,
            matching_reason="text",
            matching_reasons=["text"],
            preview_url=_resource_preview_url(resource),
            folder_id=resource.folder_id,
            local_path=resource.local_path,
            metadata={"chapter_id": chapter.id, "end_time": subchapter.end_time},
        )
        source_usage["subchapters"] += 1
        _merge_result(bucket, result)

    for concept in concept_rows:
        result = UnifiedSearchResult(
            id=f"concept:{concept.id}",
            result_type="concept",
            content_type="concept",
            title=_safe_text(concept.name) or "Untitled Concept",
            snippet=_make_snippet(_safe_text(concept.description), clean_query),
            source_name=_safe_text(concept.name) or "Untitled Concept",
            source_id=concept.id,
            resource_id=None,
            resource_title=None,
            resource_type=None,
            page=None,
            timestamp=None,
            relevance_score=0.61,
            matching_reason="text",
            matching_reasons=["text"],
            preview_url=None,
            folder_id=None,
            local_path=None,
            metadata={},
        )
        source_usage["concepts"] += 1
        _merge_result(bucket, result)

    ranked_results = sorted(bucket.values(), key=lambda item: item.relevance_score, reverse=True)[:limit]

    facets: dict[str, int] = {"all": len(ranked_results)}
    content_distribution: dict[str, int] = {}
    for result in ranked_results:
        key = _facet_key(result)
        facets[key] = facets.get(key, 0) + 1
        content_distribution[key] = content_distribution.get(key, 0) + 1
        facets[result.result_type] = facets.get(result.result_type, 0) + 1

    payload = _result_to_response(
        UnifiedSearchResponse(
            query=clean_query,
            results=[_result_to_dict(result) for result in ranked_results],
            facets=facets,
            metrics={
                "latency_ms": round((perf_counter() - started) * 1000, 1),
                "cache_hit": False,
                "result_count": len(ranked_results),
                "content_type_distribution": content_distribution,
                "search_source_usage": source_usage,
            },
        )
    )
    _set_cached_response(user, clean_query, limit, payload)
    return payload


def _result_to_response(response: UnifiedSearchResponse) -> dict[str, Any]:
    return {
        "query": response.query,
        "results": response.results,
        "facets": response.facets,
        "metrics": response.metrics,
    }
