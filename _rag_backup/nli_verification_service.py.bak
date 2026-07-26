"""NLI-based hallucination verification using cross-encoder entailment models."""

from __future__ import annotations

import contextlib
import os
import re

from core.logger import get_logger

logger = get_logger("NLI_VERIFICATION")

NLI_MODEL = os.getenv("NLI_MODEL", "cross-encoder/nli-deberta-v3-base")

_nli_model = None
_nli_model_failed = False


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

    context_str = "\n\n".join(context_chunks)
    hallucinations = []

    try:
        # Build (premise, hypothesis) pairs for batch inference
        pairs = [(context_str, claim) for claim in claims]
        scores = model.predict(pairs)

        # NLI model outputs: [contradiction, entailment, neutral]
        # For cross-encoder/nli-deberta-v3-base, scores are logits
        import numpy as np

        for i, claim in enumerate(claims):
            logits = scores[i] if hasattr(scores[i], '__len__') else [scores[i]]
            probs = _softmax(logits)

            # Index 0 = contradiction, 1 = entailment, 2 = neutral
            contradiction_score = float(probs[0]) if len(probs) > 0 else 0.0
            entailment_score = float(probs[1]) if len(probs) > 1 else 0.0

            if contradiction_score > contradiction_threshold:
                hallucinations.append({
                    "text": claim,
                    "confidence": round(contradiction_score, 3),
                })
            elif entailment_score < 0.3 and contradiction_score < 0.3:
                # Low entailment + low contradiction = likely unsupported
                unsupported_score = 1.0 - entailment_score
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
    import math
    if not hasattr(logits, '__len__'):
        return [1.0]
    max_logit = max(logits)
    exp_values = [math.exp(x - max_logit) for x in logits]
    total = sum(exp_values)
    if total == 0:
        return [1.0 / len(logits)] * len(logits)
    return [v / total for v in exp_values]
