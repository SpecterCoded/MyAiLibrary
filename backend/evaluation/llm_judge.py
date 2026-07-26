"""LLM-as-judge scoring for the evaluation framework.

The default answer-quality metrics in ``metrics.py`` are fast lexical (token-overlap)
heuristics. They are cheap and deterministic, but they cannot tell a factually wrong
answer that reuses the source's vocabulary from a correct one. This module adds an
optional, model-based judge that actually reads the answer and rates it.

It is fully optional and OFF by default: the judge only runs when
``BenchmarkConfig.use_llm_judge`` is true and a ``judge_user_id`` is configured
(so it can resolve that user's chat model). Every call is fail-soft — on any error it
returns ``None`` and the caller falls back to the lexical metric, so enabling the judge
can never crash an evaluation run.

Like the rest of ``evaluation/``, this module is observational only and is never
imported by the production retrieval/answer path.
"""

from __future__ import annotations

from core.logger import get_logger

logger = get_logger("EVAL_JUDGE")

# Keep prompts bounded so a huge context/answer can't blow up the judge call.
_MAX_CONTEXT_CHARS = 8000
_MAX_ANSWER_CHARS = 4000


def _clamp(value, lo: float = 0.0, hi: float = 1.0) -> float:
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _chat(user_id: str, prompt: str) -> str | None:
    """Call the user's configured chat model and return raw text, or None on failure."""
    try:
        from services.llm_service import get_user_chat_client

        client, model = get_user_chat_client(user_id)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content
    except Exception as e:  # noqa: BLE001 - judge must never break a run
        logger.warning(f"LLM judge call failed: {e}")
        return None


def _parse_json(text: str | None) -> dict | None:
    if not text:
        return None
    try:
        from services.llm_service import parse_json_robustly

        parsed = parse_json_robustly(text)
    except Exception:
        import json

        cleaned = text.strip()
        if cleaned.startswith("```"):
            cleaned = "\n".join(cleaned.split("\n")[1:-1]).strip()
        try:
            parsed = json.loads(cleaned)
        except Exception:
            return None
    return parsed if isinstance(parsed, dict) else None


def judge_faithfulness(question: str, answer: str, context: str, user_id: str) -> dict | None:
    """Rate how well the answer is supported by the retrieved context (0..1).

    Returns ``{"score": float, "reasoning": str}`` or ``None`` on failure.
    A high score means every claim in the answer is grounded in the context; a low
    score means the answer contains unsupported or contradicted claims.
    """
    if not answer.strip() or not context.strip():
        return None
    prompt = (
        "You are a strict RAG faithfulness judge. Decide how well the ANSWER is "
        "supported by the CONTEXT only (ignore whether it sounds correct in general).\n\n"
        f"QUESTION:\n{question}\n\n"
        f"CONTEXT:\n{context[:_MAX_CONTEXT_CHARS]}\n\n"
        f"ANSWER:\n{answer[:_MAX_ANSWER_CHARS]}\n\n"
        "Score from 0.0 to 1.0 where 1.0 = every claim is directly supported by the "
        "context, and 0.0 = the answer is unsupported by or contradicts the context. "
        'Return ONLY JSON: {"score": <0..1>, "reasoning": "<one sentence>"}'
    )
    parsed = _parse_json(_chat(user_id, prompt))
    if not parsed or "score" not in parsed:
        return None
    return {"score": _clamp(parsed.get("score")), "reasoning": str(parsed.get("reasoning", ""))[:300]}


def judge_answer_relevance(question: str, answer: str, user_id: str) -> dict | None:
    """Rate how directly the answer addresses the question (0..1).

    Independent of the context: a grounded answer that ignores the question should
    still score low here. Returns ``{"score", "reasoning"}`` or ``None``.
    """
    if not answer.strip() or not question.strip():
        return None
    prompt = (
        "You are judging answer relevance. Decide how directly the ANSWER addresses "
        "the QUESTION (not whether it is factually correct).\n\n"
        f"QUESTION:\n{question}\n\n"
        f"ANSWER:\n{answer[:_MAX_ANSWER_CHARS]}\n\n"
        "Score from 0.0 to 1.0 where 1.0 = fully and directly answers the question, "
        "0.0 = does not address it (e.g. off-topic or 'I don't know'). "
        'Return ONLY JSON: {"score": <0..1>, "reasoning": "<one sentence>"}'
    )
    parsed = _parse_json(_chat(user_id, prompt))
    if not parsed or "score" not in parsed:
        return None
    return {"score": _clamp(parsed.get("score")), "reasoning": str(parsed.get("reasoning", ""))[:300]}


def judge_sample(question: str, answer: str, context: str, user_id: str | None) -> dict | None:
    """Run the full judge for one sample.

    Returns ``{"faithfulness": float|None, "answer_relevance": float|None,
    "reasoning": str}`` or ``None`` if judging could not run at all (no user_id, or
    both sub-judges failed).
    """
    if not user_id:
        return None
    faith = judge_faithfulness(question, answer, context, user_id)
    relevance = judge_answer_relevance(question, answer, user_id)
    if faith is None and relevance is None:
        return None
    reasoning_parts = []
    if faith and faith.get("reasoning"):
        reasoning_parts.append(f"faithfulness: {faith['reasoning']}")
    if relevance and relevance.get("reasoning"):
        reasoning_parts.append(f"relevance: {relevance['reasoning']}")
    return {
        "faithfulness": faith["score"] if faith else None,
        "answer_relevance": relevance["score"] if relevance else None,
        "reasoning": " | ".join(reasoning_parts),
    }
