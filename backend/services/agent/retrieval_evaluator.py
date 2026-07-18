"""Deterministic retrieval-quality evaluation for the agent loop."""

from __future__ import annotations

import math
import re

from services.planner.planner_models import RetrievalPlan

from .workflow_models import RetrievalEvaluation, RetrievalQuality


class RetrievalEvaluator:
    """Evaluate observable retrieval signals without an additional LLM call."""

    _STOP_WORDS = {
        "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
        "how", "in", "is", "it", "of", "on", "or", "that", "the", "this",
        "to", "was", "what", "when", "where", "which", "who", "why", "with",
    }

    def evaluate(self, query: str, results: list[dict], plan: RetrievalPlan) -> RetrievalEvaluation:
        count = len(results)
        if not results:
            return RetrievalEvaluation(
                quality=RetrievalQuality.POOR,
                retrieved_chunk_count=0,
                average_rerank_score=0.0,
                score_spread=0.0,
                coverage=0.0,
                confidence=0.0,
                missing_citations=0,
                metadata_quality=0.0,
                resource_diversity=0,
                reasoning="No chunks were retrieved.",
            )

        rerank_scores = [float(item["rerank_score"]) for item in results if item.get("rerank_score") is not None]
        average_rerank = sum(rerank_scores) / len(rerank_scores) if rerank_scores else 0.0
        score_spread = max(rerank_scores) - min(rerank_scores) if len(rerank_scores) > 1 else 0.0
        relevance = self._relevance_quality(results, rerank_scores)

        query_terms = {
            token for token in re.findall(r"\b\w{3,}\b", query.lower())
            if token not in self._STOP_WORDS
        }
        content = " ".join(str(item.get("content") or "").lower() for item in results)
        coverage = (
            sum(1 for term in query_terms if term in content) / len(query_terms)
            if query_terms else 1.0
        )

        valid_metadata = 0
        missing_citations = 0
        resource_ids: set[str] = set()
        for item in results:
            metadata = item.get("metadata") or {}
            resource_id = metadata.get("resource_id")
            chunk_index = item.get("chunk_index", metadata.get("chunk_index"))
            if resource_id and chunk_index is not None:
                valid_metadata += 1
                resource_ids.add(str(resource_id))
            else:
                missing_citations += 1

        metadata_quality = valid_metadata / count
        count_quality = min(count / max(plan.max_chunks, 1), 1.0)
        diversity_target = 2 if plan.enable_multi_query else 1
        diversity_quality = min(len(resource_ids) / diversity_target, 1.0)
        confidence = max(
            0.0,
            min(
                1.0,
                0.30 * count_quality
                + 0.25 * relevance
                + 0.20 * coverage
                + 0.15 * metadata_quality
                + 0.10 * diversity_quality,
            ),
        )

        if confidence >= plan.confidence_threshold and count_quality >= 0.6:
            quality = RetrievalQuality.GOOD
        elif confidence >= plan.confidence_threshold * 0.75 and count_quality >= 0.35:
            quality = RetrievalQuality.BORDERLINE
        else:
            quality = RetrievalQuality.POOR

        return RetrievalEvaluation(
            quality=quality,
            retrieved_chunk_count=count,
            average_rerank_score=average_rerank,
            score_spread=max(score_spread, 0.0),
            coverage=coverage,
            confidence=confidence,
            missing_citations=missing_citations,
            metadata_quality=metadata_quality,
            resource_diversity=len(resource_ids),
            reasoning=(
                f"{quality.value}: {count} chunks, {coverage:.0%} query coverage, "
                f"{metadata_quality:.0%} citation metadata, confidence {confidence:.2f}."
            ),
        )

    @staticmethod
    def _relevance_quality(results: list[dict], rerank_scores: list[float]) -> float:
        if rerank_scores:
            normalized = [score if 0.0 <= score <= 1.0 else 1.0 / (1.0 + math.exp(-score)) for score in rerank_scores]
            return sum(normalized) / len(normalized)
        distances = [float(item["distance"]) for item in results if item.get("distance") is not None]
        if distances:
            return sum(max(0.0, 1.0 - distance / 1.5) for distance in distances) / len(distances)
        keyword_scores = [float(item["score"]) for item in results if item.get("score") is not None]
        if keyword_scores:
            return sum(max(0.0, score) / (5.0 + max(0.0, score)) for score in keyword_scores) / len(keyword_scores)
        # RRF scores are rank signals, not calibrated probabilities.
        return 0.65
