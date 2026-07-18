"""Optional hierarchical retrieval enrichment layered on top of chunk retrieval."""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from core.config import ENABLE_HIERARCHICAL_RETRIEVAL, HIERARCHICAL_MAX_CONTEXT_TOKENS, HIERARCHICAL_MAX_NODE_TOKENS
from database import SessionLocal
from models import Chapter, Resource
from services.planner.planner_models import QueryClassification, RetrievalPlan


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "").strip()).lower()


def _score(result: dict) -> float:
    for key in ("rerank_score", "hybrid_score", "score"):
        value = result.get(key)
        if value is not None:
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
    distance = result.get("distance")
    if distance is not None:
        try:
            return -float(distance)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


class HierarchyLevel(str, Enum):
    CHILD = "child"
    SECTION = "section"
    CHAPTER = "chapter"
    DOCUMENT = "document"


@dataclass(frozen=True)
class HierarchicalDecision:
    should_enrich: bool
    reason: str
    selected_levels: tuple[HierarchyLevel, ...] = ()
    context_size_before_tokens: int = 0


@dataclass(frozen=True)
class HierarchicalNode:
    level: HierarchyLevel
    node_id: str
    resource_id: str
    label: str
    content: str
    score: float
    matched_chunk_indices: tuple[int, ...]
    chapter_id: str | None = None
    trimmed: bool = False


def decide_hierarchical_enrichment(
    query: str,
    results: list[dict],
    plan: RetrievalPlan | None = None,
    *,
    enabled: bool = ENABLE_HIERARCHICAL_RETRIEVAL,
    max_context_tokens: int = HIERARCHICAL_MAX_CONTEXT_TOKENS,
) -> HierarchicalDecision:
    """Decide whether higher-level document context should be added."""

    before_tokens = sum(_approx_tokens(item.get("content", "")) for item in results)
    if not enabled:
        return HierarchicalDecision(False, "disabled", context_size_before_tokens=before_tokens)
    if not results:
        return HierarchicalDecision(False, "no_results", context_size_before_tokens=before_tokens)
    if max_context_tokens - before_tokens < 48:
        return HierarchicalDecision(False, "insufficient_context_budget", context_size_before_tokens=before_tokens)

    available_section = any(
        (item.get("metadata") or {}).get("section_title") or (item.get("metadata") or {}).get("parent_heading")
        for item in results
    )
    available_chapter = any(
        (item.get("metadata") or {}).get("chapter_id") or (item.get("metadata") or {}).get("chapter_title")
        for item in results
    )
    available_document = any((item.get("metadata") or {}).get("resource_id") for item in results)
    if not any((available_section, available_chapter, available_document)):
        return HierarchicalDecision(False, "missing_hierarchy_metadata", context_size_before_tokens=before_tokens)

    query_classification = plan.query_classification if plan is not None else None
    if _child_results_self_contained(query_classification, results):
        return HierarchicalDecision(False, "child_chunks_self_contained", context_size_before_tokens=before_tokens)

    selected_levels: list[HierarchyLevel] = []
    if query_classification in {
        QueryClassification.COMPARISON,
        QueryClassification.EXPLANATION,
        QueryClassification.TROUBLESHOOTING,
        QueryClassification.PROCEDURAL,
        QueryClassification.FOLLOW_UP,
    }:
        if available_section:
            selected_levels.append(HierarchyLevel.SECTION)
        elif available_chapter:
            selected_levels.append(HierarchyLevel.CHAPTER)
    elif query_classification is QueryClassification.SUMMARIZATION:
        if available_chapter:
            selected_levels.append(HierarchyLevel.CHAPTER)
        elif available_document:
            selected_levels.append(HierarchyLevel.DOCUMENT)
    elif query_classification in {
        QueryClassification.BROAD_RESEARCH,
        QueryClassification.MULTI_DOCUMENT_REASONING,
    }:
        if available_section:
            selected_levels.append(HierarchyLevel.SECTION)
        if available_chapter:
            selected_levels.append(HierarchyLevel.CHAPTER)
        if available_document:
            selected_levels.append(HierarchyLevel.DOCUMENT)
    else:
        return HierarchicalDecision(False, "child_level_sufficient", context_size_before_tokens=before_tokens)

    deduped_levels = tuple(dict.fromkeys(selected_levels))
    if not deduped_levels:
        return HierarchicalDecision(False, "no_supported_hierarchy_level", context_size_before_tokens=before_tokens)
    return HierarchicalDecision(True, "selected_for_hierarchical_enrichment", deduped_levels, before_tokens)


