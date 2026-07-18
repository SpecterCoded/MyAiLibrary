from services.retrieval_service import search_resource
from .bm25_service import search_resource_bm25
from core.activity_log import log_user_activity


def search_resource_hybrid(
    resource_id: str,
    query: str,
    user_id: str,
    top_k: int = 20,
    storage_root: str | None = None,
    rrf_k: int = 60,
):
    # Step 1-2: Run Chroma + BM25 in parallel (independent calls)
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_chroma = pool.submit(search_resource, resource_id, query, user_id=user_id, n_results=top_k, storage_root=storage_root)
        future_bm25 = pool.submit(search_resource_bm25, resource_id, query, top_k=top_k)
        chroma_results = future_chroma.result()
        bm25_results = future_bm25.result()

    # Map results by chunk_index
    merged_results = {}

    # Process Chroma results
    for i in range(len(chroma_results["documents"])):
        chunk_idx = chroma_results["metadatas"][i]["chunk_index"]
        distance = chroma_results["distances"][i]

        merged_results[chunk_idx] = {
            "chunk_index": chunk_idx,
            "content": chroma_results["documents"][i],
            "metadata": chroma_results["metadatas"][i],
            "chroma_distance": distance,
            "bm25_score": 0.0,
        }

    # Process BM25 results
    for bm25_res in bm25_results:
        chunk_idx = bm25_res["chunk_index"]
        score = bm25_res["score"]

        if chunk_idx in merged_results:
            merged_results[chunk_idx]["bm25_score"] = score
        else:
            merged_results[chunk_idx] = {
                "chunk_index": chunk_idx,
                "content": bm25_res["content"],
                "metadata": {"resource_id": resource_id, "chunk_index": chunk_idx},
                "chroma_distance": None,
                "bm25_score": score,
            }

    # Sort each signal independently to get rank positions for RRF
    # RRF formula: score(d) = Σ 1 / (k + rank(d))  — scale-invariant across signals

    chroma_ranked = sorted(
        [r for r in merged_results.values() if r["chroma_distance"] is not None],
        key=lambda r: r["chroma_distance"],  # lower distance = better
    )
    bm25_ranked = sorted(
        [r for r in merged_results.values() if r["bm25_score"] > 0],
        key=lambda r: r["bm25_score"],
        reverse=True,
    )

    chroma_rank = {r["chunk_index"]: i for i, r in enumerate(chroma_ranked)}
    bm25_rank = {r["chunk_index"]: i for i, r in enumerate(bm25_ranked)}

    final_results = []
    for res in merged_results.values():
        rrf_score = 0.0
        if res["chunk_index"] in chroma_rank:
            rrf_score += 1.0 / (rrf_k + chroma_rank[res["chunk_index"]])
        if res["chunk_index"] in bm25_rank:
            rrf_score += 1.0 / (rrf_k + bm25_rank[res["chunk_index"]])

        final_results.append(
            {
                "chunk_index": res["chunk_index"],
                "content": res["content"],
                "metadata": res["metadata"],
                "hybrid_score": rrf_score,
            }
        )

    # Step 5: Sort descending by hybrid_score
    final_results.sort(key=lambda x: x["hybrid_score"], reverse=True)

    # Log hybrid search results
    try:
        from database import SessionLocal
        _db = SessionLocal()
        log_user_activity(_db, user_id, 'ai_chat', 'Hybrid search', f'{len(final_results[:top_k])} chunks (Chroma + BM25 RRF)')
        _db.close()
    except Exception:
        pass

    # Step 6: Return top 20
    return final_results[:top_k]
