"""Typed contracts used by the standalone evaluation framework."""

from __future__ import annotations

from datetime import datetime, timezone
from os import getenv
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BenchmarkConfig(BaseModel):
    """Feature flags and cost assumptions for the evaluator."""

    model_config = ConfigDict(extra="forbid")

    enable_evaluation: bool = True
    enable_cost_tracking: bool = True
    enable_quality_metrics: bool = True
    enable_regression_reports: bool = True
    enable_html_reports: bool = True
    default_k: int = Field(default=5, ge=1, le=100)
    prompt_cost_per_1k_tokens: float = Field(default=0.0, ge=0.0)
    completion_cost_per_1k_tokens: float = Field(default=0.0, ge=0.0)
    embedding_cost_per_1k_tokens: float = Field(default=0.0, ge=0.0)

    @classmethod
    def from_env(cls) -> "BenchmarkConfig":
        def _enabled(name: str, fallback: str) -> bool:
            return getenv(name, getenv(name.lower(), fallback)).lower() in ("1", "true", "yes")

        return cls(
            enable_evaluation=_enabled("ENABLE_EVALUATION", "1"),
            enable_cost_tracking=_enabled("ENABLE_COST_TRACKING", "1"),
            enable_quality_metrics=_enabled("ENABLE_QUALITY_METRICS", "1"),
            enable_regression_reports=_enabled("ENABLE_REGRESSION_REPORTS", "1"),
            enable_html_reports=_enabled("ENABLE_HTML_REPORTS", "1"),
            default_k=max(1, int(getenv("EVALUATION_DEFAULT_K", "5"))),
            prompt_cost_per_1k_tokens=max(0.0, float(getenv("EVALUATION_PROMPT_COST_PER_1K", "0"))),
            completion_cost_per_1k_tokens=max(0.0, float(getenv("EVALUATION_COMPLETION_COST_PER_1K", "0"))),
            embedding_cost_per_1k_tokens=max(0.0, float(getenv("EVALUATION_EMBEDDING_COST_PER_1K", "0"))),
        )


class BenchmarkExample(BaseModel):
    """One benchmark question plus optional expectations."""

    model_config = ConfigDict(extra="forbid")

    question: str = Field(min_length=1)
    expected_answer: str | None = None
    expected_source_documents: list[str] = Field(default_factory=list)
    expected_citations: list[str] = Field(default_factory=list)
    expected_document_ids: list[str] = Field(default_factory=list)
    expected_chunk_ids: list[str] = Field(default_factory=list)
    category: str = Field(default="general", min_length=1)
    difficulty: str = Field(default="medium", min_length=1)
    notes: str = ""


