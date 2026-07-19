"""Structured metrics logger for the RAG pipeline.

Writes one JSON line per query to logs/metrics.jsonl.
Non-blocking, file-based, no external dependencies.
All write failures are silently ignored - never breaks the pipeline.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from core.paths import LOG_DIR

LOG_FILE = LOG_DIR / "metrics.jsonl"


def _ensure_log_dir():
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass


def log_query(query, latency_ms, cache_hit, chunks_retrieved, avg_rerank_score=0.0, top_rerank_score=0.0, hallucination_count=0, confidence_score=0.0, confidence_label="", complexity_level="", resource_id="", user_id=""):
    try:
        _ensure_log_dir()
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "query": query[:500], "latency_ms": round(latency_ms, 1), "cache_hit": cache_hit, "chunks": chunks_retrieved, "avg_rerank": round(avg_rerank_score, 4), "top_rerank": round(top_rerank_score, 4), "hallucinations": hallucination_count, "confidence": round(confidence_score, 4), "confidence_label": confidence_label, "complexity": complexity_level, "resource_id": resource_id or "", "user_id": user_id or ""}
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def log_retrieval_stats(
    query,
    chunks_before_rerank,
    chunks_after_rerank,
    hybrid_scores,
    rerank_scores,
    cache_hit=False,
    resource_id="",
    user_id="",
):
    try:
        _ensure_log_dir()
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "type": "retrieval", "query": query[:500], "chunks_before": chunks_before_rerank, "chunks_after": chunks_after_rerank, "hybrid_avg": round(sum(hybrid_scores) / len(hybrid_scores), 4) if hybrid_scores else 0, "hybrid_top": round(max(hybrid_scores), 4) if hybrid_scores else 0, "rerank_avg": round(sum(rerank_scores) / len(rerank_scores), 4) if rerank_scores else 0, "rerank_top": round(max(rerank_scores), 4) if rerank_scores else 0, "cache_hit": cache_hit, "resource_id": resource_id or "", "user_id": user_id or ""}
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def read_metrics(limit=100, user_id=None):
    try:
        if not LOG_FILE.exists():
            return []
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
        entries = []
        for line in reversed(lines):
            line = line.strip()
            if line:
                try:
                    entry = json.loads(line)
                    if user_id is not None and entry.get("user_id") != user_id:
                        continue
                    entries.append(entry)
                    if len(entries) >= limit:
                        break
                except json.JSONDecodeError:
                    pass
        return list(reversed(entries))
    except Exception:
        return []


def log_planner_execution(
    planner_input, planner_output, execution_time_ms, retrieval_strategy,
    modules_executed, modules_skipped, reasoning, final_confidence,
    cache_hit=False, user_id="", resource_id="",
):
    """Write a structured planner audit event without affecting requests."""
    try:
        _ensure_log_dir()
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": "retrieval_plan",
            "planner_input": str(planner_input)[:500],
            "planner_output": planner_output,
            "execution_time_ms": round(float(execution_time_ms), 1),
            "retrieval_strategy": retrieval_strategy,
            "modules_executed": list(modules_executed),
            "modules_skipped": list(modules_skipped),
            "reasoning": str(reasoning)[:300],
            "final_confidence": round(float(final_confidence), 4),
            "cache_hit": bool(cache_hit),
            "resource_id": resource_id or "",
            "user_id": user_id or "",
        }
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _append_structured_event(entry):
    """Append one metrics event; callers remain non-blocking and failure-safe."""
    try:
        _ensure_log_dir()
        payload = {"ts": datetime.now(timezone.utc).isoformat(), **entry}
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass


def log_agent_decision(workflow_id, query, plan, decision, user_id="", resource_id=""):
    """Log one retrieval-agent attempt and its resulting decision."""
    _append_structured_event({
        "type": "retrieval_agent_decision",
        "workflow_id": workflow_id,
        "query": str(query)[:500],
        "plan": plan,
        "decision": decision,
        "user_id": user_id or "",
        "resource_id": resource_id or "",
    })


def log_agent_workflow(
    workflow,
    final_plan,
    retry_count,
    evaluations,
    decisions,
    execution_time_ms,
    execution_state=None,
    final_confidence=None,
    query="",
    workflow_id="",
    user_id="",
    resource_id="",
):
    """Log the final workflow, evaluation history, and selected result."""
    _append_structured_event({
        "type": "retrieval_agent_workflow",
        "workflow_id": workflow_id or str((workflow or {}).get("workflow_id", "")),
        "query": str(query or (workflow or {}).get("query", ""))[:500],
        "workflow": workflow,
        "final_plan": final_plan,
        "retry_count": int(retry_count),
        "evaluations": evaluations,
        "decisions": decisions,
        "execution_time_ms": round(float(execution_time_ms), 1),
        "execution_state": execution_state or {},
        "final_confidence": final_confidence,
        "user_id": user_id or "",
        "resource_id": resource_id or "",
    })


def log_agent_event(workflow_id, event_type, node_id, tool_name, status, details, query="", user_id="", resource_id=""):
    """Log planning, execution, reflection, branch, failure, or termination events."""
    _append_structured_event({
        "type": "retrieval_agent_event",
        "workflow_id": workflow_id,
        "query": str(query)[:500],
        "event_type": event_type,
        "node_id": node_id,
        "tool_name": tool_name,
        "status": status,
        "details": details,
        "user_id": user_id or "",
        "resource_id": resource_id or "",
    })


def log_parent_child_expansion(
    query,
    child_chunks,
    parent_sections,
    context_size_before,
    context_size_after,
    success,
    fallback_reason="",
    selected=None,
    selected_parent_sections=None,
    available_parent_sections=None,
    user_id="",
    resource_id="",
):
    """Log optional parent-child retrieval expansion and fallback behavior."""
    _append_structured_event({
        "type": "parent_child_expansion",
        "query": str(query)[:500],
        "child_chunks": child_chunks,
        "parent_sections": parent_sections,
        "context_size_before_tokens": int(context_size_before),
        "context_size_after_tokens": int(context_size_after),
        "success": bool(success),
        "fallback_reason": str(fallback_reason)[:200],
        "selected": selected,
        "selected_parent_sections": selected_parent_sections,
        "available_parent_sections": available_parent_sections,
        "user_id": user_id or "",
        "resource_id": resource_id or "",
    })


def log_hierarchical_retrieval(
    query,
    selected,
    selected_levels,
    retrieved_nodes,
    context_size_before,
    context_size_after,
    success,
    fallback_reason="",
    user_id="",
    resource_id="",
):
    """Log hierarchical enrichment selection, nodes, and fallback details."""
    _append_structured_event({
        "type": "hierarchical_retrieval",
        "query": str(query)[:500],
        "selected": bool(selected),
        "selected_levels": list(selected_levels or []),
        "retrieved_nodes": list(retrieved_nodes or []),
        "context_size_before_tokens": int(context_size_before),
        "context_size_after_tokens": int(context_size_after),
        "success": bool(success),
        "fallback_reason": str(fallback_reason)[:200],
        "user_id": user_id or "",
        "resource_id": resource_id or "",
    })


def log_unified_search(
    query,
    latency_ms,
    result_count,
    content_type_distribution,
    search_source_usage,
    cache_hit=False,
    user_id="",
):
    """Log one unified search request for observability and dashboard consumption."""
    _append_structured_event({
        "type": "unified_search",
        "query": str(query)[:500],
        "latency_ms": round(float(latency_ms), 1),
        "result_count": int(result_count),
        "content_type_distribution": dict(content_type_distribution or {}),
        "search_source_usage": dict(search_source_usage or {}),
        "cache_hit": bool(cache_hit),
        "user_id": user_id or "",
    })


def log_unified_search_click(
    query,
    result_id,
    result_type,
    content_type="",
    source_id="",
    user_id="",
):
    """Log a click-through event for unified search results."""
    _append_structured_event({
        "type": "unified_search_click",
        "query": str(query)[:500],
        "result_id": str(result_id),
        "result_type": str(result_type),
        "content_type": str(content_type or ""),
        "source_id": str(source_id or ""),
        "user_id": user_id or "",
    })
