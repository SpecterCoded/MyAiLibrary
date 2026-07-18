"""Strongly typed workflow and agent decision contracts."""

from __future__ import annotations

from enum import Enum

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, model_validator

from services.planner.planner_models import RetrievalPlan


class WorkflowPhase(str, Enum):
    PREPARATION = "preparation"
    CACHE = "cache"
    RETRIEVAL = "retrieval"
    EVALUATION = "evaluation"
    ADAPTATION = "adaptation"
    POST_PROCESSING = "post_processing"
    GENERATION = "generation"
    VERIFICATION = "verification"


class StepStatus(str, Enum):
    PENDING = "pending"
    EXECUTED = "executed"
    SKIPPED = "skipped"
    FAILED = "failed"


class EdgeCondition(str, Enum):
    ALWAYS = "always"
    ON_SUCCESS = "on_success"
    ON_FAILURE = "on_failure"
    QUALITY_GOOD = "quality_good"
    QUALITY_BORDERLINE = "quality_borderline"
    QUALITY_POOR = "quality_poor"
    RETRY_AVAILABLE = "retry_available"
    RETRY_EXHAUSTED = "retry_exhausted"


class ReflectionAction(str, Enum):
    CONTINUE = "continue"
    RETRY = "retry"
    SWITCH_STRATEGY = "switch_strategy"
    TERMINATE = "terminate"


class RetrievalQuality(str, Enum):
    GOOD = "GOOD"
    BORDERLINE = "BORDERLINE"
    POOR = "POOR"


class RetryAction(str, Enum):
    NONE = "none"
    REWRITE_QUERY = "rewrite_query"
    ADD_QUERY_VARIANTS = "add_query_variants"
    INCREASE_DEPTH = "increase_retrieval_depth"
    SWITCH_TO_HYBRID = "switch_to_hybrid"
    INCREASE_TOP_K = "increase_top_k"


class WorkflowStepConfig(BaseModel):
    """Typed parameters understood by the standard workflow tools."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    retrieval_plan: RetrievalPlan | None = None
    quality_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    conditional_on_poor_quality: bool = False


class WorkflowStep(BaseModel):
    """One executable or informational node in a retrieval workflow."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    step_id: str = Field(min_length=1, max_length=80)
    phase: WorkflowPhase
    tool_name: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=240)
    depends_on: tuple[str, ...] = ()
    enabled: bool = True
    config: WorkflowStepConfig = Field(default_factory=WorkflowStepConfig)


class WorkflowEdge(BaseModel):
    """A conditional transition between two workflow graph nodes."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    source: str
    target: str
    condition: EdgeCondition = EdgeCondition.ALWAYS
    priority: int = Field(default=100, ge=0, le=1000)
    reasoning: str = Field(min_length=1, max_length=240)


class RetrievalWorkflow(BaseModel):
    """A validated workflow generated for one rewritten query."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    workflow_id: str
    query: str = Field(min_length=1)
    initial_plan: RetrievalPlan
    nodes: tuple[WorkflowStep, ...] = Field(validation_alias=AliasChoices("nodes", "steps"))
    edges: tuple[WorkflowEdge, ...] = ()
    entry_node: str = ""
    maximum_retries: int = Field(ge=0, le=10)
    reasoning: str = Field(min_length=1, max_length=300)

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_steps(cls, value):
        """Accept the previous linear ``steps=`` constructor without breaking callers."""

        if not isinstance(value, dict):
            return value
        data = dict(value)
        raw_nodes = data.get("nodes") or data.get("steps") or ()
        node_ids = [
            node.step_id if isinstance(node, WorkflowStep) else node.get("step_id")
            for node in raw_nodes
        ]
        if not data.get("entry_node") and node_ids:
            data["entry_node"] = node_ids[0]
        if "edges" not in data and len(node_ids) > 1:
            data["edges"] = [
                {
                    "source": source,
                    "target": target,
                    "condition": EdgeCondition.ALWAYS,
                    "reasoning": "Compatibility edge generated from the legacy ordered workflow.",
                }
                for source, target in zip(node_ids, node_ids[1:])
            ]
        return data

    @model_validator(mode="after")
    def validate_graph(self) -> "RetrievalWorkflow":
        node_ids = [node.step_id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("Workflow graph node IDs must be unique")
        known = set(node_ids)
        if self.entry_node not in known:
            raise ValueError("Workflow entry_node must reference an existing node")
        for edge in self.edges:
            if edge.source not in known or edge.target not in known:
                raise ValueError("Workflow edges must reference existing nodes")
        for node in self.nodes:
            if any(dependency not in known for dependency in node.depends_on):
                raise ValueError("Workflow dependencies must reference existing nodes")
        return self

    @property
    def steps(self) -> tuple[WorkflowStep, ...]:
        """Backward-compatible ordered view of graph nodes."""

        return self.nodes

    def node(self, step_id: str) -> WorkflowStep:
        return next(node for node in self.nodes if node.step_id == step_id)

    def outgoing(self, step_id: str) -> tuple[WorkflowEdge, ...]:
        return tuple(sorted((edge for edge in self.edges if edge.source == step_id), key=lambda edge: edge.priority))


class RetrievalEvaluation(BaseModel):
    """Measured quality of one retrieval attempt or merged result set."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    quality: RetrievalQuality
    retrieved_chunk_count: int = Field(ge=0)
    average_rerank_score: float
    score_spread: float = Field(ge=0.0)
    coverage: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    missing_citations: int = Field(ge=0)
    metadata_quality: float = Field(ge=0.0, le=1.0)
    resource_diversity: int = Field(ge=0)
    reasoning: str = Field(min_length=1, max_length=300)


class RetryDecision(BaseModel):
    """A bounded adaptation selected after evaluating an attempt."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    should_retry: bool
    action: RetryAction
    adapted_plan: RetrievalPlan | None = None
    adapted_query: str | None = None
    reasoning: str = Field(min_length=1, max_length=300)


class AgentDecision(BaseModel):
    """Structured decision record suitable for production logging."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    retry_number: int = Field(ge=0)
    reason: str
    tool_selected: str
    execution_time_ms: float = Field(ge=0.0)
    retrieved_chunks: int = Field(ge=0)
    evaluation_result: RetrievalQuality
    confidence: float = Field(ge=0.0, le=1.0)
    retry_action: RetryAction = RetryAction.NONE


class ReflectionDecision(BaseModel):
    """Runtime reflection outcome controlling the next graph transition."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    step_id: str
    action: ReflectionAction
    selected_edge_condition: EdgeCondition
    next_node: str | None = None
    retry_decision: RetryDecision | None = None
    reasoning: str = Field(min_length=1, max_length=300)