def enrich_with_hierarchy(
    results: list[dict],
    query: str | None = None,
    plan: RetrievalPlan | None = None,
    *,
    enabled: bool = ENABLE_HIERARCHICAL_RETRIEVAL,
    max_context_tokens: int = HIERARCHICAL_MAX_CONTEXT_TOKENS,
    max_node_tokens: int = HIERARCHICAL_MAX_NODE_TOKENS,
) -> tuple[list[dict], dict]:
    """Add adaptive section/chapter/document nodes without replacing chunk retrieval."""

    details = {
        "enabled": bool(enabled),
        "success": False,
        "fallback": False,
        "reason": "",
        "selected": False,
        "selected_levels": [],
        "retrieved_nodes": [],
        "context_size_before_tokens": sum(_approx_tokens(item.get("content", "")) for item in results),
        "context_size_after_tokens": sum(_approx_tokens(item.get("content", "")) for item in results),
    }
    decision = decide_hierarchical_enrichment(
        query or "",
        results,
        plan,
        enabled=enabled,
        max_context_tokens=max_context_tokens,
    )
    details["reason"] = decision.reason
    details["selected"] = decision.should_enrich
    details["selected_levels"] = [level.value for level in decision.selected_levels]
    details["context_size_before_tokens"] = decision.context_size_before_tokens
    if not decision.should_enrich:
        details["fallback"] = True
        return results, details

    resource_lookup, chapter_lookup = _load_db_hierarchy_context(results)
    nodes: list[HierarchicalNode] = []
    for level in decision.selected_levels:
        if level is HierarchyLevel.SECTION:
            nodes.extend(_build_section_nodes(results, max_node_tokens=max_node_tokens))
        elif level is HierarchyLevel.CHAPTER:
            nodes.extend(_build_chapter_nodes(results, chapter_lookup, max_node_tokens=max_node_tokens))
        elif level is HierarchyLevel.DOCUMENT:
            nodes.extend(_build_document_nodes(results, resource_lookup, max_node_tokens=max_node_tokens))
    if not nodes:
        details["reason"] = "no_hierarchy_nodes_built"
        details["fallback"] = True
        return results, details

    remaining_budget = max(0, max_context_tokens - details["context_size_before_tokens"])
    selected_nodes = _select_nodes_within_budget(nodes, remaining_budget, max_node_tokens=max_node_tokens)
    if not selected_nodes:
        details["reason"] = "budget_filtered_all_nodes"
        details["fallback"] = True
        return results, details

    enriched = list(results)
    seen_keys = {
        (
            (item.get("metadata") or {}).get("resource_id"),
            (item.get("metadata") or {}).get("hierarchy_node_id"),
            _normalize(item.get("content", "")),
        )
        for item in enriched
    }
    for node in selected_nodes:
        key = (node.resource_id, node.node_id, _normalize(node.content))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        enriched.append({
            "chunk_index": min(node.matched_chunk_indices) if node.matched_chunk_indices else -1,
            "content": node.content,
            "metadata": {
                "resource_id": node.resource_id,
                "chunk_index": min(node.matched_chunk_indices) if node.matched_chunk_indices else -1,
                "chapter_id": node.chapter_id,
                "hierarchy_node": True,
                "hierarchy_level": node.level.value,
                "hierarchy_node_id": node.node_id,
                "hierarchy_label": node.label,
                "matched_child_chunk_indices": list(node.matched_chunk_indices),
                "hierarchy_trimmed": node.trimmed,
            },
            "hierarchy_score": node.score,
        })

    details["success"] = True
    details["retrieved_nodes"] = [
        {
            "resource_id": node.resource_id,
            "chapter_id": node.chapter_id,
            "level": node.level.value,
            "node_id": node.node_id,
            "label": node.label,
            "matched_child_chunk_indices": list(node.matched_chunk_indices),
            "trimmed": node.trimmed,
        }
        for node in selected_nodes
    ]
    details["context_size_after_tokens"] = sum(_approx_tokens(item.get("content", "")) for item in enriched)
    return enriched, details


def _child_results_self_contained(query_classification: QueryClassification | None, results: list[dict]) -> bool:
    if not results:
        return False
    if query_classification not in {
        QueryClassification.DEFINITION,
        QueryClassification.SIMPLE_FACT,
        QueryClassification.EXACT_LOOKUP,
    }:
        return False
    top = results[0]
    return _score(top) >= 0.82 and _approx_tokens(top.get("content", "")) >= 28


