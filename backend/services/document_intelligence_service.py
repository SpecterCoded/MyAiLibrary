from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime
from typing import Any
from uuid import uuid4

from core.logger import get_logger
from core.metrics import _append_structured_event
from database import SessionLocal
from embedding_service import resolve_storage_root_for_resource, search_all_resources
from models import DocumentInsight, Resource
from services.ai_cost_service import record_chat_completion_usage
from services.llm_service import get_user_chat_client, parse_json_robustly

logger = get_logger("DOCUMENT_INTELLIGENCE")

ENABLE_DOCUMENT_INTELLIGENCE = os.getenv("ENABLE_DOCUMENT_INTELLIGENCE", "1").lower() in ("1", "true", "yes")
ENABLE_RELATED_DOCUMENTS = os.getenv("ENABLE_RELATED_DOCUMENTS", "1").lower() in ("1", "true", "yes")
ENABLE_SUGGESTED_QUESTIONS = os.getenv("ENABLE_SUGGESTED_QUESTIONS", "1").lower() in ("1", "true", "yes")
ENABLE_AI_SUMMARIES = os.getenv("ENABLE_AI_SUMMARIES", "1").lower() in ("1", "true", "yes")
DOCUMENT_INTELLIGENCE_MAX_CHARS = int(os.getenv("DOCUMENT_INTELLIGENCE_MAX_CHARS", "16000"))
SIMILAR_DOCUMENT_LIMIT = int(os.getenv("SIMILAR_DOCUMENT_LIMIT", "5"))

DOCUMENT_TYPES = {"pdf", "docx", "image", "text"}


def is_document_resource(resource_type: str | None) -> bool:
    return str(resource_type or "").lower() in DOCUMENT_TYPES


def should_enable_document_intelligence(resource: Resource | None) -> bool:
    return bool(resource and ENABLE_DOCUMENT_INTELLIGENCE and is_document_resource(resource.type))


