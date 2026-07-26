from .llm_service import get_user_chat_client
from .ai_cost_service import record_chat_completion_usage
from core.config import EMBEDDING_COMPRESSION


def compress_context(
    question: str,
    context_chunks: list[str],
    max_chunks: int = 5,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "context_compression",
) -> list[str]:
    """Filter out irrelevant chunks before sending to the LLM.

    Uses embedding similarity or LLM to score each chunk's relevance,
    then returns only the top max_chunks most relevant ones.
    """
    if len(context_chunks) <= max_chunks:
        return context_chunks

    # Fast path: embedding-based compression (no LLM call)
    if EMBEDDING_COMPRESSION:
        from services.embedding_compression_service import compress_by_embedding
        return compress_by_embedding(question, context_chunks, max_chunks)

    # LLM-based compression (default)

    chunks_text = ""
    for i, chunk in enumerate(context_chunks):
        chunks_text += f"[{i}]: {chunk[:300]}...\n\n"

    prompt = f"""
You are a relevance scorer. Given a question and numbered context chunks, return ONLY a JSON list of the {max_chunks} most relevant chunk numbers.

Rules:
- Return ONLY a JSON list of integers (e.g., [0, 3, 5, 7, 9])
- Select the {max_chunks} chunks most relevant to answering the question
- Order by relevance (most relevant first)
- Do not explain

Question: {question}

Chunks:
{chunks_text}

    Most relevant chunk numbers:
"""
    try:
        _client, _model = get_user_chat_client(user_id)
        response = _client.chat.completions.create(
            model=_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )

        import json
        content = response.choices[0].message.content.strip()
        record_chat_completion_usage(
            response=response,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
            operation="context_compression",
            model=_model,
            prompt_text=prompt,
            completion_text=content,
        )

        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1]).strip()

        indices = json.loads(content)

        if isinstance(indices, list):
            valid_indices = [i for i in indices if isinstance(i, int) and 0 <= i < len(context_chunks)]
            if valid_indices:
                return [context_chunks[i] for i in valid_indices[:max_chunks]]

    except Exception:
        pass

    return context_chunks[:max_chunks]
