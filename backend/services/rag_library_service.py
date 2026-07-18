from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from embedding_service import get_collection
from models import ChunkIndex, Folder, Playlist, Resource, SearchIndex


FAILED_STATUS_PREFIX = "failed_"
ACTIVE_PIPELINE_STATUSES = {
    "queued",
    "processing",
    "transcribing",
    "summarizing",
    "chaptering",
    "subchaptering",
    "embedding",
    "indexing",
}
DOCUMENT_EMBED_ONLY_TYPES = {"pdf", "docx", "image"}
OVERVIEW_SORT_FIELDS = {
    "created_at",
    "title",
    "type",
    "rag_status",
    "processing_status",
    "chunk_count",
    "vector_count",
    "search_index_count",
    "transcript_chars",
    "summary_chars",
}


def _is_true(value: Any) -> bool:
    return str(value).strip().lower() == "true"


def _normalize_type(resource_type: str | None) -> str:
    return (resource_type or "").strip().lower()


def _failed_stage(processing_status: str | None) -> str | None:
    status = (processing_status or "").strip().lower()
    if not status.startswith(FAILED_STATUS_PREFIX):
        return None
    stage = status[len(FAILED_STATUS_PREFIX):].strip()
    return stage or None


def _calculate_diagnostics(
    resource: Resource,
    *,
    chunk_count: int,
    vector_count: int,
    search_index_count: int,
    existing_health_history: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    transcript = (resource.transcript or "").strip()
    summary = (resource.summary or "").strip()
    processing_status = (resource.processing_status or "").strip().lower()
    failed_stage = _failed_stage(processing_status)
    resource_type = _normalize_type(resource.type)
    is_embedded = _is_true(resource.is_embedded)
    supports_summary = resource_type not in DOCUMENT_EMBED_ONLY_TYPES

    issues: list[str] = []
    warnings: list[str] = []

    if not transcript:
        issues.append("missing_transcript")
    if chunk_count == 0 and transcript:
        issues.append("missing_chunks")
    if vector_count == 0 and is_embedded:
        issues.append("embedded_flag_without_vectors")
    if vector_count > 0 and chunk_count == 0:
        issues.append("vectors_without_chunks")
    if search_index_count == 0 and chunk_count > 0:
        warnings.append("missing_search_index")
    if not supports_summary and summary:
        warnings.append("unexpected_summary_for_document_type")
    if failed_stage:
        issues.append(f"pipeline_failed_at_{failed_stage}")
    if processing_status in ACTIVE_PIPELINE_STATUSES and chunk_count > 0 and vector_count > 0:
        warnings.append("active_status_despite_existing_rag_artifacts")

    if vector_count > 0:
        last_completed_stage = "embedding"
    elif chunk_count > 0:
        last_completed_stage = "chunking"
    elif transcript:
        last_completed_stage = "text_extraction"
    else:
        last_completed_stage = "uploaded"

    ready_for_retrieval = vector_count > 0
    healthy = not issues
    health_score = max(0, 100 - (len(issues) * 18) - (len(warnings) * 6))

    history = list(existing_health_history) if existing_health_history else []
    now_iso = datetime.now(timezone.utc).isoformat()
    history.append({"time": now_iso, "score": health_score})
    history = history[-20:]

    return {
        "healthy": healthy,
        "health_score": health_score,
        "health_history": history,
        "issues": issues,
        "warnings": warnings,
        "failed_stage": failed_stage,
        "last_completed_stage": last_completed_stage,
        "ready_for_retrieval": ready_for_retrieval,
        "can_resume": failed_stage is not None,
        "can_embed": bool(transcript) and vector_count == 0 and processing_status not in ACTIVE_PIPELINE_STATUSES,
        "supports_summary": supports_summary,
    }


def _sort_value(item: dict[str, Any], sort_by: str) -> Any:
    value = item.get(sort_by)
    if sort_by in {"title", "type", "rag_status", "processing_status"}:
        return str(value or "").lower()
    if value is None:
        return ""
    return value


def _paginate(items: list[dict[str, Any]], *, page: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
    total = len(items)
    start = max(0, (page - 1) * page_size)
    end = start + page_size
    return items[start:end], total


def _base_resource_query(
    db: Session,
    *,
    user_id: str,
    storage_root: str | None,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    q: str | None = None,
    embedded_only: bool | None = None,
    resource_type: str | None = None,
    processing_status: str | None = None,
):
    query = (
        db.query(Resource)
        .join(Folder, Resource.folder_id == Folder.id)
        .filter(
            Resource.user_id == user_id,
            func.coalesce(Resource.is_deleted, 0) == 0,
        )
    )

    if storage_root:
        query = query.filter(Folder.storage_root == storage_root)
    else:
        query = query.filter(Folder.storage_root.is_(None))

    if playlist_id:
        query = query.filter(Folder.playlist_id == playlist_id)
    if folder_id:
        query = query.filter(Resource.folder_id == folder_id)
    if q:
        like_query = f"%{q}%"
        query = query.filter(
            (Resource.title.ilike(like_query))
            | (Resource.summary.ilike(like_query))
            | (Resource.transcript.ilike(like_query))
        )
    if embedded_only is True:
        query = query.filter(func.lower(func.coalesce(Resource.is_embedded, "false")) == "true")
    elif embedded_only is False:
        query = query.filter(func.lower(func.coalesce(Resource.is_embedded, "false")) != "true")
    if resource_type:
        query = query.filter(func.lower(func.coalesce(Resource.type, "")) == resource_type.lower())
    if processing_status:
        query = query.filter(func.lower(func.coalesce(Resource.processing_status, "")) == processing_status.lower())

    return query


def _fetch_vector_records_for_resources(
    *,
    storage_root: str | None,
    user_id: str,
    resource_ids: set[str],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    if not resource_ids:
        return grouped

    collection = get_collection(storage_root)
    try:
        payload = collection.get(where={"user_id": user_id}, include=["documents", "metadatas"])
    except Exception:
        try:
            payload = collection.get(include=["documents", "metadatas"])
        except Exception:
            return grouped

    ids = list(payload.get("ids") or [])
    documents = list(payload.get("documents") or [])
    metadatas = list(payload.get("metadatas") or [])

    for idx, vector_id in enumerate(ids):
        metadata = dict(metadatas[idx] or {}) if idx < len(metadatas) else {}
        resource_id = str(metadata.get("resource_id") or "")
        if resource_id not in resource_ids:
            continue
        grouped[resource_id].append(
            {
                "id": vector_id,
                "content": documents[idx] if idx < len(documents) else "",
                "metadata": metadata,
                "chunk_index": int(metadata.get("chunk_index", -1)),
            }
        )

    for resource_id in grouped:
        grouped[resource_id].sort(key=lambda item: item.get("chunk_index", -1))
    return grouped


def _fetch_chunk_counts(db: Session, resource_ids: list[str]) -> dict[str, int]:
    if not resource_ids:
        return {}
    rows = (
        db.query(ChunkIndex.resource_id, func.count(ChunkIndex.id))
        .filter(ChunkIndex.resource_id.in_(resource_ids))
        .group_by(ChunkIndex.resource_id)
        .all()
    )
    return {resource_id: int(count or 0) for resource_id, count in rows}


def _fetch_search_index_counts(db: Session, resource_ids: list[str]) -> dict[str, int]:
    if not resource_ids:
        return {}
    rows = (
        db.query(SearchIndex.source_id, func.count(SearchIndex.id))
        .filter(
            SearchIndex.source_type == "resource",
            SearchIndex.source_id.in_(resource_ids),
        )
        .group_by(SearchIndex.source_id)
        .all()
    )
    return {resource_id: int(count or 0) for resource_id, count in rows}


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, time.min)
    if value is None:
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_date_key(value: Any) -> str | None:
    parsed = _parse_datetime(value)
    if parsed is None:
        return None
    return parsed.date().isoformat()


def _volume_buckets(days: int) -> dict[str, dict[str, Any]]:
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    return {
        (start + timedelta(days=offset)).isoformat(): {
            "date": (start + timedelta(days=offset)).isoformat(),
            "label": (start + timedelta(days=offset)).strftime("%a"),
            "chunks": 0,
            "vectors": 0,
        }
        for offset in range(days)
    }


def _vector_timestamp(metadata: dict[str, Any]) -> Any:
    return (
        metadata.get("indexed_at")
        or metadata.get("embedded_at")
        or metadata.get("created_at")
        or metadata.get("updated_at")
    )


def _build_folder_lookup(db: Session, folder_ids: set[str]) -> dict[str, Folder]:
    if not folder_ids:
        return {}
    folders = db.query(Folder).filter(Folder.id.in_(folder_ids)).all()
    return {folder.id: folder for folder in folders}


def _build_playlist_lookup(db: Session, playlist_ids: set[str]) -> dict[str, Playlist]:
    if not playlist_ids:
        return {}
    playlists = db.query(Playlist).filter(Playlist.id.in_(playlist_ids)).all()
    return {playlist.id: playlist for playlist in playlists}


def _rag_status(resource: Resource, *, chunk_count: int, vector_count: int, search_index_count: int) -> str:
    processing_status = (resource.processing_status or "").strip().lower()
    if processing_status.startswith("failed"):
        return processing_status
    if processing_status in ACTIVE_PIPELINE_STATUSES:
        return processing_status
    if _is_true(resource.is_embedded) and vector_count > 0:
        return "ready"
    if chunk_count > 0 and search_index_count > 0:
        return "prepared"
    if chunk_count > 0:
        return "chunked"
    if (resource.transcript or "").strip():
        return "text_extracted"
    return processing_status or "empty"


def _serialize_rag_resource(
    resource: Resource,
    *,
    chunk_count: int,
    vector_count: int,
    search_index_count: int,
    folder_lookup: dict[str, Folder],
    playlist_lookup: dict[str, Playlist],
) -> dict[str, Any]:
    folder = folder_lookup.get(resource.folder_id)
    playlist = playlist_lookup.get(folder.playlist_id) if folder and folder.playlist_id else None
    transcript = resource.transcript or ""
    summary = resource.summary or ""
    try:
        existing_history = json.loads(resource.health_history) if resource.health_history else []
    except (json.JSONDecodeError, TypeError):
        existing_history = []
    diagnostics = _calculate_diagnostics(
        resource,
        chunk_count=chunk_count,
        vector_count=vector_count,
        search_index_count=search_index_count,
        existing_health_history=existing_history,
    )
    resource.health_history = json.dumps(diagnostics["health_history"])

    return {
        "id": resource.id,
        "title": resource.title,
        "type": resource.type,
        "folder_id": resource.folder_id,
        "folder_name": folder.name if folder else None,
        "playlist_id": folder.playlist_id if folder else None,
        "playlist_name": playlist.name if playlist else None,
        "processing_status": resource.processing_status,
        "rag_status": _rag_status(
            resource,
            chunk_count=chunk_count,
            vector_count=vector_count,
            search_index_count=search_index_count,
        ),
        "is_embedded": _is_true(resource.is_embedded),
        "chunk_count": chunk_count,
        "vector_count": vector_count,
        "search_index_count": search_index_count,
        "transcript_chars": len(transcript),
        "summary_chars": len(summary),
        "has_transcript": bool(transcript.strip()),
        "has_summary": bool(summary.strip()),
        "created_at": resource.created_at.isoformat() if resource.created_at else None,
        "diagnostics": diagnostics,
    }


def get_rag_library_overview(
    db: Session,
    *,
    user_id: str,
    storage_root: str | None,
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
) -> dict[str, Any]:
    resources = (
        _base_resource_query(
            db,
            user_id=user_id,
            storage_root=storage_root,
            playlist_id=playlist_id,
            folder_id=folder_id,
            q=q,
            embedded_only=embedded_only,
            resource_type=resource_type,
            processing_status=processing_status,
        )
        .all()
    )

    resource_ids = [resource.id for resource in resources]
    vector_records = _fetch_vector_records_for_resources(
        storage_root=storage_root,
        user_id=user_id,
        resource_ids=set(resource_ids),
    )
    chunk_counts = _fetch_chunk_counts(db, resource_ids)
    search_index_counts = _fetch_search_index_counts(db, resource_ids)
    folder_lookup = _build_folder_lookup(db, {resource.folder_id for resource in resources if resource.folder_id})
    playlist_lookup = _build_playlist_lookup(
        db,
        {folder.playlist_id for folder in folder_lookup.values() if folder.playlist_id},
    )

    items = [
        _serialize_rag_resource(
            resource,
            chunk_count=chunk_counts.get(resource.id, 0),
            vector_count=len(vector_records.get(resource.id, [])),
            search_index_count=search_index_counts.get(resource.id, 0),
            folder_lookup=folder_lookup,
            playlist_lookup=playlist_lookup,
        )
        for resource in resources
    ]

    try:
        db.commit()
    except Exception:
        db.rollback()

    sort_by = sort_by if sort_by in OVERVIEW_SORT_FIELDS else "created_at"
    reverse = str(sort_order or "desc").lower() != "asc"
    items.sort(key=lambda item: _sort_value(item, sort_by), reverse=reverse)
    paged_items, total_resources = _paginate(
        items,
        page=max(1, page),
        page_size=max(1, min(page_size, 100)),
    )

    status_counts: dict[str, int] = defaultdict(int)
    embedded_count = 0
    retrieval_ready_count = 0
    healthy_count = 0
    failed_count = 0
    chunk_total = 0
    vector_total = 0
    transcript_total_chars = 0
    for item in items:
        status_counts[item["rag_status"]] += 1
        embedded_count += 1 if item["is_embedded"] else 0
        retrieval_ready_count += 1 if item["diagnostics"]["ready_for_retrieval"] else 0
        healthy_count += 1 if item["diagnostics"]["healthy"] else 0
        failed_count += 1 if item["diagnostics"]["failed_stage"] else 0
        chunk_total += item["chunk_count"]
        vector_total += item["vector_count"]
        transcript_total_chars += item["transcript_chars"]

    return {
        "stats": {
            "resources": total_resources,
            "embedded_resources": embedded_count,
            "retrieval_ready_resources": retrieval_ready_count,
            "healthy_resources": healthy_count,
            "failed_resources": failed_count,
            "chunks": chunk_total,
            "vectors": vector_total,
            "transcript_chars": transcript_total_chars,
            "status_counts": dict(status_counts),
        },
        "pagination": {
            "page": max(1, page),
            "page_size": max(1, min(page_size, 100)),
            "total": total_resources,
            "total_pages": max(1, (total_resources + max(1, min(page_size, 100)) - 1) // max(1, min(page_size, 100))),
        },
        "sort": {
            "sort_by": sort_by,
            "sort_order": "desc" if reverse else "asc",
        },
        "filters": {
            "playlist_id": playlist_id,
            "folder_id": folder_id,
            "q": q,
            "embedded_only": embedded_only,
            "resource_type": resource_type,
            "processing_status": processing_status,
        },
        "resources": paged_items,
    }


def get_rag_library_volume(
    db: Session,
    *,
    user_id: str,
    storage_root: str | None,
    days: int = 7,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    q: str | None = None,
    embedded_only: bool | None = None,
    resource_type: str | None = None,
    processing_status: str | None = None,
) -> dict[str, Any]:
    days = max(1, min(days, 31))
    buckets = _volume_buckets(days)
    bucket_keys = set(buckets.keys())

    resources = (
        _base_resource_query(
            db,
            user_id=user_id,
            storage_root=storage_root,
            playlist_id=playlist_id,
            folder_id=folder_id,
            q=q,
            embedded_only=embedded_only,
            resource_type=resource_type,
            processing_status=processing_status,
        )
        .all()
    )
    resource_ids = [resource.id for resource in resources]
    resource_created_at = {resource.id: resource.created_at for resource in resources}

    chunk_created_at: dict[tuple[str, int], Any] = {}
    if resource_ids:
        chunk_rows = (
            db.query(ChunkIndex.resource_id, ChunkIndex.chunk_index, ChunkIndex.created_at)
            .filter(ChunkIndex.resource_id.in_(resource_ids))
            .all()
        )
        for resource_id, chunk_index, created_at in chunk_rows:
            try:
                normalized_index = int(chunk_index)
            except (TypeError, ValueError):
                normalized_index = -1
            chunk_created_at[(resource_id, normalized_index)] = created_at
            key = _to_date_key(created_at)
            if key in bucket_keys:
                buckets[key]["chunks"] += 1

    vector_records = _fetch_vector_records_for_resources(
        storage_root=storage_root,
        user_id=user_id,
        resource_ids=set(resource_ids),
    )
    for resource_id, records in vector_records.items():
        for record in records:
            metadata = dict(record.get("metadata") or {})
            try:
                chunk_index = int(record.get("chunk_index", metadata.get("chunk_index", -1)))
            except (TypeError, ValueError):
                chunk_index = -1
            vector_time = (
                _vector_timestamp(metadata)
                or chunk_created_at.get((resource_id, chunk_index))
                or resource_created_at.get(resource_id)
            )
            key = _to_date_key(vector_time)
            if key in bucket_keys:
                buckets[key]["vectors"] += 1

    data = [buckets[key] for key in sorted(buckets)]
    return {
        "days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
        "totals": {
            "chunks": sum(item["chunks"] for item in data),
            "vectors": sum(item["vectors"] for item in data),
        },
    }


def get_rag_resource_detail(
    db: Session,
    *,
    resource: Resource,
    storage_root: str | None,
) -> dict[str, Any]:
    vector_records = _fetch_vector_records_for_resources(
        storage_root=storage_root,
        user_id=resource.user_id,
        resource_ids={resource.id},
    )
    chunk_rows = (
        db.query(ChunkIndex)
        .filter(ChunkIndex.resource_id == resource.id)
        .order_by(ChunkIndex.chunk_index.asc())
        .all()
    )
    chunk_count = len(chunk_rows)
    search_index_rows = (
        db.query(SearchIndex)
        .filter(SearchIndex.source_type == "resource", SearchIndex.source_id == resource.id)
        .order_by(SearchIndex.created_at.desc())
        .all()
    )
    folder_lookup = _build_folder_lookup(db, {resource.folder_id} if resource.folder_id else set())
    playlist_lookup = _build_playlist_lookup(
        db,
        {folder.playlist_id for folder in folder_lookup.values() if folder.playlist_id},
    )

    overview = _serialize_rag_resource(
        resource,
        chunk_count=chunk_count,
        vector_count=len(vector_records.get(resource.id, [])),
        search_index_count=len(search_index_rows),
        folder_lookup=folder_lookup,
        playlist_lookup=playlist_lookup,
    )

    transcript = resource.transcript or ""
    summary = resource.summary or ""
    search_index_content = search_index_rows[0].content if search_index_rows else ""
    vectors = vector_records.get(resource.id, [])
    vector_indices = {int(item.get("chunk_index", -1)) for item in vectors if int(item.get("chunk_index", -1)) >= 0}
    chunk_indices = {int(row.chunk_index) for row in chunk_rows}

    return {
        "resource": overview,
        "source_material": {
            "transcript": transcript,
            "summary": summary,
            "transcript_chars": len(transcript),
            "summary_chars": len(summary),
            "search_index_content": search_index_content,
        },
        "artifacts": {
            "chunks": chunk_count,
            "vectors": len(vectors),
            "search_index_entries": len(search_index_rows),
            "has_search_index": bool(search_index_rows),
            "chunk_indices_without_vectors": sorted(chunk_indices - vector_indices),
            "vector_indices_without_chunks": sorted(vector_indices - chunk_indices),
        },
    }


def get_rag_resource_chunks(
    db: Session,
    *,
    resource: Resource,
    storage_root: str | None,
) -> list[dict[str, Any]]:
    vector_records = _fetch_vector_records_for_resources(
        storage_root=storage_root,
        user_id=resource.user_id,
        resource_ids={resource.id},
    ).get(resource.id, [])
    vectors_by_index = {
        int(record.get("chunk_index", -1)): record for record in vector_records if int(record.get("chunk_index", -1)) >= 0
    }

    chunk_rows = (
        db.query(ChunkIndex)
        .filter(ChunkIndex.resource_id == resource.id)
        .order_by(ChunkIndex.chunk_index.asc())
        .all()
    )

    chunks: list[dict[str, Any]] = []
    seen_indices: set[int] = set()
    for row in chunk_rows:
        chunk_index = int(row.chunk_index)
        seen_indices.add(chunk_index)
        vector_record = vectors_by_index.get(chunk_index)
        metadata = dict((vector_record or {}).get("metadata") or {})
        chunks.append(
            {
                "chunk_index": chunk_index,
                "content": row.content,
                "has_vector": vector_record is not None,
                "vector_id": (vector_record or {}).get("id"),
                "metadata": metadata,
                "start_time": metadata.get("start_time"),
                "end_time": metadata.get("end_time"),
                "page_number": metadata.get("page_number"),
                "section_title": metadata.get("section_title") or metadata.get("section_heading"),
                "chapter_title": metadata.get("chapter_title"),
                "subchapter_title": metadata.get("subchapter_title"),
            }
        )

    for chunk_index, vector_record in sorted(vectors_by_index.items()):
        if chunk_index in seen_indices:
            continue
        metadata = dict(vector_record.get("metadata") or {})
        chunks.append(
            {
                "chunk_index": chunk_index,
                "content": vector_record.get("content", ""),
                "has_vector": True,
                "vector_id": vector_record.get("id"),
                "metadata": metadata,
                "start_time": metadata.get("start_time"),
                "end_time": metadata.get("end_time"),
                "page_number": metadata.get("page_number"),
                "section_title": metadata.get("section_title") or metadata.get("section_heading"),
                "chapter_title": metadata.get("chapter_title"),
                "subchapter_title": metadata.get("subchapter_title"),
            }
        )

    chunks.sort(key=lambda item: item["chunk_index"])
    return chunks


def get_rag_retrieval_preview(
    db: Session,
    *,
    resource: Resource,
    storage_root: str | None,
    query: str,
    top_k: int = 5,
) -> dict[str, Any]:
    from services.bm25_service import search_resource_bm25
    from services.hybrid_service import search_resource_hybrid
    from services.reranker_service import rerank_results
    from services.retrieval_service import search_resource

    vector = search_resource(
        resource.id,
        query,
        user_id=resource.user_id,
        n_results=max(top_k, 10),
        storage_root=storage_root,
    )
    vector_results = []
    for content, metadata, distance in zip(
        vector.get("documents", []),
        vector.get("metadatas", []),
        vector.get("distances", []),
    ):
        vector_results.append(
            {
                "chunk_index": metadata.get("chunk_index"),
                "content": content,
                "metadata": metadata,
                "distance": distance,
            }
        )

    bm25_results = search_resource_bm25(resource.id, query, top_k=max(top_k, 10))
    hybrid_results = search_resource_hybrid(
        resource.id,
        query,
        user_id=resource.user_id,
        top_k=max(top_k, 10),
        storage_root=storage_root,
    )
    reranked_results = rerank_results(query, [dict(item) for item in hybrid_results], top_k=top_k, user_id=resource.user_id)

    return {
        "query": query,
        "resource_id": resource.id,
        "vector": vector_results[:top_k],
        "bm25": bm25_results[:top_k],
        "hybrid": hybrid_results[:top_k],
        "reranked": reranked_results[:top_k],
    }


def get_rag_library_retrieval_preview(
    db: Session,
    *,
    user_id: str,
    storage_root: str | None,
    query: str,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    from embedding_service import search_all_resources
    from services.bm25_service import search_global_bm25
    from services.reranker_service import rerank_results

    resources = (
        _base_resource_query(
            db,
            user_id=user_id,
            storage_root=storage_root,
            playlist_id=playlist_id,
            folder_id=folder_id,
        )
        .all()
    )
    resource_ids = [resource.id for resource in resources]
    resource_map = {resource.id: resource for resource in resources}

    vector = search_all_resources(
        query,
        user_id=user_id,
        n_results=max(top_k, 10),
        selected_resource_ids=resource_ids or None,
        storage_root=storage_root,
    )
    bm25 = search_global_bm25(resource_ids, query, top_k=max(top_k, 10))

    vector_results: list[dict[str, Any]] = []
    for document, metadata, distance in zip(
        vector.get("documents", []),
        vector.get("metadatas", []),
        vector.get("distances", []),
    ):
        resource_id = metadata.get("resource_id")
        resource = resource_map.get(resource_id)
        vector_results.append(
            {
                "resource_id": resource_id,
                "resource_title": resource.title if resource else None,
                "chunk_index": metadata.get("chunk_index"),
                "content": document,
                "metadata": metadata,
                "distance": distance,
            }
        )

    bm25_results: list[dict[str, Any]] = []
    for item in bm25:
        resource = resource_map.get(item.get("resource_id"))
        bm25_results.append(
            {
                **item,
                "resource_title": resource.title if resource else None,
            }
        )

    merged: dict[tuple[str, Any], dict[str, Any]] = {}
    for rank, item in enumerate(vector_results):
        key = (str(item.get("resource_id") or ""), item.get("chunk_index"))
        merged[key] = {
            "resource_id": item.get("resource_id"),
            "resource_title": item.get("resource_title"),
            "chunk_index": item.get("chunk_index"),
            "content": item.get("content"),
            "metadata": item.get("metadata") or {},
            "vector_distance": item.get("distance"),
            "bm25_score": 0.0,
            "hybrid_score": 1.0 / (60 + rank),
        }
    for rank, item in enumerate(bm25_results):
        key = (str(item.get("resource_id") or ""), item.get("chunk_index"))
        if key not in merged:
            merged[key] = {
                "resource_id": item.get("resource_id"),
                "resource_title": item.get("resource_title"),
                "chunk_index": item.get("chunk_index"),
                "content": item.get("content"),
                "metadata": {"resource_id": item.get("resource_id"), "chunk_index": item.get("chunk_index")},
                "vector_distance": None,
                "bm25_score": float(item.get("score") or 0.0),
                "hybrid_score": 0.0,
            }
        else:
            merged[key]["bm25_score"] = float(item.get("score") or 0.0)
        merged[key]["hybrid_score"] += 1.0 / (60 + rank)

    hybrid_results = sorted(merged.values(), key=lambda item: item["hybrid_score"], reverse=True)
    reranked_results = rerank_results(query, [dict(item) for item in hybrid_results[: max(top_k, 10)]], top_k=top_k, user_id=user_id)

    return {
        "query": query,
        "resource_scope_size": len(resource_ids),
        "vector": vector_results[:top_k],
        "bm25": bm25_results[:top_k],
        "hybrid": hybrid_results[:top_k],
        "reranked": reranked_results[:top_k],
    }


def search_rag_library(
    db: Session,
    *,
    user_id: str,
    storage_root: str | None,
    query: str,
    playlist_id: str | None = None,
    folder_id: str | None = None,
    limit: int = 20,
) -> dict[str, Any]:
    resources = (
        _base_resource_query(
            db,
            user_id=user_id,
            storage_root=storage_root,
            playlist_id=playlist_id,
            folder_id=folder_id,
        )
        .all()
    )
    resource_ids = [resource.id for resource in resources]
    resource_map = {resource.id: resource for resource in resources}

    search_index_hits = (
        db.query(SearchIndex)
        .filter(
            SearchIndex.source_type == "resource",
            SearchIndex.source_id.in_(resource_ids) if resource_ids else False,
            SearchIndex.content.ilike(f"%{query}%"),
        )
        .limit(limit)
        .all()
    )
    chunk_hits = (
        db.query(ChunkIndex)
        .filter(
            ChunkIndex.resource_id.in_(resource_ids) if resource_ids else False,
            ChunkIndex.content.ilike(f"%{query}%"),
        )
        .order_by(ChunkIndex.resource_id.asc(), ChunkIndex.chunk_index.asc())
        .limit(limit)
        .all()
    )

    chunk_samples_by_resource: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for chunk in chunk_hits:
        chunk_samples_by_resource[chunk.resource_id].append(
            {
                "chunk_index": chunk.chunk_index,
                "content": chunk.content[:400],
            }
        )

    results = []
    seen_resource_ids: set[str] = set()
    for hit in search_index_hits:
        resource = resource_map.get(hit.source_id)
        if not resource or resource.id in seen_resource_ids:
            continue
        seen_resource_ids.add(resource.id)
        results.append(
            {
                "resource_id": resource.id,
                "title": resource.title,
                "type": resource.type,
                "processing_status": resource.processing_status,
                "is_embedded": _is_true(resource.is_embedded),
                "folder_id": resource.folder_id,
                "search_index_excerpt": hit.content[:500],
                "chunk_samples": chunk_samples_by_resource.get(resource.id, []),
            }
        )

    for resource_id, samples in chunk_samples_by_resource.items():
        if resource_id in seen_resource_ids:
            continue
        resource = resource_map.get(resource_id)
        if not resource:
            continue
        seen_resource_ids.add(resource_id)
        results.append(
            {
                "resource_id": resource.id,
                "title": resource.title,
                "type": resource.type,
                "processing_status": resource.processing_status,
                "is_embedded": _is_true(resource.is_embedded),
                "folder_id": resource.folder_id,
                "search_index_excerpt": "",
                "chunk_samples": samples,
            }
        )

    return {
        "query": query,
        "results": results[:limit],
    }