def build_document_analysis_hash(resource: Resource) -> str:
    raw = "\n".join(
        [
            str(resource.title or ""),
            str(resource.description or ""),
            str(resource.summary or ""),
            str(resource.transcript or ""),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def get_or_create_document_insight(db, resource_id: str) -> DocumentInsight:
    insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource_id).first()
    if insight:
        return insight
    insight = DocumentInsight(
        id=str(uuid4()),
        resource_id=resource_id,
        status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(insight)
    db.commit()
    db.refresh(insight)
    return insight


def serialize_document_insight(insight: DocumentInsight | None) -> dict[str, Any] | None:
    if not insight:
        return None

    def _loads(value: str | None, default):
        if not value:
            return default
        try:
            return json.loads(value)
        except Exception:
            return default

    return {
        "resource_id": insight.resource_id,
        "status": insight.status,
        "short_summary": insight.short_summary,
        "detailed_summary": insight.detailed_summary,
        "topics": _loads(insight.topics, []),
        "keywords": _loads(insight.keywords, []),
        "key_concepts": _loads(insight.key_concepts, []),
        "named_entities": _loads(insight.named_entities, {}),
        "difficulty_level": insight.difficulty_level,
        "estimated_reading_minutes": insight.estimated_reading_minutes,
        "document_language": insight.document_language,
        "document_type": insight.document_type,
        "suggested_questions": _loads(insight.suggested_questions, []),
        "related_documents": _loads(insight.related_documents, []),
        "ai_tags": _loads(insight.ai_tags, []),
        "analysis_duration_ms": insight.analysis_duration_ms,
        "llm_usage": _loads(insight.llm_usage, {}),
        "token_usage": _loads(insight.token_usage, {}),
        "estimated_cost": insight.estimated_cost,
        "retry_count": insight.retry_count or 0,
        "error_message": insight.error_message,
        "updated_at": insight.updated_at.isoformat() if insight.updated_at else None,
    }


def _truncate_source_text(resource: Resource) -> str:
    pieces = [f"Title: {resource.title or ''}", f"Description: {resource.description or ''}"]
    if ENABLE_AI_SUMMARIES and resource.summary:
        pieces.append(f"Existing summary: {resource.summary}")
    if resource.transcript:
        pieces.append(resource.transcript)
    return "\n\n".join(piece for piece in pieces if piece and piece.strip())[:DOCUMENT_INTELLIGENCE_MAX_CHARS]


def _estimate_tokens(text: str) -> int:
    return max(1, len((text or "").split()) * 4 // 3)


def _guess_document_type(resource: Resource, source_text: str) -> str:
    title = (resource.title or "").lower()
    text = (source_text or "").lower()
    if "manual" in title or "installation" in text or "step 1" in text:
        return "manual"
    if "abstract" in text and "references" in text:
        return "paper"
    if "chapter" in text and "page" in text:
        return "book"
    if "meeting" in title or "transcript" in title:
        return "transcript"
    if resource.type == "docx":
        return "notes"
    return "article"


def _fallback_analysis(resource: Resource, source_text: str) -> dict[str, Any]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_+-]{2,}", source_text or "")
    frequencies: dict[str, int] = {}
    for word in words:
        key = word.lower()
        frequencies[key] = frequencies.get(key, 0) + 1
    top_terms = [term for term, _count in sorted(frequencies.items(), key=lambda item: (-item[1], item[0]))[:8]]
    title = resource.title or "Document"
    summary = " ".join((source_text or "").split())[:320]
    return {
        "short_summary": f"{title} covers {', '.join(top_terms[:3])}." if top_terms else title,
        "detailed_summary": summary or title,
        "topics": top_terms[:5],
        "keywords": top_terms[:8],
        "key_concepts": top_terms[:6],
        "named_entities": {
            "people": [],
            "organizations": [],
            "locations": [],
            "technologies": top_terms[:4],
            "datasets": [],
            "libraries": [],
            "models": [],
        },
        "difficulty_level": "Intermediate",
        "estimated_reading_minutes": max(1, round(len((source_text or "").split()) / 220)),
        "document_language": "English",
        "document_type": _guess_document_type(resource, source_text),
        "suggested_questions": [
            f"What are the key ideas in {title}?",
            f"What should I understand first in {title}?",
            f"What concepts matter most in {title}?",
        ],
        "ai_tags": top_terms[:6],
    }


def _generate_document_analysis(resource: Resource, source_text: str) -> tuple[dict[str, Any], dict[str, Any]]:
    fallback = _fallback_analysis(resource, source_text)
    prompt = f"""
Analyze the following document and return exactly one JSON object.

Rules:
- No markdown or prose outside JSON
- Keep summaries factual and grounded
- named_entities must be an object with keys: people, organizations, locations, technologies, datasets, libraries, models
- difficulty_level must be Beginner, Intermediate, or Advanced
- document_type should be one short label such as book, article, paper, manual, notes, transcript

Required JSON fields:
short_summary, detailed_summary, topics, keywords, key_concepts,
named_entities, difficulty_level, estimated_reading_minutes,
document_language, document_type, suggested_questions, ai_tags

Document:
{source_text}
"""
    try:
        _client, _model = get_user_chat_client(resource.user_id)
        response = _client.chat.completions.create(
            model=_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "You analyze documents and return strict JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
        )
        content = response.choices[0].message.content
        try:
            record_chat_completion_usage(
                response=response,
                user_id=resource.user_id,
                resource_id=resource.id,
                feature="document_intelligence",
                operation="content_generation",
                model=_model,
                prompt_text=prompt,
                completion_text=content,
                metadata={"resource_type": resource.type},
            )
        except Exception:
            pass
        data = parse_json_robustly(content)
        usage = getattr(response, "usage", None)
        prompt_tokens = getattr(usage, "prompt_tokens", 0)
        completion_tokens = getattr(usage, "completion_tokens", 0)
        total_tokens = getattr(usage, "total_tokens", 0)
        return data, {
            "model": _model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "provider_cost_usd": getattr(getattr(response, "usage", None), "cost", None),
            "used_fallback": False,
        }
    except Exception as exc:
        logger.warning(f"Document intelligence LLM failed for {resource.id}: {exc}")
        return fallback, {
            "model": "fallback",
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "used_fallback": True,
        }


def _merge_related_documents(db, resource: Resource, analysis: dict[str, Any]) -> list[dict[str, Any]]:
    if not ENABLE_RELATED_DOCUMENTS:
        return []
    query = " ".join(
        part for part in [
            analysis.get("short_summary") or "",
            " ".join(analysis.get("topics") or []),
            " ".join(analysis.get("keywords") or []),
            " ".join(analysis.get("key_concepts") or []),
        ] if part
    ).strip()
    if not query:
        return []

    storage_root = resolve_storage_root_for_resource(db, resource.id)
    raw = search_all_resources(query, resource.user_id, n_results=20, storage_root=storage_root)
    by_resource: dict[str, float] = {}
    for metadata, distance in zip(raw.get("metadatas", []), raw.get("distances", [])):
        related_id = str((metadata or {}).get("resource_id") or "")
        if not related_id or related_id == resource.id:
            continue
        similarity = round(max(0.0, 1.0 - float(distance or 0.0) / 2.0), 4)
        if similarity > by_resource.get(related_id, -1):
            by_resource[related_id] = similarity
    if not by_resource:
        return []

    related_resources = db.query(Resource).filter(Resource.id.in_(list(by_resource.keys())), Resource.is_deleted == 0).all()
    related_insights = {
        item.resource_id: item
        for item in db.query(DocumentInsight).filter(DocumentInsight.resource_id.in_(list(by_resource.keys()))).all()
    }
    this_topics = set(str(item).strip().lower() for item in (analysis.get("topics") or []) if str(item).strip())
    this_keywords = set(str(item).strip().lower() for item in (analysis.get("keywords") or []) if str(item).strip())

    output = []
    for related in related_resources:
        insight = related_insights.get(related.id)
        rel_topics: set[str] = set()
        rel_keywords: set[str] = set()
        if insight:
            try:
                rel_topics = set(str(item).strip().lower() for item in json.loads(insight.topics or "[]"))
                rel_keywords = set(str(item).strip().lower() for item in json.loads(insight.keywords or "[]"))
            except Exception:
                pass
        shared = sorted({item for item in (this_topics & rel_topics) | (this_keywords & rel_keywords) if item})[:6]
        output.append(
            {
                "resource_id": related.id,
                "title": related.title,
                "type": related.type,
                "similarity_score": by_resource.get(related.id, 0.0),
                "shared_topics": shared[:3],
                "shared_keywords": shared[3:] if len(shared) > 3 else shared[:3],
            }
        )
    output.sort(key=lambda item: item["similarity_score"], reverse=True)
    return output[:SIMILAR_DOCUMENT_LIMIT]


def run_document_intelligence(resource_id: str) -> str:
    db = SessionLocal()
    started = time.perf_counter()
    try:
        resource = db.query(Resource).filter(Resource.id == resource_id, Resource.is_deleted == 0).first()
        if not resource or not should_enable_document_intelligence(resource):
            return "skipped"

        insight = get_or_create_document_insight(db, resource.id)
        content_hash = build_document_analysis_hash(resource)
        if insight.status == "completed" and insight.content_hash == content_hash:
            return "cached"

        insight.status = "processing"
        insight.error_message = None
        insight.updated_at = datetime.utcnow()
        db.commit()

        source_text = _truncate_source_text(resource)
        if not source_text.strip():
            insight.status = "failed"
            insight.error_message = "No document text available for analysis."
            insight.updated_at = datetime.utcnow()
            db.commit()
            return "failed"

        analysis, usage = _generate_document_analysis(resource, source_text)
        related_documents = _merge_related_documents(db, resource, analysis)

        insight.content_hash = content_hash
        insight.short_summary = analysis.get("short_summary")
        insight.detailed_summary = analysis.get("detailed_summary")
        insight.topics = json.dumps(analysis.get("topics") or [])
        insight.keywords = json.dumps(analysis.get("keywords") or [])
        insight.key_concepts = json.dumps(analysis.get("key_concepts") or [])
        insight.named_entities = json.dumps(analysis.get("named_entities") or {})
        insight.difficulty_level = analysis.get("difficulty_level")
        insight.estimated_reading_minutes = int(analysis.get("estimated_reading_minutes") or max(1, round(len(source_text.split()) / 220)))
        insight.document_language = analysis.get("document_language")
        insight.document_type = analysis.get("document_type")
        insight.suggested_questions = json.dumps((analysis.get("suggested_questions") or []) if ENABLE_SUGGESTED_QUESTIONS else [])
        insight.related_documents = json.dumps(related_documents)
        insight.ai_tags = json.dumps(analysis.get("ai_tags") or [])
        insight.analysis_duration_ms = round((time.perf_counter() - started) * 1000, 1)
        insight.llm_usage = json.dumps({"model": usage.get("model"), "used_fallback": usage.get("used_fallback", False)})
        insight.token_usage = json.dumps(
            {
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0),
                "total_tokens": usage.get("total_tokens", 0),
            }
        )
        insight.estimated_cost = usage.get("provider_cost_usd")
        insight.status = "completed"
        insight.updated_at = datetime.utcnow()
        db.commit()

        _append_structured_event(
            {
                "type": "document_intelligence",
                "resource_id": resource.id,
                "user_id": resource.user_id or "",
                "status": "completed",
                "analysis_duration_ms": insight.analysis_duration_ms,
                "token_usage": json.loads(insight.token_usage or "{}"),
                "estimated_cost": insight.estimated_cost,
                "retry_count": insight.retry_count or 0,
                "related_documents": len(related_documents),
            }
        )
        return "completed"
    except Exception as exc:
        logger.error(f"Document intelligence failed for {resource_id}: {exc}")
        insight = db.query(DocumentInsight).filter(DocumentInsight.resource_id == resource_id).first()
        if insight:
            insight.status = "failed"
            insight.retry_count = int(insight.retry_count or 0) + 1
            insight.error_message = str(exc)
            insight.analysis_duration_ms = round((time.perf_counter() - started) * 1000, 1)
            insight.updated_at = datetime.utcnow()
            db.commit()
        _append_structured_event(
            {
                "type": "document_intelligence",
                "resource_id": resource_id,
                "status": "failed",
                "error": str(exc)[:300],
            }
        )
        return "failed"
    finally:
        db.close()
