"""Reflection policy for choosing runtime graph branches after major steps."""

from __future__ import annotations

from .agent_memory import AgentMemory
from .retry_strategy import RetryStrategy
from .workflow_models import (
    EdgeCondition, ReflectionAction, ReflectionDecision, RetrievalEvaluation,
    RetrievalQuality, RetrievalWorkflow,
)
from services.planner.planner_models import RetrievalPlan


class ReflectionEngine:
    """Translate intermediate state into a conditional graph transition."""

    def __init__(self, retry_strategy: RetryStrategy | None = None) -> None:
        self._retry_strategy = retry_strategy or RetryStrategy()

    def reflect_on_retrieval(
        self, workflow: RetrievalWorkflow, step_id: str, query: str,
        plan: RetrievalPlan, evaluation: RetrievalEvaluation, memory: AgentMemory,
    ) -> ReflectionDecision:
        if evaluation.quality is RetrievalQuality.GOOD:
            return self._edge_decision(
                workflow, step_id, EdgeCondition.QUALITY_GOOD, ReflectionAction.CONTINUE,
                "Retrieval evidence is sufficient; continue toward answer generation.",
            )

        retry = self._retry_strategy.decide(
            query, plan, evaluation, memory, workflow.maximum_retries,
        )
        if retry.should_retry:
            action = (
                ReflectionAction.SWITCH_STRATEGY
                if retry.action.value.startswith("switch_") else ReflectionAction.RETRY
            )
            condition = (
                EdgeCondition.QUALITY_POOR
                if evaluation.quality is RetrievalQuality.POOR else EdgeCondition.QUALITY_BORDERLINE
            )
            decision = self._edge_decision(workflow, step_id, condition, action, retry.reasoning)
            return decision.model_copy(update={"retry_decision": retry})

        return self._edge_decision(
            workflow, step_id, EdgeCondition.RETRY_EXHAUSTED, ReflectionAction.TERMINATE,
            retry.reasoning,
        )

    @staticmethod
    def _edge_decision(
        workflow: RetrievalWorkflow, step_id: str, condition: EdgeCondition,
        action: ReflectionAction, reasoning: str,
    ) -> ReflectionDecision:
        edges = workflow.outgoing(step_id)
        selected = next((edge for edge in edges if edge.condition is condition), None)
        if selected is None:
            selected = next((edge for edge in edges if edge.condition is EdgeCondition.ALWAYS), None)
        return ReflectionDecision(
            step_id=step_id,
            action=action,
            selected_edge_condition=condition,
            next_node=selected.target if selected else None,
            reasoning=reasoning,
        )
