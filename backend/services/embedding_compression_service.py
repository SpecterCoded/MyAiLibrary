"""Embedding-based context compression.

Replaces LLM-based compression with embedding similarity scoring.
Faster, cheaper, and nearly as accurate.
"""

from __future__ import annotations

from core.logger import get_logger

logger = get_logger("EMBEDDING_COMPRESSION")


def compress_by_embedding(
    query: str,
    chunks: list[str],
    max_chunks: int = 5,
) -> list[str]:
    """Select the most relevant chunks using embedding similarity.

    Returns the top max_chunks chunks most similar to the query.
    Zero LLM calls, runs in milliseconds.
    """
    if not chunks or len(chunks) <= max_chunks:
        return chunks

    try:
        from embedding_service import embed_text
        import math

        query_embedding = embed_text(query, feature="compression_query_embedding")

        scored: list[tuple[float, int]] = []
        for i, chunk in enumerate(chunks):
            chunk_embedding = embed_text(chunk, feature="compression_chunk_embedding")
            similarity = _cosine_similarity(query_embedding, chunk_embedding)
            scored.append((similarity, i))

        # Sort by similarity descending
        scored.sort(key=lambda x: x[0], reverse=True)

        # Return top chunks in original order
        top_indices = sorted([idx for _, idx in scored[:max_chunks]])
        return [chunks[i] for i in top_indices]

    except Exception as e:
        logger.warning(f"Embedding compression failed ({e}); returning first {max_chunks} chunks.")
        return chunks[:max_chunks]


def _cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if len(v1) != len(v2):
        return 0.0
    dot_product = sum(a * b for a, b in zip(v1, v2))
    norm_a = math.sqrt(sum(a * a for a in v1))
    norm_b = math.sqrt(sum(b * b for b in v2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)
