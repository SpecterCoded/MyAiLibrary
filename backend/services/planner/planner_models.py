"""Strongly typed contracts shared by the planner and execution engine."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RetrievalMode(str, Enum):
    """Retrieval strategies currently supported by the execution registry."""

    VECTOR_ONLY = "vector_only"
    KEYWORD_ONLY = "keyword_only"
    HYBRID = "hybrid"


class QueryClassification(str, Enum):
    """Stable query taxonomy used to select retrieval depth and modules."""

    GREETING = "Greeting"
    SMALL_TALK = "Small Talk"
    SIMPLE_FACT = "Simple Fact"
    EXACT_LOOKUP = "Exact Lookup"
    DEFINITION = "Definition"
    EXPLANATION = "Explanation"
    COMPARISON = "Comparison"
    SUMMARIZATION = "Summarization"
    MULTI_DOCUMENT_REASONING = "Multi-document reasoning"
    BROAD_RESEARCH = "Broad research"
    PROCEDURAL = "Procedural / How-To"
    TROUBLESHOOTING = "Troubleshooting"
    FOLLOW_UP = "Follow-up question"


class RetrievalPlan(BaseModel):
    """Validated, immutable instructions for one RAG pipeline execution."""

    model_config = ConfigDict(extra="forbid", frozen=True, use_enum_values=False)

    query_classification: QueryClassification
    retrieval_mode: RetrievalMode
    enable_multi_query: bool
    rerank: bool
    compress_context: bool
    hallucination_check: bool
    max_chunks: int = Field(ge=1, le=50)
    retrieval_depth: int = Field(ge=1, le=200)
    confidence_threshold: float = Field(ge=0.0, le=1.0)
    trust_semantic_cache: bool
    rrf_k: int = Field(default=60, ge=1, le=200)
    use_hyde: bool = False
    reasoning: str = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def validate_chunk_limits(self) -> "RetrievalPlan":
        """Candidate depth must be large enough to produce the final context."""

        if self.retrieval_depth < self.max_chunks:
            raise ValueError("retrieval_depth must be greater than or equal to max_chunks")
        return self

    @classmethod
    def legacy_fallback(cls) -> "RetrievalPlan":
        """Return the pre-planner full pipeline behavior for safe degradation."""

        return cls(
            query_classification=QueryClassification.MULTI_DOCUMENT_REASONING,
            retrieval_mode=RetrievalMode.HYBRID,
            enable_multi_query=True,
            rerank=True,
            compress_context=False,
            hallucination_check=True,
            max_chunks=5,
            retrieval_depth=20,
            confidence_threshold=0.0,
            trust_semantic_cache=True,
            reasoning="Planner unavailable; preserving the legacy full retrieval pipeline.",
        )


class ExecutionReport(BaseModel):
    """Structured audit data emitted for each planned execution."""

    model_config = ConfigDict(extra="forbid")

    modules_executed: list[str] = Field(default_factory=list)
    modules_skipped: list[str] = Field(default_factory=list)
    queries_executed: list[str] = Field(default_factory=list)
    retrieval_strategy: RetrievalMode
    execution_time_ms: float = 0.0
