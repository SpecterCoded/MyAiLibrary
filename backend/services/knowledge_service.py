"""Global, versioned knowledge extraction and graph services."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from glob import glob
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from typing import Any
from uuid import uuid4

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from database import SessionLocal
from core.paths import EXTRA_FILES_DIR
from models import (
    AliasCandidate,
    Chapter,
    Concept,
    ConceptAlias,
    ConceptAnalytics,
    ConceptCoverage,
    ConceptSuppression,
    ConceptMention,
    ConceptRecommendation,
    ConceptRelationship,
    EntityIdentity,
    Folder,
    KnowledgeRun,
    KnowledgeSourceSection,
    ProcessingJob,
    RelationshipEvidence,
    RelationshipReviewCandidate,
    Resource,
    ResourceKnowledgeProfile,
    ResourceKnowledgeState,
    StudyEvent,
    SubChapter,
    UserSetting,
)

RELATIONSHIP_TYPES = {
    "depends_on", "uses", "requires", "compares_with", "causes",
    "extends", "implements", "belongs_to", "prerequisite_of",
}
OCCURRENCE_ROLES = {
    "introduced", "explained", "revisited", "example", "common_mistake",
    "advanced_discussion",
}
AUTO_MERGE_THRESHOLD = 0.92
REVIEW_THRESHOLD = 0.75
RELATIONSHIP_THRESHOLD = 0.85
MIN_GROUNDING_CONFIDENCE = 0.80
CONCEPT_ADMISSION_THRESHOLD = 0.72
STRICT_RULE_VERSION = "strict-timed-v1"
MIN_EVIDENCE_WORDS = 5
MIN_RECURRING_DURATION_SECONDS = 30.0
MIN_SINGLE_TOPIC_DURATION_SECONDS = 45.0
MIN_MEANINGFUL_OCCURRENCES = 2
SEMANTIC_WINDOW_MERGE_GAP_SECONDS = 20.0
RELATIONSHIP_REVIEW_THRESHOLD = 0.70
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_KNOWLEDGE_VIEW_PREFERENCES: dict[str, Any] = {
    "node_distance": 140,
    "graph_layout": "organic",
    "explorer_group": "none",
    "filters": {
        "difficulty": [],
        "types": [],
        "favorites_only": False,
    },
}


ICT_CANONICAL_ALIASES = {
    "fvg": "Fair Value Gap",
    "fair value gap": "Fair Value Gap",
    "fair value gaps": "Fair Value Gap",
    "ob": "Order Block",
    "orderblock": "Order Block",
    "order block": "Order Block",
    "order blocks": "Order Block",
    "bos": "Break of Structure",
    "break of structure": "Break of Structure",
    "mss": "Market Structure Shift",
    "market structure shift": "Market Structure Shift",
    "choch": "Change of Character",
    "change of character": "Change of Character",
    "ote": "Optimal Trade Entry",
    "optimal trade entry": "Optimal Trade Entry",
    "pd array": "PD Array",
}

STAGES = (
    ("resource_intelligence", 5),
    ("concept_extraction", 15),
    ("alias_resolution", 24),
    ("entity_resolution", 30),
    ("duplicate_merge", 36),
    ("relationship_extraction", 44),
    ("confidence_engine", 50),
    ("timeline_builder", 56),
    ("learning_order", 62),
    ("difficulty_engine", 68),
    ("frequency_engine", 73),
    ("cross_resource_intelligence", 78),
    ("resource_references", 82),
    ("concept_summaries", 86),
    ("concept_analytics", 90),
    ("recommendation_engine", 94),
    ("global_graph_publish", 98),
    ("complete", 100),
)

_RUN_MEMORY_CACHE: dict[str, dict[str, Any]] = {}
TEMPORARY_FAILURE_CODES = {"service_unreachable", "service_timeout", "rate_limited"}


class KnowledgePipelineError(RuntimeError):
    pass


class KnowledgePipelineControl(RuntimeError):
    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"))


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return default


def _knowledge_view_preferences(settings: UserSetting | None) -> dict[str, Any]:
    stored = _loads(
        getattr(settings, "knowledge_view_preferences", None) if settings else None,
        {},
    )
    if not isinstance(stored, dict):
        stored = {}
    filters = stored.get("filters") if isinstance(stored.get("filters"), dict) else {}
    preferences = {
        **DEFAULT_KNOWLEDGE_VIEW_PREFERENCES,
        **{key: value for key, value in stored.items() if key != "filters"},
        "filters": {
            **DEFAULT_KNOWLEDGE_VIEW_PREFERENCES["filters"],
            **filters,
        },
    }
    preferences["node_distance"] = int(
        getattr(settings, "knowledge_node_distance", None)
        or preferences.get("node_distance")
        or DEFAULT_KNOWLEDGE_VIEW_PREFERENCES["node_distance"]
    )
    preferences["node_distance"] = max(60, min(400, preferences["node_distance"]))
    if preferences.get("graph_layout") not in {"organic", "radial", "learning"}:
        preferences["graph_layout"] = "organic"
    if preferences.get("explorer_group") not in {"none", "favorite", "chapter", "type", "difficulty"}:
        preferences["explorer_group"] = "none"
    preferences["filters"]["difficulty"] = [
        item for item in preferences["filters"].get("difficulty", [])
        if item in {"Beginner", "Intermediate", "Advanced"}
    ]
    preferences["filters"]["types"] = [
        item for item in preferences["filters"].get("types", [])
        if item in {"concept", "definition", "example", "warning", "advanced", "subchapter"}
    ]
    preferences["filters"]["favorites_only"] = bool(preferences["filters"].get("favorites_only"))
    return preferences
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def normalize_term(value: str | None) -> str:
    text = (value or "").strip().lower().replace(".", "")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\b(incorporated|corporation|company|limited|inc|corp|ltd|llc)\b$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.endswith("s") and len(text) > 4 and not text.endswith("ss"):
        text = text[:-1]
    return text


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _load_timed_segments(resource_id: str) -> list[dict[str, Any]]:
    from services.srt_parser import parse_srt

    paths = sorted(glob(os.path.join(str(EXTRA_FILES_DIR), resource_id, "*.srt")))
    segments: list[dict[str, Any]] = []
    seen: set[tuple[float, float, str]] = set()
    for srt_path in paths:
        for raw in parse_srt(srt_path):
            text = str(raw.get("text") or "").strip()
            start = float(raw.get("start") or 0.0)
            end = float(raw.get("end") or start)
            key = (start, end, text)
            if text and end > start and key not in seen:
                seen.add(key)
                segments.append({"start": start, "end": end, "text": text})
    return sorted(segments, key=lambda item: (item["start"], item["end"]))


def _section_transcript(
    start_seconds: float,
    end_seconds: float,
    transcript: str | None,
    timed_segments: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    matches = [
        segment for segment in timed_segments
        if segment["end"] > start_seconds and segment["start"] < end_seconds
    ]
    if matches:
        clipped = [{
            "start": max(start_seconds, segment["start"]),
            "end": min(end_seconds, segment["end"]),
            "text": segment["text"],
        } for segment in matches]
        return " ".join(item["text"] for item in clipped).strip(), clipped
    return "", []


def _source_units(resource: Resource, db: Session) -> list[dict[str, Any]]:
    chapters = db.query(Chapter).filter(
        Chapter.resource_id == resource.id
    ).order_by(Chapter.start_time).all()
    chapter_ids = [chapter.id for chapter in chapters]
    subchapters = (
        db.query(SubChapter).filter(
            SubChapter.chapter_id.in_(chapter_ids)
        ).order_by(SubChapter.start_time).all()
        if chapter_ids else []
    )
    sub_by_chapter: dict[str, list[SubChapter]] = defaultdict(list)
    for subchapter in subchapters:
        sub_by_chapter[subchapter.chapter_id].append(subchapter)

    timed_segments = _load_timed_segments(resource.id)
    units: list[dict[str, Any]] = []
    for chapter in chapters:
        children = sub_by_chapter.get(chapter.id, [])
        sections: list[tuple[str, Any]] = (
            [("subchapter", child) for child in children]
            if children else [("chapter", chapter)]
        )
        for source_type, section in sections:
            start = float(section.start_time or 0.0)
            end = float(section.end_time or 0.0)
            if end <= start:
                continue
            text, segments = _section_transcript(
                start, end, section.transcript, timed_segments
            )
            if not text or not segments:
                continue
            units.append({
                "source_type": source_type,
                "source_id": section.id,
                "chapter_id": chapter.id,
                "subchapter_id": section.id if source_type == "subchapter" else None,
                "title": section.title,
                "text": text,
                "segments": segments,
                "start_seconds": start,
                "end_seconds": end,
            })
    if not units and timed_segments:
        current: list[dict[str, Any]] = []
        window_start = timed_segments[0]["start"]
        for segment in timed_segments:
            if current and segment["end"] - window_start > 300:
                index = len(units)
                units.append({
                    "source_type": "transcript",
                    "source_id": f"{resource.id}:transcript:{index}",
                    "chapter_id": None,
                    "subchapter_id": None,
                    "title": f"{resource.title} transcript {index + 1}",
                    "text": " ".join(item["text"] for item in current),
                    "segments": current,
                    "start_seconds": current[0]["start"],
                    "end_seconds": current[-1]["end"],
                })
                current = []
                window_start = segment["start"]
            current.append(segment)
        if current:
            index = len(units)
            units.append({
                "source_type": "transcript",
                "source_id": f"{resource.id}:transcript:{index}",
                "chapter_id": None,
                "subchapter_id": None,
                "title": f"{resource.title} transcript {index + 1}",
                "text": " ".join(item["text"] for item in current),
                "segments": current,
                "start_seconds": current[0]["start"],
                "end_seconds": current[-1]["end"],
            })
    return units


def _source_fingerprint(resource: Resource, db: Session) -> str:
    units = _source_units(resource, db)
    payload = {
        "resource": [resource.id, resource.title, resource.type],
        "sections": [[
            unit["source_type"], unit["source_id"], unit["chapter_id"],
            unit["subchapter_id"], unit["title"], unit["start_seconds"],
            unit["end_seconds"], unit["segments"],
        ] for unit in units],
        "rule_version": STRICT_RULE_VERSION,
    }
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def has_usable_text(resource: Resource, db: Session | None = None) -> bool:
    if db is None:
        return False
    return bool(_source_units(resource, db))


def get_or_create_knowledge_state(db: Session, resource: Resource) -> ResourceKnowledgeState:
    state = db.query(ResourceKnowledgeState).filter(ResourceKnowledgeState.resource_id == resource.id).first()
    if not state:
        state = ResourceKnowledgeState(
            resource_id=resource.id,
            user_id=resource.user_id,
            status="not_generated",
            stale_reasons="[]",
            updated_at=datetime.utcnow(),
        )
        db.add(state)
        db.flush()
    return state


def serialize_knowledge_state(db: Session, resource: Resource) -> dict[str, Any]:
    state = get_or_create_knowledge_state(db, resource)
    published_concepts = (
        db.query(ConceptMention.concept_id)
        .filter(ConceptMention.run_id == state.active_run_id)
        .distinct()
        .count()
        if state.active_run_id else 0
    )
    job = (
        db.query(ProcessingJob)
        .filter(
            ProcessingJob.resource_id == resource.id,
            ProcessingJob.job_type == "knowledge_generation",
        )
        .order_by(ProcessingJob.created_at.desc())
        .first()
    )
    return {
        "status": (
            "ready_empty"
            if state.active_run_id and published_concepts == 0
            and state.status == "ready"
            else (state.status or "not_generated")
        ),
        "outcome": (
            "no_qualifying_concepts"
            if state.active_run_id and published_concepts == 0
            else ("published" if state.active_run_id else "not_generated")
        ),
        "published_concepts": published_concepts,
        "eligible": has_usable_text(resource, db),
        "active_version": state.active_version,
        "active_run_id": state.active_run_id,
        "generated_at": state.generated_at.isoformat() if state.generated_at else None,
        "stale_reasons": _loads(state.stale_reasons, []),
        "job_id": job.id if job else None,
        "job_status": job.status if job else None,
        "current_stage": getattr(job, "current_stage", None) if job else None,
        "progress": getattr(job, "progress", 0) if job else 0,
        "retryable": bool(getattr(job, "retryable", 1)) if job else False,
        "error_message": job.error_message if job else None,
        "next_retry_at": (job.next_retry_at.isoformat() if job and job.next_retry_at else None),
        "retry_schedule_step": (job.retry_schedule_step or 0) if job else 0,
        "last_error_code": job.last_error_code if job else None,
    }


def mark_knowledge_stale(db: Session, resource_id: str, reason: str, commit: bool = True) -> None:
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        return
    state = get_or_create_knowledge_state(db, resource)
    if state.active_run_id:
        reasons = _loads(state.stale_reasons, [])
        if reason not in reasons:
            reasons.append(reason)
        state.stale_reasons = _json(reasons)
        state.status = "stale"
        state.updated_at = datetime.utcnow()
        if commit:
            db.commit()



def get_knowledge_model_configuration(db: Session, user_id: str) -> tuple[str, str, str]:
    from services.dependency_failure_service import missing_configuration

    settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
    base_url = (getattr(settings, "knowledge_base_url", "") or "").strip().rstrip("/") if settings else ""
    api_key = (getattr(settings, "knowledge_api_key", "") or "").strip() if settings else ""
    model = (getattr(settings, "knowledge_model", "") or "").strip() if settings else ""
    missing = [
        label
        for value, label in (
            (base_url, "Base URL"),
            (api_key, "API key"),
            (model, "model name"),
        )
        if not value
    ]
    if missing:
        raise missing_configuration(
            service="Knowledge Model",
            stage="knowledge_generation",
            settings_section="Knowledge Model",
            fields=missing,
        )
    return base_url, api_key, model


def _get_knowledge_client(user_id: str):
    from openai import OpenAI

    config_db = SessionLocal()
    try:
        base_url, api_key, model = get_knowledge_model_configuration(config_db, user_id)
    finally:
        config_db.close()
    return OpenAI(api_key=api_key, base_url=base_url, timeout=60.0), model


def _call_structured(
    prompt: str,
    user_id: str,
    resource_id: str,
    feature: str,
) -> dict[str, Any]:
    from services.dependency_failure_service import (
        DependencyFailure, classify_provider_error,
    )
    from services.llm_service import _record_completion, parse_json_robustly

    client, model = _get_knowledge_client(user_id)
    base_key = hashlib.sha256(
        f"{resource_id}:{feature}:{prompt}".encode("utf-8")
    ).hexdigest()
    current_prompt = prompt
    last_parse_error: Exception | None = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": current_prompt}],
                temperature=0.15,
                extra_headers={
                    "Idempotency-Key": f"knowledge-{base_key}-{attempt}"
                },
            )
            content = response.choices[0].message.content or "{}"
            _record_completion(
                response,
                user_id=user_id,
                resource_id=resource_id,
                feature=feature,
                operation="knowledge_generation",
                prompt_text=current_prompt,
                model=model,
                completion_text=content,
            )
            try:
                parsed = parse_json_robustly(content)
            except Exception as parse_error:
                last_parse_error = parse_error
                parsed = None
            if isinstance(parsed, dict):
                return parsed
            last_parse_error = ValueError(
                "Knowledge model returned invalid structured output"
            )
            current_prompt = (
                prompt
                + "\n\nYour previous response was invalid. Return exactly one "
                + "valid JSON object matching the requested schema, with no markdown."
            )
        except DependencyFailure:
            raise
        except Exception as error:
            raise classify_provider_error(
                service="Knowledge Model",
                stage="knowledge_generation",
                error=error,
                settings_section="Knowledge Model",
                model=model,
            ) from error
    raise KnowledgePipelineError(
        "invalid_structured_output_after_3_attempts"
    ) from last_parse_error


def _profile_resource(resource: Resource, units: list[dict[str, Any]]) -> dict[str, Any]:
    excerpt = "\n\n".join(f"[{unit['title']}]\n{unit['text'][:3500]}" for unit in units[:12])
    prompt = f"""Analyze this learning resource. Return ONLY JSON with:
{{
  "summary": "concise document profile",
  "topics": ["topic"],
  "language": "language code",
  "domain": "specific domain such as ict_trading, programming, medicine, general",
  "difficulty": "Beginner|Intermediate|Advanced",
  "estimated_minutes": 1
}}
Title: {resource.title}
Type: {resource.type}
Content:
{excerpt[:24000]}
"""
    return _call_structured(prompt, resource.user_id, resource.id, "knowledge_resource_intelligence")


def _extract_unit(resource: Resource, unit: dict[str, Any], domain: str) -> dict[str, Any]:
    timed_source = "\n".join(
        f"[{segment['start']:.2f}-{segment['end']:.2f}] {segment['text']}"
        for segment in unit.get("segments", [])
    )
    prompt = f"""Extract only substantial teachable subjects from this timestamped section.
