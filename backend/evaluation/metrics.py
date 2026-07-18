"""Metric calculators for retrieval, quality, performance, and cost."""

from __future__ import annotations

import math
import re

from .models import (
    AnswerQualityMetrics,
    BenchmarkConfig,
    BenchmarkExample,
    CostMetrics,
    ObservedRun,
    PerformanceMetrics,
    RetrievalMetrics,
)


def _tokenize(text: str) -> set[str]:
    return {
        token
        for token in re.findall(r"\b[\w'-]{2,}\b", str(text or "").lower())
        if token not in {"the", "and", "for", "with", "that", "this", "from", "into", "what", "when", "where"}
    }


def _sentence_split(text: str) -> list[str]:
    items = [part.strip() for part in re.split(r"(?<=[.!?])\s+", str(text or "").strip()) if part.strip()]
    return items or ([str(text).strip()] if str(text or "").strip() else [])


def _retrieved_ids(run: ObservedRun) -> list[str]:
    ids: list[str] = []
    for chunk in run.retrieved_chunks:
        if chunk.chunk_id:
            ids.append(chunk.chunk_id)
            continue
        if chunk.resource_id is not None and chunk.chunk_index is not None:
            ids.append(f"{chunk.resource_id}:{chunk.chunk_index}")
            continue
        if chunk.resource_id:
            ids.append(str(chunk.resource_id))
    return ids


def _retrieved_resource_ids(run: ObservedRun) -> list[str]:
    ids: list[str] = []
    for chunk in run.retrieved_chunks:
        if chunk.resource_id and chunk.resource_id not in ids:
            ids.append(chunk.resource_id)
    return ids


def precision_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if k <= 0:
        return 0.0
    top = retrieved_ids[:k]
    if not top:
        return 0.0
    return len(set(top) & relevant_ids) / len(top)


def recall_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        return 1.0
    return len(set(retrieved_ids[:k]) & relevant_ids) / len(relevant_ids)


def mean_reciprocal_rank(retrieved_ids: list[str], relevant_ids: set[str]) -> float:
    for index, item in enumerate(retrieved_ids, start=1):
        if item in relevant_ids:
            return 1.0 / index
    return 0.0


