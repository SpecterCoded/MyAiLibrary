"""Aggregate sample metrics into overall benchmark scores and regression deltas."""

from __future__ import annotations

from statistics import mean

from .models import (
    AnswerQualityMetrics,
    BenchmarkRunReport,
    CategoryAggregate,
    CostMetrics,
    EvaluationSampleResult,
    PerformanceMetrics,
    RegressionDelta,
    RegressionReport,
    RetrievalMetrics,
)


def _avg(values: list[float]) -> float:
    return mean(values) if values else 0.0


def sample_overall_score(sample: EvaluationSampleResult) -> float:
    retrieval_score = mean([
        sample.retrieval.precision_at_k,
        sample.retrieval.recall_at_k,
        sample.retrieval.mrr,
        sample.retrieval.ndcg,
        sample.retrieval.hit_rate,
    ])
    quality_score = mean([
        sample.quality.faithfulness,
        sample.quality.groundedness,
        sample.quality.citation_accuracy,
        sample.quality.context_utilization,
        sample.quality.completeness,
        sample.quality.confidence_calibration,
        max(0.0, 1.0 - sample.quality.hallucination_rate),
    ])
    latency_score = 1.0 / (1.0 + max(sample.performance.end_to_end_latency_ms, 0.0) / 1000.0)
    cost_score = 1.0 / (1.0 + max(sample.cost.estimated_api_cost, 0.0))
    return round((retrieval_score * 0.4) + (quality_score * 0.4) + (latency_score * 0.1) + (cost_score * 0.1), 4)


def aggregate_retrieval(samples: list[EvaluationSampleResult]) -> RetrievalMetrics:
    return RetrievalMetrics(
        precision_at_k=round(_avg([item.retrieval.precision_at_k for item in samples]), 4),
        recall_at_k=round(_avg([item.retrieval.recall_at_k for item in samples]), 4),
        mrr=round(_avg([item.retrieval.mrr for item in samples]), 4),
        ndcg=round(_avg([item.retrieval.ndcg for item in samples]), 4),
        hit_rate=round(_avg([item.retrieval.hit_rate for item in samples]), 4),
        retrieved_chunk_count=round(_avg([float(item.retrieval.retrieved_chunk_count) for item in samples])),
        parent_expansion_usage=round(_avg([item.retrieval.parent_expansion_usage for item in samples]), 4),
        hierarchical_retrieval_usage=round(_avg([item.retrieval.hierarchical_retrieval_usage for item in samples]), 4),
    )


def aggregate_quality(samples: list[EvaluationSampleResult]) -> AnswerQualityMetrics:
    return AnswerQualityMetrics(
        faithfulness=round(_avg([item.quality.faithfulness for item in samples]), 4),
        groundedness=round(_avg([item.quality.groundedness for item in samples]), 4),
        citation_accuracy=round(_avg([item.quality.citation_accuracy for item in samples]), 4),
        context_utilization=round(_avg([item.quality.context_utilization for item in samples]), 4),
        completeness=round(_avg([item.quality.completeness for item in samples]), 4),
        hallucination_rate=round(_avg([item.quality.hallucination_rate for item in samples]), 4),
        confidence_calibration=round(_avg([item.quality.confidence_calibration for item in samples]), 4),
    )


def aggregate_performance(samples: list[EvaluationSampleResult]) -> PerformanceMetrics:
    return PerformanceMetrics(
        total_latency_ms=round(_avg([item.performance.total_latency_ms for item in samples]), 3),
        retrieval_latency_ms=round(_avg([item.performance.retrieval_latency_ms for item in samples]), 3),
        rerank_latency_ms=round(_avg([item.performance.rerank_latency_ms for item in samples]), 3),
        llm_latency_ms=round(_avg([item.performance.llm_latency_ms for item in samples]), 3),
        end_to_end_latency_ms=round(_avg([item.performance.end_to_end_latency_ms for item in samples]), 3),
    )


def aggregate_cost(samples: list[EvaluationSampleResult]) -> CostMetrics:
    return CostMetrics(
        prompt_tokens=round(_avg([float(item.cost.prompt_tokens) for item in samples])),
        completion_tokens=round(_avg([float(item.cost.completion_tokens) for item in samples])),
        embedding_tokens=round(_avg([float(item.cost.embedding_tokens) for item in samples])),
        estimated_api_cost=round(_avg([item.cost.estimated_api_cost for item in samples]), 6),
        cache_hit_rate=round(_avg([item.cost.cache_hit_rate for item in samples]), 4),
    )


