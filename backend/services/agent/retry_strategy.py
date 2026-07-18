"""Bounded, deterministic adaptation policy for weak retrieval attempts."""

from __future__ import annotations

from services.planner.planner_models import RetrievalMode, RetrievalPlan

from .agent_memory import AgentMemory
from .workflow_models import RetrievalEvaluation, RetrievalQuality, RetryAction, RetryDecision


class RetryStrategy:
    """Choose the smallest useful adaptation while preventing retry loops."""

    def decide(
        self,
        query: str,
        plan: RetrievalPlan,
        evaluation: RetrievalEvaluation,
        memory: AgentMemory,
        maximum_retries: int,
    ) -> RetryDecision:
        if evaluation.quality is RetrievalQuality.GOOD:
            return self._stop("Retrieval quality is good; no retry is needed.")
        if memory.retry_count >= maximum_retries:
            return self._stop("Maximum retrieval retry attempts reached.")

        if plan.retrieval_mode is not RetrievalMode.HYBRID:
            adapted = plan.model_copy(update={
                "retrieval_mode": RetrievalMode.HYBRID,
                "rerank": True,
                "retrieval_depth": max(plan.retrieval_depth, 30),
                "reasoning": "Weak initial retrieval; combining vector and keyword evidence.",
            })
            return self._retry(RetryAction.SWITCH_TO_HYBRID, adapted, query, "Switching to hybrid retrieval for complementary evidence.")

        if not plan.enable_multi_query:
            adapted = plan.model_copy(update={
                "enable_multi_query": True,
                "retrieval_depth": min(max(plan.retrieval_depth, 30), 200),
                "reasoning": "Weak hybrid retrieval; expanding the query from multiple perspectives.",
            })
            return self._retry(RetryAction.ADD_QUERY_VARIANTS, adapted, query, "Generating additional query variants to improve coverage.")

        if evaluation.coverage < 0.4:
            adapted = plan.model_copy(update={
                "retrieval_depth": min(max(plan.retrieval_depth + 20, 40), 200),
                "reasoning": "Retrieved evidence has weak query coverage; trying a distinct rewritten query.",
            })
            return self._retry(RetryAction.REWRITE_QUERY, adapted, None, "Rewriting the retrieval query because key concepts are missing.")

        if evaluation.retrieved_chunk_count >= plan.max_chunks and plan.max_chunks < min(plan.retrieval_depth, 50):
            adapted = plan.model_copy(update={
                "max_chunks": min(plan.max_chunks + 4, plan.retrieval_depth, 50),
                "reasoning": "Relevant candidates reached the context cap; increasing final top-k.",
            })
            return self._retry(RetryAction.INCREASE_TOP_K, adapted, query, "Increasing final top-k to retain more relevant evidence.")

        if plan.retrieval_depth < 200:
            new_depth = min(max(plan.retrieval_depth * 2, plan.retrieval_depth + 20), 200)
            adapted = plan.model_copy(update={
                "retrieval_depth": new_depth,
                "max_chunks": min(max(plan.max_chunks + 4, plan.max_chunks), min(new_depth, 50)),
                "reasoning": "Coverage remains weak; increasing candidate depth and final top-k.",
            })
            return self._retry(RetryAction.INCREASE_DEPTH, adapted, query, "Increasing retrieval depth and top-k to find missing evidence.")

        return self._stop("No distinct safe retrieval adaptation remains.")

    @staticmethod
    def _retry(action: RetryAction, plan: RetrievalPlan, query: str | None, reason: str) -> RetryDecision:
        return RetryDecision(
            should_retry=True,
            action=action,
            adapted_plan=plan,
            adapted_query=query,
            reasoning=reason,
        )

    @staticmethod
    def _stop(reason: str) -> RetryDecision:
        return RetryDecision(
            should_retry=False,
            action=RetryAction.NONE,
            reasoning=reason,
        )