Domain: {domain}
Section: {unit['title']} ({unit['source_type']})
Absolute section range: {unit['start_seconds']:.2f}-{unit['end_seconds']:.2f}

A concept is a subject that is explicitly defined, explained, demonstrated, compared,
or discussed long enough to teach. Never return incidental words, names in passing,
questions, answer choices, filler, quotations, isolated examples, or sentence fragments.
Prefer fewer, stronger concepts. Return ONLY valid JSON:
{{
  "concepts": [{{
    "name": "canonical display name",
    "aliases": ["aliases actually used in this section"],
    "description": "source-grounded definition",
    "summary": "what the section teaches about it",
    "type": "concept|entity|definition|method",
    "entity_type": "organization|person|product|method|null",
    "confidence": 0.0,
    "grounding_confidence": 0.0,
    "instructional_quality": 0.0,
    "explicitly_defined": false,
    "discussion_duration_seconds": 0.0,
    "difficulty": "Beginner|Intermediate|Advanced",
    "occurrence_role": "introduced|explained|revisited|example|common_mistake|advanced_discussion",
    "evidence_text": "complete supporting sentence or phrase from the transcript",
    "start_seconds": 0.0,
    "end_seconds": 0.0,
    "prerequisites": ["concept name"],
    "examples": ["grounded example"],
    "common_mistakes": ["grounded mistake"],
    "recommended_next_topic": "concept name or null"
  }}],
  "relationships": [{{
    "source": "admitted concept name",
    "target": "admitted concept name",
    "type": "depends_on|uses|requires|compares_with|causes|extends|implements|belongs_to|prerequisite_of",
    "confidence": 0.0,
    "evidence_text": "complete sentence explicitly supporting this relationship"
  }}]
}}
Use only the timestamped transcript below. Do not infer concepts from metadata.
Do not merge Imbalance with Fair Value Gap unless the speaker explicitly establishes equivalence.
Timestamped transcript:
{timed_source[:20000]}
"""
    return _call_structured(prompt, resource.user_id, resource.id, "knowledge_concept_extraction")


def _canonicalize_name(name: str, domain: str) -> str:
    normalized = normalize_term(name)
    if domain == "ict_trading" and normalized in ICT_CANONICAL_ALIASES:
        return ICT_CANONICAL_ALIASES[normalized]
    return re.sub(r"\s+", " ", (name or "").strip())




def _semantic_matches(
    text: str,
    user_id: str,
    resource_id: str,
    domain: str,
    limit: int = 5,
) -> tuple[list[float] | None, list[tuple[str, float]]]:
    """Return Chroma concept candidates; provider failures fall back to deterministic resolution."""
    try:
        from embedding_service import client, embed_text

        vector = embed_text(
            text,
            user_id=user_id,
            resource_id=resource_id,
            feature="knowledge_alias_resolution",
        )
        collection = client.get_or_create_collection(name="knowledge_concepts_v1")
        count = collection.count()
        if not count:
            return vector, []
        result = collection.query(
            query_embeddings=[vector],
            n_results=min(limit, count),
            where={"$and": [{"user_id": user_id}, {"domain": domain}]},
            include=["distances"],
        )
        ids = (result.get("ids") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        return vector, [
            (concept_id, 1.0 / (1.0 + max(0.0, float(distance))))
            for concept_id, distance in zip(ids, distances)
        ]
    except Exception:
        return None, []


def _store_concept_embedding(
    concept: Concept,
    vector: list[float] | None,
    text: str,
) -> None:
    if vector is None:
        return
    try:
        from embedding_service import client

        collection = client.get_or_create_collection(name="knowledge_concepts_v1")
        collection.upsert(
            ids=[concept.id],
            embeddings=[vector],
            documents=[text[:8000]],
            metadatas=[{
                "user_id": concept.user_id or "",
                "domain": concept.domain or "general",
                "canonical_name": concept.canonical_name or concept.name,
            }],
        )
    except Exception:
        pass

def _find_concept(
    db: Session,
    user_id: str,
    canonical_name: str,
    aliases: list[str],
    domain: str,
    run_id: str,
    resource_id: str,
    description: str = "",
) -> tuple[Concept, float]:
    canonical_name = _canonicalize_name(canonical_name, domain)
    normalized = normalize_term(canonical_name)
    candidate_terms = {normalized, *(normalize_term(alias) for alias in aliases)}
    if domain == "ict_trading":
        candidate_terms = {
            normalize_term(ICT_CANONICAL_ALIASES.get(term, term)) for term in candidate_terms if term
        } | {term for term in candidate_terms if term}

    existing = (
        db.query(Concept)
        .filter(
            Concept.user_id == user_id,
            Concept.domain == domain,
            Concept.archived == 0,
            Concept.normalized_name.in_(candidate_terms),
        )
        .first()
    )
    if existing:
        return existing, 1.0

    alias_match = (
        db.query(Concept)
        .join(ConceptAlias, ConceptAlias.concept_id == Concept.id)
        .filter(
            Concept.user_id == user_id,
            Concept.domain == domain,
            Concept.archived == 0,
            ConceptAlias.status == "approved",
            ConceptAlias.normalized_alias.in_(candidate_terms),
        )
        .first()
    )
    if alias_match:
        return alias_match, 1.0

    semantic_text = f"{canonical_name}\n{description}".strip()
    vector, semantic_candidates = _semantic_matches(
        semantic_text, user_id, resource_id, domain
    )
    semantic_scores = dict(semantic_candidates)
    candidates = (
        db.query(Concept)
        .filter(Concept.user_id == user_id, Concept.domain == domain, Concept.archived == 0)
        .all()
    )
    best = None
    best_score = 0.0
    for candidate in candidates:
        lexical_score = SequenceMatcher(
            None,
            normalized,
            candidate.normalized_name or normalize_term(candidate.canonical_name),
        ).ratio()
        semantic_score = semantic_scores.get(candidate.id, 0.0)
        score = max(lexical_score, semantic_score)
        if score > best_score:
            best = candidate
            best_score = score
    if best and best_score >= AUTO_MERGE_THRESHOLD:
        return best, best_score
    if best and best_score >= REVIEW_THRESHOLD:
        db.add(AliasCandidate(
            id=str(uuid4()), user_id=user_id, run_id=run_id, concept_id=best.id,
            alias=canonical_name, normalized_alias=normalized, domain=domain,
            confidence=best_score, reason="Lexically similar concept requires review",
            status="pending", created_at=datetime.utcnow(),
        ))

    concept = Concept(
        id=str(uuid4()),
        name=f"kg:{user_id}:{domain}:{normalized}:{uuid4().hex[:8]}",
        canonical_name=canonical_name,
        normalized_name=normalized,
        user_id=user_id,
        domain=domain,
        concept_type="concept",
        origin="generated",
        confidence=0.0,
        archived=0,
        description="",
        color="#3b82f6",
        tags="[]",
        created_at=datetime.utcnow(),
    )
    db.add(concept)
    db.flush()
    _store_concept_embedding(concept, vector, semantic_text)
    return concept, best_score


def _check_job_control(db: Session, job: ProcessingJob) -> None:
    db.refresh(job)
    if job.status in {"paused", "cancelled", "superseded"}:
        raise KnowledgePipelineControl(job.status)


def _set_checkpoint(
    run: KnowledgeRun,
    stage: str,
    *,
    source_unit_id: str | None = None,
    completed_source_units: list[str] | None = None,
    status: str = "completed",
    extra: dict[str, Any] | None = None,
) -> None:
    checkpoint = _loads(run.checkpoint_json, {})
    checkpoint.update({
        "run_id": run.id,
        "version": run.version,
        "stage": stage,
        "source_unit_id": source_unit_id,
        "input_fingerprint": run.input_fingerprint,
        "rule_version": run.rule_version,
        "model_version": run.model_version,
        "completion_status": status,
        "safe_resume_cursor": run.resume_cursor,
        "completed_source_units": completed_source_units or checkpoint.get(
            "completed_source_units", []
        ),
        "updated_at": datetime.utcnow().isoformat(),
    })
    if extra:
        checkpoint.update(extra)
    run.checkpoint_json = _json(checkpoint)


def _update_stage(
    db: Session,
    run: KnowledgeRun,
    job: ProcessingJob,
    stage: str,
    progress: int,
) -> None:
    db.refresh(job)
    if job.status in {"paused", "cancelled"}:
        raise KnowledgePipelineControl(job.status)
    now = datetime.utcnow()
    metrics = _loads(run.metrics_json, {})
    timing = metrics.setdefault("stage_timing", {})
    previous_stage = run.current_stage
    checkpoint = _loads(run.checkpoint_json, {})
    previous_started = metrics.get("_stage_started_at")
    if previous_stage and previous_started and previous_stage != stage:
        try:
            elapsed = (
                now - datetime.fromisoformat(previous_started)
            ).total_seconds()
            timing[previous_stage] = round(
                timing.get(previous_stage, 0.0) + max(0.0, elapsed), 3
            )
        except (TypeError, ValueError):
            pass
    checkpoint["stage_started_at"] = now.isoformat()
    metrics["_stage_started_at"] = now.isoformat()
    checkpoint["active_stage"] = stage
    checkpoint["resume_cursor"] = run.resume_cursor
    run.checkpoint_json = _json(checkpoint)
    run.metrics_json = _json(metrics)
    run.current_stage = stage
    run.progress = progress
    job.current_stage = stage
    job.progress = progress
    job.heartbeat_at = now
    db.commit()


def _active_run_ids_query(db: Session, user_id: str):
    return db.query(ResourceKnowledgeState.active_run_id).filter(
        ResourceKnowledgeState.user_id == user_id,
        ResourceKnowledgeState.active_run_id.isnot(None),
    )


def _recalculate_graph(db: Session, user_id: str, concept_ids: set[str]) -> None:
    active_run_ids = _active_run_ids_query(db, user_id)
    for concept_id in concept_ids:
        mentions = (
            db.query(ConceptMention)
            .filter(
                ConceptMention.user_id == user_id,
                ConceptMention.concept_id == concept_id,
                ConceptMention.run_id.in_(active_run_ids),
            )
            .all()
        )
        relationships = db.query(ConceptRelationship).filter(
            ConceptRelationship.user_id == user_id,
            ConceptRelationship.archived == 0,
            or_(
                ConceptRelationship.source_concept_id == concept_id,
                ConceptRelationship.target_concept_id == concept_id,
            ),
        ).count()
        analytics = db.query(ConceptAnalytics).filter(ConceptAnalytics.concept_id == concept_id).first()
        if not analytics:
            analytics = ConceptAnalytics(concept_id=concept_id, user_id=user_id)
            db.add(analytics)
        analytics.mention_count = len(mentions)
        mention_windows: list[dict[str, Any]] = []
        mentions_by_resource: dict[str, list[ConceptMention]] = defaultdict(list)
        for mention in mentions:
            mentions_by_resource[mention.resource_id].append(mention)
        for resource_mentions in mentions_by_resource.values():
            mention_windows.extend(_merge_evidence_windows([
                {
                    "start": mention.start_seconds,
                    "end": mention.end_seconds,
                    "text": mention.evidence_text or "",
                }
                for mention in resource_mentions
                if mention.start_seconds is not None
                and mention.end_seconds is not None
                and mention.end_seconds > mention.start_seconds
            ]))
        analytics.meaningful_occurrence_count = len(mention_windows)
        analytics.discussion_duration_seconds = sum(
            max(0.0, window["end"] - window["start"])
            for window in mention_windows
        )
        analytics.raw_phrase_occurrences = len(mentions)
        analytics.resource_count = len({mention.resource_id for mention in mentions})
        analytics.chapter_count = len({mention.source_id for mention in mentions if mention.source_type in {"chapter", "subchapter"}})
        analytics.relationship_count = relationships
        analytics.average_confidence = (
            sum(mention.confidence for mention in mentions) / len(mentions) if mentions else 0.0
        )
        analytics.popularity = math.log1p(analytics.meaningful_occurrence_count) * max(1, analytics.resource_count)
        analytics.difficulty_score = min(5.0, 1.0 + relationships * 0.15 + analytics.chapter_count * 0.05)
        timeline_positions = [item.start_seconds for item in mentions if item.start_seconds is not None]
        analytics.learning_order = int(min(timeline_positions)) if timeline_positions else None
        analytics.updated_at = datetime.utcnow()

        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if concept and not mentions and concept.origin == "generated":
            concept.archived = 1

    relationships = db.query(ConceptRelationship).filter(ConceptRelationship.user_id == user_id).all()
    active_ids = {row[0] for row in active_run_ids.all() if row[0]}
    for relationship in relationships:
        evidence = db.query(RelationshipEvidence).filter(
            RelationshipEvidence.relationship_id == relationship.id,
            RelationshipEvidence.run_id.in_(active_ids) if active_ids else False,
        ).all()
        relationship.evidence_count = len(evidence)
        relationship.confidence = (
            sum(item.confidence for item in evidence) / len(evidence) if evidence else 0.0
        )
        relationship.archived = 0 if evidence else 1
        relationship.updated_at = datetime.utcnow()


def _rebuild_recommendations(db: Session, user_id: str, concept_ids: set[str]) -> None:
    db.query(ConceptRecommendation).filter(
        ConceptRecommendation.user_id == user_id,
        ConceptRecommendation.concept_id.in_(concept_ids),
    ).delete(synchronize_session=False)

    for concept_id in concept_ids:
        relations = db.query(ConceptRelationship).filter(
            ConceptRelationship.user_id == user_id,
            ConceptRelationship.archived == 0,
            or_(
                ConceptRelationship.source_concept_id == concept_id,
                ConceptRelationship.target_concept_id == concept_id,
            ),
        ).order_by(ConceptRelationship.confidence.desc()).limit(12).all()
        for relation in relations:
            target_id = (
                relation.target_concept_id
                if relation.source_concept_id == concept_id
                else relation.source_concept_id
            )
            rec_type = "missing_prerequisite" if relation.relationship_type in {"requires", "depends_on", "prerequisite_of"} else "strongly_connected"
            references = concept_references(db, user_id, target_id)
            first_reference = references[0] if references else None
            db.add(ConceptRecommendation(
                id=str(uuid4()), user_id=user_id, concept_id=concept_id,
                recommended_concept_id=target_id,
                resource_id=first_reference["resource_id"] if first_reference else None,
                recommendation_type=rec_type,
                score=relation.confidence,
                explanation=f"Connected by {relation.relationship_type} with {relation.evidence_count} supporting source(s).",
                jump_target_json=_json(first_reference["jump_target"]) if first_reference else None,
                created_at=datetime.utcnow(), updated_at=datetime.utcnow(),
            ))


EVIDENCE_WEIGHTS = {
    "explicit_definition": 1.0,
    "explained": 1.0,
    "chapter": 0.90,
    "subchapter": 0.85,
    "revisited": 0.75,
    "example": 0.60,
    "incidental": 0.10,
}


def _content_tokens(value: str) -> set[str]:
    stop = {
        "the", "a", "an", "and", "or", "to", "of", "in", "is", "it",
        "this", "that", "for", "with", "on", "as", "be", "are", "was",
        "were", "by", "from", "at", "we", "you", "they", "he", "she",
    }
    return {
        token for token in normalize_term(value).split()
        if len(token) > 2 and token not in stop
    }


def _semantic_windows(
    raw: dict[str, Any],
    unit: dict[str, Any],
) -> list[dict[str, Any]]:
    segments = unit.get("segments") or []
    evidence = str(raw.get("evidence_text") or "").strip()
    evidence_normalized = normalize_term(evidence)
    unit_normalized = normalize_term(" ".join(
        str(segment.get("text") or "") for segment in segments
    ))
    if not evidence_normalized or (
        evidence_normalized not in unit_normalized
        and SequenceMatcher(None, evidence_normalized, unit_normalized).ratio() < 0.16
    ):
        evidence_tokens = _content_tokens(evidence)
        unit_tokens = _content_tokens(unit_normalized)
        if not evidence_tokens or len(evidence_tokens & unit_tokens) / len(evidence_tokens) < 0.55:
            return []

    topic_text = " ".join([
        str(raw.get("name") or ""),
        *[str(value) for value in raw.get("aliases", [])],
        str(raw.get("description") or ""),
        evidence,
    ])
    topic_tokens = _content_tokens(topic_text)
    try:
        declared_start = float(raw.get("start_seconds"))
        declared_end = float(raw.get("end_seconds"))
    except (TypeError, ValueError):
        declared_start = declared_end = -1.0

    relevant: list[int] = []
    for index, segment in enumerate(segments):
        segment_tokens = _content_tokens(str(segment.get("text") or ""))
        overlap = (
            len(topic_tokens & segment_tokens) / max(1, min(len(topic_tokens), 5))
        )
        timestamp_hit = (
            declared_end > declared_start
            and float(segment["end"]) > declared_start
            and float(segment["start"]) < declared_end
        )
        evidence_hit = (
            evidence_normalized
            and evidence_normalized in normalize_term(str(segment.get("text") or ""))
        )
        if timestamp_hit or evidence_hit or overlap >= 0.20:
            relevant.append(index)
    if not relevant:
        return []

    expanded = set(relevant)
    for index in list(relevant):
        for neighbor in (index - 1, index + 1):
            if neighbor < 0 or neighbor >= len(segments):
                continue
            gap = (
                float(segments[neighbor]["start"]) - float(segments[index]["end"])
                if neighbor > index
                else float(segments[index]["start"]) - float(segments[neighbor]["end"])
            )
            neighbor_tokens = _content_tokens(str(segments[neighbor].get("text") or ""))
            if gap <= SEMANTIC_WINDOW_MERGE_GAP_SECONDS and topic_tokens & neighbor_tokens:
                expanded.add(neighbor)

    ordered = sorted(expanded)
    windows: list[dict[str, Any]] = []
    for index in ordered:
        segment = segments[index]
        candidate = {
            "start": float(segment["start"]),
            "end": float(segment["end"]),
            "text": str(segment.get("text") or "").strip(),
        }
        if (
            windows
            and candidate["start"] - windows[-1]["end"]
            <= SEMANTIC_WINDOW_MERGE_GAP_SECONDS
        ):
            windows[-1]["end"] = max(windows[-1]["end"], candidate["end"])
            windows[-1]["text"] = (
                windows[-1]["text"] + " " + candidate["text"]
            ).strip()
        else:
            windows.append(candidate)
    return windows


def _candidate_rejection_reason(
    raw: dict[str, Any],
    unit: dict[str, Any],
) -> str | None:
    name = str(raw.get("name") or "").strip()
    normalized = normalize_term(name)
    evidence = str(raw.get("evidence_text") or "").strip()
    confidence = _safe_float(raw.get("confidence"), 0.0)
    grounding = _safe_float(raw.get("grounding_confidence"), confidence)
    if not normalized or len(normalized) < 3:
        return "empty_or_short_name"
    if len(normalized.split()) > 10 or name.endswith("?"):
        return "sentence_or_question"
    if re.search(r"\b(answer|choice)\s+[a-d]\b", normalized):
        return "answer_choice"
    if re.match(r"^(what|who|when|where|why|how|is|are|does|do)\b", normalized):
        return "question_or_fragment"
    if confidence < MIN_GROUNDING_CONFIDENCE or grounding < MIN_GROUNDING_CONFIDENCE:
        return "low_grounding"
    if len(evidence.split()) < MIN_EVIDENCE_WORDS:
        return "incomplete_evidence"
    windows = _semantic_windows(raw, unit)
    if not windows:
        return "evidence_not_in_source"
    raw["_validated_windows"] = windows
    return None


def _occurrence_bounds(
    raw: dict[str, Any],
    unit: dict[str, Any],
) -> tuple[float, float]:
    windows = raw.get("_validated_windows") or []
    if windows:
        return (
            min(float(window["start"]) for window in windows),
            max(float(window["end"]) for window in windows),
        )
    return float(unit["start_seconds"]), float(unit["start_seconds"])


def _existing_concept_support(
    db: Session,
    user_id: str,
    domain: str,
    normalized_name: str,
) -> tuple[Concept | None, int]:
    concept = db.query(Concept).filter(
        Concept.user_id == user_id,
        Concept.domain == domain,
        Concept.archived == 0,
        Concept.normalized_name == normalized_name,
    ).first()
    if not concept:
        concept = db.query(Concept).join(
            ConceptAlias, ConceptAlias.concept_id == Concept.id
        ).filter(
            Concept.user_id == user_id,
            Concept.domain == domain,
            Concept.archived == 0,
            ConceptAlias.status == "approved",
            ConceptAlias.normalized_alias == normalized_name,
        ).first()
    if not concept:
        return None, 0
    support = _active_mentions(db, user_id).filter(
        ConceptMention.concept_id == concept.id
    ).with_entities(ConceptMention.resource_id).distinct().count()
    return concept, support


def _is_suppressed(
    db: Session,
    user_id: str,
    domain: str,
    normalized_name: str,
) -> bool:
    return db.query(ConceptSuppression.id).filter(
        ConceptSuppression.user_id == user_id,
        ConceptSuppression.domain == domain,
        ConceptSuppression.normalized_name == normalized_name,
        ConceptSuppression.active == 1,
    ).first() is not None


def _merge_evidence_windows(
    windows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    for window in sorted(windows, key=lambda item: (item["start"], item["end"])):
        if (
            merged
            and float(window["start"]) - float(merged[-1]["end"])
            <= SEMANTIC_WINDOW_MERGE_GAP_SECONDS
        ):
            merged[-1]["end"] = max(
                float(merged[-1]["end"]), float(window["end"])
            )
            merged[-1]["text"] = (
                str(merged[-1].get("text") or "")
                + " "
                + str(window.get("text") or "")
            ).strip()
        else:
            merged.append(dict(window))
    return merged


def _admit_candidates(
    db: Session,
    resource: Resource,
    domain: str,
    extracted: list[tuple[dict[str, Any], dict[str, Any]]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    discarded: dict[str, int] = defaultdict(int)
    extracted_count = 0
    for unit, data in extracted:
        concepts = data.get("concepts", [])
        if not isinstance(concepts, list):
            continue
        for raw in concepts:
            extracted_count += 1
            if not isinstance(raw, dict):
                discarded["invalid_structured_output"] += 1
                continue
            reason = _candidate_rejection_reason(raw, unit)
            if reason:
                discarded[reason] += 1
                continue
            canonical = _canonicalize_name(str(raw["name"]), domain)
            normalized = normalize_term(canonical)
            if _is_suppressed(db, resource.user_id, domain, normalized):
                discarded["user_suppressed"] += 1
                continue
            windows = list(raw.get("_validated_windows") or [])
            start, end = _occurrence_bounds(raw, unit)
            duration = sum(
                max(0.0, float(window["end"]) - float(window["start"]))
                for window in windows
            )
            role = str(raw.get("occurrence_role") or "explained")
            evidence_weight = EVIDENCE_WEIGHTS.get(role, 1.0)
            if raw.get("explicitly_defined"):
                evidence_weight = EVIDENCE_WEIGHTS["explicit_definition"]
            elif unit["source_type"] in {"chapter", "subchapter"}:
                evidence_weight = max(
                    evidence_weight, EVIDENCE_WEIGHTS[unit["source_type"]]
                )
            group = groups.setdefault(normalized, {
                "canonical": canonical,
                "normalized": normalized,
                "rows": [],
                "aliases": set(),
                "confidences": [],
                "grounding": [],
                "qualities": [],
                "explicit": False,
                "windows": [],
                "sections": set(),
                "roles": defaultdict(int),
            })
            group["rows"].append((unit, raw, start, end, duration))
            group["windows"].extend(windows)
            group["aliases"].update(
                str(alias).strip() for alias in raw.get("aliases", [])
                if str(alias).strip()
            )
            group["confidences"].append(
                _safe_float(raw.get("confidence"), 0.0)
            )
            group["grounding"].append(_safe_float(
                raw.get("grounding_confidence"),
                _safe_float(raw.get("confidence"), 0.0),
            ))
            group["qualities"].append(
                _safe_float(raw.get("instructional_quality"), 0.5)
                * evidence_weight
            )
            group["explicit"] = (
                group["explicit"] or bool(raw.get("explicitly_defined"))
            )
            group["sections"].add(unit["source_id"])
            group["roles"][role] += 1

    admitted: list[dict[str, Any]] = []
    durations: list[float] = []
    occurrence_counts: list[int] = []
    for group in groups.values():
        group["windows"] = _merge_evidence_windows(group["windows"])
        group["duration"] = sum(
            max(0.0, float(window["end"]) - float(window["start"]))
            for window in group["windows"]
        )
        existing, resource_support = _existing_concept_support(
            db, resource.user_id, domain, group["normalized"]
        )
        occurrence_count = len(group["windows"])
        row_count = len(group["rows"])
        avg_confidence = sum(group["confidences"]) / row_count
        avg_grounding = sum(group["grounding"]) / row_count
        avg_quality = sum(group["qualities"]) / row_count
        confidence_score = (avg_confidence + avg_grounding) / 2.0
        duration_score = min(1.0, group["duration"] / 60.0)
        recurrence_score = min(1.0, occurrence_count / 2.0)
        diversity_score = min(
            1.0, (len(group["sections"]) + resource_support) / 2.0
        )
        if group["explicit"]:
            duration_score = max(duration_score, 0.80)
            recurrence_score = max(recurrence_score, 0.90)
            diversity_score = max(diversity_score, 0.80)
        score = min(
            1.0,
            confidence_score * 0.30
            + duration_score * 0.25
            + recurrence_score * 0.20
            + diversity_score * 0.15
            + avg_quality * 0.10,
        )
        substantial = (
            group["explicit"]
            or group["duration"] >= MIN_SINGLE_TOPIC_DURATION_SECONDS
            or (
                occurrence_count >= MIN_MEANINGFUL_OCCURRENCES
                and group["duration"] >= MIN_RECURRING_DURATION_SECONDS
            )
            or resource_support >= 2
            or (
                len(group["sections"]) >= 1
                and group["duration"] >= MIN_RECURRING_DURATION_SECONDS
                and avg_quality >= 0.80
            )
        )
        if not substantial:
            discarded["insufficient_discussion"] += row_count
            continue
        if score < CONCEPT_ADMISSION_THRESHOLD:
            discarded["below_admission_score"] += row_count
            continue
        group["score"] = score
        group["existing"] = existing
        group["resource_support"] = resource_support
        group["occurrence_count"] = occurrence_count
        admitted.append(group)
        durations.append(group["duration"])
        occurrence_counts.append(occurrence_count)

    admitted_rows = sum(len(item["rows"]) for item in admitted)
    metrics = {
        "extracted_candidates": extracted_count,
        "published_candidates": len(admitted),
        "admitted_concepts": len(admitted),
        "discarded_candidates": extracted_count - admitted_rows,
        "discard_reasons": dict(sorted(discarded.items())),
        "average_discussion_duration": (
            sum(durations) / len(durations) if durations else 0.0
        ),
        "average_meaningful_occurrences": (
            sum(occurrence_counts) / len(occurrence_counts)
            if occurrence_counts else 0.0
        ),
        "rule_version": STRICT_RULE_VERSION,
    }
    return admitted, metrics


def _cleanup_run_staging(db: Session, run_id: str) -> set[str]:
    run = db.query(KnowledgeRun).filter(KnowledgeRun.id == run_id).first()
    checkpoint = _loads(run.checkpoint_json, {}) if run else {}
    concept_ids = {
        row[0] for row in db.query(ConceptMention.concept_id).filter(
            ConceptMention.run_id == run_id
        ).all()
    }
    concept_ids.update(
        value for value in checkpoint.get("staged_concept_ids", [])
        if isinstance(value, str)
    )
    relationship_ids = {
        row[0] for row in db.query(RelationshipEvidence.relationship_id).filter(
            RelationshipEvidence.run_id == run_id
        ).all()
    }
    db.query(ConceptCoverage).filter(
        ConceptCoverage.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(KnowledgeSourceSection).filter(
        KnowledgeSourceSection.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(RelationshipEvidence).filter(
        RelationshipEvidence.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(ConceptMention).filter(
        ConceptMention.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(EntityIdentity).filter(
        EntityIdentity.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(ConceptAlias).filter(
        ConceptAlias.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(AliasCandidate).filter(
        AliasCandidate.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(RelationshipReviewCandidate).filter(
        RelationshipReviewCandidate.run_id == run_id
    ).delete(synchronize_session=False)
    db.query(ResourceKnowledgeProfile).filter(
        ResourceKnowledgeProfile.run_id == run_id
    ).delete(synchronize_session=False)
    db.flush()

    for relationship_id in relationship_ids:
        relationship = db.query(ConceptRelationship).filter(
            ConceptRelationship.id == relationship_id
        ).first()
        if relationship and not db.query(RelationshipEvidence.id).filter(
            RelationshipEvidence.relationship_id == relationship_id
        ).first():
            relationship.archived = 1
            relationship.evidence_count = 0
            relationship.confidence = 0.0

    for concept_id in concept_ids:
        concept = db.query(Concept).filter(Concept.id == concept_id).first()
        if not concept or concept.origin != "generated":
            continue
        if db.query(ConceptMention.id).filter(
            ConceptMention.concept_id == concept_id
        ).first():
            continue
        db.query(ConceptRecommendation).filter(or_(
            ConceptRecommendation.concept_id == concept_id,
            ConceptRecommendation.recommended_concept_id == concept_id,
        )).delete(synchronize_session=False)
        db.query(ConceptAnalytics).filter(
            ConceptAnalytics.concept_id == concept_id
        ).delete(synchronize_session=False)
        db.query(ConceptAlias).filter(
            ConceptAlias.concept_id == concept_id
        ).delete(synchronize_session=False)
        db.query(EntityIdentity).filter(
            EntityIdentity.concept_id == concept_id
        ).delete(synchronize_session=False)
        db.query(ConceptRelationship).filter(or_(
            ConceptRelationship.source_concept_id == concept_id,
            ConceptRelationship.target_concept_id == concept_id,
        )).delete(synchronize_session=False)
        db.delete(concept)
    db.flush()
    return concept_ids


def _validate_publication(
    db: Session,
    resource: Resource,
    run: KnowledgeRun,
    units: list[dict[str, Any]],
    admitted_concept_ids: set[str],
    previous_run_id: str | None,
    previous_fingerprint: str | None,
) -> dict[str, Any]:
    units_by_source = {
        (unit["source_type"], unit["source_id"]): unit for unit in units
    }
    mentions = db.query(ConceptMention).filter(
        ConceptMention.run_id == run.id
    ).all()
    seen_mentions: set[tuple[Any, ...]] = set()
    duplicates = 0
    for mention in mentions:
        if (
            mention.user_id != resource.user_id
            or mention.resource_id != resource.id
            or mention.concept_id not in admitted_concept_ids
        ):
            raise KnowledgePipelineError(
                "publication_validation: cross-user or bypassed mention"
            )
        unit = units_by_source.get((mention.source_type, mention.source_id))
        if not unit:
            raise KnowledgePipelineError(
                "publication_validation: missing source unit"
            )
        if (
            mention.start_seconds is None
            or mention.end_seconds is None
            or mention.end_seconds <= mention.start_seconds
            or mention.start_seconds < float(unit["start_seconds"]) - 0.01
            or mention.end_seconds > float(unit["end_seconds"]) + 0.01
        ):
            raise KnowledgePipelineError(
                "publication_validation: invalid timestamp range"
            )
        evidence_tokens = _content_tokens(mention.evidence_text or "")
        source_tokens = _content_tokens(unit["text"])
        if (
            evidence_tokens
            and len(evidence_tokens & source_tokens) / len(evidence_tokens) < 0.55
        ):
            raise KnowledgePipelineError(
                "publication_validation: evidence not present in source"
            )
        key = (
            mention.concept_id, mention.source_type, mention.source_id,
            round(mention.start_seconds, 2), round(mention.end_seconds, 2),
            normalize_term(mention.evidence_text),
        )
        if key in seen_mentions:
            duplicates += 1
        seen_mentions.add(key)

    if mentions and duplicates / len(mentions) > 0.10:
        raise KnowledgePipelineError(
            "publication_validation: duplicate mention anomaly"
        )

    coverages = db.query(ConceptCoverage).filter(
        ConceptCoverage.run_id == run.id
    ).all()
    section_ids = {
        row[0] for row in db.query(KnowledgeSourceSection.id).filter(
            KnowledgeSourceSection.run_id == run.id
        ).all()
    }
    if any(
        coverage.section_id not in section_ids
        or coverage.concept_id not in admitted_concept_ids
        for coverage in coverages
    ):
        raise KnowledgePipelineError(
            "publication_validation: dangling covers edge"
        )

    if (
        previous_run_id
        and previous_fingerprint == run.input_fingerprint
    ):
        previous_count = db.query(ConceptMention.concept_id).filter(
            ConceptMention.run_id == previous_run_id
        ).distinct().count()
        current_count = len(admitted_concept_ids)
        if previous_count >= 5 and current_count < previous_count * 0.20:
            raise KnowledgePipelineError(
                "publication_validation: unexpected concept collapse"
            )

    return {
        "validated_mentions": len(mentions),
        "validated_coverages": len(coverages),
        "duplicate_mentions": duplicates,
    }


def run_knowledge_pipeline(resource_id: str, job_id: str) -> str:
    db = SessionLocal()
    try:
        resource = db.query(Resource).filter(
            Resource.id == resource_id, Resource.is_deleted == 0
        ).first()
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        if not resource or not job:
            raise KnowledgePipelineError("Resource or job no longer exists")
        units = _source_units(resource, db)
        if not units:
            raise KnowledgePipelineError(
                "Resource has no timestamped transcript segments"
            )

        _base_url, _api_key, configured_model = get_knowledge_model_configuration(
            db, resource.user_id
        )
        state = get_or_create_knowledge_state(db, resource)
        fingerprint = _source_fingerprint(resource, db)
        previous_run_id = state.active_run_id
        previous_fingerprint = state.source_fingerprint
        graph_size_before = (
            db.query(ConceptMention.concept_id)
            .filter(ConceptMention.run_id == previous_run_id)
            .distinct().count()
            if previous_run_id else 0
        )
        next_version = (state.active_version or 0) + 1
        run = db.query(KnowledgeRun).filter(
            KnowledgeRun.job_id == job.id
        ).first()
        if run and (
            run.user_id != resource.user_id
            or run.resource_id != resource.id
        ):
            raise KnowledgePipelineError("Recovery ownership validation failed")
        resume_cache = (
            _RUN_MEMORY_CACHE.get(run.id)
            if run and run.input_fingerprint == fingerprint else None
        )
        if run and resume_cache:
            recovery_metrics = _loads(run.metrics_json, {})
            recovery_metrics["resumed_job_count"] = recovery_metrics.get("resumed_job_count", 0) + 1
            recovery_metrics["checkpoint_replay_count"] = recovery_metrics.get("checkpoint_replay_count", 0) + 1
            recovery_metrics["avoided_repeated_model_calls"] = recovery_metrics.get("avoided_repeated_model_calls", 0) + len(resume_cache.get("extracted", []))
            run.metrics_json = _json(recovery_metrics)
        if not run:
            run = KnowledgeRun(
                id=str(uuid4()), resource_id=resource.id,
                user_id=resource.user_id, job_id=job.id,
                version=next_version, status="processing",
                input_fingerprint=fingerprint,
                current_stage=STAGES[0][0], progress=0,
                created_at=datetime.utcnow(), started_at=datetime.utcnow(),
                checkpoint_json="{}", metrics_json="{}",
                rule_version=STRICT_RULE_VERSION,
                model_version=configured_model,
            )
            db.add(run)
            db.flush()
        else:
            _cleanup_run_staging(db, run.id)
            run.status = "processing"
            run.error_message = None
            run.started_at = datetime.utcnow()
            run.finished_at = None
            if not resume_cache:
                run.checkpoint_json = "{}"
                run.metrics_json = "{}"
            run.rule_version = STRICT_RULE_VERSION
            run.model_version = configured_model
        state.status = "processing"
        state.updated_at = datetime.utcnow()
        job.input_fingerprint = fingerprint
        db.commit()

        _update_stage(db, run, job, "resource_intelligence", 5)
        _check_job_control(db, job)
        profile = (
            resume_cache.get("profile")
            if resume_cache and resume_cache.get("profile")
            else _profile_resource(resource, units)
        )
        _RUN_MEMORY_CACHE[run.id] = {
            "fingerprint": fingerprint,
            "profile": profile,
            "domain": None,
            "extracted": list(resume_cache.get("extracted", []))
            if resume_cache else [],
        }
        domain = normalize_term(profile.get("domain")) or "general"
        domain = domain.replace(" ", "_")
        domain_sample = " ".join(unit["text"][:2000] for unit in units[:8]).lower()
        if any(signal in domain_sample for signal in (
            "fair value gap", "order block", "ict mentorship",
            "market structure shift",
        )):
            domain = "ict_trading"
        word_count = sum(len(unit["text"].split()) for unit in units)
        db.add(ResourceKnowledgeProfile(
            id=str(uuid4()), run_id=run.id, resource_id=resource.id,
            summary=str(profile.get("summary") or ""),
            topics=_json(profile.get("topics") or []),
            language=str(profile.get("language") or "unknown"),
            domain=domain,
            difficulty=str(profile.get("difficulty") or "Intermediate"),
            estimated_minutes=int(
                profile.get("estimated_minutes") or max(1, word_count // 200)
            ),
            metadata_json=_json({
                "title": resource.title,
                "type": resource.type,
                "unit_count": len(units),
                "source_policy": "timestamped_transcript_chapters_subchapters_only",
            }),
        ))
        _set_checkpoint(run, "resource_intelligence")
        db.commit()

        extracted: list[tuple[dict[str, Any], dict[str, Any]]] = list(
            _RUN_MEMORY_CACHE[run.id].get("extracted", [])
        )
        total_units = len(units)
        completed_unit_ids = {item[0]["source_id"] for item in extracted}

        # --- Skip small units (< 30s or < 50 words) ---
        MIN_DURATION_SECONDS = 30.0
        MIN_WORD_COUNT = 50
        units_to_extract = []
        skipped_units = []
        skipped_unit_ids: set[str] = set()
        for unit in units:
            if unit["source_id"] in completed_unit_ids:
                continue
            duration = unit["end_seconds"] - unit["start_seconds"]
            word_count = len(unit.get("text", "").split())
            if duration < MIN_DURATION_SECONDS or word_count < MIN_WORD_COUNT:
                skipped_units.append(unit)
                skipped_unit_ids.add(unit["source_id"])
                continue
            units_to_extract.append(unit)

        # Mark skipped units as completed with empty results
        for unit in skipped_units:
            extracted.append((unit, {"concepts": [], "relationships": []}))

        # --- Parallel extraction ---
        import threading
        from concurrent.futures import ThreadPoolExecutor, as_completed

        MAX_WORKERS = min(5, len(units_to_extract)) or 1
        extraction_results: dict[str, dict[str, Any]] = {}
        extraction_errors: list[tuple[str, Exception]] = []
        lock = threading.Lock()

        def _extract_one(u: dict[str, Any]) -> tuple[str, dict[str, Any]]:
            data = _extract_unit(resource, u, domain)
            return u["source_id"], data

        if units_to_extract:
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
                futures = {
                    pool.submit(_extract_one, unit): unit
                    for unit in units_to_extract
                }
                for future in as_completed(futures):
                    try:
                        source_id, data = future.result()
                        with lock:
                            extraction_results[source_id] = data
                    except Exception as exc:
                        unit = futures[future]
                        with lock:
                            extraction_errors.append((unit["source_id"], exc))

        # Re-raise first extraction error to preserve original fail-fast behavior
        if extraction_errors:
            raise extraction_errors[0][1]

        # --- Sequential side effects: update cache, checkpoints, stage ---
        for unit in units:
            if unit["source_id"] in completed_unit_ids:
                continue
            if unit["source_id"] in skipped_unit_ids:
                continue
            if unit["source_id"] in extraction_results:
                data = extraction_results[unit["source_id"]]
            else:
                data = {"concepts": [], "relationships": []}
            extracted.append((unit, data))

        _RUN_MEMORY_CACHE[run.id]["extracted"] = list(extracted)

        for index, unit in enumerate(units):
            if unit["source_id"] not in completed_unit_ids:
                _check_job_control(db, job)
                run.resume_cursor = f"unit:{index + 1}"
        _set_checkpoint(
            run, "concept_extraction",
            source_unit_id=units[-1]["source_id"] if units else None,
            completed_source_units=[
                item[0]["source_id"] for item in extracted
            ],
            extra={
                "completed_units": len(extracted),
                "total_units": total_units,
                "skipped_units": len(skipped_units),
            },
        )
        _update_stage(db, run, job, "concept_extraction", 15)

        admitted, admission_metrics = _admit_candidates(
            db, resource, domain, extracted
        )
        current_metrics = _loads(run.metrics_json, {})
        current_metrics.update(admission_metrics)
        run.metrics_json = _json(current_metrics)
        _set_checkpoint(
            run, "concept_admission",
            extra={"admitted_concepts": len(admitted)},
        )
        _update_stage(db, run, job, "confidence_engine", 22)

        preexisting_concept_ids = {
            row[0] for row in db.query(Concept.id).filter(
                Concept.user_id == resource.user_id
            ).all()
        }
        alias_merge_count = 0
        alias_review_count_before = db.query(AliasCandidate).filter(
            AliasCandidate.run_id == run.id
        ).count()
        concept_by_name: dict[str, Concept] = {}
        admitted_rows: list[tuple[dict[str, Any], dict[str, Any], Concept, float, float, float]] = []
        affected: set[str] = set()
        for group in admitted:
            representative = max(
                group["rows"],
                key=lambda item: (
                    _safe_float(item[1].get("instructional_quality"), 0.0),
                    _safe_float(item[1].get("confidence"), 0.0),
                ),
            )[1]
            concept, merge_score = _find_concept(
                db, resource.user_id, group["canonical"],
                sorted(group["aliases"]), domain, run.id, resource.id,
                str(representative.get("description") or ""),
            )
            if merge_score >= AUTO_MERGE_THRESHOLD:
                alias_merge_count += 1
            concept.canonical_name = concept.canonical_name or group["canonical"]
            concept.normalized_name = concept.normalized_name or group["normalized"]
            concept.domain = domain
            concept.user_id = resource.user_id
            concept.concept_type = str(
                representative.get("type") or concept.concept_type or "concept"
            )
            concept.description = str(
                representative.get("description") or concept.description or ""
            )
            concept.summary = str(
                representative.get("summary") or concept.summary or ""
            )
            concept.prerequisites = _json(
                representative.get("prerequisites")
                or _loads(concept.prerequisites, [])
            )
            concept.examples = _json(
                representative.get("examples") or _loads(concept.examples, [])
            )
            concept.common_mistakes = _json(
                representative.get("common_mistakes")
                or _loads(concept.common_mistakes, [])
            )
            concept.recommended_next_topic = (
                str(representative.get("recommended_next_topic")
                    or concept.recommended_next_topic or "") or None
            )
            concept.confidence = max(concept.confidence or 0.0, group["score"])
            concept.difficulty = str(
                representative.get("difficulty")
                or concept.difficulty or "Intermediate"
            )
            concept.learning_stage = {
                "Beginner": "Foundational",
                "Intermediate": "Practical",
                "Advanced": "Advanced",
            }.get(concept.difficulty, "Practical")
            concept.archived = 0
            names = {
                group["normalized"],
                normalize_term(group["canonical"]),
                *(normalize_term(alias) for alias in group["aliases"]),
            }
            for name in names:
                if name:
                    concept_by_name[name] = concept
            for unit, raw, start, end, duration in group["rows"]:
                admitted_rows.append((unit, raw, concept, start, end, duration))
            affected.add(concept.id)
        db.flush()
        _set_checkpoint(
            run, "alias_resolution",
            extra={
                "staged_concept_ids": sorted(
                    affected - preexisting_concept_ids
                ),
            },
        )
        _update_stage(db, run, job, "alias_resolution", 30)

        section_by_source: dict[tuple[str, str], KnowledgeSourceSection] = {}
        for unit, _raw, _concept, _start, _end, _duration in admitted_rows:
            if unit["source_type"] not in {"chapter", "subchapter"}:
                continue
            key = (unit["source_type"], unit["source_id"])
            if key in section_by_source:
                continue
            section = KnowledgeSourceSection(
                id=str(uuid4()), run_id=run.id, user_id=resource.user_id,
                resource_id=resource.id, source_type=unit["source_type"],
                source_id=unit["source_id"], chapter_id=unit["chapter_id"],
                subchapter_id=unit.get("subchapter_id"), title=unit["title"],
                summary=None, start_seconds=unit["start_seconds"],
                end_seconds=unit["end_seconds"],
            )
            db.add(section)
            section_by_source[key] = section
        db.flush()

        coverage_groups: dict[tuple[str, str], list[tuple[Any, ...]]] = defaultdict(list)
        for row in admitted_rows:
            unit, raw, concept, start, end, duration = row
            if unit["source_type"] in {"chapter", "subchapter"}:
                coverage_groups[(unit["source_id"], concept.id)].append(row)
            db.add(ConceptMention(
                id=str(uuid4()), concept_id=concept.id, run_id=run.id,
                resource_id=resource.id, user_id=resource.user_id,
                source_type=unit["source_type"], source_id=unit["source_id"],
                occurrence_role=(
                    str(raw.get("occurrence_role") or "explained")
                    if str(raw.get("occurrence_role") or "explained") in OCCURRENCE_ROLES
                    else "explained"
                ),
                evidence_text=str(raw.get("evidence_text") or "")[:2000],
                confidence=_safe_float(raw.get("confidence"), 0.0),
                start_seconds=start, end_seconds=end,
            ))
            entity_type = raw.get("entity_type")
            if entity_type and str(entity_type).lower() not in {"null", "none", ""}:
                db.add(EntityIdentity(
                    id=str(uuid4()), concept_id=concept.id,
                    user_id=resource.user_id, entity_type=str(entity_type),
                    canonical_identifier=concept.normalized_name,
                    attributes_json="{}",
                    confidence=_safe_float(raw.get("confidence"), 0.0),
                    run_id=run.id,
                ))

        for (source_id, concept_id), rows in coverage_groups.items():
            unit = rows[0][0]
            section = section_by_source[(unit["source_type"], source_id)]
            confidences = [_safe_float(row[1].get("confidence"), 0.0) for row in rows]
            db.add(ConceptCoverage(
                id=str(uuid4()), run_id=run.id, user_id=resource.user_id,
                resource_id=resource.id, section_id=section.id,
                concept_id=concept_id,
                confidence=sum(confidences) / len(confidences),
                occurrence_role=str(
                    max(rows, key=lambda row: row[5])[1].get("occurrence_role")
                    or "explained"
                ),
                discussion_duration=sum(row[5] for row in rows),
                evidence_count=len(rows),
                evidence_json=_json([
                    {
                        "text": str(row[1].get("evidence_text") or "")[:2000],
                        "start_seconds": row[3],
                        "end_seconds": row[4],
                    } for row in rows
                ]),
                start_seconds=min(row[3] for row in rows),
                end_seconds=max(row[4] for row in rows),
            ))
        _update_stage(db, run, job, "resource_references", 42)

        existing_alias_keys = {
            (row.concept_id, row.normalized_alias)
            for row in db.query(ConceptAlias).filter(
                ConceptAlias.user_id == resource.user_id,
                ConceptAlias.status == "approved",
            ).all()
        }
        for group in admitted:
            concept = concept_by_name.get(group["normalized"])
            if not concept:
                continue
            for alias in {group["canonical"], *group["aliases"]}:
                normalized_alias = normalize_term(alias)
                key = (concept.id, normalized_alias)
                if not normalized_alias or key in existing_alias_keys:
                    continue
                db.add(ConceptAlias(
                    id=str(uuid4()), concept_id=concept.id,
                    user_id=resource.user_id, alias=alias,
                    normalized_alias=normalized_alias,
                    language=str(profile.get("language") or "unknown"),
                    domain=domain, confidence=group["score"],
                    status="approved", provenance="knowledge_generation",
                    run_id=run.id,
                ))
                existing_alias_keys.add(key)
        _update_stage(db, run, job, "entity_resolution", 48)

        semantic_edge_count = 0
        relationship_review_count = 0
        for unit, data in extracted:
            relationships = data.get("relationships", [])
            if not isinstance(relationships, list):
                continue
            unit_text = normalize_term(unit["text"])
            for raw in relationships:
                if not isinstance(raw, dict):
                    continue
                relationship_type = str(raw.get("type") or "").lower()
                confidence = _safe_float(raw.get("confidence"), 0.0)
                evidence = str(raw.get("evidence_text") or "").strip()
                evidence_normalized = normalize_term(evidence)
                if (
                    relationship_type not in RELATIONSHIP_TYPES
                    or confidence < RELATIONSHIP_REVIEW_THRESHOLD
                    or len(evidence.split()) < MIN_EVIDENCE_WORDS
                    or not evidence_normalized
                    or (
                        evidence_normalized not in unit_text
                        and len(
                            _content_tokens(evidence)
                            & _content_tokens(unit["text"])
                        ) / max(1, len(_content_tokens(evidence))) < 0.55
                    )
                ):
                    continue
                source = concept_by_name.get(
                    normalize_term(str(raw.get("source") or ""))
                )
                target = concept_by_name.get(
                    normalize_term(str(raw.get("target") or ""))
                )
                if not source or not target or source.id == target.id:
                    continue
                start = float(unit["start_seconds"])
                end = float(unit["end_seconds"])
                if confidence < RELATIONSHIP_THRESHOLD:
                    db.add(RelationshipReviewCandidate(
                        id=str(uuid4()), run_id=run.id,
                        user_id=resource.user_id,
                        resource_id=resource.id,
                        source_concept_id=source.id,
                        target_concept_id=target.id,
                        relationship_type=relationship_type,
                        confidence=confidence,
                        evidence_text=evidence[:2000],
                        start_seconds=start,
                        end_seconds=end,
                        status="pending",
                    ))
                    relationship_review_count += 1
                    continue
                relationship = db.query(ConceptRelationship).filter(
                    ConceptRelationship.user_id == resource.user_id,
                    ConceptRelationship.source_concept_id == source.id,
                    ConceptRelationship.target_concept_id == target.id,
                    ConceptRelationship.relationship_type == relationship_type,
                ).first()
                if not relationship:
                    relationship = ConceptRelationship(
                        id=str(uuid4()), user_id=resource.user_id,
                        source_concept_id=source.id,
                        target_concept_id=target.id,
                        relationship_type=relationship_type,
                        confidence=confidence, evidence_count=0, archived=0,
                    )
                    db.add(relationship)
                    db.flush()
                db.add(RelationshipEvidence(
                    id=str(uuid4()), relationship_id=relationship.id,
                    run_id=run.id, resource_id=resource.id,
                    evidence_text=evidence[:2000], confidence=confidence,
                    start_seconds=start, end_seconds=end,
                ))
                semantic_edge_count += 1
                affected.update({source.id, target.id})
        _update_stage(db, run, job, "relationship_extraction", 58)

        for stage, progress in (
            ("timeline_builder", 64),
            ("learning_order", 69),
            ("difficulty_engine", 74),
            ("frequency_engine", 79),
            ("cross_resource_intelligence", 84),
            ("concept_summaries", 88),
        ):
            _update_stage(db, run, job, stage, progress)

        validation_metrics = _validate_publication(
            db, resource, run, units, affected,
            previous_run_id, previous_fingerprint,
        )
        metrics = _loads(run.metrics_json, {})
        metrics.update(validation_metrics)
        metrics.update({
            "alias_merge_count": alias_merge_count,
            "alias_review_count": (
                db.query(AliasCandidate).filter(
                    AliasCandidate.run_id == run.id
                ).count() - alias_review_count_before
            ),
            "covers_edge_count": db.query(ConceptCoverage).filter(
                ConceptCoverage.run_id == run.id
            ).count(),
            "semantic_edge_count": semantic_edge_count,
            "relationship_review_count": relationship_review_count,
            "graph_size_before": graph_size_before,
            "graph_size_after": len(affected),
            "model_version": configured_model,
        })
        run.metrics_json = _json(metrics)
        _set_checkpoint(run, "publication_validation")
        db.flush()

        state.active_run_id = run.id
        state.active_version = run.version
        state.source_fingerprint = fingerprint
        has_published_concepts = bool(affected)
        state.status = "ready" if has_published_concepts else "ready_empty"
        state.stale_reasons = "[]"
        state.generated_at = datetime.utcnow()
        state.updated_at = datetime.utcnow()
        run.status = "completed"
        run.current_stage = "global_graph_publish"
        run.progress = 94
        run.published_at = datetime.utcnow()
        run.finished_at = datetime.utcnow()
        db.flush()

        _recalculate_graph(db, resource.user_id, affected)
        _update_stage(db, run, job, "concept_analytics", 96)
        _rebuild_recommendations(db, resource.user_id, affected)
        _update_stage(db, run, job, "recommendation_engine", 98)

        if previous_run_id and previous_run_id != run.id:
            old_concept_ids = _cleanup_run_staging(db, previous_run_id)
            affected.update(old_concept_ids)
            _recalculate_graph(db, resource.user_id, affected)

        run.current_stage = "complete"
        run.progress = 100
        _set_checkpoint(run, "complete")
        job.current_stage = "complete"
        job.progress = 100
        job.heartbeat_at = datetime.utcnow()
        db.commit()
        _RUN_MEMORY_CACHE.pop(run.id, None)
        return "completed" if has_published_concepts else "completed_empty"

    except KnowledgePipelineControl as control:
        db.rollback()
        resource = db.query(Resource).filter(Resource.id == resource_id).first()
        run = db.query(KnowledgeRun).filter(
            KnowledgeRun.job_id == job_id
        ).first()
        if run:
            if control.status == "cancelled":
                _cleanup_run_staging(db, run.id)
                _RUN_MEMORY_CACHE.pop(run.id, None)
            run.status = control.status
            run.current_stage = control.status
            run.finished_at = (
                datetime.utcnow() if control.status == "cancelled" else None
            )
        if resource:
            state = get_or_create_knowledge_state(db, resource)
            if state.active_run_id:
                state.status = (
                    "ready"
                    if db.query(ConceptMention.id).filter(
                        ConceptMention.run_id == state.active_run_id
                    ).first()
                    else "ready_empty"
                )
            else:
                state.status = "not_generated"
            state.updated_at = datetime.utcnow()
        db.commit()
        return control.status
    except Exception as exc:
        from services.dependency_failure_service import DependencyFailure

        db.rollback()
        resource = db.query(Resource).filter(Resource.id == resource_id).first()
        job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
        run = db.query(KnowledgeRun).filter(
            KnowledgeRun.job_id == job_id
        ).first()
        temporary = (
            isinstance(exc, DependencyFailure)
            and exc.code in TEMPORARY_FAILURE_CODES
        )
        if run:
            if temporary:
                recovery_metrics = _loads(run.metrics_json, {})
                recovery_metrics["temporary_failure_count"] = recovery_metrics.get("temporary_failure_count", 0) + 1
                run.metrics_json = _json(recovery_metrics)
                run.status = "waiting_for_connection"
                run.error_message = exc.safe_detail
                run.finished_at = None
            else:
                _cleanup_run_staging(db, run.id)
                _RUN_MEMORY_CACHE.pop(run.id, None)
                run.status = "failed"
                run.error_message = str(exc)[:2000]
                run.finished_at = datetime.utcnow()
        if resource:
            state = get_or_create_knowledge_state(db, resource)
            current_fingerprint = _source_fingerprint(resource, db)
            if temporary and not state.active_run_id:
                state.status = "waiting_for_connection"
            else:
                state.status = (
                    "stale"
                    if state.active_run_id
                    and state.source_fingerprint != current_fingerprint
                    else (
                        (
                            "ready"
                            if db.query(ConceptMention.id).filter(
                                ConceptMention.run_id == state.active_run_id
                            ).first()
                            else "ready_empty"
                        )
                        if state.active_run_id else "failed"
                    )
                )
            state.updated_at = datetime.utcnow()
        if job:
            job.retryable = 1
            if temporary:
                job.current_stage = "waiting_for_connection"
                job.last_error_code = exc.code
        db.commit()
        raise
    finally:
        db.close()


def _active_mentions(db: Session, user_id: str):
    return (
        db.query(ConceptMention)
        .join(ResourceKnowledgeState, ResourceKnowledgeState.active_run_id == ConceptMention.run_id)
        .join(Resource, Resource.id == ConceptMention.resource_id)
        .filter(
            ConceptMention.user_id == user_id,
            ResourceKnowledgeState.user_id == user_id,
            Resource.is_deleted == 0,
        )
    )


def _active_coverages(db: Session, user_id: str):
    return db.query(ConceptCoverage).join(
        ResourceKnowledgeState,
        ResourceKnowledgeState.active_run_id == ConceptCoverage.run_id,
    ).join(Resource, Resource.id == ConceptCoverage.resource_id).filter(
        ConceptCoverage.user_id == user_id,
        ResourceKnowledgeState.user_id == user_id,
        Resource.is_deleted == 0,
    )


def graph_payload(
    db: Session,
    user_id: str,
    domain: str | None = None,
    resource_id: str | None = None,
    concept_type: str | None = None,
    min_confidence: float = 0.0,
    difficulty: str | None = None,
    relationship_type: str | None = None,
    playlist_id: str | None = None,
) -> dict[str, Any]:
    mention_query = _active_mentions(db, user_id)
    coverage_query = _active_coverages(db, user_id)
    if resource_id:
        mention_query = mention_query.filter(
            ConceptMention.resource_id == resource_id
        )
        coverage_query = coverage_query.filter(
            ConceptCoverage.resource_id == resource_id
        )
    if playlist_id:
        mention_query = mention_query.join(
            Folder, Folder.id == Resource.folder_id
        ).filter(Folder.playlist_id == playlist_id, Folder.user_id == user_id)
        coverage_query = coverage_query.join(
            Folder, Folder.id == Resource.folder_id
        ).filter(Folder.playlist_id == playlist_id, Folder.user_id == user_id)

    mentions = mention_query.all()
    coverages = coverage_query.all()
    concept_ids = {
        *[mention.concept_id for mention in mentions],
        *[coverage.concept_id for coverage in coverages],
    }
    concepts_query = db.query(Concept).filter(
        Concept.id.in_(concept_ids) if concept_ids else False,
        Concept.user_id == user_id,
        Concept.archived == 0,
        func.coalesce(Concept.confidence, 0.0) >= min_confidence,
    )
    if domain:
        concepts_query = concepts_query.filter(Concept.domain == domain)
    if concept_type:
        concepts_query = concepts_query.filter(
            Concept.concept_type == concept_type
        )
    if difficulty:
        concepts_query = concepts_query.filter(Concept.difficulty == difficulty)
    concepts = concepts_query.all()
    allowed_ids = {concept.id for concept in concepts}

    aliases_by_concept: dict[str, list[str]] = defaultdict(list)
    if allowed_ids:
        for alias in db.query(ConceptAlias).filter(
            ConceptAlias.user_id == user_id,
            ConceptAlias.status == "approved",
            ConceptAlias.concept_id.in_(allowed_ids),
        ).all():
            aliases_by_concept[alias.concept_id].append(alias.alias)

    analytics_by_id = {
        row.concept_id: row for row in db.query(ConceptAnalytics).filter(
            ConceptAnalytics.user_id == user_id,
            ConceptAnalytics.concept_id.in_(allowed_ids)
            if allowed_ids else False,
        ).all()
    }
    mentions_by_concept: dict[str, list[ConceptMention]] = defaultdict(list)
    for mention in mentions:
        if mention.concept_id in allowed_ids:
            mentions_by_concept[mention.concept_id].append(mention)

    def format_seconds(value: float | None) -> str:
        if value is None:
            return "--"
        seconds = max(0, int(value))
        return f"{seconds // 60:02d}:{seconds % 60:02d}"

    nodes: list[dict[str, Any]] = []
    for concept in concepts:
        analytics = analytics_by_id.get(concept.id)
        visible_mentions = mentions_by_concept.get(concept.id, [])
        visible_confidence = (
            sum(item.confidence for item in visible_mentions)
            / len(visible_mentions)
            if visible_mentions else (concept.confidence or 0.0)
        )
        mention_times = [
            item.start_seconds for item in visible_mentions
            if item.start_seconds is not None
        ]
        nodes.append({
            "id": concept.id,
            "node_type": "concept",
            "name": concept.canonical_name or concept.name,
            "description": concept.description or "",
            "summary": concept.summary or concept.description or "",
            "type": concept.concept_type or "concept",
            "domain": concept.domain or "general",
            "confidence": round(visible_confidence * 100),
            "difficulty": concept.difficulty or "Intermediate",
            "learning_stage": concept.learning_stage or "Practical",
            "prerequisites": _loads(concept.prerequisites, []),
            "examples": _loads(concept.examples, []),
            "common_mistakes": _loads(concept.common_mistakes, []),
            "recommended_next_topic": concept.recommended_next_topic,
            "aliases": aliases_by_concept.get(concept.id, []),
            "mentions": (analytics.meaningful_occurrence_count if analytics else len(visible_mentions)),
            "raw_mentions": len(visible_mentions),
            "discussion_duration_seconds": (analytics.discussion_duration_seconds if analytics else 0.0),
            "resource_count": len({
                item.resource_id for item in visible_mentions
            }),
            "importance": round(analytics.popularity if analytics else 0.0),
            "favorite": bool(concept.is_favorite),
            "learning_order": analytics.learning_order if analytics else None,
            "first": (
                format_seconds(min(mention_times)) if mention_times else "--"
            ),
            "last": (
                format_seconds(max(mention_times)) if mention_times else "--"
            ),
        })

    visible_coverages = [
        coverage for coverage in coverages
        if coverage.concept_id in allowed_ids
    ]
    section_ids = {coverage.section_id for coverage in visible_coverages}
    sections = db.query(KnowledgeSourceSection).filter(
        KnowledgeSourceSection.id.in_(section_ids)
        if section_ids else False,
        KnowledgeSourceSection.user_id == user_id,
    ).all()
    resources = {
        item.id: item for item in db.query(Resource).filter(
            Resource.id.in_({section.resource_id for section in sections})
            if sections else False,
            Resource.user_id == user_id,
        ).all()
    }
    chapters = {
        item.id: item for item in db.query(Chapter).filter(
            Chapter.id.in_({
                section.chapter_id for section in sections
                if section.chapter_id
            }) if sections else False
        ).all()
    }
    subchapters = {
        item.id: item for item in db.query(SubChapter).filter(
            SubChapter.id.in_({
                section.subchapter_id for section in sections
                if section.subchapter_id
            }) if sections else False
        ).all()
    }
    for section in sections:
        resource = resources.get(section.resource_id)
        source = (
            subchapters.get(section.subchapter_id)
            if section.source_type == "subchapter"
            else chapters.get(section.chapter_id)
        )
        nodes.append({
            "id": f"section:{section.id}",
            "section_id": section.id,
            "node_type": section.source_type,
            "type": section.source_type,
            "name": section.title,
            "description": "",
            "summary": getattr(source, "summary", None) or "",
            "confidence": 100,
            "difficulty": "",
            "learning_stage": "Source",
            "aliases": [],
            "mentions": 0,
            "resource_count": 1,
            "importance": 0,
            "favorite": bool(getattr(source, "is_favorite", 0)),
            "resource_id": section.resource_id,
            "resource_title": resource.title if resource else "",
            "resource_type": resource.type if resource else "",
            "chapter_id": section.chapter_id,
            "subchapter_id": section.subchapter_id,
            "start_seconds": section.start_seconds,
            "end_seconds": section.end_seconds,
            "first": format_seconds(section.start_seconds),
            "last": format_seconds(section.end_seconds),
        })

    edge_payload: list[dict[str, Any]] = []
    if relationship_type in {None, "", "covers"}:
        edge_payload.extend({
            "id": f"coverage:{coverage.id}",
            "source": f"section:{coverage.section_id}",
            "target": coverage.concept_id,
            "type": "covers",
            "edge_kind": "covers",
            "confidence": round(coverage.confidence * 100),
            "evidence_count": coverage.evidence_count,
            "discussion_duration": coverage.discussion_duration,
            "occurrence_role": coverage.occurrence_role,
            "start_seconds": coverage.start_seconds,
            "end_seconds": coverage.end_seconds,
            "evidence": _loads(coverage.evidence_json, []),
        } for coverage in visible_coverages)

    if relationship_type != "covers":
        edge_query = db.query(ConceptRelationship).filter(
            ConceptRelationship.user_id == user_id,
            ConceptRelationship.archived == 0,
            ConceptRelationship.confidence >= RELATIONSHIP_THRESHOLD,
            ConceptRelationship.source_concept_id.in_(allowed_ids)
            if allowed_ids else False,
            ConceptRelationship.target_concept_id.in_(allowed_ids)
            if allowed_ids else False,
        )
        if relationship_type:
            edge_query = edge_query.filter(
                ConceptRelationship.relationship_type == relationship_type
            )
        edge_payload.extend({
            "id": edge.id,
            "source": edge.source_concept_id,
            "target": edge.target_concept_id,
            "type": edge.relationship_type,
            "edge_kind": "semantic",
            "confidence": round(edge.confidence * 100),
            "evidence_count": edge.evidence_count,
        } for edge in edge_query.all())

    settings = db.query(UserSetting).filter(
        UserSetting.user_id == user_id
    ).first()
    semantic_count = sum(
        1 for edge in edge_payload if edge["edge_kind"] == "semantic"
    )
    generated_resource_query = db.query(ResourceKnowledgeState.resource_id).join(
        Resource, Resource.id == ResourceKnowledgeState.resource_id
    ).filter(
        ResourceKnowledgeState.user_id == user_id,
        ResourceKnowledgeState.active_run_id.isnot(None),
        Resource.user_id == user_id,
        Resource.is_deleted == 0,
    )
    if resource_id:
        generated_resource_query = generated_resource_query.filter(
            ResourceKnowledgeState.resource_id == resource_id
        )
    generated_resource_ids = {
        row[0] for row in generated_resource_query.distinct().all()
    }
    published_resource_ids = {
        row[0] for row in _active_mentions(db, user_id)
        .with_entities(ConceptMention.resource_id)
        .filter(
            ConceptMention.resource_id.in_(generated_resource_ids)
            if generated_resource_ids else False
        )
        .distinct().all()
    }
    return {
        "scope": "library",
        "nodes": nodes,
        "edges": edge_payload,
        "generation": {
            "completed_resources": len(generated_resource_ids),
            "published_resources": len(published_resource_ids),
            "empty_resources": len(
                generated_resource_ids - published_resource_ids
            ),
        },
        "preferences": _knowledge_view_preferences(settings),
        "stats": {
            "concepts": len(concepts),
            "relationships": semantic_count,
            "source_sections": len(sections),
            "coverage_links": len(visible_coverages),
            "resources": len({mention.resource_id for mention in mentions}),
            "average_confidence": (
                round(sum(
                    node["confidence"] for node in nodes
                    if node["node_type"] == "concept"
                ) / len(concepts)) if concepts else 0
            ),
        },
    }


def set_concept_favorite(
    db: Session,
    user_id: str,
    concept_id: str,
    favorite: bool,
) -> Concept | None:
    concept = db.query(Concept).filter(
        Concept.id == concept_id,
        Concept.user_id == user_id,
        Concept.archived == 0,
    ).first()
    if not concept:
        return None
    concept.is_favorite = 1 if favorite else 0
    db.commit()
    db.refresh(concept)
    return concept


def rename_concept(
    db: Session,
    user_id: str,
    concept_id: str,
    name: str,
) -> Concept | None:
    clean_name = re.sub(r"\s+", " ", name.strip())
    if not clean_name:
        raise ValueError("Concept name cannot be empty")
    concept = db.query(Concept).filter(
        Concept.id == concept_id,
        Concept.user_id == user_id,
        Concept.archived == 0,
    ).first()
    if not concept:
        return None
    normalized = normalize_term(clean_name)
    duplicate = db.query(Concept.id).filter(
        Concept.user_id == user_id,
        Concept.domain == concept.domain,
        Concept.normalized_name == normalized,
        Concept.archived == 0,
        Concept.id != concept.id,
    ).first()
    if duplicate:
        raise ValueError("A concept with this name already exists in this domain")
    old_name = concept.canonical_name or concept.name
    old_normalized = concept.normalized_name or normalize_term(old_name)
    concept.canonical_name = clean_name
    concept.normalized_name = normalized
    alias_exists = db.query(ConceptAlias.id).filter(
        ConceptAlias.concept_id == concept.id,
        ConceptAlias.normalized_alias == old_normalized,
        ConceptAlias.status == "approved",
    ).first()
    if old_normalized and old_normalized != normalized and not alias_exists:
        db.add(ConceptAlias(
            id=str(uuid4()), concept_id=concept.id, user_id=user_id,
            alias=old_name, normalized_alias=old_normalized,
            language="unknown", domain=concept.domain,
            confidence=1.0, status="approved",
            provenance="user_rename", run_id=None,
        ))
    db.commit()
    db.refresh(concept)
    return concept


def delete_concept(
    db: Session,
    user_id: str,
    concept_id: str,
) -> Concept | None:
    concept = db.query(Concept).filter(
        Concept.id == concept_id,
        Concept.user_id == user_id,
        Concept.archived == 0,
    ).first()
    if not concept:
        return None
    concept.archived = 1
    suppression = db.query(ConceptSuppression).filter(
        ConceptSuppression.user_id == user_id,
        ConceptSuppression.domain == (concept.domain or "general"),
        ConceptSuppression.normalized_name == concept.normalized_name,
    ).first()
    if not suppression:
        suppression = ConceptSuppression(
            id=str(uuid4()), user_id=user_id, concept_id=concept.id,
            domain=concept.domain or "general",
            normalized_name=concept.normalized_name,
            reason="user_deleted", active=1,
            created_at=datetime.utcnow(),
        )
        db.add(suppression)
    else:
        suppression.active = 1
        suppression.concept_id = concept.id
        suppression.reason = "user_deleted"
        suppression.restored_at = None
    db.commit()
    return concept


def restore_concept(
    db: Session,
    user_id: str,
    concept_id: str,
) -> Concept | None:
    concept = db.query(Concept).filter(
        Concept.id == concept_id,
        Concept.user_id == user_id,
    ).first()
    if not concept:
        return None
    concept.archived = 0
    suppressions = db.query(ConceptSuppression).filter(
        ConceptSuppression.user_id == user_id,
        ConceptSuppression.concept_id == concept.id,
        ConceptSuppression.active == 1,
    ).all()
    for suppression in suppressions:
        suppression.active = 0
        suppression.restored_at = datetime.utcnow()
    db.commit()
    return concept


def set_source_section_favorite(
    db: Session,
    user_id: str,
    section_id: str,
    favorite: bool,
) -> KnowledgeSourceSection | None:
    section = db.query(KnowledgeSourceSection).join(
        ResourceKnowledgeState,
        ResourceKnowledgeState.active_run_id == KnowledgeSourceSection.run_id,
    ).filter(
        KnowledgeSourceSection.id == section_id,
        KnowledgeSourceSection.user_id == user_id,
        ResourceKnowledgeState.user_id == user_id,
    ).first()
    if not section:
        return None
    source = (
        db.query(SubChapter).filter(
            SubChapter.id == section.subchapter_id
        ).first()
        if section.source_type == "subchapter"
        else db.query(Chapter).filter(Chapter.id == section.chapter_id).first()
    )
    if not source:
        return None
    source.is_favorite = 1 if favorite else 0
    db.commit()
    return section


def set_knowledge_node_distance(
    db: Session,
    user_id: str,
    distance: int,
) -> int:
    value = max(60, min(400, int(distance)))
    settings = db.query(UserSetting).filter(
        UserSetting.user_id == user_id
    ).first()
    if not settings:
        settings = UserSetting(id=str(uuid4()), user_id=user_id)
        db.add(settings)
    settings.knowledge_node_distance = value
    preferences = _knowledge_view_preferences(settings)
    preferences["node_distance"] = value
    settings.knowledge_view_preferences = _json(preferences)
    db.commit()
    return value


def set_knowledge_view_preferences(
    db: Session,
    user_id: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    settings = db.query(UserSetting).filter(
        UserSetting.user_id == user_id
    ).first()
    if not settings:
        settings = UserSetting(id=str(uuid4()), user_id=user_id)
        db.add(settings)

    preferences = _knowledge_view_preferences(settings)
    if "node_distance" in payload and payload["node_distance"] is not None:
        preferences["node_distance"] = max(60, min(400, int(payload["node_distance"])))
        settings.knowledge_node_distance = preferences["node_distance"]
    if payload.get("graph_layout") in {"organic", "radial", "learning"}:
        preferences["graph_layout"] = payload["graph_layout"]
    if payload.get("explorer_group") in {"none", "favorite", "chapter", "type", "difficulty"}:
        preferences["explorer_group"] = payload["explorer_group"]
    if isinstance(payload.get("filters"), dict):
        filters = payload["filters"]
        preferences["filters"] = {
            "difficulty": [
                item for item in filters.get("difficulty", [])
                if item in {"Beginner", "Intermediate", "Advanced"}
            ],
            "types": [
                item for item in filters.get("types", [])
                if item in {"concept", "definition", "example", "warning", "advanced", "subchapter"}
            ],
            "favorites_only": bool(filters.get("favorites_only")),
        }

    settings.knowledge_view_preferences = _json(preferences)
    db.commit()
    return preferences


def concept_payload(db: Session, user_id: str, concept_id: str) -> dict[str, Any] | None:
    graph = graph_payload(db, user_id)
    node = next((item for item in graph["nodes"] if item["id"] == concept_id), None)
    if not node:
        return None
    node["references"] = concept_references(db, user_id, concept_id)
    node["recommendations"] = recommendation_payload(db, user_id, concept_id=concept_id)
    return node


def concept_references(db: Session, user_id: str, concept_id: str) -> list[dict[str, Any]]:
    visible = db.query(Concept.id).filter(
        Concept.id == concept_id, Concept.user_id == user_id,
        Concept.archived == 0,
    ).first()
    if not visible:
        return []
    mentions = _active_mentions(db, user_id).filter(ConceptMention.concept_id == concept_id).order_by(
        ConceptMention.resource_id, ConceptMention.start_seconds
    ).all()
    resources = {
        resource.id: resource for resource in db.query(Resource).filter(
            Resource.id.in_({mention.resource_id for mention in mentions}) if mentions else False,
            Resource.user_id == user_id,
        ).all()
    }
    return [{
        "mention_id": mention.id,
        "resource_id": mention.resource_id,
        "resource_title": resources[mention.resource_id].title if mention.resource_id in resources else "",
        "resource_type": resources[mention.resource_id].type if mention.resource_id in resources else "",
        "source_type": mention.source_type,
        "source_id": mention.source_id,
        "role": mention.occurrence_role,
        "evidence_text": mention.evidence_text,
        "confidence": mention.confidence,
        "jump_target": {
            "resource_id": mention.resource_id,
            "resource_type": resources[mention.resource_id].type if mention.resource_id in resources else "",
            "source_type": mention.source_type,
            "source_id": mention.source_id,
            "start_seconds": mention.start_seconds,
            "end_seconds": mention.end_seconds,
            "page_number": mention.page_number,
            "paragraph_index": mention.paragraph_index,
            "text_start": mention.text_start,
            "text_end": mention.text_end,
        },
    } for mention in mentions]


def timeline_payload(db: Session, user_id: str, concept_id: str) -> list[dict[str, Any]]:
    return sorted(
        concept_references(db, user_id, concept_id),
        key=lambda item: (
            item["jump_target"]["start_seconds"] is None,
            item["jump_target"]["start_seconds"] or 0,
        ),
    )


def analytics_payload(db: Session, user_id: str, concept_id: str) -> dict[str, Any] | None:
    row = db.query(ConceptAnalytics).join(
        Concept, Concept.id == ConceptAnalytics.concept_id
    ).filter(
        ConceptAnalytics.concept_id == concept_id,
        ConceptAnalytics.user_id == user_id,
        Concept.user_id == user_id, Concept.archived == 0,
    ).first()
    if not row:
        return None
    return {
        "concept_id": row.concept_id,
        "mention_count": row.mention_count,
        "meaningful_occurrence_count": row.meaningful_occurrence_count,
        "discussion_duration_seconds": row.discussion_duration_seconds,
        "raw_phrase_occurrences": row.raw_phrase_occurrences,
        "resource_count": row.resource_count,
        "chapter_count": row.chapter_count,
        "relationship_count": row.relationship_count,
        "popularity": row.popularity,
        "average_confidence": row.average_confidence,
        "difficulty_score": row.difficulty_score,
        "learning_order": row.learning_order,
        "growth": row.growth,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def recommendation_payload(
    db: Session,
    user_id: str,
    concept_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    query = db.query(ConceptRecommendation).filter(ConceptRecommendation.user_id == user_id)
    if concept_id:
        query = query.filter(ConceptRecommendation.concept_id == concept_id)
    rows = query.order_by(ConceptRecommendation.score.desc()).limit(limit).all()
    event_counts = {
        target_id: count
        for target_id, count in db.query(StudyEvent.concept_id, func.count(StudyEvent.id))
        .filter(StudyEvent.user_id == user_id, StudyEvent.concept_id.isnot(None))
        .group_by(StudyEvent.concept_id)
        .all()
    }
    concept_ids = {row.recommended_concept_id for row in rows if row.recommended_concept_id}
    concepts = {
        item.id: item for item in db.query(Concept).filter(
            Concept.id.in_(concept_ids) if concept_ids else False,
            Concept.user_id == user_id,
        ).all()
    }
    return [{
        "id": row.id,
        "concept_id": row.concept_id,
        "recommended_concept_id": row.recommended_concept_id,
        "recommended_concept_name": (
            concepts[row.recommended_concept_id].canonical_name
            if row.recommended_concept_id in concepts else None
        ),
        "resource_id": row.resource_id,
        "type": row.recommendation_type,
        "score": min(1.0, row.score + min(0.15, event_counts.get(row.recommended_concept_id, 0) * 0.01)),
        "personalized": event_counts.get(row.recommended_concept_id, 0) > 0,
        "explanation": row.explanation,
        "jump_target": _loads(row.jump_target_json, None),
    } for row in rows]


def resolve_alias_candidate(
    db: Session,
    user_id: str,
    candidate_id: str,
    decision: str,
) -> AliasCandidate | None:
    candidate = db.query(AliasCandidate).filter(
        AliasCandidate.id == candidate_id,
        AliasCandidate.user_id == user_id,
        AliasCandidate.status == "pending",
    ).first()
    if not candidate:
        return None
    if decision not in {"approve", "reject"}:
        raise ValueError("decision must be approve or reject")
    candidate.status = "approved" if decision == "approve" else "rejected"
    candidate.resolved_at = datetime.utcnow()
    if decision == "approve" and candidate.concept_id:
        existing = db.query(ConceptAlias).filter(
            ConceptAlias.concept_id == candidate.concept_id,
            ConceptAlias.normalized_alias == candidate.normalized_alias,
            ConceptAlias.status == "approved",
        ).first()
        if not existing:
            db.add(ConceptAlias(
                id=str(uuid4()), concept_id=candidate.concept_id, user_id=user_id,
                alias=candidate.alias, normalized_alias=candidate.normalized_alias,
                domain=candidate.domain, confidence=candidate.confidence,
                status="approved", provenance="human_review", run_id=candidate.run_id,
            ))
    db.commit()
    return candidate


def delete_resource_knowledge(db: Session, resource_id: str, user_id: str) -> None:
    """Remove one resource's graph contribution without touching shared canonical nodes."""
    runs = db.query(KnowledgeRun).filter(
        KnowledgeRun.resource_id == resource_id,
        KnowledgeRun.user_id == user_id,
    ).all()
    run_ids = [run.id for run in runs]
    affected = {
        row[0] for row in db.query(ConceptMention.concept_id)
        .filter(ConceptMention.run_id.in_(run_ids) if run_ids else False)
        .all()
    }
    if run_ids:
        db.query(ConceptAlias).filter(
            ConceptAlias.run_id.in_(run_ids)
        ).update({ConceptAlias.run_id: None}, synchronize_session=False)
        db.query(RelationshipEvidence).filter(
            RelationshipEvidence.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
        db.query(ConceptMention).filter(
            ConceptMention.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
        db.query(EntityIdentity).filter(
            EntityIdentity.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
        db.query(AliasCandidate).filter(
            AliasCandidate.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
        db.query(ResourceKnowledgeProfile).filter(
            ResourceKnowledgeProfile.run_id.in_(run_ids)
        ).delete(synchronize_session=False)
    db.query(ConceptRecommendation).filter(
        ConceptRecommendation.user_id == user_id,
        ConceptRecommendation.resource_id == resource_id,
    ).delete(synchronize_session=False)
    db.query(ResourceKnowledgeState).filter(
        ResourceKnowledgeState.resource_id == resource_id,
        ResourceKnowledgeState.user_id == user_id,
    ).delete(synchronize_session=False)
    if run_ids:
        db.query(KnowledgeRun).filter(
            KnowledgeRun.id.in_(run_ids)
        ).delete(synchronize_session=False)
    if affected:
        _recalculate_graph(db, user_id, affected)
        _rebuild_recommendations(db, user_id, affected)