def _load_db_hierarchy_context(results: list[dict]) -> tuple[dict[str, Resource], dict[str, Chapter]]:
    resource_ids = sorted({
        str((item.get("metadata") or {}).get("resource_id"))
        for item in results
        if (item.get("metadata") or {}).get("resource_id")
    })
    chapter_ids = sorted({
        str((item.get("metadata") or {}).get("chapter_id"))
        for item in results
        if (item.get("metadata") or {}).get("chapter_id")
    })
    if not resource_ids and not chapter_ids:
        return {}, {}
    db = SessionLocal()
    try:
        resources = (
            db.query(Resource)
            .filter(Resource.id.in_(resource_ids))
            .all()
            if resource_ids else []
        )
        chapters = (
            db.query(Chapter)
            .filter(Chapter.id.in_(chapter_ids))
            .all()
            if chapter_ids else []
        )
        return (
            {str(row.id): row for row in resources},
            {str(row.id): row for row in chapters},
        )
    except Exception:
        return {}, {}
    finally:
        db.close()


def _build_section_nodes(results: list[dict], *, max_node_tokens: int) -> list[HierarchicalNode]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for item in results:
        metadata = item.get("metadata") or {}
        resource_id = str(metadata.get("resource_id") or "")
        label = str(metadata.get("section_title") or metadata.get("parent_heading") or "").strip()
        if not resource_id or not label:
            continue
        grouped.setdefault((resource_id, label), []).append(item)

    nodes: list[HierarchicalNode] = []
    for (resource_id, label), matches in grouped.items():
        ordered = sorted(matches, key=_score, reverse=True)
        snippets = _unique_snippets(ordered, limit=3)
        body = f"Section: {label}\n\n" + "\n\n".join(snippets)
        content, trimmed = _trim_text(body, max_node_tokens)
        nodes.append(
            HierarchicalNode(
                level=HierarchyLevel.SECTION,
                node_id=f"section:{resource_id}:{_normalize(label)}",
                resource_id=resource_id,
                label=label,
                content=content,
                score=max(_score(item) for item in ordered),
                matched_chunk_indices=_matched_indices(ordered),
                chapter_id=str((ordered[0].get("metadata") or {}).get("chapter_id") or "") or None,
                trimmed=trimmed,
            )
        )
    return sorted(nodes, key=lambda node: node.score, reverse=True)


def _build_chapter_nodes(
    results: list[dict],
    chapter_lookup: dict[str, Chapter],
    *,
    max_node_tokens: int,
) -> list[HierarchicalNode]:
    grouped: dict[tuple[str, str], list[dict]] = {}
    for item in results:
        metadata = item.get("metadata") or {}
        resource_id = str(metadata.get("resource_id") or "")
        chapter_id = str(metadata.get("chapter_id") or metadata.get("chapter_title") or "").strip()
        if not resource_id or not chapter_id:
            continue
        grouped.setdefault((resource_id, chapter_id), []).append(item)

    nodes: list[HierarchicalNode] = []
    for (resource_id, chapter_key), matches in grouped.items():
        ordered = sorted(matches, key=_score, reverse=True)
        metadata = ordered[0].get("metadata") or {}
        chapter_row = chapter_lookup.get(str(metadata.get("chapter_id") or ""))
        label = str(
            metadata.get("chapter_title")
            or getattr(chapter_row, "title", "")
            or chapter_key
        ).strip()
        summary = str(
            getattr(chapter_row, "summary", "")
            or metadata.get("chapter_summary", "")
        ).strip()
        snippets = _unique_snippets(ordered, limit=2)
        parts = [f"Chapter: {label}"]
        if summary:
            parts.append(summary)
        if snippets:
            parts.append("Matched evidence:\n" + "\n\n".join(snippets))
        content, trimmed = _trim_text("\n\n".join(parts), max_node_tokens)
        nodes.append(
            HierarchicalNode(
                level=HierarchyLevel.CHAPTER,
                node_id=f"chapter:{resource_id}:{str(metadata.get('chapter_id') or chapter_key)}",
                resource_id=resource_id,
                label=label,
                content=content,
                score=max(_score(item) for item in ordered),
                matched_chunk_indices=_matched_indices(ordered),
                chapter_id=str(metadata.get("chapter_id") or "") or None,
                trimmed=trimmed,
            )
        )
    return sorted(nodes, key=lambda node: node.score, reverse=True)


