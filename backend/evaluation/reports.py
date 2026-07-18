"""Build aggregate benchmark and regression reports."""

from __future__ import annotations

from statistics import mean
from uuid import uuid4

from .models import BenchmarkConfig, BenchmarkRunReport, EvaluationSampleResult
from .scoring import aggregate_cost, aggregate_performance, aggregate_quality, aggregate_retrieval, category_aggregates


def build_benchmark_report(
    dataset_name: str,
    config: BenchmarkConfig,
    sample_results: list[EvaluationSampleResult],
    *,
    disabled: bool = False,
) -> BenchmarkRunReport:
    if disabled:
        return BenchmarkRunReport(
            run_id=str(uuid4()),
            dataset_name=dataset_name,
            config=config,
            disabled=True,
        )

    overall_score = round(mean([item.overall_score for item in sample_results]), 4) if sample_results else 0.0
    retrieval = aggregate_retrieval(sample_results)
    quality = aggregate_quality(sample_results)
    performance = aggregate_performance(sample_results)
    cost = aggregate_cost(sample_results)
    confidence_values = [item.observed_run.confidence for item in sample_results if item.observed_run.confidence is not None]
    failure_analysis = [
        f"{item.question}: {item.observed_run.error}"
        for item in sample_results
        if item.observed_run.error
    ]
    slowest = [
        item.question
        for item in sorted(sample_results, key=lambda sample: sample.performance.end_to_end_latency_ms, reverse=True)[:5]
    ]
    lowest_confidence = [
        item.question
        for item in sorted(
            sample_results,
            key=lambda sample: sample.observed_run.confidence if sample.observed_run.confidence is not None else 1.0,
        )[:5]
    ]
    confidence_stats = {
        "average_confidence": round(mean(confidence_values), 4) if confidence_values else 0.0,
        "min_confidence": round(min(confidence_values), 4) if confidence_values else 0.0,
        "max_confidence": round(max(confidence_values), 4) if confidence_values else 0.0,
    }
    return BenchmarkRunReport(
        run_id=str(uuid4()),
        dataset_name=dataset_name,
        config=config,
        sample_results=sample_results,
        overall_score=overall_score,
        category_scores=category_aggregates(sample_results),
        retrieval_metrics=retrieval,
        quality_metrics=quality,
        performance_metrics=performance,
        cost_metrics=cost,
        confidence_statistics=confidence_stats,
        failure_analysis=failure_analysis,
        slowest_queries=slowest,
        lowest_confidence_queries=lowest_confidence,
    )
