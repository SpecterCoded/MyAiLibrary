import math


def calculate_confidence(reranked_results: list[dict], hallucinations: list[dict]):
    """
    Dynamic confidence score based on retrieval and validation signals.

    Base formula: 40% Rerank + 40% Hybrid + 20% Hallucination
    Dynamic adjustments:
    - Tight rerank spread penalizes confidence (uncertain ranking)
    - Few retrieved chunks penalizes confidence (weak evidence)
    - More hallucinations penalize faster than static bins
    """
    try:
        return _calculate_confidence_inner(reranked_results, hallucinations)
    except Exception:
        # Fallback to simple heuristic on any error
        return _fallback_confidence(reranked_results, hallucinations)


def _calculate_confidence_inner(reranked_results: list[dict], hallucinations: list[dict]):
    if not reranked_results:
        return 0.0, "Very Low"

    # 1. Rerank Score (35%)
    top_rerank = reranked_results[0].get("rerank_score", 0.0)
    normalized_rerank = 1.0 / (1.0 + math.exp(-top_rerank))

    # 2. Hybrid Score (30%)
    RRF_BEST = (1.0 / 60) * 2
    top_hybrid = reranked_results[0].get("hybrid_score", 0.0)
    normalized_hybrid = min(1.0, top_hybrid / RRF_BEST)

    # 3. Hallucination Score (15%) - dynamic scaling
    hall_count = len(hallucinations)
    if hall_count == 0:
        hall_score = 1.0
    else:
        # Exponential decay: each hallucination reduces score by ~30%
        hall_score = max(0.0, 1.0 - (hall_count * 0.3))

    # 4. Coverage Score (10%) — chunks with rich metadata indicate better retrieval
    has_timestamp = sum(1 for r in reranked_results if (r.get("metadata") or {}).get("start_time") is not None)
    has_page = sum(1 for r in reranked_results if (r.get("metadata") or {}).get("page_number") is not None)
    rich_count = has_timestamp + has_page
    coverage_score = min(1.0, rich_count / max(len(reranked_results), 1))

    # 5. Diversity Score (10%) — multiple resources indicate broader evidence
    resource_ids = set()
    for r in reranked_results:
        rid = (r.get("metadata") or {}).get("resource_id")
        if rid:
            resource_ids.add(rid)
    diversity_score = min(1.0, len(resource_ids) / max(len(reranked_results), 1))

    # 6. Base Weighted Score
    confidence = (
        normalized_rerank * 0.35
        + normalized_hybrid * 0.30
        + hall_score * 0.15
        + coverage_score * 0.10
        + diversity_score * 0.10
    )

    # 5. Dynamic adjustments
    # Penalty for tight rerank spread (uncertain ranking)
    if len(reranked_results) > 1:
        scores = [r.get("rerank_score", 0.0) for r in reranked_results]
        spread = max(scores) - min(scores)
        if spread < 0.5:
            confidence *= 0.85  # 15% penalty for tight spread

    # Penalty for too few chunks (weak evidence)
    chunk_count = len(reranked_results)
    if chunk_count < 2:
        confidence *= 0.7  # 30% penalty
    elif chunk_count < 3:
        confidence *= 0.85  # 15% penalty

    confidence = round(min(1.0, max(0.0, confidence)), 2)

    # 6. Labeling
    if confidence >= 0.90:
        label = "Very High"
    elif confidence >= 0.75:
        label = "High"
    elif confidence >= 0.60:
        label = "Medium"
    elif confidence >= 0.40:
        label = "Low"
    else:
        label = "Very Low"

    return confidence, label


def _fallback_confidence(reranked_results, hallucinations):
    if not reranked_results:
        return 0.0, "Very Low"
    top_rerank = reranked_results[0].get("rerank_score", 0.0)
    normalized_rerank = 1.0 / (1.0 + math.exp(-top_rerank))
    hall_count = len(hallucinations)
    hall_score = 1.0 if hall_count == 0 else max(0.0, 1.0 - (hall_count * 0.3))
    confidence = round(normalized_rerank * 0.6 + hall_score * 0.4, 2)
    label = "High" if confidence >= 0.75 else "Medium" if confidence >= 0.5 else "Low"
    return confidence, label
