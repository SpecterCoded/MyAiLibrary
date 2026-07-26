"""NLI-based hallucination verification using cross-encoder entailment models."""

from __future__ import annotations

import contextlib
import math
import os
import re

from core.logger import get_logger

logger = get_logger("NLI_VERIFICATION")

NLI_MODEL = os.getenv("NLI_MODEL", "cross-encoder/nli-deberta-v3-base")

# Cap how many context chunks each claim is checked against, to bound compute.
MAX_CHUNKS_PER_CLAIM = int(os.getenv("NLI_MAX_CHUNKS_PER_CLAIM", "8"))

_nli_model = None
_nli_model_failed = False
_label_idx: tuple[int, int] | None = None  # (contradiction_index, entailment_index)


def _get_nli_model():
    """Lazy-load the NLI cross-encoder model."""
    global _nli_model, _nli_model_failed
    if _nli_model is not None:
        return _nli_model
    if _nli_model_failed:
        return None
    try:
        from sentence_transformers import CrossEncoder
        with open(os.devnull, "w") as devnull:
            with contextlib.redirect_stderr(devnull), contextlib.redirect_stdout(devnull):
                _nli_model = CrossEncoder(NLI_MODEL)
        logger.info(f"Loaded NLI model: {NLI_MODEL}")
        return _nli_model
    except Exception as e:
        logger.warning(f"Failed to load NLI model ({e}); NLI verification unavailable.")
        _nli_model_failed = True
        return None


def _resolve_label_indices(model) -> tuple[int, int]:
    """Find which output index means 'contradiction' vs 'entailment' for this model.

    Different NLI checkpoints order their labels differently. Assuming a fixed
    [contradiction, entailment, neutral] order (as the old code did) can silently
    invert the result. Here we read the model's own id2label map and match by name,
    falling back to the common (0=contradiction, 1=entailment) order only if unknown.
    """
    global _label_idx
    if _label_idx is not None:
        return _label_idx
    id2label = None
    for obj in (model, getattr(model, "model", None), getattr(model, "config", None)):
        cfg = getattr(obj, "config", obj)
        candidate = getattr(cfg, "id2label", None)
        if candidate:
            id2label = candidate
            break
    contradiction_idx, entailment_idx = 0, 1
    if id2label:
        try:
            lookup = {int(k): str(v).lower() for k, v in id2label.items()}
            for idx, name in lookup.items():
                if "contradict" in name:
                    contradiction_idx = idx
                elif "entail" in name:
                    entailment_idx = idx
        except Exception:
            pass
    _label_idx = (contradiction_idx, entailment_idx)
    logger.info(f"NLI label indices -> contradiction={contradiction_idx}, entailment={entailment_idx}")
    return _label_idx


def _split_into_claims(answer: str) -> list[str]:
    """Split an answer into individual claims (sentences)."""
    claims = re.split(r'(?<=[.!?])\s+', answer.strip())
    return [c.strip() for c in claims if c.strip() and len(c.strip()) > 10]


def verify_claims(
    answer: str,
    context_chunks: list[str],
    contradiction_threshold: float = 0.5,
) -> list[dict]:
    """Verify each claim in the answer against context using NLI.

    Each claim is checked against each context chunk SEPARATELY (not one giant
    concatenated premise), so support that sits in a later chunk isn't lost to the
    model's ~512-token input limit. A claim counts as supported if any chunk entails
    it; it's flagged only if no chunk supports it (and, ideally, one contradicts it).

    Returns a list of hallucination dicts with 'text' and 'confidence' keys,
    matching the output format of the existing hallucination providers.
    """
    if not answer.strip() or not context_chunks:
        return []

    model = _get_nli_model()
    if model is None:
        return []

    claims = _split_into_claims(answer)
    if not claims:
        return []

    chunks = [c for c in context_chunks if c and c.strip()][:MAX_CHUNKS_PER_CLAIM]
    if not chunks:
        return []

    contradiction_idx, entailment_idx = _resolve_label_indices(model)
    hallucinations = []

    try:
        # One (chunk, claim) pair per chunk, per claim — batched in a single predict.
        pairs = []
        for claim in claims:
            for chunk in chunks:
                pairs.append((chunk, claim))
        scores = model.predict(pairs)

        per_claim = len(chunks)
        for ci, claim in enumerate(claims):
            best_entailment = 0.0
            best_contradiction = 0.0
            for j in range(per_claim):
                logits = scores[ci * per_claim + j]
                logits = logits if hasattr(logits, "__len__") else [logits]
                probs = _softmax(logits)
                ent = float(probs[entailment_idx]) if len(probs) > entailment_idx else 0.0
                con = float(probs[contradiction_idx]) if len(probs) > contradiction_idx else 0.0
                best_entailment = max(best_entailment, ent)
                best_contradiction = max(best_contradiction, con)

            # Supported by at least one chunk -> not a hallucination.
            if best_entailment >= 0.5:
                continue
            # Actively contradicted by some chunk -> flag.
            if best_contradiction > contradiction_threshold:
                hallucinations.append({
                    "text": claim,
                    "confidence": round(best_contradiction, 3),
                })
            # Nothing supports it at all -> flag as unsupported (softer confidence).
            elif best_entailment < 0.3:
                unsupported_score = 1.0 - best_entailment
                if unsupported_score > 0.6:
                    hallucinations.append({
                        "text": claim,
                        "confidence": round(unsupported_score * 0.7, 3),
                    })

        logger.info(f"NLI verification: {len(hallucinations)} hallucinations detected from {len(claims)} claims")
        return hallucinations

    except Exception as e:
        logger.error(f"NLI verification failed: {e}")
        return []


def _softmax(logits) -> list[float]:
    """Compute softmax over logits."""
    if not hasattr(logits, '__len__'):
        return [1.0]
    max_logit = max(logits)
    exp_values = [math.exp(x - max_logit) for x in logits]
    total = sum(exp_values)
    if total == 0:
        return [1.0 / len(logits)] * len(logits)
    return [v / total for v in exp_values]
