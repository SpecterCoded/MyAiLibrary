import re
from time import perf_counter
from typing import List, Dict
from embedding_service import build_context, extract_rich_sources
from core.activity_log import log_user_activity
from .query_rewrite_service import rewrite_query, generate_query_variants
from .hybrid_service import search_resource_hybrid
from .reranker_service import rerank_results
from .context_compression_service import compress_context
from .parent_child_service import expand_parent_context
from .llm_service import enforce_inline_chunk_citations
try:
    from core.metrics import log_parent_child_expansion, log_planner_execution, log_query, log_retrieval_stats
except ImportError:
    log_parent_child_expansion = None
    log_planner_execution = None
    log_query = None
    log_retrieval_stats = None

from .planner.planner_executor import PlannerExecutor, RetrievalRequest
from .planner.planner_models import RetrievalPlan
from .agent.retrieval_agent import RetrievalAgent
from .agent.workflow_executor import WorkflowExecutor
from .agent.workflow_models import RetrievalWorkflow
from core.config import ENABLE_QUERY_ROUTING, ENABLE_CHUNK_OVERLAP, ENABLE_HYDE


def get_user_rag_settings(user_id: str) -> dict:
    """Fetch per-user RAG enhancement toggles from the database.

    Returns a dict with boolean keys matching the UserSetting columns.
    Falls back to env-var defaults if the user has no settings row.
    """
    try:
        from database import SessionLocal
        from models import UserSetting
        db = SessionLocal()
        try:
            row = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
            if row is None:
                return {
                    "chunk_overlap": ENABLE_CHUNK_OVERLAP,
                    "query_routing": ENABLE_QUERY_ROUTING,
                    "nli_verification": False,
                    "adaptive_rrf": True,
                    "parent_child": False,
                    "hierarchical": False,
                }
            return {
                "chunk_overlap": getattr(row, "rag_chunk_overlap", 0) == 1,
                "query_routing": getattr(row, "rag_query_routing", 0) == 1,
                "nli_verification": getattr(row, "rag_nli_verification", 0) == 1,
                "adaptive_rrf": getattr(row, "rag_adaptive_rrf", 1) == 1,
                "parent_child": getattr(row, "rag_parent_child", 0) == 1,
                "hierarchical": getattr(row, "rag_hierarchical", 0) == 1,
            }
        finally:
            db.close()
    except Exception:
        return {
            "chunk_overlap": ENABLE_CHUNK_OVERLAP,
            "query_routing": ENABLE_QUERY_ROUTING,
            "nli_verification": False,
            "adaptive_rrf": True,
            "parent_child": False,
            "hierarchical": False,
        }


def _build_provisional_sources(results: list[dict]) -> list[dict]:
    """Build a lightweight source list immediately from reranked results.

    This avoids the slower rich-source extraction path so inline citation
    tooltips can work as soon as the answer text is ready.
    """
    provisional_sources: list[dict] = []
    seen_chunk_indexes: set[int] = set()

    for result in results:
        metadata = result.get("metadata") or {}
        chunk_index = result.get("chunk_index", metadata.get("chunk_index"))
        if chunk_index is None:
            continue

        try:
            normalized_chunk_index = int(chunk_index)
        except (TypeError, ValueError):
            continue

        if normalized_chunk_index in seen_chunk_indexes:
            continue
        seen_chunk_indexes.add(normalized_chunk_index)

        content = result.get("content") or result.get("document") or ""
        excerpt = content[:220].strip()
        if content and len(content) > 220:
            excerpt = f"{excerpt}..."

        provisional_sources.append(
            {
                "chunk_index": normalized_chunk_index,
                "excerpt": excerpt or "Source preview unavailable.",
                "rerank_score": result.get("rerank_score"),
                "hybrid_score": result.get("hybrid_score"),
                "resource_id": metadata.get("resource_id"),
                "resource_title": metadata.get("resource_title") or "Source",
                "resource_path": metadata.get("resource_path") or "",
                "timestamp": metadata.get("start_time"),
                "timestamp_label": metadata.get("timestamp_label") or "",
                "page_number": metadata.get("page_number"),
            }
        )

    return provisional_sources

