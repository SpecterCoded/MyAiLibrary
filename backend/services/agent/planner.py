"""Build executable retrieval workflows from the existing adaptive plan."""

from __future__ import annotations

import os
from uuid import uuid4

from services.planner.planner_models import RetrievalPlan
from services.planner.retrieval_planner import RetrievalPlanner

from .workflow_models import RetrievalWorkflow, WorkflowPhase, WorkflowStep, WorkflowStepConfig
from .workflow_models import EdgeCondition, WorkflowEdge
from .tool_registry import ToolRegistry


class WorkflowPlanner:
    """Evolve a compatible RetrievalPlan into a structured workflow."""

    def __init__(
        self, adaptive_planner: RetrievalPlanner | None = None,
        maximum_retries: int | None = None, registry: ToolRegistry | None = None,
    ) -> None:
        self._adaptive_planner = adaptive_planner or RetrievalPlanner()
        self._registry = registry
        configured = int(os.getenv("RETRIEVAL_AGENT_MAX_RETRIES", "2")) if maximum_retries is None else maximum_retries
        self._maximum_retries = min(max(configured, 0), 10)

    def create_workflow(
        self,
        query: str,
        has_chat_history: bool = False,
        cache_candidate_present: bool = False,
        initial_plan: RetrievalPlan | None = None,
        streaming: bool = False,
        user_id: str | None = None,
        resource_id: str | None = None,
    ) -> RetrievalWorkflow:
        plan = initial_plan or self._adaptive_planner.create_plan(
            query,
            has_chat_history=has_chat_history,
            user_id=user_id,
            resource_id=resource_id,
        )
        selected = [plan.retrieval_mode.value]
        if plan.enable_multi_query:
            selected.append("multi_query")
        if plan.rerank:
            selected.append("rerank")
        if plan.compress_context:
            selected.append("context_compression")

        cache_dependency = ("cache",) if cache_candidate_present else ("rewrite",)
        answer_tool = self._tool(
            "streaming_answer_generation" if streaming else "answer_generation",
            "answer_generator_stream" if streaming else "answer_generator",
        )
        nodes = (
            WorkflowStep(step_id="plan", phase=WorkflowPhase.PREPARATION, tool_name=self._tool("workflow_planning", "workflow_planner"), purpose="Select a capability-driven execution graph."),
            WorkflowStep(step_id="rewrite", phase=WorkflowPhase.PREPARATION, tool_name=self._tool("query_rewrite", "query_rewrite"), purpose="Resolve conversational references before retrieval.", depends_on=("plan",)),
            WorkflowStep(step_id="cache", phase=WorkflowPhase.CACHE, tool_name=self._tool("semantic_cache", "semantic_cache"), purpose="Evaluate the semantic-cache candidate.", depends_on=("rewrite",), enabled=cache_candidate_present),
            WorkflowStep(
                step_id="retrieve",
                phase=WorkflowPhase.RETRIEVAL,
                tool_name=self._tool("retrieval_orchestration", "retrieval_attempt"),
                purpose=f"Execute selected retrieval tools: {', '.join(selected)}.",
                depends_on=cache_dependency,
                config=WorkflowStepConfig(retrieval_plan=plan),
            ),
            WorkflowStep(step_id="evaluate", phase=WorkflowPhase.EVALUATION, tool_name=self._tool("retrieval_evaluation", "retrieval_evaluation"), purpose="Measure evidence quality and coverage.", depends_on=("retrieve",), config=WorkflowStepConfig(quality_threshold=plan.confidence_threshold)),
            WorkflowStep(step_id="reflect", phase=WorkflowPhase.ADAPTATION, tool_name=self._tool("workflow_reflection", "reflection"), purpose="Choose the next graph branch from intermediate state.", depends_on=("evaluate",), config=WorkflowStepConfig(conditional_on_poor_quality=True)),
            WorkflowStep(step_id="answer", phase=WorkflowPhase.GENERATION, tool_name=answer_tool, purpose="Generate the grounded answer from the chosen evidence.", depends_on=("reflect",)),
            WorkflowStep(step_id="sources", phase=WorkflowPhase.POST_PROCESSING, tool_name=self._tool("source_extraction", "source_extraction"), purpose="Extract grounded citation metadata from selected evidence.", depends_on=("answer",)),
            WorkflowStep(step_id="hallucination", phase=WorkflowPhase.VERIFICATION, tool_name=self._tool("hallucination_detection", "hallucination_check"), purpose="Verify answer claims against retrieved evidence.", depends_on=("answer",), enabled=plan.hallucination_check),
            WorkflowStep(step_id="confidence", phase=WorkflowPhase.VERIFICATION, tool_name=self._tool("confidence_scoring", "confidence_score"), purpose="Calculate final answer confidence.", depends_on=(("sources", "hallucination") if plan.hallucination_check else ("sources",))),
        )
        edges = [
            WorkflowEdge(source="plan", target="rewrite", condition=EdgeCondition.ALWAYS, reasoning="Planning precedes execution."),
            WorkflowEdge(source="rewrite", target="cache" if cache_candidate_present else "retrieve", condition=EdgeCondition.ON_SUCCESS, reasoning="Use the rewritten query."),
            WorkflowEdge(source="cache", target="answer", condition=EdgeCondition.ON_SUCCESS, priority=10, reasoning="A trusted cache hit can skip retrieval."),
            WorkflowEdge(source="cache", target="retrieve", condition=EdgeCondition.ON_FAILURE, priority=20, reasoning="Retrieve when cache evidence is unavailable or untrusted."),
            WorkflowEdge(source="retrieve", target="evaluate", condition=EdgeCondition.ON_SUCCESS, reasoning="Evaluate every retrieval attempt."),
            WorkflowEdge(source="retrieve", target="reflect", condition=EdgeCondition.ON_FAILURE, reasoning="Reflect on tool failures before choosing another branch."),
            WorkflowEdge(source="evaluate", target="reflect", condition=EdgeCondition.ALWAYS, reasoning="Reflection consumes evaluation signals."),
            WorkflowEdge(source="reflect", target="answer", condition=EdgeCondition.QUALITY_GOOD, priority=10, reasoning="Sufficient evidence proceeds to generation."),
            WorkflowEdge(source="reflect", target="retrieve", condition=EdgeCondition.QUALITY_BORDERLINE, priority=20, reasoning="Borderline evidence receives a targeted adaptation."),
            WorkflowEdge(source="reflect", target="retrieve", condition=EdgeCondition.QUALITY_POOR, priority=30, reasoning="Poor evidence switches or retries retrieval."),
            WorkflowEdge(source="reflect", target="answer", condition=EdgeCondition.RETRY_EXHAUSTED, priority=40, reasoning="Use the best evidence when bounded retries end."),
            WorkflowEdge(source="answer", target="sources", condition=EdgeCondition.ON_SUCCESS, priority=10, reasoning="Extract citations from generated output."),
            WorkflowEdge(source="answer", target="hallucination" if plan.hallucination_check else "confidence", condition=EdgeCondition.ON_SUCCESS, priority=20, reasoning="Verify generated output."),
            WorkflowEdge(source="sources", target="confidence", condition=EdgeCondition.ON_SUCCESS, reasoning="Confidence includes citation evidence."),
            WorkflowEdge(source="hallucination", target="confidence", condition=EdgeCondition.ALWAYS, reasoning="Confidence uses verification results."),
        ]
        return RetrievalWorkflow(
            workflow_id=str(uuid4()),
            query=query,
            initial_plan=plan,
            nodes=nodes,
            edges=tuple(edges),
            entry_node="plan",
            maximum_retries=self._maximum_retries,
            reasoning=f"Workflow derived from adaptive plan: {plan.reasoning}",
        )

    def _tool(self, capability: str, fallback: str) -> str:
        if self._registry is None:
            return fallback
        candidates = self._registry.tools_for_capability(capability)
        return candidates[0].name if candidates else fallback
