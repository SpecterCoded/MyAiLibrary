"""Optional parent-child retrieval expansion built on top of existing chunks."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

from core.config import (
    ENABLE_PARENT_CHILD_RETRIEVAL,
    PARENT_CHILD_GROUP_SIZE,
    PARENT_CHILD_MAX_CONTEXT_TOKENS,
    PARENT_CHILD_MAX_SECTION_TOKENS,
)
from database import SessionLocal
from models import ChunkIndex
from services.planner.planner_models import QueryClassification, RetrievalPlan


def _approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _stable_id(*parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def _normalize_line(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip()).lower()


def _heading_from_chunk(chunk: str) -> str | None:
    """Extract a heading-like label when a chunk begins a logical section."""

    lines = [line.strip() for line in chunk.splitlines() if line.strip()]
    if not lines:
        return None
    candidate = lines[0]
    if re.match(r"^#{1,6}\s+\S+", candidate):
        return candidate.lstrip("#").strip()[:160]
    if re.match(r"^(chapter|section|part)\s+[\w.-]+", candidate, re.IGNORECASE):
        return candidate[:160]
    if re.match(r"^\[page\s+\d+\]", candidate, re.IGNORECASE):
        return candidate[:160]
    if len(candidate) <= 90 and len(lines) > 1:
        word_count = len(candidate.split())
        if 1 <= word_count <= 10 and candidate == candidate.title():
            return candidate[:160]
    return None


@dataclass(frozen=True)
class ParentSectionDefinition:
    parent_id: str
    heading: str | None
    start_chunk_index: int
    end_chunk_index: int


@dataclass(frozen=True)
class ExpandedSection:
    resource_id: str
    parent_id: str
    start_chunk_index: int
    end_chunk_index: int
    matched_chunk_indices: tuple[int, ...]
    content: str
    trimmed: bool


@dataclass(frozen=True)
class ParentExpansionDecision:
    """Deterministic decision describing whether parent expansion is useful."""

    should_expand: bool
    reason: str
    selected_parent_ids: tuple[str, ...] = ()
    selected_chunk_indices: tuple[int, ...] = ()
    context_size_before_tokens: int = 0
    available_parent_sections: int = 0


def build_parent_sections(
    resource_id: str,
    chunks: list[str],
    group_size: int = PARENT_CHILD_GROUP_SIZE,
) -> list[ParentSectionDefinition]:
    """Group child chunks into heading-aware parent sections."""

    if not chunks:
        return []

    definitions: list[ParentSectionDefinition] = []
    current_start = 0
    current_heading = _heading_from_chunk(chunks[0])

    for index in range(1, len(chunks)):
        next_heading = _heading_from_chunk(chunks[index])
        if (index - current_start) >= group_size or next_heading is not None:
            end_index = index - 1
            definitions.append(
                ParentSectionDefinition(
                    parent_id=_stable_id(resource_id, current_start, end_index, current_heading or ""),
                    heading=current_heading,
                    start_chunk_index=current_start,
                    end_chunk_index=end_index,
                )
            )
            current_start = index
            current_heading = next_heading

    end_index = len(chunks) - 1
    definitions.append(
        ParentSectionDefinition(
            parent_id=_stable_id(resource_id, current_start, end_index, current_heading or ""),
            heading=current_heading,
            start_chunk_index=current_start,
            end_chunk_index=end_index,
        )
    )
    return definitions


def chunk_parent_metadata(
    resource_id: str,
    chunks: list[str],
    group_size: int = PARENT_CHILD_GROUP_SIZE,
) -> list[dict]:
    """Create per-child metadata describing the child's parent section."""

    metadata_by_index: list[dict] = [{} for _ in chunks]
    for section in build_parent_sections(resource_id, chunks, group_size=group_size):
        for chunk_index in range(section.start_chunk_index, section.end_chunk_index + 1):
            metadata_by_index[chunk_index] = {
                "chunk_id": _stable_id(resource_id, chunk_index, chunks[chunk_index]),
                "parent_id": section.parent_id,
                "parent_heading": section.heading or "",
                "parent_start_chunk_index": section.start_chunk_index,
                "parent_end_chunk_index": section.end_chunk_index,
            }
    return metadata_by_index


