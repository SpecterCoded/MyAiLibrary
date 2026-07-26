"""Aggregate report builder and exporters for the standalone evaluation framework.

This module was previously referenced by ``benchmark_runner`` but missing from the
package, which made ``from .reports import build_benchmark_report`` fail on import.
It is purely observational: it only summarizes already-computed sample results and
never touches production retrieval, planning, or generation.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from .models import (
    BenchmarkConfig,
    BenchmarkRunReport,
    EvaluationSampleResult,
)
from .scoring import (
    aggregate_cost,
    aggregate_performance,
    aggregate_quality,
    aggregate_retrieval,
    category_aggregates,
)

# How many entries to surface in the "slowest" / "lowest confidence" call-outs.
_TOP_N = 5


def _new_run_id() -> str:
    """Time-sortable, unique run id (safe for filenames)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"run_{stamp}_{uuid4().hex[:8]}"


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _confidence_statistics(samples: list[EvaluationSampleResult]) -> dict[str, float]:
    confidences = [
        s.observed_run.confidence
        for s in samples
        if s.observed_run.confidence is not None
    ]
    if not confidences:
        return {}
    return {
        "count": float(len(confidences)),
        "mean": round(_mean(confidences), 4),
        "min": round(min(confidences), 4),
        "max": round(max(confidences), 4),
    }


def _failure_analysis(samples: list[EvaluationSampleResult]) -> list[str]:
    failures: list[str] = []
    for s in samples:
        if s.observed_run.error:
            failures.append(f"[error] {s.question} :: {s.observed_run.error}")
        elif not s.observed_run.answer.strip():
            failures.append(f"[empty-answer] {s.question}")
        elif s.observed_run.hallucinations:
            failures.append(
                f"[hallucinations={len(s.observed_run.hallucinations)}] {s.question}"
            )
    return failures


def _slowest_queries(samples: list[EvaluationSampleResult]) -> list[str]:
    ranked = sorted(
        samples,
        key=lambda s: s.performance.end_to_end_latency_ms
        or s.performance.total_latency_ms,
        reverse=True,
    )
    out = []
    for s in ranked[:_TOP_N]:
        ms = s.performance.end_to_end_latency_ms or s.performance.total_latency_ms
        out.append(f"{ms:.0f}ms :: {s.question}")
    return out


def _lowest_confidence_queries(samples: list[EvaluationSampleResult]) -> list[str]:
    scored = [s for s in samples if s.observed_run.confidence is not None]
    ranked = sorted(scored, key=lambda s: s.observed_run.confidence)
    return [
        f"{s.observed_run.confidence:.2f} :: {s.question}" for s in ranked[:_TOP_N]
    ]


def build_benchmark_report(
    dataset_name: str,
    config: BenchmarkConfig,
    sample_results: list[EvaluationSampleResult],
    *,
    disabled: bool = False,
) -> BenchmarkRunReport:
    """Aggregate per-sample results into a single benchmark report.

    Matches the call sites in ``benchmark_runner`` exactly:
    ``build_benchmark_report(name, config, results)`` and, for the disabled path,
    ``build_benchmark_report(name, config, [], disabled=True)``.
    """
    if disabled or not sample_results:
        return BenchmarkRunReport(
            run_id=_new_run_id(),
            dataset_name=dataset_name,
            config=config,
            sample_results=list(sample_results),
            disabled=disabled,
        )

    overall = round(_mean([s.overall_score for s in sample_results]), 4)

    return BenchmarkRunReport(
        run_id=_new_run_id(),
        dataset_name=dataset_name,
        config=config,
        sample_results=sample_results,
        overall_score=overall,
        category_scores=category_aggregates(sample_results),
        retrieval_metrics=aggregate_retrieval(sample_results),
        quality_metrics=aggregate_quality(sample_results),
        performance_metrics=aggregate_performance(sample_results),
        cost_metrics=aggregate_cost(sample_results),
        confidence_statistics=_confidence_statistics(sample_results),
        failure_analysis=_failure_analysis(sample_results),
        slowest_queries=_slowest_queries(sample_results),
        lowest_confidence_queries=_lowest_confidence_queries(sample_results),
        disabled=False,
    )


# ---------------------------------------------------------------------------
# Optional exporters (dependency-free). Handy for saving a run to disk.
# ---------------------------------------------------------------------------

def report_to_dict(report: BenchmarkRunReport) -> dict:
    """Full report as a plain dict (Pydantic v2)."""
    return report.model_dump()


def export_json(report: BenchmarkRunReport, *, indent: int = 2) -> str:
    """Serialize the report to a JSON string."""
    return json.dumps(report_to_dict(report), indent=indent, default=str)


def export_markdown(report: BenchmarkRunReport) -> str:
    """Render a compact, human-readable Markdown summary of the run."""
    r = report
    lines: list[str] = []
    lines.append(f"# Benchmark Report — {r.dataset_name}")
    lines.append("")
    lines.append(f"- Run ID: `{r.run_id}`")
    lines.append(f"- Created: {r.created_at}")
    lines.append(f"- Samples: {len(r.sample_results)}")
    if r.disabled:
        lines.append("")
        lines.append("> Evaluation was disabled for this run.")
        return "\n".join(lines)

    lines.append(f"- Overall score: **{r.overall_score:.3f}**")
    lines.append("")
    lines.append("## Retrieval")
    rm = r.retrieval_metrics
    lines.append(
        f"- precision@k {rm.precision_at_k:.3f} · recall@k {rm.recall_at_k:.3f} · "
        f"MRR {rm.mrr:.3f} · nDCG {rm.ndcg:.3f} · hit-rate {rm.hit_rate:.3f}"
    )
    lines.append("")
    lines.append("## Answer quality")
    qm = r.quality_metrics
    lines.append(
        f"- faithfulness {qm.faithfulness:.3f} · groundedness {qm.groundedness:.3f} · "
        f"citation {qm.citation_accuracy:.3f} · completeness {qm.completeness:.3f} · "
        f"hallucination-rate {qm.hallucination_rate:.3f}"
    )
    if r.confidence_statistics:
        cs = r.confidence_statistics
        lines.append("")
        lines.append("## Confidence")
        lines.append(
            f"- mean {cs.get('mean', 0):.3f} · min {cs.get('min', 0):.3f} · "
            f"max {cs.get('max', 0):.3f} (n={int(cs.get('count', 0))})"
        )
    if r.category_scores:
        lines.append("")
        lines.append("## By category")
        for c in r.category_scores:
            lines.append(
                f"- **{c.category}** (n={c.sample_count}): overall {c.overall_score:.3f}, "
                f"retrieval {c.retrieval_score:.3f}, quality {c.quality_score:.3f}"
            )
    if r.slowest_queries:
        lines.append("")
        lines.append("## Slowest queries")
        for q in r.slowest_queries:
            lines.append(f"- {q}")
    if r.lowest_confidence_queries:
        lines.append("")
        lines.append("## Lowest-confidence queries")
        for q in r.lowest_confidence_queries:
            lines.append(f"- {q}")
    if r.failure_analysis:
        lines.append("")
        lines.append("## Failures / flags")
        for f in r.failure_analysis:
            lines.append(f"- {f}")
    return "\n".join(lines)
