"""Execute workflow tools while delegating retrieval to the existing engine."""

from __future__ import annotations

from services.planner.planner_executor import ExecutionResult, PlannerExecutor, RetrievalRequest
from services.planner.planner_models import RetrievalMode, RetrievalPlan

from .retrieval_evaluator import RetrievalEvaluator
from .tool_registry import ExecutionCost, ToolRegistry
from .workflow_models import RetrievalEvaluation, WorkflowStep
from .agent_memory import AgentMemory


class WorkflowExecutor:
    """Adapter between generic workflow tools and existing RAG implementations."""

    def __init__(
        self,
        planner_executor: PlannerExecutor | None = None,
        evaluator: RetrievalEvaluator | None = None,
        registry: ToolRegistry | None = None,
    ) -> None:
        self._planner_executor = planner_executor or PlannerExecutor()
        self._evaluator = evaluator or RetrievalEvaluator()
        self.registry = registry or ToolRegistry()
        self._register_defaults()

    def _register_defaults(self) -> None:
        retrieval_tools = {
            "vector_search": RetrievalMode.VECTOR_ONLY,
            "bm25_search": RetrievalMode.KEYWORD_ONLY,
            "hybrid_search": RetrievalMode.HYBRID,
        }
        for name, mode in retrieval_tools.items():
            if not self.registry.contains(name):
                self.registry.register(
                    name,
                    lambda request, top_k, selected_mode=mode: self._planner_executor.retrieve(selected_mode, request, top_k),
                    f"Run the existing {mode.value} retrieval implementation.",
                    capabilities=(mode.value, "retrieval"),
                    prerequisites=("rewritten_query",),
                    expected_outputs=("retrieved_chunks",),
                    execution_cost=ExecutionCost.MEDIUM,
                )
        if not self.registry.contains("retrieval_attempt"):
            self.registry.register(
                "retrieval_attempt",
                self.execute_retrieval_attempt,
                "Run the existing vector/BM25/hybrid, multi-query, rerank, and compression engine.",
                capabilities=("retrieval_orchestration", "retrieval"),
                prerequisites=("rewritten_query", "retrieval_plan"),
                expected_outputs=("retrieval_execution",),
                execution_cost=ExecutionCost.HIGH,
            )
        if not self.registry.contains("retrieval_evaluation"):
            self.registry.register(
                "retrieval_evaluation",
                self.evaluate_retrieval,
                "Evaluate chunk count, relevance, spread, coverage, confidence, citations, and metadata.",
                capabilities=("retrieval_evaluation",),
                prerequisites=("retrieval_execution",),
                expected_outputs=("retrieval_evaluation",),
                execution_cost=ExecutionCost.LOW,
            )
        standard_tools = {
            "query_rewrite": (self._query_rewrite, "Rewrite conversational follow-up queries.", ("query_rewrite",), (), ("rewritten_query",), ExecutionCost.MEDIUM),
            "semantic_cache": (self._semantic_cache, "Retrieve a candidate from the existing semantic cache.", ("semantic_cache",), ("rewritten_query",), ("cache_candidate",), ExecutionCost.LOW),
            "multi_query": (self._multi_query, "Generate query variants with the existing query-rewrite service.", ("query_expansion",), ("rewritten_query",), ("query_variants",), ExecutionCost.MEDIUM),
            "rerank": (self._rerank, "Rerank candidates with the configured existing reranker.", ("reranking",), ("retrieved_chunks",), ("reranked_chunks",), ExecutionCost.HIGH),
            "hierarchical_context_enrichment": (self._hierarchical_expand, "Add adaptive section, chapter, or document context when the retrieval agent judges it useful.", ("hierarchical_retrieval", "retrieval_enrichment"), ("retrieved_chunks", "retrieval_plan"), ("hierarchical_context",), ExecutionCost.MEDIUM),
            "parent_context_expansion": (self._parent_expand, "Adaptively expand selected child chunks to parent sections when it improves answer context.", ("parent_context_expansion",), ("retrieved_chunks", "retrieval_plan"), ("expanded_parent_context",), ExecutionCost.MEDIUM),
            "context_compression": (self._compress, "Compress context with the existing compression service.", ("context_compression",), ("retrieved_chunks",), ("compressed_context",), ExecutionCost.MEDIUM),
            "answer_generator": (self._answer, "Generate an answer with the existing LLM service.", ("answer_generation",), ("retrieval_execution",), ("answer",), ExecutionCost.HIGH),
            "answer_generator_stream": (self._answer_stream, "Stream an answer with the existing LLM service.", ("streaming_answer_generation",), ("retrieval_execution",), ("answer",), ExecutionCost.HIGH),
            "source_extraction": (self._sources, "Extract citations with the existing source service.", ("source_extraction",), ("answer", "retrieval_execution"), ("sources",), ExecutionCost.LOW),
            "hallucination_check": (self._hallucination, "Run the existing hallucination detector.", ("hallucination_detection",), ("answer", "retrieval_execution"), ("hallucinations",), ExecutionCost.HIGH),
            "confidence_score": (self._confidence, "Calculate confidence with the existing confidence service.", ("confidence_scoring",), ("retrieval_execution",), ("final_confidence",), ExecutionCost.LOW),
        }
        for name, (handler, description, capabilities, prerequisites, outputs, cost) in standard_tools.items():
            if not self.registry.contains(name):
                self.registry.register(
                    name, handler, description, capabilities=capabilities,
                    prerequisites=prerequisites, expected_outputs=outputs,
                    execution_cost=cost,
                )

    def execute_retrieval_attempt(self, plan: RetrievalPlan, request: RetrievalRequest) -> ExecutionResult:
        return self._planner_executor.execute(plan, request)

    def evaluate_retrieval(self, query: str, results: list[dict], plan: RetrievalPlan) -> RetrievalEvaluation:
        return self._evaluator.evaluate(query, results, plan)

    def build_context(self, results: list[dict]) -> str:
        from embedding_service import build_context
        return build_context(results)

    def execute_node(
        self, node: WorkflowStep, memory: AgentMemory, *args, input_fingerprint: str = "", **kwargs,
    ):
        """Execute a graph node once after validating declared prerequisites."""

        descriptor = self.registry.descriptor(node.tool_name)
        if not memory.begin_step(node.step_id, node.tool_name, input_fingerprint):
            output_key = descriptor.expected_outputs[0] if descriptor.expected_outputs else node.step_id
            return memory.tool_outputs.get(output_key)
        missing_nodes = [
            dependency for dependency in node.depends_on
            if dependency not in memory.completed_steps
            and dependency not in memory.skipped_steps
            and dependency not in memory.failed_steps
        ]
        if missing_nodes:
            error = RuntimeError(f"Graph node {node.step_id} missing dependencies: {', '.join(missing_nodes)}")
            memory.fail_step(node.step_id, error)
            raise error
        missing = [key for key in descriptor.prerequisites if key not in memory.tool_outputs]
        if missing:
            error = RuntimeError(f"Tool {node.tool_name} missing prerequisites: {', '.join(missing)}")
            memory.fail_step(node.step_id, error)
            raise error
        try:
            output = self.registry.execute(node.tool_name, *args, **kwargs)
            output_key = descriptor.expected_outputs[0] if descriptor.expected_outputs else node.step_id
            memory.complete_step(node.step_id, output_key, output)
            return output
        except Exception as exc:
            memory.fail_step(node.step_id, exc)
            raise

    @staticmethod
    def _query_rewrite(
        question: str,
        chat_history: list[dict],
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "query_rewrite",
    ) -> str:
        from services.query_rewrite_service import rewrite_query
        return rewrite_query(question, chat_history, user_id=user_id, resource_id=resource_id, feature=feature)

    @staticmethod
    def _semantic_cache(db, resource_id: str | None, query: str, user_id: str | None = None):
        from services.cache_service import get_cached_answer
        return get_cached_answer(db, resource_id, query, user_id=user_id)

    @staticmethod
    def _multi_query(
        query: str,
        count: int = 2,
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "query_variants_generation",
    ) -> list[str]:
        from services.query_rewrite_service import generate_query_variants
        return generate_query_variants(query, n=count, user_id=user_id, resource_id=resource_id, feature=feature)

    @staticmethod
    def _rerank(query: str, results: list[dict], top_k: int, user_id: str | None = None) -> list[dict]:
        from services.reranker_service import rerank_results
        return rerank_results(query, results, top_k=top_k, user_id=user_id)

    @staticmethod
    def _compress(
        query: str,
        chunks: list[str],
        max_chunks: int,
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "context_compression",
    ) -> list[str]:
        from services.context_compression_service import compress_context
        return compress_context(
            query,
            chunks,
            max_chunks=max_chunks,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
        )

    @staticmethod
    def _parent_expand(query: str, results: list[dict], plan: RetrievalPlan):
        from services.parent_child_service import expand_parent_context
        return expand_parent_context(results, query=query, plan=plan)

    @staticmethod
    def _hierarchical_expand(query: str, results: list[dict], plan: RetrievalPlan):
        from services.hierarchical_retrieval_service import enrich_with_hierarchy
        return enrich_with_hierarchy(results, query=query, plan=plan)

    @staticmethod
    def _answer(
        question: str,
        context: str,
        chat_history: str | None = None,
        concise: bool = False,
        globe_on: bool = False,
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "rag_answer",
    ) -> str:
        from services.llm_service import generate_answer
        return generate_answer(
            question,
            context,
            chat_history=chat_history,
            concise=concise,
            globe_on=globe_on,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
        )

    @staticmethod
    def _answer_stream(
        question: str,
        context: str,
        chat_history: str | None = None,
        globe_on: bool = False,
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "rag_answer_stream",
    ):
        from services.llm_service import generate_answer_stream
        return generate_answer_stream(
            question,
            context,
            chat_history=chat_history,
            globe_on=globe_on,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
        )

    @staticmethod
    def _hallucination(
        context_chunks: list[str],
        question: str,
        answer: str,
        user_id: str | None = None,
        resource_id: str | None = None,
        feature: str = "hallucination_detection",
    ):
        from services.hallucination_service import detect_hallucinations
        return detect_hallucinations(
            context_chunks,
            question,
            answer,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
        )

    @staticmethod
    def _sources(results: list[dict], answer: str):
        from embedding_service import extract_rich_sources
        return extract_rich_sources(results, answer)

    @staticmethod
    def _confidence(results: list[dict], hallucinations: list[dict]):
        from services.confidence_service import calculate_confidence
        return calculate_confidence(results, hallucinations)