def category_aggregates(samples: list[EvaluationSampleResult]) -> list[CategoryAggregate]:
    grouped: dict[str, list[EvaluationSampleResult]] = {}
    for sample in samples:
        grouped.setdefault(sample.category, []).append(sample)
    output: list[CategoryAggregate] = []
    for category, items in sorted(grouped.items()):
        output.append(
            CategoryAggregate(
                category=category,
                sample_count=len(items),
                overall_score=round(_avg([item.overall_score for item in items]), 4),
                retrieval_score=round(_avg([mean([
                    item.retrieval.precision_at_k,
                    item.retrieval.recall_at_k,
                    item.retrieval.mrr,
                    item.retrieval.ndcg,
                    item.retrieval.hit_rate,
                ]) for item in items]), 4),
                quality_score=round(_avg([mean([
                    item.quality.faithfulness,
                    item.quality.groundedness,
                    item.quality.citation_accuracy,
                    item.quality.context_utilization,
                    item.quality.completeness,
                ]) for item in items]), 4),
                average_latency_ms=round(_avg([item.performance.end_to_end_latency_ms for item in items]), 3),
                average_cost=round(_avg([item.cost.estimated_api_cost for item in items]), 6),
            )
        )
    return output


def build_regression_delta(baseline: float, candidate: float, *, lower_is_better: bool = False) -> RegressionDelta:
    absolute = candidate - baseline
    relative = (absolute / baseline) if baseline else (1.0 if candidate else 0.0)
    if abs(absolute) < 1e-9:
        trend = "unchanged"
    elif lower_is_better:
        trend = "improved" if candidate < baseline else "regressed"
    else:
        trend = "improved" if candidate > baseline else "regressed"
    return RegressionDelta(
        baseline=round(baseline, 6),
        candidate=round(candidate, 6),
        absolute_change=round(absolute, 6),
        relative_change=round(relative, 6),
        trend=trend,
    )


def build_regression_report(baseline: BenchmarkRunReport, candidate: BenchmarkRunReport) -> RegressionReport:
    overall = build_regression_delta(baseline.overall_score, candidate.overall_score)
    accuracy = build_regression_delta(
        baseline.quality_metrics.faithfulness,
        candidate.quality_metrics.faithfulness,
    )
    latency = build_regression_delta(
        baseline.performance_metrics.end_to_end_latency_ms,
        candidate.performance_metrics.end_to_end_latency_ms,
        lower_is_better=True,
    )
    cost = build_regression_delta(
        baseline.cost_metrics.estimated_api_cost,
        candidate.cost_metrics.estimated_api_cost,
        lower_is_better=True,
    )
    confidence = build_regression_delta(
        baseline.quality_metrics.confidence_calibration,
        candidate.quality_metrics.confidence_calibration,
    )
    retrieval = build_regression_delta(
        mean([
            baseline.retrieval_metrics.precision_at_k,
            baseline.retrieval_metrics.recall_at_k,
            baseline.retrieval_metrics.mrr,
            baseline.retrieval_metrics.ndcg,
            baseline.retrieval_metrics.hit_rate,
        ]),
        mean([
            candidate.retrieval_metrics.precision_at_k,
            candidate.retrieval_metrics.recall_at_k,
            candidate.retrieval_metrics.mrr,
            candidate.retrieval_metrics.ndcg,
            candidate.retrieval_metrics.hit_rate,
        ]),
    )
    highlights = [
        f"Overall score {overall.trend} by {overall.absolute_change:+.4f}.",
        f"Faithfulness {accuracy.trend} by {accuracy.absolute_change:+.4f}.",
        f"Latency {latency.trend} by {latency.absolute_change:+.3f} ms.",
        f"Estimated cost {cost.trend} by {cost.absolute_change:+.6f}.",
        f"Confidence calibration {confidence.trend} by {confidence.absolute_change:+.4f}.",
        f"Retrieval quality {retrieval.trend} by {retrieval.absolute_change:+.4f}.",
    ]
    return RegressionReport(
        baseline_run_id=baseline.run_id,
        candidate_run_id=candidate.run_id,
        overall_score=overall,
        accuracy_change=accuracy,
        latency_change=latency,
        cost_change=cost,
        confidence_change=confidence,
        retrieval_quality_change=retrieval,
        highlights=highlights,
    )
