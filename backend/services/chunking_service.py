import contextlib
import os

from .sentence_segmentation_service import split_into_sentences
from core.config import ENABLE_CHUNK_OVERLAP, CHUNK_OVERLAP_CHARS

from core.logger import get_logger
logger = get_logger("CHUNKING")

# Similarity threshold below which two consecutive sentences are considered a topic
# boundary. Lower = fewer, larger chunks; higher = more, smaller chunks.
SEMANTIC_SIMILARITY_THRESHOLD = float(os.getenv("CHUNK_SIMILARITY_THRESHOLD", "0.45"))
# Don't cut a chunk until it has at least this many characters, so a single
# off-topic sentence doesn't fragment the text.
MIN_CHUNK_CHARS = 200

# Lazy-loaded local model used ONLY for boundary detection (never the paid API).
_boundary_model = None
_boundary_model_failed = False


def _get_boundary_model():
    """Load a small local sentence embedding model for boundary detection.
    Returns None if unavailable — caller falls back to size-based chunking."""
    global _boundary_model, _boundary_model_failed
    if _boundary_model is not None:
        return _boundary_model
    if _boundary_model_failed:
        return None
    try:
        from sentence_transformers import SentenceTransformer
        with open(os.devnull, "w") as devnull:
            with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                _boundary_model = SentenceTransformer("all-MiniLM-L6-v2")
        return _boundary_model
    except Exception as e:
        logger.warning(f"Semantic boundary model unavailable ({e}); using size-based chunking.")
        _boundary_model_failed = True
        return None


def _size_based_chunk(sentences: list[str], target_chunk_size: int) -> list[str]:
    """Original size-accumulation chunker. Used as the guaranteed fallback."""
    chunks = []
    current_chunk = ""
    for sentence in sentences:
        candidate = current_chunk + " " + sentence
        if len(candidate) <= target_chunk_size:
            current_chunk = candidate
        else:
            if current_chunk.strip():
                chunks.append(current_chunk.strip())
                # Add overlap from end of previous chunk to preserve context
                if ENABLE_CHUNK_OVERLAP and current_chunk.strip():
                    overlap_text = current_chunk.strip()[-CHUNK_OVERLAP_CHARS:]
                    if overlap_text and not overlap_text.startswith(" "):
                        overlap_text = " " + overlap_text
                    current_chunk = (overlap_text + " " + sentence).strip()
                else:
                    current_chunk = sentence
            else:
                current_chunk = sentence
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
    return chunks


def semantic_chunk_text(
    text: str,
    target_chunk_size: int = 1000,
):
    """Split text into chunks at semantic topic boundaries.

    Sentences are embedded with a local model; when the cosine similarity between
    consecutive sentences drops below a threshold (a topic shift), a new chunk
    starts — provided the current chunk has reached MIN_CHUNK_CHARS. A hard
    target_chunk_size cap still applies so chunks never grow unbounded.

    Falls back to pure size-based chunking if the embedding model is unavailable
    or anything goes wrong, so ingestion never breaks.
    """
    sentences = split_into_sentences(text)
    if not sentences:
        return []

    model = _get_boundary_model()
    if model is None or len(sentences) < 3:
        chunks = _size_based_chunk(sentences, target_chunk_size)
        logger.info(f"Chunks created (size-based): {len(chunks)}")
        return chunks

    try:
        import numpy as np

        embeddings = model.encode(sentences, show_progress_bar=False)

        def cosine(a, b):
            denom = (np.linalg.norm(a) * np.linalg.norm(b))
            if denom == 0:
                return 0.0
            return float(np.dot(a, b) / denom)

        chunks = []
        current = sentences[0]
        window_size = 2
        for i in range(1, len(sentences)):
            prev_start = max(0, i - window_size)
            next_end = min(len(sentences), i + window_size)

            prev_emb = np.mean(embeddings[prev_start:i], axis=0)
            next_emb = np.mean(embeddings[i:next_end], axis=0)

            sim = cosine(prev_emb, next_emb)
            would_exceed = len(current) + len(sentences[i]) + 1 > target_chunk_size
            topic_shift = sim < SEMANTIC_SIMILARITY_THRESHOLD and len(current) >= MIN_CHUNK_CHARS

            if would_exceed or topic_shift:
                chunks.append(current.strip())
                # Add overlap from end of previous chunk to preserve context
                if ENABLE_CHUNK_OVERLAP and current.strip():
                    overlap_text = current.strip()[-CHUNK_OVERLAP_CHARS:]
                    if overlap_text and not overlap_text.startswith(" "):
                        overlap_text = " " + overlap_text
                    current = (overlap_text + " " + sentences[i]).strip()
                else:
                    current = sentences[i]
            else:
                current = f"{current} {sentences[i]}"

        if current.strip():
            chunks.append(current.strip())

        logger.info(f"Chunks created (semantic): {len(chunks)} from {len(sentences)} sentences")
        return chunks
    except Exception as e:
        logger.warning(f"Semantic chunking failed ({e}); falling back to size-based.")
        chunks = _size_based_chunk(sentences, target_chunk_size)
        logger.info(f"Chunks created (size-based fallback): {len(chunks)}")
        return chunks