def decide_parent_expansion(
    query: str,
    results: list[dict],
    plan: RetrievalPlan | None = None,
    *,
    enabled: bool = ENABLE_PARENT_CHILD_RETRIEVAL,
    max_context_tokens: int = PARENT_CHILD_MAX_CONTEXT_TOKENS,
) -> ParentExpansionDecision:
    """Decide whether parent expansion is worth the added context cost."""

    before_tokens = sum(_approx_tokens(item.get("content", "")) for item in results)
    if not enabled:
        return ParentExpansionDecision(False, "disabled", context_size_before_tokens=before_tokens)
    if not results:
        return ParentExpansionDecision(False, "no_results", context_size_before_tokens=before_tokens)

    expandable = []
    for item in results:
        metadata = item.get("metadata") or {}
        if (
            metadata.get("resource_id")
            and metadata.get("parent_start_chunk_index") is not None
            and metadata.get("parent_end_chunk_index") is not None
        ):
            expandable.append(item)
    if not expandable:
        return ParentExpansionDecision(False, "missing_parent_metadata", context_size_before_tokens=before_tokens)
    if len(expandable) != len(results):
        return ParentExpansionDecision(False, "partial_parent_metadata", context_size_before_tokens=before_tokens)

    available_parent_ids = tuple(dict.fromkeys(str(item["metadata"].get("parent_id") or "") for item in expandable))
    parent_count = len([parent_id for parent_id in available_parent_ids if parent_id])
    query_classification = plan.query_classification if plan is not None else None
    avg_rerank = _average_rerank_score(results)
    top_rerank = _top_rerank_score(results)
    coverage = _query_coverage(query, results)
    self_contained = _looks_self_contained(query, results, query_classification, avg_rerank, coverage)

    # Leave exact/simple queries alone when child chunks already look complete.
    if self_contained:
        return ParentExpansionDecision(
            False,
            "child_chunks_self_contained",
            context_size_before_tokens=before_tokens,
            available_parent_sections=parent_count,
        )

    remaining_budget = max(0, max_context_tokens - before_tokens)
    if remaining_budget < 80:
        return ParentExpansionDecision(
            False,
            "insufficient_context_budget",
            context_size_before_tokens=before_tokens,
            available_parent_sections=parent_count,
        )

    selected = _select_results_for_expansion(
        query=query,
        results=expandable,
        query_classification=query_classification,
        avg_rerank=avg_rerank,
        top_rerank=top_rerank,
        coverage=coverage,
        max_context_tokens=max_context_tokens,
    )
    if not selected:
        return ParentExpansionDecision(
            False,
            "expansion_not_beneficial",
            context_size_before_tokens=before_tokens,
            available_parent_sections=parent_count,
        )

    selected_parent_ids = tuple(
        dict.fromkeys(str(item["metadata"].get("parent_id") or "") for item in selected if item["metadata"].get("parent_id"))
    )
    selected_chunk_indices = tuple(
        int(item.get("chunk_index", item["metadata"].get("chunk_index", -1)))
        for item in selected
        if int(item.get("chunk_index", item["metadata"].get("chunk_index", -1))) >= 0
    )
    return ParentExpansionDecision(
        True,
        "selected_for_context_enrichment",
        selected_parent_ids=selected_parent_ids,
        selected_chunk_indices=selected_chunk_indices,
        context_size_before_tokens=before_tokens,
        available_parent_sections=parent_count,
    )