class BenchmarkDataset(BaseModel):
    """A named set of benchmark examples."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str = ""
    examples: list[BenchmarkExample] = Field(default_factory=list)


class ObservedChunk(BaseModel):
    """A retrieved chunk or enrichment node captured from an observed run."""

    model_config = ConfigDict(extra="allow")

    resource_id: str | None = None
    chunk_index: int | None = None
    chunk_id: str | None = None
    content: str = ""
    score: float | None = None
    rerank_score: float | None = None
    hybrid_score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ObservedSource(BaseModel):
    """Citation/source metadata captured from an observed run."""

    model_config = ConfigDict(extra="allow")

    resource_id: str | None = None
    chunk_index: int | None = None
    excerpt: str = ""
    resource_title: str | None = None
    resource_path: str | None = None
    citation: str | None = None


class ObservedTokenUsage(BaseModel):
    """Observed token counts, if available from the surrounding system."""

    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = Field(default=0, ge=0)
    completion_tokens: int = Field(default=0, ge=0)
    embedding_tokens: int = Field(default=0, ge=0)


class ObservedLatency(BaseModel):
    """Observed timing breakdown for one evaluated question."""

    model_config = ConfigDict(extra="forbid")

    total_latency_ms: float = Field(default=0.0, ge=0.0)
    retrieval_latency_ms: float = Field(default=0.0, ge=0.0)
    rerank_latency_ms: float = Field(default=0.0, ge=0.0)
    llm_latency_ms: float = Field(default=0.0, ge=0.0)
    end_to_end_latency_ms: float = Field(default=0.0, ge=0.0)


class ObservedRun(BaseModel):
    """Purely observational snapshot of one production-style run."""

    model_config = ConfigDict(extra="allow")

    question: str = Field(min_length=1)
    answer: str = ""
    context: str = ""
    rewritten_question: str | None = None
    retrieved_chunks: list[ObservedChunk] = Field(default_factory=list)
    sources: list[ObservedSource] = Field(default_factory=list)
    hallucinations: list[dict[str, Any]] = Field(default_factory=list)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence_label: str | None = None
    cache_hit: bool = False
    planner_output: dict[str, Any] = Field(default_factory=dict)
    execution_report: dict[str, Any] = Field(default_factory=dict)
    token_usage: ObservedTokenUsage = Field(default_factory=ObservedTokenUsage)
    latency: ObservedLatency = Field(default_factory=ObservedLatency)
    logs: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class RetrievalMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    precision_at_k: float = 0.0
    recall_at_k: float = 0.0
    mrr: float = 0.0
    ndcg: float = 0.0
    hit_rate: float = 0.0
    retrieved_chunk_count: int = 0
    parent_expansion_usage: float = 0.0
    hierarchical_retrieval_usage: float = 0.0


class AnswerQualityMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    faithfulness: float = 0.0
    groundedness: float = 0.0
    citation_accuracy: float = 0.0
    context_utilization: float = 0.0
    completeness: float = 0.0
    hallucination_rate: float = 0.0
    confidence_calibration: float = 0.0


class PerformanceMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_latency_ms: float = 0.0
    retrieval_latency_ms: float = 0.0
    rerank_latency_ms: float = 0.0
    llm_latency_ms: float = 0.0
    end_to_end_latency_ms: float = 0.0


class CostMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt_tokens: int = 0
    completion_tokens: int = 0
    embedding_tokens: int = 0
    estimated_api_cost: float = 0.0
    cache_hit_rate: float = 0.0


class EvaluationSampleResult(BaseModel):
    """Full evaluation output for one question."""

    model_config = ConfigDict(extra="forbid")

    question: str
    category: str
    difficulty: str
    overall_score: float = Field(ge=0.0, le=1.0)
    retrieval: RetrievalMetrics
    quality: AnswerQualityMetrics
    performance: PerformanceMetrics
    cost: CostMetrics
    observed_run: ObservedRun
    notes: list[str] = Field(default_factory=list)


class CategoryAggregate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: str
    sample_count: int = 0
    overall_score: float = 0.0
    retrieval_score: float = 0.0
    quality_score: float = 0.0
    average_latency_ms: float = 0.0
    average_cost: float = 0.0


class BenchmarkRunReport(BaseModel):
    """Aggregate report for a benchmark run."""

    model_config = ConfigDict(extra="forbid")

    run_id: str
    dataset_name: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    config: BenchmarkConfig
    sample_results: list[EvaluationSampleResult] = Field(default_factory=list)
    overall_score: float = 0.0
    category_scores: list[CategoryAggregate] = Field(default_factory=list)
    retrieval_metrics: RetrievalMetrics = Field(default_factory=RetrievalMetrics)
    quality_metrics: AnswerQualityMetrics = Field(default_factory=AnswerQualityMetrics)
    performance_metrics: PerformanceMetrics = Field(default_factory=PerformanceMetrics)
    cost_metrics: CostMetrics = Field(default_factory=CostMetrics)
    confidence_statistics: dict[str, float] = Field(default_factory=dict)
    failure_analysis: list[str] = Field(default_factory=list)
    slowest_queries: list[str] = Field(default_factory=list)
    lowest_confidence_queries: list[str] = Field(default_factory=list)
    disabled: bool = False


class RegressionDelta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baseline: float = 0.0
    candidate: float = 0.0
    absolute_change: float = 0.0
    relative_change: float = 0.0
    trend: str = "unchanged"


class RegressionReport(BaseModel):
    """Comparison between two benchmark runs."""

    model_config = ConfigDict(extra="forbid")

    baseline_run_id: str
    candidate_run_id: str
    overall_score: RegressionDelta
    accuracy_change: RegressionDelta
    latency_change: RegressionDelta
    cost_change: RegressionDelta
    confidence_change: RegressionDelta
    retrieval_quality_change: RegressionDelta
    highlights: list[str] = Field(default_factory=list)