def _build_document_nodes(
    results: list[dict],
    resource_lookup: dict[str, Resource],
    *,
    max_node_tokens: int,
) -> list[HierarchicalNode]:
    grouped: dict[str, list[dict]] = {}
    for item in results:
        metadata = item.get("metadata") or {}
        resource_id = str(metadata.get("resource_id") or "").strip()
        if resource_id:
            grouped.setdefault(resource_id, []).append(item)

    nodes: list[HierarchicalNode] = []
    for resource_id, matches in grouped.items():
        ordered = sorted(matches, key=_score, reverse=True)
        resource_row = resource_lookup.get(resource_id)
        metadata = ordered[0].get("metadata") or {}
        title = str(
            metadata.get("resource_title")
            or getattr(resource_row, "title", "")
            or resource_id
        ).strip()
        summary = str(
            getattr(resource_row, "summary", "")
            or metadata.get("resource_summary", "")
        ).strip()
        section_labels = sorted({
            str((item.get("metadata") or {}).get("section_title") or (item.get("metadata") or {}).get("parent_heading") or "").strip()
            for item in ordered
            if str((item.get("metadata") or {}).get("section_title") or (item.get("metadata") or {}).get("parent_heading") or "").strip()
        })
        snippets = _unique_snippets(ordered, limit=2)
        parts = [f"Document: {title}"]
        if summary:
            parts.append(summary)
        if section_labels:
            parts.append("Relevant sections: " + ", ".join(section_labels[:4]))
        if snippets:
            parts.append("Matched evidence:\n" + "\n\n".join(snippets))
        content, trimmed = _trim_text("\n\n".join(parts), max_node_tokens)
        nodes.append(
            HierarchicalNode(
                level=HierarchyLevel.DOCUMENT,
                node_id=f"document:{resource_id}",
                resource_id=resource_id,
                label=title,
                content=content,
                score=max(_score(item) for item in ordered),
                matched_chunk_indices=_matched_indices(ordered),
                trimmed=trimmed,
            )
        )
    return sorted(nodes, key=lambda node: node.score, reverse=True)


def _matched_indices(results: list[dict]) -> tuple[int, ...]:
    indices = []
    for item in results:
        metadata = item.get("metadata") or {}
        chunk_index = item.get("chunk_index", metadata.get("chunk_index", -1))
        try:
            value = int(chunk_index)
        except (TypeError, ValueError):
            continue
        if value >= 0 and value not in indices:
            indices.append(value)
    return tuple(indices)


def _unique_snippets(results: list[dict], *, limit: int) -> list[str]:
    snippets: list[str] = []
    seen: set[str] = set()
    for item in results:
        text = str(item.get("content") or "").strip()
        normalized = _normalize(text)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        snippets.append(text)
        if len(snippets) >= limit:
            break
    return snippets


def _trim_text(text: str, budget_tokens: int) -> tuple[str, bool]:
    if _approx_tokens(text) <= budget_tokens:
        return text, False
    limit = max(80, budget_tokens * 4)
    trimmed = text[:limit].rsplit(" ", 1)[0].strip()
    if not trimmed:
        trimmed = text[:limit].strip()
    return trimmed + " …", True


def _select_nodes_within_budget(
    nodes: list[HierarchicalNode],
    remaining_budget: int,
    *,
    max_node_tokens: int,
) -> list[HierarchicalNode]:
    if remaining_budget <= 0:
        return []
    ordered = sorted(
        nodes,
        key=lambda node: (
            0 if node.level is HierarchyLevel.SECTION else 1 if node.level is HierarchyLevel.CHAPTER else 2,
            -node.score,
        ),
    )
    selected: list[HierarchicalNode] = []
    consumed = 0
    seen: set[tuple[str, str]] = set()
    for node in ordered:
        identity = (node.level.value, node.node_id)
        if identity in seen:
            continue
        tokens = _approx_tokens(node.content)
        if tokens > max_node_tokens:
            continue
        if selected and consumed + tokens > remaining_budget:
            continue
        if not selected and tokens > remaining_budget:
            trimmed_text, trimmed = _trim_text(node.content, max(32, remaining_budget))
            tokens = _approx_tokens(trimmed_text)
            if tokens > remaining_budget:
                continue
            node = HierarchicalNode(
                level=node.level,
                node_id=node.node_id,
                resource_id=node.resource_id,
                label=node.label,
                content=trimmed_text,
                score=node.score,
                matched_chunk_indices=node.matched_chunk_indices,
                chapter_id=node.chapter_id,
                trimmed=trimmed or node.trimmed,
            )
        selected.append(node)
        seen.add(identity)
        consumed += tokens
    return selected
