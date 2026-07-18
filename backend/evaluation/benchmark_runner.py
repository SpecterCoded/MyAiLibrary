"""Benchmark runner for single-question, batch, suite, and regression evaluation."""

from __future__ import annotations

from typing import Callable

from .evaluator import RAGEvaluator
from .models import BenchmarkConfig, BenchmarkDataset, BenchmarkExample, BenchmarkRunReport, ObservedRun, RegressionReport
from .reports import build_benchmark_report
from .scoring import build_regression_report


ObservedRunProvider = Callable[[BenchmarkExample], ObservedRun | dict]


class BenchmarkRunner:
    """Run evaluation suites without altering production services."""

    def __init__(self, evaluator: RAGEvaluator | None = None, config: BenchmarkConfig | None = None) -> None:
        self.config = config or BenchmarkConfig()
        self.evaluator = evaluator or RAGEvaluator(self.config)

    def run_single(self, example: BenchmarkExample, provider: ObservedRunProvider) -> BenchmarkRunReport:
        return self.run_batch(BenchmarkDataset(name="single-question", examples=[example]), provider)

    def run_batch(self, dataset: BenchmarkDataset, provider: ObservedRunProvider) -> BenchmarkRunReport:
        if not self.config.enable_evaluation:
            return build_benchmark_report(dataset.name, self.config, [], disabled=True)
        sample_results = []
        for example in dataset.examples:
            observed = provider(example)
            normalized = self.evaluator.normalize_observed_run(observed, default_question=example.question)
            sample_results.append(self.evaluator.evaluate(example, normalized))
        return build_benchmark_report(dataset.name, self.config, sample_results)

    def run_suite(self, dataset: BenchmarkDataset, provider: ObservedRunProvider) -> BenchmarkRunReport:
        return self.run_batch(dataset, provider)

    def compare_runs(self, baseline: BenchmarkRunReport, candidate: BenchmarkRunReport) -> RegressionReport:
        if not self.config.enable_regression_reports:
            raise RuntimeError("Regression reporting is disabled by configuration.")
        return build_regression_report(baseline, candidate)
