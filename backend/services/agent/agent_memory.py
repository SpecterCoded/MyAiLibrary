"""Request-scoped memory used to prevent repeated retrieval attempts."""

from __future__ import annotations

from dataclasses import dataclass, field

from .workflow_models import ReflectionDecision, RetrievalEvaluation, StepStatus


@dataclass
class AgentMemory:
    """Mutable state that lives only for the duration of one agent request."""

    queries_tried: set[str] = field(default_factory=set)
    retrieval_methods_tried: set[str] = field(default_factory=set)
    attempt_signatures: set[str] = field(default_factory=set)
    retrieved_chunk_ids: set[tuple[str, object]] = field(default_factory=set)
    evaluations: list[RetrievalEvaluation] = field(default_factory=list)
    retry_count: int = 0
    completed_steps: set[str] = field(default_factory=set)
    failed_steps: dict[str, str] = field(default_factory=dict)
    skipped_steps: set[str] = field(default_factory=set)
    tool_outputs: dict[str, object] = field(default_factory=dict)
    reflection_decisions: list[ReflectionDecision] = field(default_factory=list)
    step_signatures: set[str] = field(default_factory=set)
    current_node: str | None = None

    def signature(self, query: str, mode: str, depth: int, multi_query: bool) -> str:
        return f"{query.strip().lower()}|{mode}|{depth}|{int(multi_query)}"

    def begin_attempt(self, query: str, mode: str, depth: int, multi_query: bool) -> bool:
        """Record a unique attempt, returning false when it was already tried."""

        signature = self.signature(query, mode, depth, multi_query)
        if signature in self.attempt_signatures:
            return False
        self.attempt_signatures.add(signature)
        self.queries_tried.add(query.strip().lower())
        self.retrieval_methods_tried.add(mode)
        return True

    def remember_results(self, results: list[dict]) -> None:
        for result in results:
            metadata = result.get("metadata") or {}
            self.retrieved_chunk_ids.add(
                (str(metadata.get("resource_id") or ""), result.get("chunk_index", metadata.get("chunk_index")))
            )

    def begin_step(self, step_id: str, tool_name: str, input_fingerprint: str = "") -> bool:
        """Prevent an identical graph node execution with identical inputs."""

        signature = f"{step_id}|{tool_name}|{input_fingerprint}"
        if signature in self.step_signatures:
            self.skipped_steps.add(step_id)
            return False
        self.step_signatures.add(signature)
        self.current_node = step_id
        return True

    def complete_step(self, step_id: str, output_key: str | None = None, output: object = None) -> None:
        self.completed_steps.add(step_id)
        self.failed_steps.pop(step_id, None)
        if output_key:
            self.tool_outputs[output_key] = output

    def fail_step(self, step_id: str, error: Exception | str) -> None:
        self.failed_steps[step_id] = str(error)[:500]

    def status(self, step_id: str) -> StepStatus:
        if step_id in self.failed_steps:
            return StepStatus.FAILED
        if step_id in self.completed_steps:
            return StepStatus.EXECUTED
        if step_id in self.skipped_steps:
            return StepStatus.SKIPPED
        return StepStatus.PENDING
