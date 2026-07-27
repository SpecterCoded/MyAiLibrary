"""Focused safety and lifecycle tests for structured RAG tracing."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from services import pipeline_logger
from services.pipeline_logger import (
    RagPipelineTrace,
    get_current_rag_trace,
    trace_rag_pipeline,
)
from services.planner.planner_executor import PlannerExecutor, RetrievalRequest
from services.planner.planner_models import RetrievalMode, RetrievalPlan


class RagPipelineLoggingTests(unittest.TestCase):
    def test_trace_uses_one_correlation_id_and_drops_content_fields(self):
        trace = RagPipelineTrace(
            streaming=False,
            resource_scoped=True,
            selected_resource_count=0,
            chat_history_present=True,
            concise=False,
            globe_mode=False,
        )
        with patch.object(pipeline_logger.logger, "info") as info:
            trace.start()
            with trace.phase(
                "dense_retrieval",
                {
                    "query": "PRIVATE QUERY",
                    "answer": "PRIVATE ANSWER",
                    "context": "PRIVATE CONTEXT",
                    "candidateCount": 8,
                },
            ):
                pass
            trace.finish({"confidence": 0.82, "sourceCount": 3})

        calls = info.call_args_list
        self.assertGreaterEqual(len(calls), 4)
        correlation_ids = {
            call.kwargs.get("correlation_id")
            for call in calls
            if call.kwargs.get("correlation_id")
        }
        self.assertEqual(correlation_ids, {trace.correlation_id})
        rendered = repr(calls)
        self.assertNotIn("PRIVATE QUERY", rendered)
        self.assertNotIn("PRIVATE ANSWER", rendered)
        self.assertNotIn("PRIVATE CONTEXT", rendered)
        self.assertIn("candidateCount", rendered)

    def test_sync_decorator_never_logs_question_text(self):
        @trace_rag_pipeline(streaming=False)
        def sample(
            user_id: str,
            resource_id: str,
            question: str,
            chat_history=None,
        ):
            trace = get_current_rag_trace()
            self.assertIsNotNone(trace)
            with trace.phase("confidence_scoring") as details:
                details["confidence"] = 0.9
            return "ok"

        with patch.object(pipeline_logger.logger, "info") as info:
            result = sample("user-1", "resource-1", "TOP SECRET QUESTION")

        self.assertEqual(result, "ok")
        self.assertNotIn("TOP SECRET QUESTION", repr(info.call_args_list))

    def test_streaming_failure_is_terminal_and_content_free(self):
        @trace_rag_pipeline(streaming=True)
        def sample_stream(
            user_id: str,
            resource_id: str,
            question: str,
        ):
            yield {"type": "token", "content": "not logged"}
            raise RuntimeError("safe-test-error")

        with (
            patch.object(pipeline_logger.logger, "info"),
            patch.object(pipeline_logger.logger, "exception") as exception,
        ):
            generator = sample_stream("user-1", "resource-1", "PRIVATE STREAM QUERY")
            self.assertEqual(next(generator)["type"], "token")
            with self.assertRaises(RuntimeError):
                next(generator)

        self.assertEqual(exception.call_count, 1)
        self.assertNotIn("PRIVATE STREAM QUERY", repr(exception.call_args_list))

    def test_planner_executor_emits_internal_retrieval_phases(self):
        private_content = "PRIVATE CHUNK CONTENT"
        plan = RetrievalPlan.legacy_fallback().model_copy(update={
            "retrieval_mode": RetrievalMode.VECTOR_ONLY,
            "enable_multi_query": False,
            "rerank": True,
            "compress_context": False,
            "max_chunks": 3,
            "retrieval_depth": 5,
        })
        executor = PlannerExecutor(
            handlers={
                RetrievalMode.VECTOR_ONLY: lambda _request, _top_k: [
                    {
                        "chunk_index": 0,
                        "content": private_content,
                        "metadata": {"resource_id": "resource-1", "chunk_index": 0},
                        "score": 0.9,
                    }
                ],
            },
            reranker=lambda _query, results, _top_k, user_id=None: results,
            hierarchical_expander=lambda _query, results, _plan: (
                results,
                {"success": False, "selected": False, "selected_levels": []},
            ),
            parent_expander=lambda _query, results, _plan: (
                results,
                {"success": False, "selected_parent_sections": []},
            ),
            context_builder=lambda results: results[0]["content"],
        )
        trace = RagPipelineTrace(
            streaming=False,
            resource_scoped=True,
            selected_resource_count=0,
            chat_history_present=False,
            concise=False,
            globe_mode=False,
        )
        request = RetrievalRequest(
            query="PRIVATE QUERY",
            user_id="user-1",
            resource_id="resource-1",
            trace=trace,
        )

        with patch.object(pipeline_logger.logger, "info") as info:
            result = executor.execute(plan, request)

        self.assertEqual(len(result.results), 1)
        rendered = repr(info.call_args_list)
        for phase in (
            "vector_retrieval",
            "reranking",
            "hierarchical_retrieval",
            "parent_context_expansion",
            "context_compression",
            "context_building",
        ):
            self.assertIn(phase, rendered)
        self.assertNotIn("PRIVATE QUERY", rendered)
        self.assertNotIn(private_content, rendered)


if __name__ == "__main__":
    unittest.main()
