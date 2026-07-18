"""HyDE (Hypothetical Document Embeddings) query expansion.

Generates a hypothetical answer to the query, then uses it as the search
query. The generated answer is closer in embedding space to actual document
chunks, improving retrieval recall.
"""

from __future__ import annotations

from core.logger import get_logger
from .ai_cost_service import record_chat_completion_usage

logger = get_logger("HYDE")


def generate_hypothetical_answer(
    question: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "hyde_query_expansion",
) -> str:
    """Generate a hypothetical answer to use as an enhanced search query.

    Returns the hypothetical answer text, or empty string on failure.
    """
    if not question.strip():
        return ""

    try:
        from .llm_service import get_user_chat_client

        prompt = f"""Write a short, factual answer to the following question as if you were writing a textbook entry. Be concise (2-4 sentences). Do not cite sources. Do not use phrases like "Based on the context" — just state facts directly.

Question: {question}

Answer:"""
        _client, _model = get_user_chat_client(user_id)
        response = _client.chat.completions.create(
            model=_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=150,
        )
        hypothetical = response.choices[0].message.content.strip()
        record_chat_completion_usage(
            response=response,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
            operation="hyde_generation",
            model=_model,
            prompt_text=prompt,
            completion_text=hypothetical,
        )

        # Guard against empty or overly long output
        if not hypothetical or len(hypothetical) > 800:
            logger.warning(f"HyDE output rejected (len={len(hypothetical)}); using original query.")
            return ""

        logger.info(f"HyDE generated hypothetical answer ({len(hypothetical)} chars)")
        return hypothetical

    except Exception as e:
        logger.warning(f"HyDE generation failed ({e}); using original query.")
        return ""
