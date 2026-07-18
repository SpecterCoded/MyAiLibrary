from rank_bm25 import BM25Okapi
import re
import time
import os
from database import SessionLocal
from models import ChunkIndex


# Opt-in stemming and stopwords via env vars (default: off)
_USE_STEMMING = os.getenv("BM25_STEMMING", "0") in ("1", "true", "yes")
_USE_STOPWORDS = os.getenv("BM25_STOPWORDS", "0") in ("1", "true", "yes")

_stemmer = None
_stopwords = set()

if _USE_STEMMING:
    try:
        from nltk.stem import PorterStemmer
        _stemmer = PorterStemmer()
    except ImportError:
        _USE_STEMMING = False

if _USE_STOPWORDS:
    try:
        from nltk.corpus import stopwords as _sw
        _stopwords = set(_sw.words("english"))
    except ImportError:
        _USE_STOPWORDS = False


def _tokenize(text):
    tokens = re.findall(r"\b\w+\b", text.lower())
    if _USE_STOPWORDS and _stopwords:
        tokens = [t for t in tokens if t not in _stopwords]
    if _USE_STEMMING and _stemmer:
        tokens = [_stemmer.stem(t) for t in tokens]
    return tokens


# In-memory BM25 cache: {resource_id: {"bm25": BM25Okapi, "chunks": list, "tokenized_corpus": list, "timestamp": float}}
_bm25_cache: dict[str, dict] = {}
CACHE_TTL = 300  # 5 minutes
MAX_CACHE_SIZE = 50

def _evict_oldest_if_needed():
    if len(_bm25_cache) >= MAX_CACHE_SIZE:
        oldest_key = min(_bm25_cache.keys(), key=lambda k: _bm25_cache[k]["timestamp"])
        del _bm25_cache[oldest_key]


def _build_bm25(resource_id: str):
    """Load chunks from SQL and build a BM25 index for a resource."""
    db = SessionLocal()
    try:
        chunks = (
            db.query(ChunkIndex)
            .filter(ChunkIndex.resource_id == resource_id)
            .order_by(ChunkIndex.chunk_index)
            .all()
        )
        if not chunks:
            return None, [], []

        corpus = [c.content for c in chunks]
        tokenized_corpus = [_tokenize(doc) for doc in corpus]
        bm25 = BM25Okapi(tokenized_corpus)
        return bm25, chunks, tokenized_corpus
    finally:
        db.close()


def _get_bm25(resource_id: str):
    """Get BM25 index from cache or build it."""
    cached = _bm25_cache.get(resource_id)
    if cached and (time.time() - cached["timestamp"]) < CACHE_TTL:
        cached["timestamp"] = time.time()  # Update access time
        return cached["bm25"], cached["chunks"], cached["tokenized_corpus"]

    bm25, chunks, tokenized_corpus = _build_bm25(resource_id)
    if bm25 is not None:
        _evict_oldest_if_needed()
        _bm25_cache[resource_id] = {
            "bm25": bm25,
            "chunks": chunks,
            "tokenized_corpus": tokenized_corpus,
            "timestamp": time.time()
        }
    return bm25, chunks, tokenized_corpus


def invalidate_bm25_cache(resource_id: str = None):
    """Invalidate cached BM25 index. Call after chunk add/delete."""
    if resource_id:
        _bm25_cache.pop(resource_id, None)
    else:
        _bm25_cache.clear()


def search_global_bm25(
    resource_ids: list[str],
    query: str,
    top_k: int = 20,
):
    """BM25 search across multiple resources. Returns results tagged with resource_id."""
    if not resource_ids:
        return []

    # Collect chunks from all resources (using cached BM25 where possible)
    all_chunks = []
    combined_tokenized_corpus = []
    for rid in resource_ids:
        bm25, chunks, tokenized_corpus = _get_bm25(rid)
        if chunks:
            all_chunks.extend(chunks)
            combined_tokenized_corpus.extend(tokenized_corpus)

    if not all_chunks:
        return []

    # Build combined corpus
    bm25 = BM25Okapi(combined_tokenized_corpus)

    tokenized_query = _tokenize(query)
    scores = bm25.get_scores(tokenized_query)

    results = []
    for i, score in enumerate(scores):
        results.append({
            "resource_id": all_chunks[i].resource_id,
            "chunk_index": all_chunks[i].chunk_index,
            "content": all_chunks[i].content,
            "score": float(score),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


def search_resource_bm25(
    resource_id: str,
    query: str,
    top_k: int = 20,
):
    bm25, chunks, _ = _get_bm25(resource_id)
    if not chunks:
        return []

    tokenized_query = _tokenize(query)
    scores = bm25.get_scores(tokenized_query)

    results = []
    for i, score in enumerate(scores):
        results.append({
            "chunk_index": chunks[i].chunk_index,
            "content": chunks[i].content,
            "score": float(score)
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]
