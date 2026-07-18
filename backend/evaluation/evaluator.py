"""Evaluate one observed RAG run without influencing production behavior."""

from __future__ import annotations

import json
from pathlib import Path
from time import perf_counter
from typing import Any

from .metrics import answer_quality_metrics, cost_metrics, performance_metrics, retrieval_metrics
from .models import BenchmarkConfig, BenchmarkExample, EvaluationSampleResult, ObservedChunk, ObservedLatency, ObservedRun, ObservedSource, ObservedTokenUsage
from .scoring import sample_overall_score


class RAGEvaluator:
    """Observational evaluator built around existing production outputs."""

    def __init__(self, config: BenchmarkConfig | None = None) -> None:
        self.config = config or BenchmarkConfig.from_env()

    def evaluate(self, example: BenchmarkExample, observed_run: ObservedRun) -> EvaluationSampleResult:
        retrieval = retrieval_metrics(example, observed_run, self.config)
        quality = answer_quality_metrics(example, observed_run, self.config)
        performance = performance_metrics(observed_run)
        cost = cost_metrics(observed_run, self.config)
        sample = EvaluationSampleResult(
            question=example.question,
            category=example.category,
            difficulty=example.difficulty,
            overall_score=0.0,
            retrieval=retrieval,
            quality=quality,
            performance=performance,
            cost=cost,
            observed_run=observed_run,
            notes=self._notes(example, observed_run),
        )
        return sample.model_copy(update={"overall_score": sample_overall_score(sample)})

    def evaluate_single(
        self,
        question: str,
        observed_run: ObservedRun,
        *,
        category: str = "single",
        difficulty: str = "unknown",
        expected_answer: str | None = None,
        expected_document_ids: list[str] | None = None,
        expected_chunk_ids: list[str] | None = None,
    ) -> EvaluationSampleResult:
        return self.evaluate(
            BenchmarkExample(
                question=question,
                category=category,
                difficulty=difficulty,
                expected_answer=expected_answer,
                expected_document_ids=expected_document_ids or [],
                expected_chunk_ids=expected_chunk_ids or [],
            ),
            observed_run,
        )

    def observe_callable(self, question: str, runner) -> ObservedRun:
        """Run an existing callable from the outside and capture timings."""

        started = perf_counter()
        payload = runner(question)
        total_ms = (perf_counter() - started) * 1000.0
        return self.normalize_observed_run(payload, default_question=question).model_copy(
            update={
                "latency": self.normalize_observed_run(payload, default_question=question).latency.model_copy(
                    update={
                        "total_latency_ms": total_ms,
                        "end_to_end_latency_ms": total_ms,
                    }
                )
            }
        )

    def normalize_observed_run(self, payload: Any, *, default_question: str = "") -> ObservedRun:
        """Accept dict-like outputs from existing services and convert them to a typed snapshot."""

        if isinstance(payload, ObservedRun):
            return payload
        if hasattr(payload, "model_dump"):
            payload = payload.model_dump(mode="python")
        if not isinstance(payload, dict):
            raise TypeError("Observed run payload must be a dict-like object or ObservedRun")

        chunks = [
            chunk if isinstance(chunk, ObservedChunk) else ObservedChunk.model_validate({
                "resource_id": (chunk.get("metadata") or {}).get("resource_id", chunk.get("resource_id")),
                "chunk_index": chunk.get("chunk_index", (chunk.get("metadata") or {}).get("chunk_index")),
                "chunk_id": (chunk.get("metadata") or {}).get("chunk_id", chunk.get("chunk_id")),
                "content": chunk.get("content", chunk.get("document", "")),
                "score": chunk.get("score"),
                "rerank_score": chunk.get("rerank_score"),
                "hybrid_score": chunk.get("hybrid_score"),
                "metadata": chunk.get("metadata", {}),
            })
            for chunk in payload.get("retrieved_chunks", payload.get("results", []))
        ]
        sources = [
            source if isinstance(source, ObservedSource) else ObservedSource.model_validate(source)
            for source in payload.get("sources", [])
        ]
        token_usage = payload.get("token_usage", {})
        latency = payload.get("latency", {})
        run = ObservedRun(
            question=payload.get("question") or default_question or "",
            answer=payload.get("answer", ""),
            context=payload.get("context", ""),
            rewritten_question=payload.get("rewritten_question"),
            retrieved_chunks=chunks,
            sources=sources,
            hallucinations=list(payload.get("hallucinations", [])),
            confidence=payload.get("confidence"),
            confidence_label=payload.get("confidence_label"),
            cache_hit=bool(payload.get("cache_hit", False)),
            planner_output=payload.get("planner_output", payload.get("plan", {})) or {},
            execution_report=payload.get("execution_report", payload.get("report", {})) or {},
            token_usage=ObservedTokenUsage.model_validate(token_usage) if not isinstance(token_usage, ObservedTokenUsage) else token_usage,
            latency=ObservedLatency.model_validate(latency) if not isinstance(latency, ObservedLatency) else latency,
            logs=list(payload.get("logs", [])),
            error=payload.get("error"),
        )
        return self.enrich_from_logs(run)

    def enrich_from_logs(self, run: ObservedRun, log_path: str | Path | None = None) -> ObservedRun:
        """Optionally read existing metrics logs and attach matching entries."""

        path = Path(log_path) if log_path else Path(__file__).resolve().parent.parent / "logs" / "metrics.jsonl"
        if not path.exists():
            return run
        matches: list[dict[str, Any]] = []
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                item = json.loads(line)
                if item.get("query") == run.question:
                    matches.append(item)
        except Exception:
            return run
        planner_output = dict(run.planner_output)
        cache_hit = run.cache_hit
        execution_report = dict(run.execution_report)
        for item in matches:
            if item.get("type") == "retrieval_plan":
                planner_output.setdefault("planner_output", item.get("planner_output"))
                execution_report.setdefault("retrieval_strategy", item.get("retrieval_strategy"))
                execution_report.setdefault("modules_executed", item.get("modules_executed", []))
                execution_report.setdefault("modules_skipped", item.get("modules_skipped", []))
                cache_hit = bool(item.get("cache_hit", cache_hit))
        return run.model_copy(update={"logs": matches, "planner_output": planner_output, "execution_report": execution_report, "cache_hit": cache_hit})

    @staticmethod
    def _notes(example: BenchmarkExample, run: ObservedRun) -> list[str]:
        notes: list[str] = []
        if run.error:
            notes.append(f"Execution error: {run.error}")
        if example.expected_document_ids and not run.sources:
            notes.append("Expected document IDs were provided, but no sources were observed.")
        if run.cache_hit:
            notes.append("Result was served from semantic cache.")
        return notes
