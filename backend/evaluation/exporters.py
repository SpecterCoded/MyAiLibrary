"""Export evaluation reports to JSON, CSV, Markdown, and HTML."""

from __future__ import annotations

import csv
import html
import json
from pathlib import Path

from .models import BenchmarkRunReport, RegressionReport


def export_json(report: BenchmarkRunReport | RegressionReport, path: str | Path) -> Path:
    target = Path(path)
    target.write_text(json.dumps(report.model_dump(mode="json"), indent=2), encoding="utf-8")
    return target


def export_csv(report: BenchmarkRunReport, path: str | Path) -> Path:
    target = Path(path)
    with target.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "question", "category", "difficulty", "overall_score",
            "precision_at_k", "recall_at_k", "mrr", "ndcg", "hit_rate",
            "faithfulness", "groundedness", "citation_accuracy", "completeness",
            "hallucination_rate", "confidence", "latency_ms", "estimated_api_cost",
        ])
        for sample in report.sample_results:
            writer.writerow([
                sample.question,
                sample.category,
                sample.difficulty,
                sample.overall_score,
                sample.retrieval.precision_at_k,
                sample.retrieval.recall_at_k,
                sample.retrieval.mrr,
                sample.retrieval.ndcg,
                sample.retrieval.hit_rate,
                sample.quality.faithfulness,
                sample.quality.groundedness,
                sample.quality.citation_accuracy,
                sample.quality.completeness,
                sample.quality.hallucination_rate,
                sample.observed_run.confidence,
                sample.performance.end_to_end_latency_ms,
                sample.cost.estimated_api_cost,
            ])
    return target


def render_markdown(report: BenchmarkRunReport) -> str:
    lines = [
        f"# Benchmark Report: {report.dataset_name}",
        "",
        f"- Run ID: `{report.run_id}`",
        f"- Overall score: `{report.overall_score:.4f}`",
        f"- Samples: `{len(report.sample_results)}`",
        "",
        "## Category scores",
        "",
        "| Category | Samples | Overall | Retrieval | Quality | Avg latency (ms) | Avg cost |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for category in report.category_scores:
        lines.append(
            f"| {category.category} | {category.sample_count} | {category.overall_score:.4f} | "
            f"{category.retrieval_score:.4f} | {category.quality_score:.4f} | "
            f"{category.average_latency_ms:.2f} | {category.average_cost:.6f} |"
        )
    lines.extend([
        "",
        "## Lowest confidence queries",
        "",
    ])
    for item in report.lowest_confidence_queries:
        lines.append(f"- {item}")
    lines.extend([
        "",
        "## Slowest queries",
        "",
    ])
    for item in report.slowest_queries:
        lines.append(f"- {item}")
    return "\n".join(lines)


def export_markdown(report: BenchmarkRunReport, path: str | Path) -> Path:
    target = Path(path)
    target.write_text(render_markdown(report), encoding="utf-8")
    return target


def render_html(report: BenchmarkRunReport) -> str:
    rows = "\n".join(
        "<tr>"
        f"<td>{html.escape(category.category)}</td>"
        f"<td>{category.sample_count}</td>"
        f"<td>{category.overall_score:.4f}</td>"
        f"<td>{category.retrieval_score:.4f}</td>"
        f"<td>{category.quality_score:.4f}</td>"
        f"<td>{category.average_latency_ms:.2f}</td>"
        f"<td>{category.average_cost:.6f}</td>"
        "</tr>"
        for category in report.category_scores
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Benchmark Report</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 24px; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
    th {{ background: #f5f5f5; }}
  </style>
</head>
<body>
  <h1>Benchmark Report: {html.escape(report.dataset_name)}</h1>
  <p>Run ID: <code>{html.escape(report.run_id)}</code></p>
  <p>Overall score: <strong>{report.overall_score:.4f}</strong></p>
  <h2>Category scores</h2>
  <table>
    <thead>
      <tr><th>Category</th><th>Samples</th><th>Overall</th><th>Retrieval</th><th>Quality</th><th>Avg latency (ms)</th><th>Avg cost</th></tr>
    </thead>
    <tbody>
      {rows}
    </tbody>
  </table>
</body>
</html>"""


def export_html(report: BenchmarkRunReport, path: str | Path) -> Path:
    target = Path(path)
    target.write_text(render_html(report), encoding="utf-8")
    return target