def expand_parent_context(
    results: list[dict],
    query: str | None = None,
    plan: RetrievalPlan | None = None,
    *,
    enabled: bool = ENABLE_PARENT_CHILD_RETRIEVAL,
    max_context_tokens: int = PARENT_CHILD_MAX_CONTEXT_TOKENS,
    max_section_tokens: int = PARENT_CHILD_MAX_SECTION_TOKENS,
) -> tuple[list[dict], dict]:
    """Expand final child hits into parent sections while preserving fallback."""

    details = {
        "enabled": bool(enabled),
        "success": False,
        "fallback": False,
        "reason": "",
        "selected": False,
        "selected_parent_sections": 0,
        "available_parent_sections": 0,
        "child_chunks": [],
        "parent_sections": [],
        "context_size_before_tokens": sum(_approx_tokens(item.get("content", "")) for item in results),
        "context_size_after_tokens": sum(_approx_tokens(item.get("content", "")) for item in results),
    }
    if not enabled:
        details["reason"] = "disabled"
        details["fallback"] = True
        return results, details
    if not results:
        details["reason"] = "no_results"
        details["fallback"] = True
        return results, details

    decision = decide_parent_expansion(
        query or "",
        results,
        plan,
        enabled=enabled,
        max_context_tokens=max_context_tokens,
    )
    details["reason"] = decision.reason
    details["selected"] = decision.should_expand
    details["available_parent_sections"] = decision.available_parent_sections
    details["context_size_before_tokens"] = decision.context_size_before_tokens
    if not decision.should_expand:
        details["fallback"] = True
        return results, details

    expandable = [
        item for item in results
        if isinstance(item.get("metadata"), dict)
        and item["metadata"].get("resource_id")
        and item["metadata"].get("parent_start_chunk_index") is not None
        and item["metadata"].get("parent_end_chunk_index") is not None
    ]
    if expandable and len(expandable) != len(results):
        details["reason"] = "partial_parent_metadata"
        details["fallback"] = True
        return results, details
    if not expandable:
        details["reason"] = "missing_parent_metadata"
        details["fallback"] = True
        return results, details

    if decision.selected_parent_ids:
        allowed_parent_ids = set(decision.selected_parent_ids)
        expandable = [
            item for item in expandable
            if str(item["metadata"].get("parent_id") or "") in allowed_parent_ids
        ]
    elif decision.selected_chunk_indices:
        allowed_indices = set(decision.selected_chunk_indices)
        expandable = [
            item for item in expandable
            if int(item.get("chunk_index", item["metadata"].get("chunk_index", -1))) in allowed_indices
        ]
    if not expandable:
        details["reason"] = "no_selected_parents"
        details["fallback"] = True
        return results, details

    grouped: dict[str, list[dict]] = {}
    for item in expandable:
        grouped.setdefault(item["metadata"]["resource_id"], []).append(item)

    sections: list[ExpandedSection] = []
    for resource_id, resource_results in grouped.items():
        ranges: list[dict] = []
        for item in resource_results:
            metadata = item["metadata"]
            ranges.append({
                "start": int(metadata["parent_start_chunk_index"]),
                "end": int(metadata["parent_end_chunk_index"]),
                "parent_id": str(metadata.get("parent_id") or ""),
                "matched": {int(item.get("chunk_index", metadata.get("chunk_index", -1)))},
            })
        merged_ranges = _merge_ranges(ranges)
        fetched = _load_chunk_texts(resource_id, merged_ranges)
        if not fetched:
            details["reason"] = "parent_lookup_failed"
            details["fallback"] = True
            return results, details
        sections.extend(
            _build_expanded_sections(
                resource_id=resource_id,
                merged_ranges=merged_ranges,
                chunk_map=fetched,
                max_context_tokens=max_context_tokens,
                max_section_tokens=max_section_tokens,
            )
        )

    if not sections:
        details["reason"] = "empty_parent_sections"
        details["fallback"] = True
        return results, details

    expanded_results: list[dict] = []
    seen_text: set[str] = set()
    for section in sections:
        normalized = _normalize_line(section.content)
        key = f"{section.resource_id}:{normalized}"
        if not normalized or key in seen_text:
            continue
        seen_text.add(key)
        expanded_results.append({
            "chunk_index": section.start_chunk_index,
            "content": section.content,
            "metadata": {
                "resource_id": section.resource_id,
                "chunk_index": section.start_chunk_index,
                "parent_id": section.parent_id,
                "parent_start_chunk_index": section.start_chunk_index,
                "parent_end_chunk_index": section.end_chunk_index,
                "matched_child_chunk_indices": list(section.matched_chunk_indices),
                "parent_expanded": True,
                "parent_trimmed": section.trimmed,
            },
        })

    if not expanded_results:
        details["reason"] = "deduped_empty"
        details["fallback"] = True
        return results, details

    details["success"] = True
    details["selected_parent_sections"] = len(sections)
    details["child_chunks"] = [
        {
            "resource_id": item["metadata"].get("resource_id"),
            "chunk_index": int(item.get("chunk_index", item["metadata"].get("chunk_index", -1))),
            "chunk_id": item["metadata"].get("chunk_id", ""),
        }
        for item in expandable
    ]
    details["parent_sections"] = [
        {
            "resource_id": section.resource_id,
            "parent_id": section.parent_id,
            "start_chunk_index": section.start_chunk_index,
            "end_chunk_index": section.end_chunk_index,
            "matched_chunk_indices": list(section.matched_chunk_indices),
            "trimmed": section.trimmed,
        }
        for section in sections
    ]
    details["context_size_after_tokens"] = sum(_approx_tokens(item["content"]) for item in expanded_results)
    return expanded_results, details