def ndcg_at_k(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if k <= 0:
        return 0.0
    dcg = 0.0
    for rank, item in enumerate(retrieved_ids[:k], start=1):
        gain = 1.0 if item in relevant_ids else 0.0
        dcg += gain / math.log2(rank + 1)
    ideal_hits = min(len(relevant_ids), k)
    if ideal_hits == 0:
        return 1.0
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return dcg / idcg if idcg else 0.0


def hit_rate(retrieved_ids: list[str], relevant_ids: set[str], k: int) -> float:
    return 1.0 if set(retrieved_ids[:k]) & relevant_ids else 0.0


def retrieval_metrics(example: BenchmarkExample, run: ObservedRun, config: BenchmarkConfig) -> RetrievalMetrics:
    relevant_ids = set(example.expected_chunk_ids or [])
    if not relevant_ids and example.expected_document_ids:
        relevant_ids = set(example.expected_document_ids)
        ids = _retrieved_resource_ids(run)
    else:
        ids = _retrieved_ids(run)
    used_parent = any(
        chunk.metadata.get("parent_expanded") or chunk.metadata.get("parent_id")
        for chunk in run.retrieved_chunks
    ) or "parent_child_expansion" in list(run.execution_report.get("modules_executed", []))
    used_hierarchy = any(chunk.metadata.get("hierarchy_node") for chunk in run.retrieved_chunks) or "hierarchical_retrieval" in list(run.execution_report.get("modules_executed", []))
    return RetrievalMetrics(
        precision_at_k=round(precision_at_k(ids, relevant_ids, config.default_k), 4),
        recall_at_k=round(recall_at_k(ids, relevant_ids, config.default_k), 4),
        mrr=round(mean_reciprocal_rank(ids, relevant_ids), 4),
        ndcg=round(ndcg_at_k(ids, relevant_ids, config.default_k), 4),
        hit_rate=round(hit_rate(ids, relevant_ids, config.default_k), 4),
        retrieved_chunk_count=len(run.retrieved_chunks),
        parent_expansion_usage=1.0 if used_parent else 0.0,
        hierarchical_retrieval_usage=1.0 if used_hierarchy else 0.0,
    )


def _expected_answer_coverage(answer: str, expected_answer: str | None) -> float:
    expected_terms = _tokenize(expected_answer or "")
    if not expected_terms:
        return 1.0
    answer_terms = _tokenize(answer)
    return len(expected_terms & answer_terms) / len(expected_terms)


def _context_overlap_ratio(answer: str, context: str) -> float:
    answer_terms = _tokenize(answer)
    if not answer_terms:
        return 1.0
    context_terms = _tokenize(context)
    return len(answer_terms & context_terms) / len(answer_terms)


def _faithfulness(answer: str, context: str, hallucinations: list[dict]) -> float:
    sentences = _sentence_split(answer)
    if not sentences:
        return 1.0
    context_terms = _tokenize(context)
    supported = 0
    for sentence in sentences:
        sentence_terms = _tokenize(sentence)
        if not sentence_terms:
            supported += 1
            continue
        overlap = len(sentence_terms & context_terms) / len(sentence_terms)
        if overlap >= 0.35:
            supported += 1
    penalty = min(0.6, len(hallucinations) / max(len(sentences), 1))
    return max(0.0, min(1.0, (supported / len(sentences)) - penalty))


def _citation_accuracy(example: BenchmarkExample, run: ObservedRun) -> float:
    if example.expected_document_ids:
        source_resource_ids = {source.resource_id for source in run.sources if source.resource_id}
        if not source_resource_ids:
            return 0.0
        return len(source_resource_ids & set(example.expected_document_ids)) / len(set(example.expected_document_ids))
    if example.expected_source_documents:
        observed_titles = {source.resource_title for source in run.sources if source.resource_title}
        if not observed_titles:
            return 0.0
        return len(observed_titles & set(example.expected_source_documents)) / len(set(example.expected_source_documents))
    if example.expected_citations:
        observed = {source.citation for source in run.sources if source.citation}
        if not observed:
            return 0.0
        return len(observed & set(example.expected_citations)) / len(set(example.expected_citations))
    return 1.0 if run.sources else 0.0 if run.answer else 1.0


def _completeness(example: BenchmarkExample, run: ObservedRun) -> float:
    expected_doc_coverage = 1.0
    if example.expected_document_ids:
        returned = {source.resource_id for source in run.sources if source.resource_id}
        expected_doc_coverage = len(returned & set(example.expected_document_ids)) / len(set(example.expected_document_ids))
    elif example.expected_source_documents:
        returned_titles = {source.resource_title for source in run.sources if source.resource_title}
        expected_doc_coverage = len(returned_titles & set(example.expected_source_documents)) / len(set(example.expected_source_documents))
    expected_answer_coverage = _expected_answer_coverage(run.answer, example.expected_answer)
    return (expected_doc_coverage + expected_answer_coverage) / 2


def _confidence_calibration(confidence: float | None, correctness_proxy: float) -> float:
    if confidence is None:
        return 0.0
    return max(0.0, 1.0 - abs(confidence - correctness_proxy))


def answer_quality_metrics(example: BenchmarkExample, run: ObservedRun, config: BenchmarkConfig) -> AnswerQualityMetrics:
    if not config.enable_quality_metrics:
        return AnswerQualityMetrics()
    completeness = _completeness(example, run)
    groundedness = _context_overlap_ratio(run.answer, run.context)
    citation_accuracy = _citation_accuracy(example, run)
    faithfulness = _faithfulness(run.answer, run.context, run.hallucinations)
    context_utilization = groundedness
    sentences = _sentence_split(run.answer)
    hallucination_rate = len(run.hallucinations) / max(len(sentences), 1)
    correctness_proxy = (faithfulness + completeness + citation_accuracy) / 3
    return AnswerQualityMetrics(
        faithfulness=round(faithfulness, 4),
        groundedness=round(groundedness, 4),
        citation_accuracy=round(citation_accuracy, 4),
        context_utilization=round(context_utilization, 4),
        completeness=round(completeness, 4),
        hallucination_rate=round(hallucination_rate, 4),
        confidence_calibration=round(_confidence_calibration(run.confidence, correctness_proxy), 4),
    )


def performance_metrics(run: ObservedRun) -> PerformanceMetrics:
    latency = run.latency
    total = latency.total_latency_ms or latency.end_to_end_latency_ms
    end_to_end = latency.end_to_end_latency_ms or total
    return PerformanceMetrics(
        total_latency_ms=round(total, 3),
        retrieval_latency_ms=round(latency.retrieval_latency_ms, 3),
        rerank_latency_ms=round(latency.rerank_latency_ms, 3),
        llm_latency_ms=round(latency.llm_latency_ms, 3),
        end_to_end_latency_ms=round(end_to_end, 3),
    )


def cost_metrics(run: ObservedRun, config: BenchmarkConfig) -> CostMetrics:
    usage = run.token_usage
    cost = 0.0
    if config.enable_cost_tracking:
        cost += (usage.prompt_tokens / 1000.0) * config.prompt_cost_per_1k_tokens
        cost += (usage.completion_tokens / 1000.0) * config.completion_cost_per_1k_tokens
        cost += (usage.embedding_tokens / 1000.0) * config.embedding_cost_per_1k_tokens
    return CostMetrics(
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        embedding_tokens=usage.embedding_tokens,
        estimated_api_cost=round(cost, 6),
        cache_hit_rate=1.0 if run.cache_hit else 0.0,
    )
