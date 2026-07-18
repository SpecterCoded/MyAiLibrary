"""Plan, execute, evaluate, and adapt retrieval within one bounded workflow."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from services.planner.planner_executor import ExecutionResult, RetrievalRequest
from services.planner.planner_models import ExecutionReport, RetrievalPlan

from .agent_memory import AgentMemory
from .planner import WorkflowPlanner
from .retry_strategy import RetryStrategy
from .reflection import ReflectionEngine
from .workflow_executor import WorkflowExecutor
from core.activity_log import log_user_activity
from .workflow_models import (
    AgentDecision,
    RetrievalEvaluation,
    RetrievalQuality,
    RetrievalWorkflow,
    RetryAction,
    WorkflowPhase,
    EdgeCondition,
    ReflectionAction,
    ReflectionDecision,
)


@dataclass(frozen=True)
class AgentExecutionResult:
    """Final retrieval artifacts plus the complete auditable agent trace."""

    context: str
    results: list[dict]
    report: ExecutionReport
    workflow: RetrievalWorkflow
    final_plan: RetrievalPlan
    evaluations: tuple[RetrievalEvaluation, ...]
    decisions: tuple[AgentDecision, ...]
    retry_count: int
    memory: AgentMemory


class RetrievalAgent:
    """Request-scoped retrieval orchestrator with bounded self-correction."""

    def __init__(
        self,
        workflow_planner: WorkflowPlanner | None = None,
        workflow_executor: WorkflowExecutor | None = None,
        retry_strategy: RetryStrategy | None = None,
        reflection_engine: ReflectionEngine | None = None,
    ) -> None:
        self._executor = workflow_executor or WorkflowExecutor()
        self._retry_strategy = retry_strategy or RetryStrategy()
        self._reflection = reflection_engine or ReflectionEngine(self._retry_strategy)
        self._planner = workflow_planner or WorkflowPlanner(registry=self._executor.registry)
        self._last_result: AgentExecutionResult | None = None
        self._log_context: dict[str, str] = {"user_id": "", "resource_id": ""}

    def run(
        self,
        query: str,
        request: RetrievalRequest,
        *,
        initial_plan: RetrievalPlan | None = None,
        has_chat_history: bool = False,
        cache_candidate_present: bool = False,
        workflow: RetrievalWorkflow | None = None,
        streaming: bool = False,
    ) -> AgentExecutionResult:
        """Execute retrieval attempts until quality is good or retries are exhausted."""

        workflow = workflow or self.create_workflow(
            query,
            has_chat_history=has_chat_history,
            cache_candidate_present=cache_candidate_present,
            initial_plan=initial_plan,
            streaming=streaming,
            user_id=request.user_id,
            resource_id=request.resource_id,
        )
        self._log_context = {
            "user_id": request.user_id or "",
            "resource_id": request.resource_id or "",
        }
        retrieval_step = next(step for step in workflow.steps if step.phase is WorkflowPhase.RETRIEVAL and step.enabled)
        evaluation_step = next(step for step in workflow.steps if step.phase is WorkflowPhase.EVALUATION and step.enabled)
        reflection_step = next(step for step in workflow.steps if step.phase is WorkflowPhase.ADAPTATION and step.enabled)

        memory = AgentMemory()
        memory.tool_outputs.update({"rewritten_query": query, "retrieval_plan": workflow.initial_plan})
        memory.complete_step("plan", "workflow", workflow)
        memory.complete_step("rewrite", "rewritten_query", query)
        if workflow.node("cache").enabled:
            memory.complete_step("cache", "cache_candidate", False)
        else:
            memory.skipped_steps.add("cache")
        self._log_event(workflow, "planning", workflow.entry_node, workflow.node(workflow.entry_node).tool_name, "completed", {"nodes": len(workflow.nodes), "edges": len(workflow.edges)})
        current_query = query
        current_plan = workflow.initial_plan
        best_execution: ExecutionResult | None = None
        best_evaluation: RetrievalEvaluation | None = None
        best_plan: RetrievalPlan | None = None
        decisions: list[AgentDecision] = []
        executed_modules: list[str] = []
        skipped_modules: list[str] = []
        queries_executed: list[str] = []
        agent_started = perf_counter()

        while True:
            if not memory.begin_attempt(
                current_query,
                current_plan.retrieval_mode.value,
                current_plan.retrieval_depth,
                current_plan.enable_multi_query,
            ):
                break

            attempt_started = perf_counter()
            attempt_request = RetrievalRequest(
                query=current_query,
                user_id=request.user_id,
                resource_id=request.resource_id,
                selected_resource_ids=request.selected_resource_ids,
                available_resource_ids=request.available_resource_ids,
                storage_root=request.storage_root,
            )
            fingerprint = memory.signature(current_query, current_plan.retrieval_mode.value, current_plan.retrieval_depth, current_plan.enable_multi_query)
            memory.tool_outputs["retrieval_plan"] = current_plan
            try:
                execution: ExecutionResult = self._executor.execute_node(
                    retrieval_step, memory, current_plan, attempt_request,
                    input_fingerprint=fingerprint,
                )
                self._log_event(workflow, "execution", retrieval_step.step_id, retrieval_step.tool_name, "completed", {"retry": memory.retry_count, "chunks": len(execution.results)})
            except Exception as exc:
                execution = ExecutionResult(
                    context="", results=[],
                    report=ExecutionReport(
                        modules_executed=[], modules_skipped=[retrieval_step.tool_name],
                        queries_executed=[current_query], retrieval_strategy=current_plan.retrieval_mode,
                        execution_time_ms=(perf_counter() - attempt_started) * 1000,
                    ),
                )
                memory.tool_outputs["retrieval_execution"] = execution
                self._log_event(workflow, "execution", retrieval_step.step_id, retrieval_step.tool_name, "failed", {"error": str(exc)[:500]})
            memory.remember_results(execution.results)
            memory.queries_tried.update(item.strip().lower() for item in execution.report.queries_executed)
            evaluation: RetrievalEvaluation = self._executor.execute_node(
                evaluation_step, memory, current_query, execution.results, current_plan,
                input_fingerprint=fingerprint,
            )
            memory.evaluations.append(evaluation)
            executed_modules.extend(execution.report.modules_executed)
            skipped_modules.extend(execution.report.modules_skipped)
            queries_executed.extend(execution.report.queries_executed)

            candidate_execution, candidate_evaluation = self._choose_candidate(
                query=current_query,
                plan=current_plan,
                previous=best_execution,
                previous_evaluation=best_evaluation,
                current=execution,
                current_evaluation=evaluation,
            )
            if best_evaluation is None or candidate_evaluation.confidence > best_evaluation.confidence:
                best_execution = candidate_execution
                best_evaluation = candidate_evaluation
                best_plan = current_plan

            reflection = self._reflection.reflect_on_retrieval(
                workflow, reflection_step.step_id, current_query, current_plan, evaluation, memory,
            )
            memory.reflection_decisions.append(reflection)
            memory.complete_step(reflection_step.step_id, "reflection", reflection)
            retry = reflection.retry_decision or self._retry_strategy.decide(
                current_query, current_plan, evaluation, memory, workflow.maximum_retries,
            )
            self._log_event(
                workflow, "reflection", reflection_step.step_id, reflection_step.tool_name,
                "completed", reflection.model_dump(mode="json"),
            )
            self._log_event(
                workflow, "branch", reflection_step.step_id, reflection_step.tool_name,
                reflection.action.value, {"next_node": reflection.next_node, "condition": reflection.selected_edge_condition.value},
            )
            decision = AgentDecision(
                retry_number=memory.retry_count,
                reason=retry.reasoning,
                tool_selected=retrieval_step.tool_name,
                execution_time_ms=(perf_counter() - attempt_started) * 1000,
                retrieved_chunks=len(execution.results),
                evaluation_result=evaluation.quality,
                confidence=evaluation.confidence,
                retry_action=retry.action,
            )
            decisions.append(decision)
            self._log_decision(workflow, current_plan, decision)

            if not retry.should_retry or retry.adapted_plan is None:
                break
            memory.retry_count += 1
            current_plan = retry.adapted_plan
            if retry.action is RetryAction.REWRITE_QUERY and retry.adapted_query is None:
                try:
                    variants = self.execute_tool("multi_query", current_query, 2)
                    current_query = next(
                        (variant for variant in variants if variant.strip().lower() not in memory.queries_tried),
                        current_query,
                    )
                except Exception:
                    pass
            else:
                current_query = retry.adapted_query or current_query

        if best_execution is None or best_evaluation is None:
            # Defensive fallback; the first attempt is normally guaranteed unique.
            fallback = self._executor.execute_retrieval_attempt(workflow.initial_plan, request)
            best_execution = fallback
            best_evaluation = self._executor.evaluate_retrieval(query, fallback.results, workflow.initial_plan)
            best_plan = workflow.initial_plan

        selected_plan = best_plan or current_plan

        report = ExecutionReport(
            modules_executed=self._unique(executed_modules),
            modules_skipped=self._unique(skipped_modules),
            queries_executed=self._unique(queries_executed),
            retrieval_strategy=selected_plan.retrieval_mode,
            execution_time_ms=(perf_counter() - agent_started) * 1000,
        )
        result = AgentExecutionResult(
            context=best_execution.context,
            results=best_execution.results,
            report=report,
            workflow=workflow,
            final_plan=selected_plan,
            evaluations=tuple(memory.evaluations),
            decisions=tuple(decisions),
            retry_count=memory.retry_count,
            memory=memory,
        )
        self._log_final(result)
        self._last_result = result
        try:
            from database import SessionLocal
            db = SessionLocal()
            log_user_activity(db, request.user_id, 'ai_chat', f'Agent retrieval: {selected_plan.retrieval_mode}', f'{memory.retry_count} retries, {len(best_execution.results)} chunks')
            db.close()
        except Exception:
            pass
        return result

    @property
    def last_result(self) -> AgentExecutionResult | None:
        return self._last_result

    def create_workflow(
        self,
        query: str,
        *,
        has_chat_history: bool = False,
        cache_candidate_present: bool = False,
        initial_plan: RetrievalPlan | None = None,
        streaming: bool = False,
        user_id: str = "",
        resource_id: str | None = None,
    ) -> RetrievalWorkflow:
        """Build a workflow without executing it, allowing cache evaluation first."""

        self._log_context = {
            "user_id": user_id or "",
            "resource_id": resource_id or "",
        }
        workflow = self._planner.create_workflow(
            query,
            has_chat_history=has_chat_history,
            cache_candidate_present=cache_candidate_present,
            initial_plan=initial_plan,
            streaming=streaming,
            user_id=user_id,
            resource_id=resource_id,
        )
        self._log_event(
            workflow, "planning", workflow.entry_node, workflow.node(workflow.entry_node).tool_name,
            "completed", self._planning_details(workflow),
        )
        return workflow

    def execute_tool(self, tool_name: str, *args, **kwargs):
        """Execute any registered current or future tool through the agent."""

        return self._executor.registry.execute(tool_name, *args, **kwargs)

    def register_tool(self, name: str, handler, description: str, **contract) -> None:
        """Register a future capability without modifying the agent core."""

        self._executor.registry.register(name, handler, description, **contract)

    def available_tools(self):
        """Expose immutable tool descriptors to planners and diagnostics."""

        return self._executor.registry.available_tools()

    def execute_workflow_node(
        self, workflow: RetrievalWorkflow, memory: AgentMemory, step_id: str,
        *args, input_fingerprint: str = "", **kwargs,
    ):
        """Execute a named graph node with prerequisite and duplicate checks."""

        node = workflow.node(step_id)
        try:
            output = self._executor.execute_node(
                node, memory, *args, input_fingerprint=input_fingerprint, **kwargs,
            )
            self._log_event(workflow, "execution", node.step_id, node.tool_name, "completed", {"output_type": type(output).__name__})
            edge = next(
                (item for item in workflow.outgoing(node.step_id) if item.condition in {EdgeCondition.ON_SUCCESS, EdgeCondition.ALWAYS}),
                None,
            )
            reflection = ReflectionDecision(
                step_id=node.step_id,
                action=ReflectionAction.CONTINUE if edge else ReflectionAction.TERMINATE,
                selected_edge_condition=EdgeCondition.ON_SUCCESS,
                next_node=edge.target if edge else None,
                reasoning=(
                    "Tool completed successfully; following the next eligible graph edge."
                    if edge else "Terminal graph node completed."
                ),
            )
            memory.reflection_decisions.append(reflection)
            self._log_event(workflow, "reflection", node.step_id, node.tool_name, "completed", reflection.model_dump(mode="json"))
            return output
        except Exception as exc:
            self._log_event(workflow, "execution", node.step_id, node.tool_name, "failed", {"error": str(exc)[:500]})
            edge = next((item for item in workflow.outgoing(node.step_id) if item.condition is EdgeCondition.ON_FAILURE), None)
            reflection = ReflectionDecision(
                step_id=node.step_id,
                action=ReflectionAction.SWITCH_STRATEGY if edge else ReflectionAction.TERMINATE,
                selected_edge_condition=EdgeCondition.ON_FAILURE,
                next_node=edge.target if edge else None,
                reasoning="Tool failed; following the failure branch." if edge else "Tool failed and no recovery branch is available.",
            )
            memory.reflection_decisions.append(reflection)
            self._log_event(workflow, "reflection", node.step_id, node.tool_name, "failed", reflection.model_dump(mode="json"))
            raise

    def finalize_workflow(self, final_confidence: float) -> None:
        """Record termination after answer generation and verification finish."""

        if self._last_result is None:
            return
        self._last_result.memory.tool_outputs["final_confidence"] = final_confidence
        self._log_event(
            self._last_result.workflow, "termination", "confidence", "confidence_score",
            "completed", {"final_confidence": final_confidence},
        )
        self._log_final(self._last_result, final_confidence=final_confidence)

    def should_accept_cache(
        self,
        workflow: RetrievalWorkflow,
        candidate: dict | None,
        *,
        user_id: str = "",
        resource_id: str | None = None,
    ) -> bool:
        """Let the workflow agent decide whether a semantic-cache candidate is safe."""

        self._log_context = {
            "user_id": user_id or self._log_context.get("user_id", ""),
            "resource_id": resource_id or self._log_context.get("resource_id", ""),
        }
        confidence = float((candidate or {}).get("confidence") or 0.0)
        accepted = bool(
            candidate
            and workflow.initial_plan.trust_semantic_cache
            and confidence >= workflow.initial_plan.confidence_threshold
        )
        decision = AgentDecision(
            retry_number=0,
            reason=(
                "Semantic-cache candidate satisfies workflow trust and confidence requirements."
                if accepted
                else "Semantic-cache candidate is absent, untrusted, or below the workflow confidence threshold."
            ),
            tool_selected="semantic_cache",
            execution_time_ms=0.0,
            retrieved_chunks=0,
            evaluation_result=RetrievalQuality.GOOD if accepted else RetrievalQuality.POOR,
            confidence=max(0.0, min(confidence, 1.0)),
            retry_action=RetryAction.NONE,
        )
        self._log_decision(workflow, workflow.initial_plan, decision)
        if accepted:
            try:
                from core.metrics import log_agent_workflow
                log_agent_workflow(
                    workflow=workflow.model_dump(mode="json"),
                    final_plan=workflow.initial_plan.model_dump(mode="json"),
                    retry_count=0,
                    evaluations=[],
                    decisions=[decision.model_dump(mode="json")],
                    execution_time_ms=0.0,
                    workflow_id=workflow.workflow_id,
                    query=workflow.query,
                    user_id=self._log_context.get("user_id", ""),
                    resource_id=self._log_context.get("resource_id", ""),
                )
            except Exception:
                pass
        return accepted

    def _choose_candidate(
        self,
        query: str,
        plan: RetrievalPlan,
        previous: ExecutionResult | None,
        previous_evaluation: RetrievalEvaluation | None,
        current: ExecutionResult,
        current_evaluation: RetrievalEvaluation,
    ) -> tuple[ExecutionResult, RetrievalEvaluation]:
        if previous is None or previous_evaluation is None:
            return current, current_evaluation

        merged_results = self._merge_results(previous.results, current.results, plan.max_chunks)
        merged_evaluation = self._executor.evaluate_retrieval(query, merged_results, plan)
        if merged_evaluation.confidence <= max(previous_evaluation.confidence, current_evaluation.confidence):
            return (previous, previous_evaluation) if previous_evaluation.confidence >= current_evaluation.confidence else (current, current_evaluation)

        merged_report = ExecutionReport(
            modules_executed=self._unique(previous.report.modules_executed + current.report.modules_executed + ["merge_attempts"]),
            modules_skipped=self._unique(previous.report.modules_skipped + current.report.modules_skipped),
            queries_executed=self._unique(previous.report.queries_executed + current.report.queries_executed),
            retrieval_strategy=plan.retrieval_mode,
            execution_time_ms=previous.report.execution_time_ms + current.report.execution_time_ms,
        )
        return ExecutionResult(
            context=self._executor.build_context(merged_results),
            results=merged_results,
            report=merged_report,
        ), merged_evaluation

    @staticmethod
    def _merge_results(previous: list[dict], current: list[dict], max_chunks: int) -> list[dict]:
        """Merge results from multiple retrieval attempts, keeping the best version of each chunk."""
        merged: dict[tuple[object, object], dict] = {}
        for result in previous + current:
            metadata = result.get("metadata") or {}
            key = (metadata.get("resource_id"), result.get("chunk_index", metadata.get("chunk_index")))
            old = merged.get(key)
            new_score = float(result.get("rerank_score", result.get("hybrid_score", result.get("score", 0.0))))
            old_score = float(old.get("rerank_score", old.get("hybrid_score", old.get("score", float("-inf"))))) if old else float("-inf")

            if old is None or new_score > old_score:
                # Keep the higher-scored version
                merged[key] = result
            elif old is not None and new_score == old_score:
                # Same score: prefer the version with richer metadata
                old_meta_count = len(old.get("metadata") or {})
                new_meta_count = len(metadata)
                if new_meta_count > old_meta_count:
                    merged[key] = result

        ranked = list(merged.values())
        ranked.sort(
            key=lambda item: float(item.get("rerank_score", item.get("hybrid_score", item.get("score", 0.0)))),
            reverse=True,
        )
        return ranked[:max_chunks]

    @staticmethod
    def _unique(values: list[str]) -> list[str]:
        return list(dict.fromkeys(values))

    def _log_decision(self, workflow: RetrievalWorkflow, plan: RetrievalPlan, decision: AgentDecision) -> None:
        try:
            from core.metrics import log_agent_decision
            log_agent_decision(
                workflow_id=workflow.workflow_id,
                query=workflow.query,
                plan=plan.model_dump(mode="json"),
                decision=decision.model_dump(mode="json"),
                user_id=self._log_context.get("user_id", ""),
                resource_id=self._log_context.get("resource_id", ""),
            )
        except Exception:
            pass

    def _log_final(self, result: AgentExecutionResult, final_confidence: float | None = None) -> None:
        try:
            from core.metrics import log_agent_workflow
            log_agent_workflow(
                workflow=result.workflow.model_dump(mode="json"),
                final_plan=result.final_plan.model_dump(mode="json"),
                retry_count=result.retry_count,
                evaluations=[item.model_dump(mode="json") for item in result.evaluations],
                decisions=[item.model_dump(mode="json") for item in result.decisions],
                execution_time_ms=result.report.execution_time_ms,
                execution_state={
                    "completed_steps": sorted(result.memory.completed_steps),
                    "failed_steps": result.memory.failed_steps,
                    "skipped_steps": sorted(result.memory.skipped_steps),
                    "output_keys": sorted(result.memory.tool_outputs),
                    "reflection_decisions": [item.model_dump(mode="json") for item in result.memory.reflection_decisions],
                },
                final_confidence=final_confidence,
                workflow_id=result.workflow.workflow_id,
                query=result.workflow.query,
                user_id=self._log_context.get("user_id", ""),
                resource_id=self._log_context.get("resource_id", ""),
            )
        except Exception:
            pass

    def _log_event(
        self,
        workflow: RetrievalWorkflow,
        event_type: str,
        node_id: str,
        tool_name: str,
        status: str,
        details: dict,
    ) -> None:
        try:
            from core.metrics import log_agent_event
            log_agent_event(
                workflow.workflow_id,
                event_type,
                node_id,
                tool_name,
                status,
                details,
                query=workflow.query,
                user_id=self._log_context.get("user_id", ""),
                resource_id=self._log_context.get("resource_id", ""),
            )
        except Exception:
            pass

    def _planning_details(self, workflow: RetrievalWorkflow) -> dict:
        tools = []
        for node in workflow.nodes:
            try:
                descriptor = self._executor.registry.descriptor(node.tool_name)
                tools.append({
                    "node": node.step_id,
                    "tool": descriptor.name,
                    "capabilities": descriptor.capabilities,
                    "prerequisites": descriptor.prerequisites,
                    "expected_outputs": descriptor.expected_outputs,
                    "execution_cost": descriptor.execution_cost.value,
                })
            except KeyError:
                tools.append({"node": node.step_id, "tool": node.tool_name, "internal": True})
        return {"nodes": len(workflow.nodes), "edges": len(workflow.edges), "tools": tools}