def _average_rerank_score(results: list[dict]) -> float:
    scores = [float(item["rerank_score"]) for item in results if item.get("rerank_score") is not None]
    if not scores:
        return 0.0
    return sum(scores) / len(scores)


def _top_rerank_score(results: list[dict]) -> float:
    scores = [float(item["rerank_score"]) for item in results if item.get("rerank_score") is not None]
    if not scores:
        return 0.0
    return max(scores)


def _query_coverage(query: str, results: list[dict]) -> float:
    terms = {
        token for token in re.findall(r"\b\w{3,}\b", query.lower())
        if token not in {"the", "and", "for", "with", "that", "this", "what", "when", "where", "which", "who", "why", "how"}
    }
    if not terms:
        return 1.0
    content = " ".join(str(item.get("content") or "").lower() for item in results)
    return sum(1 for term in terms if term in content) / len(terms)


def _looks_self_contained(
    query: str,
    results: list[dict],
    query_classification: QueryClassification | None,
    avg_rerank: float,
    coverage: float,
) -> bool:
    if not results:
        return False
    if query_classification in {
        QueryClassification.DEFINITION,
        QueryClassification.SIMPLE_FACT,
        QueryClassification.EXACT_LOOKUP,
    }:
        top_content = str(results[0].get("content") or "")
        return avg_rerank >= 0.82 and coverage >= 0.75 and _approx_tokens(top_content) >= 30
    return False


def _select_results_for_expansion(
    *,
    query: str,
    results: list[dict],
    query_classification: QueryClassification | None,
    avg_rerank: float,
    top_rerank: float,
    coverage: float,
    max_context_tokens: int,
) -> list[dict]:
    if not results:
        return []

    if query_classification in {
        QueryClassification.SUMMARIZATION,
        QueryClassification.BROAD_RESEARCH,
        QueryClassification.MULTI_DOCUMENT_REASONING,
        QueryClassification.COMPARISON,
        QueryClassification.TROUBLESHOOTING,
        QueryClassification.EXPLANATION,
        QueryClassification.PROCEDURAL,
    }:
        limit = 3 if max_context_tokens >= 500 else 2
    else:
        limit = 1 if top_rerank >= 0.75 else 2

    ranked = sorted(
        results,
        key=lambda item: float(item.get("rerank_score", item.get("hybrid_score", item.get("score", 0.0)))),
        reverse=True,
    )
    selected: list[dict] = []
    seen_parents: set[tuple[object, object]] = set()
    for item in ranked:
        metadata = item.get("metadata") or {}
        parent_key = (metadata.get("resource_id"), metadata.get("parent_id"))
        if parent_key in seen_parents:
            continue
        if query_classification not in {
            QueryClassification.SUMMARIZATION,
            QueryClassification.BROAD_RESEARCH,
            QueryClassification.MULTI_DOCUMENT_REASONING,
            QueryClassification.COMPARISON,
            QueryClassification.TROUBLESHOOTING,
            QueryClassification.EXPLANATION,
            QueryClassification.PROCEDURAL,
        } and avg_rerank >= 0.78 and coverage >= 0.7 and _approx_tokens(str(item.get("content") or "")) >= 60:
            continue
        selected.append(item)
        seen_parents.add(parent_key)
        if len(selected) >= limit:
            break
    return selected


