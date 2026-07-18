# Evaluation Framework

This package is a purely observational evaluation layer for the RAG system.
It does not modify retrieval, planning, answer generation, or production API
behavior.

What it supports:

- loading benchmark datasets from JSON or YAML;
- evaluating a single question, a batch, or a full suite;
- computing retrieval, answer-quality, performance, and cost metrics;
- generating aggregate benchmark reports;
- comparing two benchmark runs for regressions or improvements;
- exporting JSON, CSV, Markdown, and HTML reports.

Expected usage:

1. Build or load a `BenchmarkDataset`.
2. Provide a callable that returns an observed run from existing system outputs.
3. Run `BenchmarkRunner.run_suite(...)`.
4. Export the resulting `BenchmarkRunReport`.

The evaluator can consume:

- retrieved chunks and sources;
- hallucination outputs;
- confidence scores;
- execution reports;
- planner outputs;
- existing JSONL metrics logs.

No evaluation code is imported by the production retrieval path.
