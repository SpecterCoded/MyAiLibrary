"""Execution engine that composes existing RAG services from a retrieval plan."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from inspect import signature
from time import perf_counter
from typing import Callable, Protocol

from core.metrics import log_hierarchical_retrieval, log_parent_child_expansion
from services.hierarchical_retrieval_service import enrich_with_hierarchy
from services.parent_child_service import expand_parent_context

from .planner_models import ExecutionReport, RetrievalMode, RetrievalPlan


@dataclass(frozen=True)
class RetrievalRequest:
    """Workspace-scoped inputs needed by every retrieval strategy."""

    query: str
    user_id: str
    resource_id: str | None = None
    selected_resource_ids: list[str] | None = None
    available_resource_ids: list[str] | None = None
    storage_root: str | None = None


@dataclass(frozen=True)
class ExecutionResult:
    """Artifacts returned by planned retrieval execution."""

    context: str
    results: list[dict]
    report: ExecutionReport


class RetrievalHandler(Protocol):
    """Extension point for current and future retrieval tools."""

    def __call__(self, request: RetrievalRequest, top_k: int) -> list[dict]: ...


class PlannerExecutor:
    """Execute plans through a registry of retrieval strategy adapters.

    New retrieval systems can be registered without changing planning or stage
    orchestration. Existing functions remain the sole implementations of vector,
    BM25, hybrid, reranking, query expansion, and context compression.
    """

    def __init__(
        self,
        handlers: dict[RetrievalMode, RetrievalHandler] | None = None,
        query_expander: Callable[[str, int, str | None, str | None], list[str]] | None = None,
        reranker: Callable[[str, list, int, str | None], list[dict]] | None = None,
        compressor: Callable[[str, list[str], int, str | None, str | None], list[str]] | None = None,
        context_builder: Callable[[list[dict]], str] | None = None,
        hierarchical_expander: Callable[[str, list[dict], RetrievalPlan], tuple[list[dict], dict]] | None = None,
        parent_expander: Callable[[str, list[dict], RetrievalPlan], tuple[list[dict], dict]] | None = None,
    ) -> None:
        self._handlers: dict[RetrievalMode, RetrievalHandler] = handlers or {
            RetrievalMode.VECTOR_ONLY: self._vector_retrieval,
            RetrievalMode.KEYWORD_ONLY: self._keyword_retrieval,
            RetrievalMode.HYBRID: self._hybrid_retrieval,
        }
        self._query_expander = query_expander or self._default_query_expander
        self._reranker = reranker or self._default_reranker
        self._compressor = compressor or self._default_compressor
        self._context_builder = context_builder or self._default_context_builder
        self._hierarchical_expander = hierarchical_expander or self._default_hierarchical_expander
        self._parent_expander = parent_expander or self._default_parent_expander

    def register(self, mode: RetrievalMode, handler: RetrievalHandler) -> None:
        """Register or replace a retrieval adapter (useful for future tools)."""

        self._handlers[mode] = handler

    def retrieve(self, mode: RetrievalMode, request: RetrievalRequest, top_k: int) -> list[dict]:
        """Expose a registered retrieval strategy as a standalone callable tool."""

        handler = self._handlers.get(mode)
        if handler is None:
            raise ValueError(f"No retrieval handler registered for {mode.value}")
        return handler(request, top_k)

    @staticmethod
    def _call_with_compatible_args(func: Callable, *args):
        """Call helper functions with the newest supported subset of arguments.

        Several tests and older call sites still provide simple lambdas with the
        legacy signatures like ``(query, count)`` or ``(query, chunks, max_chunks)``.
        We pass only the prefix accepted by the callable so newer production
        helpers and older test doubles both keep working.
        """

        try:
            params = signature(func).parameters.values()
        except (TypeError, ValueError):
            return func(*args)

        accepted = []
        for param in params:
            if param.kind in (
                param.POSITIONAL_ONLY,
                param.POSITIONAL_OR_KEYWORD,
            ):
                accepted.append(param)
            elif param.kind == param.VAR_POSITIONAL:
                return func(*args)

        return func(*args[: len(accepted)])

    def execute(self, plan: RetrievalPlan, request: RetrievalRequest) -> ExecutionResult:
        """Run only the modules enabled by ``plan`` and return an audit report."""

        self._current_rrf_k = plan.rrf_k
        started = perf_counter()
        executed: list[str] = []
        skipped: list[str] = []
        handler = self._handlers.get(plan.retrieval_mode)
        if handler is None:
            raise ValueError(f"No retrieval handler registered for {plan.retrieval_mode.value}")

        queries = [request.query]
        if plan.enable_multi_query:
            queries.extend(
                self._call_with_compatible_args(
                    self._query_expander,
                    request.query,
                    2,
                    request.user_id,
                    request.resource_id,
                )
            )
            executed.append("multi_query")
        else:
            skipped.append("multi_query")

        if len(queries) == 1:
            candidates = handler(request, plan.retrieval_depth)
        else:
            candidates = []
            with ThreadPoolExecutor(max_workers=len(queries)) as pool:
                futures = [
                    pool.submit(
                        handler,
                        RetrievalRequest(
                            query=query,
                            user_id=request.user_id,
                            resource_id=request.resource_id,
                            selected_resource_ids=request.selected_resource_ids,
                            available_resource_ids=request.available_resource_ids,
                            storage_root=request.storage_root,
                        ),
                        plan.retrieval_depth,
                    )
                    for query in queries
                ]
                for future in as_completed(futures):
                    candidates.extend(future.result())

        executed.append(plan.retrieval_mode.value)
        candidates = self._deduplicate(candidates)[: plan.retrieval_depth]

        if plan.rerank:
            # Keep a broad ranked pool so compression makes the final selection.
            results = self._reranker(request.query, candidates, plan.retrieval_depth, user_id=request.user_id)
            executed.append("rerank")
        else:
            results = candidates
            skipped.append("rerank")

        results, hierarchy_details = self._hierarchical_expander(request.query, results, plan)
        if hierarchy_details.get("success"):
            executed.append("hierarchical_retrieval")
        else:
            skipped.append("hierarchical_retrieval")
        log_hierarchical_retrieval(
            query=request.query,
            selected=hierarchy_details.get("selected", False),
            selected_levels=hierarchy_details.get("selected_levels", []),
            retrieved_nodes=hierarchy_details.get("retrieved_nodes", []),
            context_size_before=hierarchy_details.get("context_size_before_tokens", 0),
            context_size_after=hierarchy_details.get("context_size_after_tokens", 0),
            success=hierarchy_details.get("success", False),
            fallback_reason=hierarchy_details.get("reason", ""),
            user_id=request.user_id,
            resource_id=request.resource_id,
        )

        child_results = [item for item in results if not (item.get("metadata") or {}).get("hierarchy_node")]
        hierarchy_results = [item for item in results if (item.get("metadata") or {}).get("hierarchy_node")]
        expanded_results, expansion_details = self._parent_expander(request.query, child_results, plan)
        if expansion_details.get("success"):
            results = expanded_results + hierarchy_results
            executed.append("parent_child_expansion")
        else:
            results = child_results + hierarchy_results
            skipped.append("parent_child_expansion")
        log_parent_child_expansion(
            query=request.query,
            child_chunks=expansion_details.get("child_chunks", []),
            parent_sections=expansion_details.get("parent_sections", []),
            context_size_before=expansion_details.get("context_size_before_tokens", 0),
            context_size_after=expansion_details.get("context_size_after_tokens", 0),
            success=expansion_details.get("success", False),
            fallback_reason=expansion_details.get("reason", ""),
            selected=expansion_details.get("selected"),
            selected_parent_sections=expansion_details.get("selected_parent_sections"),
            available_parent_sections=expansion_details.get("available_parent_sections"),
            user_id=request.user_id,
            resource_id=request.resource_id,
        )

        if plan.compress_context and len(results) > plan.max_chunks:
            selected_content = self._call_with_compatible_args(
                self._compressor,
                request.query,
                [item["content"] for item in results],
                plan.max_chunks,
                request.user_id,
                request.resource_id,
            )
            selected = set(selected_content)
            results = [item for item in results if item["content"] in selected]
            executed.append("context_compression")
        else:
            results = results[: plan.max_chunks]
            skipped.append("context_compression")

        report = ExecutionReport(
            modules_executed=executed,
            modules_skipped=skipped,
            queries_executed=queries,
            retrieval_strategy=plan.retrieval_mode,
            execution_time_ms=(perf_counter() - started) * 1000,
        )
        return ExecutionResult(context=self._context_builder(results), results=results, report=report)

    @staticmethod
    def _default_query_expander(
        query: str,
        count: int,
        user_id: str | None = None,
        resource_id: str | None = None,
    ) -> list[str]:
        from services.query_rewrite_service import generate_query_variants
        return generate_query_variants(
            query,
            n=count,
            user_id=user_id,
            resource_id=resource_id,
            feature="query_variants_generation",
        )

    @staticmethod
    def _default_reranker(query: str, results: list, top_k: int, user_id: str | None = None) -> list[dict]:
        from services.reranker_service import rerank_results
        return rerank_results(query, results, top_k=top_k, user_id=user_id)

    @staticmethod
    def _default_compressor(
        query: str,
        chunks: list[str],
        max_chunks: int,
        user_id: str | None = None,
        resource_id: str | None = None,
    ) -> list[str]:
        from services.context_compression_service import compress_context
        return compress_context(
            query,
            chunks,
            max_chunks=max_chunks,
            user_id=user_id,
            resource_id=resource_id,
            feature="context_compression",
        )

    @staticmethod
    def _default_context_builder(results: list[dict]) -> str:
        from embedding_service import build_context
        return build_context(results)

    @staticmethod
    def _default_hierarchical_expander(query: str, results: list[dict], plan: RetrievalPlan) -> tuple[list[dict], dict]:
        return enrich_with_hierarchy(results, query=query, plan=plan)

    def _default_hierarchical_expander(self, query: str, results: list[dict], plan: RetrievalPlan) -> tuple[list[dict], dict]:
        user_settings = getattr(self, '_user_rag_settings', {})
        enabled = user_settings.get("hierarchical", False)
        return enrich_with_hierarchy(results, query=query, plan=plan, enabled=enabled)

    def _default_parent_expander(self, query: str, results: list[dict], plan: RetrievalPlan) -> tuple[list[dict], dict]:
        from services.parent_child_service import expand_parent_context
        user_settings = getattr(self, '_user_rag_settings', {})
        enabled = user_settings.get("parent_child", False)
        return expand_parent_context(results, query=query, plan=plan, enabled=enabled)

    @staticmethod
    def _deduplicate(results: list[dict]) -> list[dict]:
        merged: dict[tuple[object, object], dict] = {}
        for result in results:
            metadata = result.get("metadata") or {}
            key = (metadata.get("resource_id"), result.get("chunk_index", metadata.get("chunk_index")))
            score = result.get("hybrid_score", result.get("score", -result.get("distance", 999.0)))
            previous = merged.get(key)
            previous_score = previous.get("_planner_score", float("-inf")) if previous else float("-inf")
            if previous is None or score > previous_score:
                item = dict(result)
                item["_planner_score"] = score
                merged[key] = item
        output = list(merged.values())
        output.sort(key=lambda item: item.pop("_planner_score"), reverse=True)
        return output

    @staticmethod
    def _vector_retrieval(request: RetrievalRequest, top_k: int) -> list[dict]:
        from embedding_service import search_all_resources
        from services.retrieval_service import search_resource

        if request.resource_id:
            raw = search_resource(
                request.resource_id,
                request.query,
                request.user_id,
                n_results=top_k,
                storage_root=request.storage_root,
            )
        else:
            raw = search_all_resources(
                request.query,
                user_id=request.user_id,
                n_results=top_k,
                selected_resource_ids=request.selected_resource_ids,
                storage_root=request.storage_root,
            )
        return [
            {
                "chunk_index": metadata.get("chunk_index"),
                "content": document,
                "metadata": metadata,
                "distance": distance,
            }
            for document, metadata, distance in zip(raw["documents"], raw["metadatas"], raw["distances"])
        ]

    @staticmethod
    def _keyword_retrieval(request: RetrievalRequest, top_k: int) -> list[dict]:
        from services.bm25_service import search_global_bm25, search_resource_bm25

        if request.resource_id:
            results = search_resource_bm25(request.resource_id, request.query, top_k=top_k)
            return [
                {
                    **item,
                    "metadata": {"resource_id": request.resource_id, "chunk_index": item["chunk_index"]},
                }
                for item in results
            ]
        available = set(request.available_resource_ids or [])
        resource_ids = request.selected_resource_ids or list(available)
        # BM25 has no workspace column of its own, so enforce ownership before
        # handing resource IDs to it. Vector search also applies its user filter.
        if available:
            resource_ids = [resource_id for resource_id in resource_ids if resource_id in available]
        return [
            {
                **item,
                "metadata": {"resource_id": item["resource_id"], "chunk_index": item["chunk_index"]},
            }
            for item in search_global_bm25(resource_ids, request.query, top_k=top_k)
        ]

    def _hybrid_retrieval(self, request: RetrievalRequest, top_k: int) -> list[dict]:
        rrf_k = getattr(self, '_current_rrf_k', 60)
        if request.resource_id:
            from services.hybrid_service import search_resource_hybrid
            return search_resource_hybrid(
                request.resource_id,
                request.query,
                request.user_id,
                top_k=top_k,
                storage_root=request.storage_root,
                rrf_k=rrf_k,
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            vector_future = pool.submit(self._vector_retrieval, request, top_k)
            keyword_future = pool.submit(self._keyword_retrieval, request, top_k)
            vector_results = vector_future.result()
            keyword_results = keyword_future.result()
        return self._rrf(vector_results, keyword_results, rrf_k=rrf_k)[:top_k]

    @staticmethod
    def _rrf(vector_results: list[dict], keyword_results: list[dict], rrf_k: int = 60) -> list[dict]:
        """Fuse existing vector and BM25 results using reciprocal rank fusion."""

        merged: dict[tuple[object, object], dict] = {}
        scores: dict[tuple[object, object], float] = {}
        for ranked in (vector_results, keyword_results):
            for rank, result in enumerate(ranked):
                metadata = result.get("metadata") or {}
                key = (metadata.get("resource_id"), result.get("chunk_index", metadata.get("chunk_index")))
                merged.setdefault(key, result)
                scores[key] = scores.get(key, 0.0) + 1.0 / (rrf_k + rank)
        output = []
        for key, score in sorted(scores.items(), key=lambda item: item[1], reverse=True):
            item = dict(merged[key])
            item["hybrid_score"] = score
            output.append(item)
        return output