def prepare_rag_context(
    question: str,
    user_id: str,
    resource_id: str = None,
    chat_history: List[Dict] = None,
    n_results: int = 5,
    selected_resource_ids: List[str] = None,
    storage_root: str = None,
    use_multi_query: bool = True,
    use_context_compression: bool = False,
    plan: RetrievalPlan = None,
    executor: PlannerExecutor = None,
    available_resource_ids: List[str] = None,
    agent: RetrievalAgent = None,
    workflow: RetrievalWorkflow = None,
    user_rag_settings: dict = None,
):
    """
    Retrieval part of the RAG pipeline. `storage_root` scopes retrieval to the
    user's active workspace collection so results never mix across workspaces.
    """
    if plan is not None:
        # Store user RAG settings on executor for expander functions to read
        if executor is not None and user_rag_settings:
            executor._user_rag_settings = user_rag_settings
        rewritten_question = question
        if chat_history:
            rewritten_question = rewrite_query(
                question,
                chat_history,
                user_id=user_id,
                resource_id=resource_id,
                feature="query_rewrite",
            )
        retrieval_agent = agent or RetrievalAgent(
            workflow_executor=WorkflowExecutor(planner_executor=executor)
            if executor is not None else None
        )
        execution = retrieval_agent.run(
            rewritten_question,
            RetrievalRequest(
                query=rewritten_question,
                user_id=user_id,
                resource_id=resource_id,
                selected_resource_ids=selected_resource_ids,
                available_resource_ids=available_resource_ids,
                storage_root=storage_root,
            ),
            initial_plan=plan,
            has_chat_history=bool(chat_history),
            workflow=workflow,
        )
        return execution.context, execution.results, rewritten_question, execution.report

    # 1. Query Rewrite
    rewritten_question = question
    if chat_history and len(chat_history) > 0:
        rewritten_question = rewrite_query(
            current_question=question,
            chat_history=chat_history,
            user_id=user_id,
            resource_id=resource_id,
            feature="query_rewrite",
        )

    # 2. Hybrid Retrieval
    if resource_id:
        if use_multi_query:
            # Multi-query: rewritten + 2 variants, run in parallel
            all_queries = [rewritten_question] + generate_query_variants(
                rewritten_question,
                n=2,
                user_id=user_id,
                resource_id=resource_id,
                feature="query_variants_generation",
            )

            # HyDE: add hypothetical answer as additional query
            if plan and plan.use_hyde and ENABLE_HYDE:
                from services.hyde_service import generate_hypothetical_answer
                hypothetical = generate_hypothetical_answer(
                    rewritten_question, user_id=user_id, resource_id=resource_id
                )
                if hypothetical:
                    all_queries.append(hypothetical)

            from concurrent.futures import ThreadPoolExecutor, as_completed

            def _run_hybrid(q: str):
                return search_resource_hybrid(
                    resource_id=resource_id,
                    query=q,
                    user_id=user_id,
                    top_k=20,
                    storage_root=storage_root
                )

            all_results = []
            with ThreadPoolExecutor(max_workers=len(all_queries)) as pool:
                futures = {pool.submit(_run_hybrid, q): q for q in all_queries}
                for future in as_completed(futures):
                    all_results.extend(future.result())
        else:
            # Simple question — single search only
            all_results = search_resource_hybrid(
                resource_id=resource_id,
                query=rewritten_question,
                user_id=user_id,
                top_k=20,
                storage_root=storage_root
            )

        # Merge by chunk_index, keeping highest hybrid_score
        merged: dict[int, dict] = {}
        for res in all_results:
            idx = res["chunk_index"]
            if idx not in merged or res["hybrid_score"] > merged[idx]["hybrid_score"]:
                merged[idx] = res

        results = sorted(merged.values(), key=lambda r: r["hybrid_score"], reverse=True)[:20]
    else:
        # Global library search — hybrid (Chroma + BM25) with RRF fusion
        from embedding_service import search_all_resources
        from .bm25_service import search_global_bm25

        raw = search_all_resources(
            rewritten_question,
            user_id=user_id,
            n_results=20,
            selected_resource_ids=selected_resource_ids,
            storage_root=storage_root
        )

        # Build Chroma candidates, deduplicating by content
        chroma_candidates = []
        seen_content = set()
        for doc, meta, dist in zip(raw["documents"], raw["metadatas"], raw["distances"]):
            content_key = doc.strip().lower()
            if content_key in seen_content:
                continue
            seen_content.add(content_key)
            chroma_candidates.append({"content": doc, "metadata": meta, "distance": dist})

        # Run BM25 across the resource_ids Chroma found (already user-scoped)
        chroma_resource_ids = list({c["metadata"].get("resource_id") for c in chroma_candidates if c["metadata"].get("resource_id")})
        bm25_candidates = search_global_bm25(chroma_resource_ids, rewritten_question, top_k=20)

        # RRF fusion — same approach as hybrid_service.py
        RRF_K = 60
        chroma_ranked = {(c["metadata"].get("resource_id"), c["metadata"].get("chunk_index")): i
                         for i, c in enumerate(chroma_candidates)}
        bm25_ranked = {(b["resource_id"], b["chunk_index"]): i
                       for i, b in enumerate(bm25_candidates)}

        all_keys = set(chroma_ranked) | set(bm25_ranked)
        merged: dict = {}
        for key in all_keys:
            rrf = 0.0
            if key in chroma_ranked:
                rrf += 1.0 / (RRF_K + chroma_ranked[key])
            if key in bm25_ranked:
                rrf += 1.0 / (RRF_K + bm25_ranked[key])
            merged[key] = rrf

        # Rebuild result list in RRF order
        chroma_by_key = {(c["metadata"].get("resource_id"), c["metadata"].get("chunk_index")): c
                         for c in chroma_candidates}
        bm25_by_key = {(b["resource_id"], b["chunk_index"]): b for b in bm25_candidates}

        results = []
        for key, rrf_score in sorted(merged.items(), key=lambda x: x[1], reverse=True)[:20]:
            if key in chroma_by_key:
                c = chroma_by_key[key]
                results.append({"content": c["content"], "metadata": c["metadata"], "hybrid_score": rrf_score})
            elif key in bm25_by_key:
                b = bm25_by_key[key]
                results.append({
                    "content": b["content"],
                    "metadata": {"resource_id": b["resource_id"], "chunk_index": b["chunk_index"]},
                    "hybrid_score": rrf_score,
                })

    # 3. Reranking — top_k = n_results so no truncation beyond what was retrieved
    reranked_results = rerank_results(
        query=rewritten_question,
        results=results,
        top_k=n_results,
        user_id=user_id,
    )

    # Log reranking details
    try:
        from database import SessionLocal as _SL
        _ldb = _SL()
        log_user_activity(_ldb, user_id, 'ai_features', 'Reranking chunks', f'{len(results)} → {len(reranked_results)} after rerank')
        _ldb.close()
    except Exception:
        pass

    expanded_results, expansion_details = expand_parent_context(
        reranked_results,
        enabled=(user_rag_settings or {}).get("parent_child", False),
    )
    if expansion_details.get("success"):
        reranked_results = expanded_results
        # Log parent-child expansion
        try:
            from database import SessionLocal as _SL2
            _ldb2 = _SL2()
            before = expansion_details.get("context_size_before_tokens", 0)
            after = expansion_details.get("context_size_after_tokens", 0)
            log_user_activity(_ldb2, user_id, 'ai_features', 'Parent-child expansion', f'{before} → {after} tokens')
            _ldb2.close()
        except Exception:
            pass
    if log_parent_child_expansion:
        log_parent_child_expansion(
            query=rewritten_question,
            child_chunks=expansion_details.get("child_chunks", []),
            parent_sections=expansion_details.get("parent_sections", []),
            context_size_before=expansion_details.get("context_size_before_tokens", 0),
            context_size_after=expansion_details.get("context_size_after_tokens", 0),
            success=expansion_details.get("success", False),
            fallback_reason=expansion_details.get("reason", ""),
            user_id=user_id or "",
            resource_id=resource_id or "",
        )

    # 3b. Context compression — filter out irrelevant chunks before answer generation
    if use_context_compression and len(reranked_results) > 5:
        chunk_texts = [r["content"] for r in reranked_results]
        compressed = compress_context(
            rewritten_question,
            chunk_texts,
            max_chunks=5,
            user_id=user_id,
            resource_id=resource_id,
            feature="context_compression",
        )
        reranked_results = [r for r in reranked_results if r["content"] in compressed]
        try:
            from database import SessionLocal as _SL3
            _ldb3 = _SL3()
            log_user_activity(_ldb3, user_id, 'ai_features', 'Context compressed', f'{len(chunk_texts)} → {len(reranked_results)} chunks')
            _ldb3.close()
        except Exception:
            pass

    # 4. Context Building
    context = build_context(reranked_results)
    # Log context size
    try:
        from database import SessionLocal as _SL4
        _ldb4 = _SL4()
        token_est = len(context.split()) * 1.3  # rough token estimate
        log_user_activity(_ldb4, user_id, 'ai_chat', 'Context built', f'{len(reranked_results)} chunks, ~{int(token_est)} tokens')
        _ldb4.close()
    except Exception:
        pass
    
    return context, reranked_results, rewritten_question


