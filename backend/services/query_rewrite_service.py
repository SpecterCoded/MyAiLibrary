from .llm_service import get_user_chat_client
from .ai_cost_service import record_chat_completion_usage
from core.activity_log import log_user_activity


def generate_query_variants(
    question: str,
    n: int = 2,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "query_variants_generation",
) -> list[str]:
    """
    Generate alternative phrasings of a question to improve retrieval recall.
    Returns a list of variant strings (excluding the original).
    Falls back to empty list on any failure so the caller can proceed with the original.
    """
    prompt = f"""Generate {n} different phrasings of the following question that would help retrieve relevant information from a transcript or document. Each phrasing should use different vocabulary but preserve the same meaning.

Question: {question}

    Return ONLY the rephrased questions, one per line, no numbering, no explanation."""

    try:
        _client, _model = get_user_chat_client(user_id)
        response = _client.chat.completions.create(
            model=_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
        content = response.choices[0].message.content.strip()
        record_chat_completion_usage(
            response=response,
            user_id=user_id,
            resource_id=resource_id,
            feature=feature,
            operation="query_expansion",
            model=_model,
            prompt_text=prompt,
            completion_text=content,
        )
        variants = [line.strip() for line in content.split("\n") if line.strip()]
        try:
            from database import SessionLocal
            _db = SessionLocal()
            log_user_activity(_db, user_id, 'ai_chat', 'Generated query variants', f'{len(variants[:n])} variants for retrieval')
            _db.close()
        except Exception:
            pass
        return variants[:n]
    except Exception:
        return []


def rewrite_query(
    current_question: str,
    chat_history: list[dict],
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "query_rewrite",
) -> str:
    """
    Rewrites the search query for better retrieval by resolving pronouns and references
    using the provided chat history.
    """

    history_str = ""
    for msg in chat_history:
        role = "User" if msg["role"] == "user" else "Assistant"
        content = msg["content"]
        history_str += f"{role}: {content}\n"

    prompt = f"""
You rewrite search queries for retrieval.
Rules:
* Expand pronouns using chat history.
* Resolve references such as:
  he
  she
  they
  it
  this
  that
* Preserve original meaning.
* Do not answer the question.
* Return ONLY the rewritten query.
* If no rewrite is needed, return the original query.

History:
{history_str}

Question:
{current_question}

Output:
"""
    _client, _model = get_user_chat_client(user_id)
    response = _client.chat.completions.create(
        model=_model,
    messages=[
        {
            "role": "system",
            "content": """You rewrite search queries for retrieval systems.
Return ONLY the rewritten query.

Examples:
History: User: What is RAG? | Assistant: Retrieval-Augmented Generation...
Query: "How does it work?" → "How does Retrieval-Augmented Generation work?"

History: User: Tell me about BERT | Assistant: BERT is a transformer model...
Query: "What about GPT?" → "How does GPT compare to BERT?"

History: User: Explain backpropagation | Assistant: Backpropagation is...
Query: "And gradient descent?" → "How does gradient descent relate to backpropagation?"

Do not answer the question. Do not explain your reasoning.
Do not add prefixes like 'Rewritten Query:' or 'Output:'.""",
        },
        {
            "role": "user",
            "content": prompt,
        },
    ],
        temperature=0.0,
    )

    rewritten_query = response.choices[0].message.content.strip()
    record_chat_completion_usage(
        response=response,
        user_id=user_id,
        resource_id=resource_id,
        feature=feature,
        operation="query_rewrite",
        model=_model,
        prompt_text=prompt,
        completion_text=rewritten_query,
    )

    # Remove accidental multi-line outputs
    if "\n" in rewritten_query:
        rewritten_query = rewritten_query.split("\n")[0].strip()

    # Safety fallback
    if len(rewritten_query) > 500:
        return current_question

    # Simple fallback if the model returns something empty or weird
    if not rewritten_query:
        return current_question

    # Debug logging
    print(f"QUERY REWRITE\nOriginal: {current_question}\nRewritten: {rewritten_query}")

    return rewritten_query
