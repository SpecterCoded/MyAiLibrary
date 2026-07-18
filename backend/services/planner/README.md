# Agentic Retrieval Planner

This package extends the existing RAG pipeline; it does not replace retrieval,
reranking, compression, cache, answer generation, hallucination detection, or
confidence scoring.

The adaptive plan is now consumed by the workflow-based agent in
`services/agent`. This package remains intact as the initial strategy planner and
single-attempt execution engine, preserving direct-call compatibility.

## Components

- `planner_models.py`: immutable Pydantic plan contract and enums.
- `retrieval_planner.py`: deterministic LLM planning with validated structured
  output and a local heuristic fallback.
- `planner_executor.py`: registry-driven orchestration over the existing vector,
  BM25, hybrid/RRF, multi-query, reranker, and compression functions.
- `planner_prompt.py`: versionable deterministic planning prompt.

The pipeline obtains a semantic-cache candidate, creates a plan, and accepts the
candidate only when `trust_semantic_cache` is true and its confidence meets the
plan threshold. A miss or rejected candidate is executed using the plan. Public
RAG function signatures and response payloads remain compatible.

## Configuration

- `RETRIEVAL_PLANNER_USE_LLM`: defaults to `true`; set to `false` for local-only
  deterministic classification.
- `RETRIEVAL_PLANNER_MODEL`: optional planner model override; defaults to the
  model already used by the application.

Provider errors, malformed JSON, and schema violations automatically use the
heuristic planner. An empty query uses the legacy full-pipeline fallback plan.

## Extension

Implement the `RetrievalHandler` protocol and register the handler on
`PlannerExecutor`. Adding a future strategy requires extending the retrieval-mode
enum/schema and prompt allow-list, while execution-stage logic remains unchanged.

Structured `retrieval_plan` events are appended to `logs/metrics.jsonl` with the
input, validated output, timing, strategy, executed/skipped modules, reasoning,
cache status, and final confidence.