def _merge_ranges(ranges: list[dict]) -> list[dict]:
    if not ranges:
        return []
    ordered = sorted(ranges, key=lambda item: (item["start"], item["end"]))
    merged = [ordered[0]]
    for item in ordered[1:]:
        current = merged[-1]
        if item["start"] <= current["end"] + 1:
            current["end"] = max(current["end"], item["end"])
            current["matched"].update(item["matched"])
            if not current["parent_id"]:
                current["parent_id"] = item["parent_id"]
        else:
            merged.append(item)
    return merged


def _load_chunk_texts(resource_id: str, merged_ranges: list[dict]) -> dict[int, str]:
    db = SessionLocal()
    try:
        lower = min(item["start"] for item in merged_ranges)
        upper = max(item["end"] for item in merged_ranges)
        rows = (
            db.query(ChunkIndex)
            .filter(
                ChunkIndex.resource_id == resource_id,
                ChunkIndex.chunk_index >= lower,
                ChunkIndex.chunk_index <= upper,
            )
            .order_by(ChunkIndex.chunk_index)
            .all()
        )
        return {int(row.chunk_index): row.content for row in rows}
    finally:
        db.close()


def _build_expanded_sections(
    *,
    resource_id: str,
    merged_ranges: list[dict],
    chunk_map: dict[int, str],
    max_context_tokens: int,
    max_section_tokens: int,
) -> list[ExpandedSection]:
    sections: list[ExpandedSection] = []
    range_count = max(1, len(merged_ranges))
    per_section_budget = max(64, min(max_section_tokens, max_context_tokens // range_count))

    for item in merged_ranges:
        ordered_indices = [idx for idx in range(item["start"], item["end"] + 1) if idx in chunk_map]
        if not ordered_indices:
            continue
        matched = tuple(sorted(idx for idx in item["matched"] if idx in chunk_map))
        full_chunks = [chunk_map[idx] for idx in ordered_indices]
        full_text = "\n\n".join(_dedupe_chunks(full_chunks))
        content = full_text
        trimmed = False
        if _approx_tokens(full_text) > per_section_budget:
            content = _trim_around_matches(
                ordered_indices=ordered_indices,
                matched_indices=matched or (ordered_indices[0],),
                chunk_map=chunk_map,
                budget_tokens=per_section_budget,
            )
            trimmed = True
        sections.append(
            ExpandedSection(
                resource_id=resource_id,
                parent_id=item["parent_id"] or _stable_id(resource_id, item["start"], item["end"]),
                start_chunk_index=item["start"],
                end_chunk_index=item["end"],
                matched_chunk_indices=matched or (ordered_indices[0],),
                content=content,
                trimmed=trimmed,
            )
        )
    return sections


def _trim_around_matches(
    *,
    ordered_indices: list[int],
    matched_indices: tuple[int, ...],
    chunk_map: dict[int, str],
    budget_tokens: int,
) -> str:
    selected = set(matched_indices)
    left = min(ordered_indices.index(index) for index in matched_indices if index in ordered_indices)
    right = max(ordered_indices.index(index) for index in matched_indices if index in ordered_indices)

    def build_text() -> str:
        active = [chunk_map[index] for index in ordered_indices if index in selected]
        return "\n\n".join(_dedupe_chunks(active))

    text = build_text()
    while _approx_tokens(text) < budget_tokens and (left > 0 or right < len(ordered_indices) - 1):
        grew = False
        if left > 0:
            left -= 1
            selected.add(ordered_indices[left])
            grew = True
            text = build_text()
            if _approx_tokens(text) > budget_tokens:
                selected.remove(ordered_indices[left])
                left += 1
                text = build_text()
        if right < len(ordered_indices) - 1:
            right += 1
            selected.add(ordered_indices[right])
            grew = True
            text = build_text()
            if _approx_tokens(text) > budget_tokens:
                selected.remove(ordered_indices[right])
                right -= 1
                text = build_text()
        if not grew:
            break
    return text


def _dedupe_chunks(chunks: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for chunk in chunks:
        normalized = _normalize_line(chunk)
        if normalized and normalized not in seen:
            deduped.append(chunk)
            seen.add(normalized)
    return deduped