from sqlalchemy.orm import Session
from .cache_service import save_to_cache

def run_rag_pipeline(
    db: Session,
    user_id: str,
    resource_id: str,
    question: str,
    chat_history: List[Dict] = None,
    final_history_str: str = None,
    n_results: int = 5,
    concise: bool = False,
    selected_resource_ids: List[str] = None,
    globe_on: bool = False
):
    """
    Unified Production RAG Pipeline with Semantic Caching.
    Cache is checked BEFORE retrieval so hits skip the entire search pipeline.
    """
    from services.pipeline_logger import PipelineLogger
    plog = PipelineLogger(user_id, question)
    plog.log("start", resource_id=resource_id, globe_on=globe_on)

    log_user_activity(db, user_id, 'ai_chat', 'RAG query', question[:100])
    # Globe mode: bypass the entire RAG pipeline — pure LLM, like ChatGPT
    if globe_on:
        from .llm_service import generate_answer
        answer = generate_answer(
            question=question,
            context="",
            chat_history=final_history_str,
            concise=concise,
            globe_on=True,
            user_id=user_id,
            resource_id=resource_id,
            feature="global_chat_answer",
        )
        return {
            "answer": answer,
            "context": "",
            "sources": [],
            "hallucinations": [],
            "rewritten_question": question,
            "confidence": 1.0,
            "confidence_label": "globe"
        }

    pipeline_started = perf_counter()
    # 0. Resolve the user's active workspace so retrieval is scoped to it.
    from models import Resource, User
    user = db.query(User).filter(User.id == user_id).first()
    storage_root = user.storage_root if user else None
    available_resource_ids = [
        row[0]
        for row in db.query(Resource.id).filter(
            Resource.user_id == user_id,
            Resource.is_deleted == 0,
        ).all()
    ]

    # 1. Query Rewrite (needed for cache key, but NOT retrieval yet)
    retrieval_agent = RetrievalAgent()
    rewritten_question = question
    if chat_history and len(chat_history) > 0:
        rewritten_question = retrieval_agent.execute_tool(
            "query_rewrite",
            question,
            chat_history,
            user_id=user_id,
            resource_id=resource_id,
            feature="query_rewrite",
        )
        log_user_activity(db, user_id, 'ai_chat', 'Query rewritten', f'"{question[:50]}" → "{rewritten_question[:50]}"')

    # 2. Check Cache BEFORE retrieval — skip entire pipeline on hit
    cached_result = None
    # We bypass the cache entirely if specific resources are selected via the global chat,
    # because the cache schema currently keys off a single resource_id.
    if not selected_resource_ids:
        cached_result = retrieval_agent.execute_tool(
            "semantic_cache",
            db,
            resource_id,
            rewritten_question,
            user_id=user_id,
        )

    plog.log("cache_check", hit=cached_result is not None)
    workflow = retrieval_agent.create_workflow(
        rewritten_question,
        has_chat_history=bool(chat_history),
        cache_candidate_present=cached_result is not None,
        user_id=user_id,
        resource_id=resource_id,
    )
    plan = workflow.initial_plan

    # 2.5 Query routing gate — skip retrieval for greetings/small talk
    user_rag = get_user_rag_settings(user_id)
    if user_rag["query_routing"]:
        from services.query_router import should_skip_retrieval
        if should_skip_retrieval(question, plan.query_classification):
            log_user_activity(db, user_id, 'ai_chat', 'Query routed', f'Skipping retrieval for {plan.query_classification.value}')
            from services.llm_service import generate_answer
            answer = generate_answer(
                question=question,
                context="",
                chat_history=final_history_str,
                concise=concise,
                globe_on=True,
                user_id=user_id,
                resource_id=resource_id,
                feature="global_chat_answer",
            )
            return {
                "answer": answer,
                "context": "",
                "sources": [],
                "hallucinations": [],
                "rewritten_question": rewritten_question,
                "confidence": 1.0,
                "confidence_label": "routed"
            }

    if retrieval_agent.should_accept_cache(workflow, cached_result, user_id=user_id, resource_id=resource_id):
        log_user_activity(db, user_id, 'ai_chat', 'Cache hit', f'Confidence: {cached_result["confidence"]:.2f}')
        if log_planner_execution:
            log_planner_execution(
                rewritten_question, plan.model_dump(mode="json"),
                (perf_counter() - pipeline_started) * 1000,
                plan.retrieval_mode.value, ["semantic_cache"],
                ["retrieval", "multi_query", "rerank", "context_compression", "hallucination_check"],
                plan.reasoning, cached_result["confidence"], True, user_id, resource_id,
            )
        if log_query:
            try:
                log_query(
                    query=question,
                    latency_ms=(perf_counter() - pipeline_started) * 1000,
                    cache_hit=True,
                    chunks_retrieved=0,
                    hallucination_count=0,
                    confidence_score=cached_result["confidence"],
                    confidence_label="cached",
                    complexity_level=plan.query_classification.value,
                    resource_id=resource_id or "",
                    user_id=user_id or "",
                )
            except Exception:
                pass
        return {
            "answer": cached_result["answer"],
            "context": "",
            "sources": cached_result["sources"],
            "hallucinations": [],
            "rewritten_question": rewritten_question,
            "confidence": cached_result["confidence"],
            "confidence_label": "cached"
        }

    # 2.5 Analyze question complexity — controls pipeline depth
    # 3. Full retrieval pipeline (only on cache miss)
    log_user_activity(db, user_id, 'ai_chat', 'Retrieving context', f'Strategy: {plan.retrieval_mode.value}')
    context, reranked_results, rewritten_question, execution_report = prepare_rag_context(
        question=rewritten_question,
        user_id=user_id,
        resource_id=resource_id,
        chat_history=None,
        n_results=n_results,
        selected_resource_ids=selected_resource_ids,
        storage_root=storage_root,
        plan=plan,
        available_resource_ids=available_resource_ids,
        agent=retrieval_agent,
        workflow=workflow,
    )
    execution_report.modules_skipped.append("semantic_cache")
    agent_execution = retrieval_agent.last_result
    if agent_execution is None:
        raise RuntimeError("Retrieval agent did not produce execution state")
    agent_memory = agent_execution.memory

    # 4. LLM Answer Generation
    log_user_activity(db, user_id, 'ai_chat', 'Generating answer', f'{len(reranked_results)} chunks used')
    answer = retrieval_agent.execute_workflow_node(
        workflow, agent_memory, "answer",
        question, context, final_history_str, concise,
        input_fingerprint=rewritten_question,
        globe_on=globe_on,
        user_id=user_id,
        resource_id=resource_id,
        feature="resource_rag_answer" if resource_id else "global_rag_answer",
    )
    answer = enforce_inline_chunk_citations(answer, reranked_results)
    execution_report.modules_executed.append("answer_generation")

    # 5-6. Evidence extraction + hallucination check
    # Sources are always extracted (user wants citations). Hallucination check skipped for simple/medium.
    context_chunks = [res["content"] for res in reranked_results]
    log_user_activity(db, user_id, 'ai_chat', 'Extracting sources', f'Hallucination check: {"on" if plan.hallucination_check else "off"}')

    if plan.hallucination_check:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=2) as pool:
            future_sources = pool.submit(
                retrieval_agent.execute_workflow_node,
                workflow,
                agent_memory,
                "sources",
                reranked_results,
                answer,
            )
            future_halluc = pool.submit(
                retrieval_agent.execute_workflow_node,
                workflow,
                agent_memory,
                "hallucination",
                context_chunks,
                question,
                answer,
                user_id=user_id,
                resource_id=resource_id,
                feature="hallucination_detection",
            )
            sources = future_sources.result()
            hallucinations = future_halluc.result()
    else:
        sources = retrieval_agent.execute_workflow_node(
            workflow, agent_memory, "sources", reranked_results, answer,
            input_fingerprint=str(len(reranked_results)),
        )
        hallucinations = []
        agent_memory.skipped_steps.add("hallucination")

    if plan.hallucination_check:
        execution_report.modules_executed.append("hallucination_check")
    else:
        execution_report.modules_skipped.append("hallucination_check")

    # 7. Confidence Scoring
    log_user_activity(db, user_id, 'ai_chat', 'Scoring confidence')
    confidence, confidence_label = retrieval_agent.execute_workflow_node(
        workflow, agent_memory, "confidence",
        reranked_results, hallucinations,
        input_fingerprint=str(len(reranked_results)),
    )
    retrieval_agent.finalize_workflow(confidence)
    execution_report.modules_executed.append("confidence_score")

    result = {
        "answer": answer,
        "context": context,
        "sources": sources,
        "hallucinations": hallucinations,
        "rewritten_question": rewritten_question,
        "confidence": confidence,
        "confidence_label": confidence_label
    }

    # 8. Store in Cache
    # We only cache if no specific selected resources are filtered
    if not selected_resource_ids:
        save_to_cache(
            db,
            resource_id,
            rewritten_question,
            answer,
            sources,
            confidence,
            user_id=user_id,
        )

    # 9. Log metrics (never breaks pipeline)
    if log_planner_execution:
        log_planner_execution(
            rewritten_question, plan.model_dump(mode="json"),
            (perf_counter() - pipeline_started) * 1000,
            plan.retrieval_mode.value,
            execution_report.modules_executed,
            execution_report.modules_skipped,
            plan.reasoning, confidence, False, user_id, resource_id,
        )

    if log_query:
        try:
            log_retrieval_stats(
                query=question,
                chunks_before_rerank=len(results) if "results" in dir() else 0,
                chunks_after_rerank=len(reranked_results),
                hybrid_scores=[r.get("hybrid_score", 0) for r in reranked_results],
                rerank_scores=[r.get("rerank_score", 0) for r in reranked_results],
                cache_hit=False,
                resource_id=resource_id or "",
                user_id=user_id or "",
            )
            log_query(
                query=question,
                latency_ms=(perf_counter() - pipeline_started) * 1000,
                cache_hit=False,
                chunks_retrieved=len(reranked_results),
                avg_rerank_score=sum(r.get("rerank_score", 0) for r in reranked_results) / max(len(reranked_results), 1),
                top_rerank_score=reranked_results[0].get("rerank_score", 0) if reranked_results else 0,
                hallucination_count=len(hallucinations),
                confidence_score=confidence,
                confidence_label=confidence_label,
                complexity_level=plan.query_classification.value,
                resource_id=resource_id or "",
                user_id=user_id or "",
            )
        except Exception:
            pass

    plog.log("complete", confidence=confidence, label=confidence_label, chunks=len(reranked_results), hallucinations=len(hallucinations))
    plog.flush()

    return result


