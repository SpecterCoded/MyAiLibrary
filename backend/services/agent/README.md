# Workflow-Based Retrieval Agent

The retrieval agent evolves the adaptive retrieval planner without replacing it.
`RetrievalPlan` remains the compatibility contract; the agent wraps it in a
structured directed graph, executes registered tools, reflects on intermediate
state, and chooses conditional branches at runtime.

## Dynamic execution graph

`RetrievalWorkflow` contains immutable graph nodes and conditional edges while
retaining the old `steps` view for backward compatibility. Supported edge
conditions include success, failure, quality levels, retry availability, and
retry exhaustion. Cycles are allowed deliberately for bounded retry branches.

The default graph contains planning, rewrite, cache, retrieval, evaluation,
reflection, answer generation, source extraction, hallucination verification,
and confidence nodes. Cache and hallucination nodes can be skipped; retrieval
and reflection nodes can repeat; registered alternatives can replace a node or
reorder the graph through a custom workflow planner.

## Request lifecycle

1. The existing query rewrite tool resolves conversational references.
2. The existing semantic cache produces a candidate.
3. `WorkflowPlanner` selects tools by capability and declared execution cost,
   then creates validated graph nodes and conditional edges.
4. `RetrievalAgent` invokes the existing `PlannerExecutor` through the registry.
5. `RetrievalEvaluator` measures chunk count, rerank score and spread, lexical
   coverage, retrieval confidence, missing citation metadata, metadata quality,
   and resource diversity.
6. `ReflectionEngine` chooses whether to continue, retry, switch strategy, or
   terminate. `RetryStrategy` supplies bounded retrieval adaptations.
7. The best current or merged result set is selected by measured confidence.
8. Existing answer, citation, hallucination, and confidence tools execute as
   graph nodes using the same request state.

Retries are bounded by `RETRIEVAL_AGENT_MAX_RETRIES` (default `2`, maximum `10`).
Request-scoped `AgentMemory` records queries, completed/failed/skipped nodes,
tool outputs, reflection and branch decisions, method/depth signatures, chunk
IDs, evaluations, and retry count. Identical node/input executions are skipped.

## Adaptation order

The default policy applies the smallest distinct escalation available:

1. Switch vector-only or BM25-only retrieval to hybrid.
2. Add multi-query expansion to hybrid retrieval.
3. Rewrite the retrieval query when key-concept coverage remains weak.
4. Increase final top-k or retrieval depth within validated limits.
5. Stop when quality is good, the retry bound is reached, or no safe distinct
   adaptation remains.

Workspace/user isolation filters are never removed. Explicit resource filters
also remain intact during every attempt.

## Tool registry

Every `ToolRegistry` entry declares capabilities, prerequisites, expected output
keys, and estimated cost (`low`, `medium`, or `high`). The planner selects the
lowest-cost compatible tool. The registry includes callable adapters for:

- query rewrite and semantic cache lookup;
- vector, BM25, and hybrid search;
- multi-query generation, reranking, adaptive hierarchical enrichment,
  adaptive parent-child expansion, and context compression;
- retrieval evaluation and retry orchestration;
- answer generation (normal and streaming), citation extraction, hallucination
  detection, and final confidence scoring.

Future tools such as GraphRAG, SQL, web search, or hierarchical retrieval can be
registered with their capability contract. The generic planner can select them
without changing the agent core.

## Structured telemetry

Two JSONL event types are written through the existing metrics subsystem:

- `retrieval_agent_decision`: attempt plan, tool, duration, chunk count, retry
  number/action, evaluation result, confidence, and reason.
- `retrieval_agent_event`: every planning, execution, reflection, branch,
  failure, and termination event.
- `retrieval_agent_workflow`: final typed workflow, selected final plan, complete
  graph, execution-state summary, evaluation/decision history, retry count, and
  total retrieval-agent time.

Logging failures never interrupt a request.

## Files

- `retrieval_agent.py`: orchestration and best-result selection.
- `planner.py`: adaptive-plan to workflow conversion.
- `workflow_models.py`: immutable workflow/evaluation/decision contracts.
- `workflow_executor.py`: registry adapters over existing services.
- `tool_registry.py`: thread-safe extensibility boundary.
- `retrieval_evaluator.py`: deterministic quality measurement.
- `retry_strategy.py`: bounded adaptation policy.
- `reflection.py`: runtime continue/retry/switch/terminate decisions.
- `agent_memory.py`: request-local loop memory.
- `workflow.py`: workflow inspection helpers.