def run_rag_pipeline_stream(
    user_id: str,
    resource_id: str,
    question: str,
    chat_history: List[Dict] = None,
    final_history_str: str = None,
    n_results: int = 5,
    globe_on: bool = False
):
    """
    Streaming version of the RAG pipeline.
    Yields chunks:
    1. {"type": "metadata", ...}
    2. {"type": "token", "content": "..."}
    3. {"type": "final", ...}
    4. {"type": "done"}

    Includes cache-before-retrieval and complexity-based pipeline depth.
    """
    full_answer = ""

    # Globe mode: bypass the entire RAG pipeline — pure LLM streaming, like ChatGPT
    if globe_on:
        from .llm_service import generate_answer_stream
        buffer = ""
        THRESHOLD = 30
        for token in generate_answer_stream(
            question=question,
            context="",
            chat_history=final_history_str,
            globe_on=True,
            user_id=user_id,
            resource_id=resource_id,
            feature="media_global_chat_stream",
        ):
            full_answer += token
            buffer += token
            if len(buffer) >= THRESHOLD or re.search(r'[.!?](\s|$)', buffer):
                yield {"type": "token", "content": buffer}
                buffer = ""
        if buffer:
            yield {"type": "token", "content": buffer}
        yield {
            "type": "final",
            "answer": full_answer,
            "sources": [],
            "hallucinations": [],
            "confidence": 1.0,
            "confidence_label": "globe",
        }
        yield {"type": "done"}
        return

    pipeline_started = perf_counter()
    try:
        from models import Resource, User
        from database import SessionLocal
        from .cache_service import save_to_cache

        db = SessionLocal()
        try:
            user = db.query(User).filter(User.id == user_id).first()
            storage_root = user.storage_root if user else None
            available_resource_ids = [
                row[0]
                for row in db.query(Resource.id).filter(
                    Resource.user_id == user_id,
                    Resource.is_deleted == 0,
                ).all()
            ]

            # 1. Query Rewrite (for cache key)
            retrieval_agent = RetrievalAgent()
            rewritten_question = question
            if chat_history and len(chat_history) > 0:
                rewritten_question = retrieval_agent.execute_tool(
                    "query_rewrite",
                    question,
                    chat_history,
                    user_id=user_id,
                    resource_id=resource_id,
                    feature="query_rewrite",
                )

            # 2. Cache check BEFORE retrieval
            cached = retrieval_agent.execute_tool(
                "semantic_cache",
                db,
                resource_id,
                rewritten_question,
                user_id=user_id,
            )
            workflow = retrieval_agent.create_workflow(
                rewritten_question,
                has_chat_history=bool(chat_history),
                cache_candidate_present=cached is not None,
                streaming=True,
                user_id=user_id,
                resource_id=resource_id,
            )
            plan = workflow.initial_plan
            if retrieval_agent.should_accept_cache(workflow, cached, user_id=user_id, resource_id=resource_id):
                yield {"type": "metadata", "rewritten_question": rewritten_question}
                # Stream cached answer in chunks
                chunk_size = 40
                for i in range(0, len(cached["answer"]), chunk_size):
                    yield {"type": "token", "content": cached["answer"][i:i+chunk_size]}
                yield {
                    "type": "final",
                    "answer": cached["answer"],
                    "sources": cached["sources"],
                    "hallucinations": [],
                    "confidence": cached["confidence"],
                    "confidence_label": "cached"
                }
                if log_planner_execution:
                    log_planner_execution(
                        rewritten_question, plan.model_dump(mode="json"),
                        (perf_counter() - pipeline_started) * 1000,
                        plan.retrieval_mode.value, ["semantic_cache"],
                        ["retrieval", "multi_query", "rerank", "context_compression", "hallucination_check"],
                        plan.reasoning, cached["confidence"], True, user_id, resource_id,
                    )
                if log_query:
                    try:
                        log_retrieval_stats(
                            query=question,
                            chunks_before_rerank=0,
                            chunks_after_rerank=len(cached.get("sources", []) if isinstance(cached, dict) else []),
                            hybrid_scores=[],
                            rerank_scores=[],
                            cache_hit=True,
                            resource_id=resource_id or "",
                            user_id=user_id or "",
                        )
                        log_query(
                            query=question,
                            latency_ms=(perf_counter() - pipeline_started) * 1000,
                            cache_hit=True,
                            chunks_retrieved=len(cached.get("sources", []) if isinstance(cached, dict) else []),
                            avg_rerank_score=0.0,
                            top_rerank_score=0.0,
                            hallucination_count=0,
                            confidence_score=cached.get("confidence", 0.0),
                            confidence_label="cached",
                            complexity_level=plan.query_classification.value,
                            resource_id=resource_id or "",
                            user_id=user_id or "",
                        )
                    except Exception:
                        pass
                return
        finally:
            db.close()

        # 4. Full retrieval pipeline
        context, reranked_results, rewritten_question, execution_report = prepare_rag_context(
            question=rewritten_question,
            user_id=user_id,
            resource_id=resource_id,
            chat_history=None,
            n_results=n_results,
            storage_root=storage_root,
            plan=plan,
            available_resource_ids=available_resource_ids,
            agent=retrieval_agent,
            workflow=workflow,
        )
        execution_report.modules_skipped.append("semantic_cache")
        agent_execution = retrieval_agent.last_result
        if agent_execution is None:
            raise RuntimeError("Retrieval agent did not produce execution state")
        agent_memory = agent_execution.memory

        yield {
            "type": "metadata",
            "rewritten_question": rewritten_question,
            "context": context
        }

        buffer = ""
        THRESHOLD = 30

        answer_stream = retrieval_agent.execute_workflow_node(
            workflow, agent_memory, "answer",
            question, context, final_history_str,
            input_fingerprint=rewritten_question,
            globe_on=globe_on,
            user_id=user_id,
            resource_id=resource_id,
            feature="media_rag_answer_stream" if resource_id else "global_rag_answer_stream",
        )
        for token in answer_stream:
            full_answer += token
            buffer += token

            if len(buffer) >= THRESHOLD or re.search(r'[.!?](\s|$)', buffer):
                yield {"type": "token", "content": buffer}
                buffer = ""

        execution_report.modules_executed.append("answer_generation")

        if buffer:
            yield {"type": "token", "content": buffer}
        full_answer = enforce_inline_chunk_citations(full_answer, reranked_results)
        agent_memory.tool_outputs["answer"] = full_answer

        provisional_sources = _build_provisional_sources(reranked_results)

        if provisional_sources:
            yield {
                "type": "sources",
                "answer": full_answer,
                "sources": provisional_sources,
            }

        # 5. Post-generation (parallel when hallucination enabled)
        context_chunks = [res["content"] for res in reranked_results]

        if plan.hallucination_check:
            from concurrent.futures import ThreadPoolExecutor

            with ThreadPoolExecutor(max_workers=2) as pool:
                future_sources = pool.submit(
                    retrieval_agent.execute_workflow_node,
                    workflow,
                    agent_memory,
                    "sources",
                    reranked_results,
                    full_answer,
                )
                future_halluc = pool.submit(
                    retrieval_agent.execute_workflow_node,
                    workflow,
                    agent_memory,
                    "hallucination",
                    context_chunks,
                    question,
                    full_answer,
                    user_id=user_id,
                    resource_id=resource_id,
                    feature="hallucination_detection",
                )
                sources = future_sources.result()
                yield {
                    "type": "sources",
                    "answer": full_answer,
                    "sources": sources,
                }
                hallucinations = future_halluc.result()
        else:
            sources = retrieval_agent.execute_workflow_node(
                workflow, agent_memory, "sources", reranked_results, full_answer,
                input_fingerprint=str(len(reranked_results)),
            )
            yield {
                "type": "sources",
                "answer": full_answer,
                "sources": sources,
            }
            hallucinations = []
            agent_memory.skipped_steps.add("hallucination")

        if plan.hallucination_check:
            execution_report.modules_executed.append("hallucination_check")
        else:
            execution_report.modules_skipped.append("hallucination_check")

        confidence, confidence_label = retrieval_agent.execute_workflow_node(
            workflow, agent_memory, "confidence",
            reranked_results, hallucinations,
            input_fingerprint=str(len(reranked_results)),
        )
        retrieval_agent.finalize_workflow(confidence)
        execution_report.modules_executed.append("confidence_score")
        latency_ms = (perf_counter() - pipeline_started) * 1000
        log_user_activity(db, user_id, 'ai_chat', 'RAG complete', f'Confidence: {confidence:.2f} ({confidence_label}), {len(hallucinations)} hallucinations, {latency_ms:.0f}ms')

        yield {
            "type": "final",
            "answer": full_answer,
            "sources": sources,
            "hallucinations": hallucinations,
            "confidence": confidence,
            "confidence_label": confidence_label,
            "retrieval_strategy": execution_report.retrieval_strategy.value if execution_report.retrieval_strategy else None,
            "processing_time_ms": (perf_counter() - pipeline_started) * 1000,
            "modules_executed": execution_report.modules_executed,
            "reasoning": plan.reasoning,
        }

        # 6. Save to cache
        try:
            with SessionLocal() as cache_db:
                save_to_cache(
                    cache_db,
                    resource_id,
                    rewritten_question,
                    full_answer,
                    sources,
                    confidence,
                    user_id=user_id,
                )
        except Exception:
            pass

        if log_planner_execution:
            log_planner_execution(
                rewritten_question, plan.model_dump(mode="json"),
                (perf_counter() - pipeline_started) * 1000,
                plan.retrieval_mode.value,
                execution_report.modules_executed,
                execution_report.modules_skipped,
                plan.reasoning, confidence, False, user_id, resource_id,
            )

        if log_query:
            try:
                log_retrieval_stats(
                    query=question,
                    chunks_before_rerank=0,
                    chunks_after_rerank=len(reranked_results),
                    hybrid_scores=[r.get("hybrid_score", 0) for r in reranked_results],
                    rerank_scores=[r.get("rerank_score", 0) for r in reranked_results],
                    cache_hit=False,
                    resource_id=resource_id or "",
                    user_id=user_id or "",
                )
                log_query(
                    query=question,
                    latency_ms=(perf_counter() - pipeline_started) * 1000,
                    cache_hit=False,
                    chunks_retrieved=len(reranked_results),
                    avg_rerank_score=sum(r.get("rerank_score", 0) for r in reranked_results) / max(len(reranked_results), 1),
                    top_rerank_score=reranked_results[0].get("rerank_score", 0) if reranked_results else 0,
                    hallucination_count=len(hallucinations),
                    confidence_score=confidence,
                    confidence_label=confidence_label,
                    complexity_level=plan.query_classification.value,
                    resource_id=resource_id or "",
                    user_id=user_id or "",
                )
            except Exception:
                pass

    except Exception as e:
        yield {"type": "error", "message": str(e)}
    finally:
        yield {"type": "done"}
