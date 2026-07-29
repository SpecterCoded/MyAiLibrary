# =========================
# CONFIGURATION AND DEPENDENCIES
# =========================

import json
import re
import os
import time as _time
from contextlib import nullcontext

from openai import OpenAI
from services.url_utils import strip_api_suffix
from services.ai_cost_service import (
    record_chat_completion_usage,
    record_stream_completion_usage,
)
from services.generation_trace import (
    get_current_generation_trace,
    trace_generation,
)

_INLINE_CITATION_PATTERN = re.compile(r'(?:\s*\(\s*(?:Chunk\s+\d+|\[\d+\])\s*\)|\s*Chunk\s+\d+|\s*\[\d+\])\s*$', re.IGNORECASE)
_WORD_PATTERN = re.compile(r"[A-Za-z0-9']+")
_STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "he", "her", "his",
    "i", "in", "is", "it", "its", "of", "on", "or", "she", "that", "the", "their", "them", "they", "this",
    "to", "was", "we", "were", "what", "who", "with", "you", "your",
}

_user_client_cache: dict[str, tuple[OpenAI, str, float]] = {}
CHAT_MAX_OUTPUT_TOKENS = max(1, int(os.getenv("CHAT_MAX_OUTPUT_TOKENS", "4096")))
CHAT_MAX_AUTO_CONTINUATIONS = max(
    0, int(os.getenv("CHAT_MAX_AUTO_CONTINUATIONS", "2"))
)


def _longest_boundary_overlap(existing: str, continuation: str, limit: int = 512) -> int:
    """Return the exact suffix/prefix overlap without inspecting logged content."""
    maximum = min(len(existing), len(continuation), limit)
    for size in range(maximum, 0, -1):
        if existing[-size:] == continuation[:size]:
            return size
    return 0


def _classify_api_error(error: Exception) -> str:
    """Convert API errors to user-friendly messages."""
    error_str = str(error).lower()
    if 'insufficient' in error_str or '402' in error_str or 'balance' in error_str or 'credits' in error_str:
        return "Your AI provider account has insufficient balance. Please add credits to your account."
    if ('invalid' in error_str or 'unauthorized' in error_str or '401' in error_str) and ('key' in error_str or 'api' in error_str or 'auth' in error_str):
        return "Invalid API key. Please check your settings in Settings > AI Models."
    if 'rate limit' in error_str or '429' in error_str or 'too many' in error_str:
        return "Rate limit exceeded. Please wait a moment and try again."
    if 'timeout' in error_str or 'timed out' in error_str:
        return "Request timed out. The AI service may be temporarily unavailable."
    if 'not found' in error_str or '404' in error_str or 'does not exist' in error_str:
        return "Model not found. Please check your model name in Settings > AI Models."
    if 'not configured' in error_str or 'api key' in error_str:
        return "AI settings are not configured. Please set them in Settings > AI Models."
    return str(error)


def get_user_chat_client(user_id: str | None) -> tuple[OpenAI, str]:
    """Return an OpenAI client and model name configured from the user's settings.

    Results are cached for 5 minutes per user to avoid repeated DB lookups.
    Raises ValueError if the user has no configured chat settings.
    """
    if not user_id:
        raise ValueError("No user ID provided. Each user must configure their own Chat settings.")

    now = _time.time()
    if user_id in _user_client_cache:
        cached_client, cached_model, cached_at = _user_client_cache[user_id]
        if now - cached_at < 300:
            return cached_client, cached_model

    from database import SessionLocal
    from models import UserSetting
    db = SessionLocal()
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if not settings or not settings.chat_base_url or not settings.chat_api_key or not settings.chat_model:
            raise ValueError("Chat Base URL, API Key, and model are not configured. Please set them in Settings > Chat.")
        base_url = strip_api_suffix(settings.chat_base_url)
        api_key = settings.chat_api_key
        model = settings.chat_model

        user_client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=60.0,
            default_headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
        )
        _user_client_cache[user_id] = (user_client, model, now)
        return user_client, model
    finally:
        db.close()


def _create_chat_completion(
    user_id: str | None,
    *,
    messages: list[dict],
    temperature: float,
    **kwargs,
):
    """Create one traced provider request without logging prompt content."""
    trace = get_current_generation_trace()
    if trace:
        with trace.phase("provider_configuration"):
            client, model = get_user_chat_client(user_id)
        with trace.phase("provider_request", {"model": model}):
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                **kwargs,
            )
        return response, model

    client, model = get_user_chat_client(user_id)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        **kwargs,
    )
    return response, model


def _record_completion(
    response,
    *,
    user_id: str | None,
    resource_id: str | None,
    feature: str,
    operation: str,
    prompt_text: str,
    completion_text: str,
    model: str,
    metadata: dict | None = None,
):
    trace = get_current_generation_trace()
    correlation_id = trace.correlation_id if trace else None
    metrics: dict | None = None
    # Log token burn to activity log.
    try:
        if user_id and hasattr(response, 'usage') and response.usage:
            from core.activity_log import log_user_activity
            from database import SessionLocal
            db = SessionLocal()
            prompt_tokens = getattr(response.usage, 'prompt_tokens', 0) or 0
            completion_tokens = getattr(response.usage, 'completion_tokens', 0) or 0
            total = prompt_tokens + completion_tokens

            # Record usage before logging token burn.
            try:
                if trace:
                    with trace.phase("usage_accounting", {"model": model}):
                        metrics = record_chat_completion_usage(
                            response=response,
                            user_id=user_id,
                            resource_id=resource_id,
                            feature=feature,
                            operation=operation,
                            model=model,
                            prompt_text=prompt_text,
                            completion_text=completion_text,
                            metadata=metadata,
                            correlation_id=correlation_id,
                        )
                else:
                    metrics = record_chat_completion_usage(
                        response=response,
                        user_id=user_id,
                        resource_id=resource_id,
                        feature=feature,
                        operation=operation,
                        model=model,
                        prompt_text=prompt_text,
                        completion_text=completion_text,
                        metadata=metadata,
                        correlation_id=correlation_id,
                    )
            except Exception:
                pass

            log_user_activity(
                db,
                user_id,
                'ai_chat',
                f'Token burn: {feature}',
                f'-{total} tokens ({prompt_tokens} in + {completion_tokens} out) | {model}'
            )

            db.close()
            if trace and metrics:
                trace.usage_received(metrics)
            return  # Already recorded above, skip duplicate
    except Exception:
        pass

    try:
        if trace:
            with trace.phase("usage_accounting", {"model": model}):
                metrics = record_chat_completion_usage(
                    response=response,
                    user_id=user_id,
                    resource_id=resource_id,
                    feature=feature,
                    operation=operation,
                    model=model,
                    prompt_text=prompt_text,
                    completion_text=completion_text,
                    metadata=metadata,
                    correlation_id=correlation_id,
                )
        else:
            metrics = record_chat_completion_usage(
                response=response,
                user_id=user_id,
                resource_id=resource_id,
                feature=feature,
                operation=operation,
                model=model,
                prompt_text=prompt_text,
                completion_text=completion_text,
                metadata=metadata,
                correlation_id=correlation_id,
            )
    except Exception:
        pass
    if trace and metrics:
        trace.usage_received(metrics)


def _tokenize_for_overlap(text: str) -> list[str]:
    return [token for token in (item.lower() for item in _WORD_PATTERN.findall(text)) if token not in _STOP_WORDS and len(token) > 1]


def _choose_best_chunk_index(text: str, results: list[dict], previous_chunk_index: int | None = None) -> int | None:
    tokens = _tokenize_for_overlap(text)
    best_chunk_index = previous_chunk_index
    best_score = -1.0

    for rank, result in enumerate(results):
        metadata = result.get("metadata") or {}
        chunk_index = result.get("chunk_index", metadata.get("chunk_index"))
        if chunk_index is None:
            continue

        content = result.get("content") or result.get("document") or ""
        content_tokens = set(_tokenize_for_overlap(content))
        if not content_tokens:
            continue

        overlap = sum(1 for token in tokens if token in content_tokens)
        positional_bonus = max(0.0, 0.25 - (rank * 0.03))
        reuse_bonus = 0.15 if previous_chunk_index is not None and chunk_index == previous_chunk_index else 0.0
        score = overlap + positional_bonus + reuse_bonus

        if score > best_score:
            best_score = score
            best_chunk_index = chunk_index

    if best_chunk_index is not None:
        return best_chunk_index

    for result in results:
        metadata = result.get("metadata") or {}
        chunk_index = result.get("chunk_index", metadata.get("chunk_index"))
        if chunk_index is not None:
            return chunk_index
    return None


def enforce_inline_chunk_citations(answer: str, results: list[dict]) -> str:
    """Ensure grounded answer sentences end with an inline `Chunk N` marker."""
    if not answer or not results:
        return answer

    updated_lines: list[str] = []
    previous_chunk_index: int | None = None

    for raw_line in answer.splitlines():
        stripped = raw_line.strip()
        if not stripped:
          updated_lines.append(raw_line)
          continue

        # Skip markdown headings and structural elements
        if stripped.startswith('#') or stripped.startswith('---') or stripped.startswith('>'):
            updated_lines.append(raw_line)
            continue

        bullet_prefix_match = re.match(r"^(\*|-|\d+\.)\s+", stripped)
        is_bullet = bool(bullet_prefix_match)
        content_for_matching = re.sub(r"^(\*|-|\d+\.)\s+", "", stripped)
        content_without_citation = _INLINE_CITATION_PATTERN.sub("", content_for_matching).strip()

        # Leave structural headings alone.
        if content_without_citation.endswith(":") and not is_bullet:
            updated_lines.append(raw_line)
            continue

        if len(_tokenize_for_overlap(content_without_citation)) == 0:
            updated_lines.append(raw_line)
            continue

        leading = raw_line[: len(raw_line) - len(raw_line.lstrip())]
        bullet_prefix = bullet_prefix_match.group(0) if bullet_prefix_match else ""
        sentence_parts = re.split(r"(?<=[.!?])\s+", content_without_citation)
        rebuilt_parts: list[str] = []

        for sentence_part in sentence_parts:
            clean_sentence = _INLINE_CITATION_PATTERN.sub("", sentence_part).strip()
            if not clean_sentence:
                continue
            if len(_tokenize_for_overlap(clean_sentence)) == 0:
                rebuilt_parts.append(clean_sentence)
                continue

            # Skip if the sentence already has a citation marker
            if re.search(r'(?:\[\d+\]|\(Chunk\s+\d+\)|Chunk\s+\d+)', sentence_part, re.IGNORECASE):
                rebuilt_parts.append(sentence_part.strip())
                continue

            chosen_chunk_index = _choose_best_chunk_index(clean_sentence, results, previous_chunk_index)
            if chosen_chunk_index is None:
                rebuilt_parts.append(clean_sentence)
                continue

            previous_chunk_index = chosen_chunk_index
            # Use 1-based indexing for display (Chunk 1, Chunk 2, etc.)
            rebuilt_parts.append(f"{clean_sentence} [Chunk {chosen_chunk_index + 1}]")

        if not rebuilt_parts:
            updated_lines.append(raw_line)
            continue

        rebuilt = f"{leading}{bullet_prefix}{' '.join(rebuilt_parts)}"
        updated_lines.append(rebuilt)

    return "\n".join(updated_lines)


def _parse_json_robustly(content: str):
    """Robustly extract and parse JSON from string content returned by LLMs.
    Supports markdown blocks, trailing commas, single-quote literals, etc.
    """
    import re
    cleaned = content.strip()
    
    # 1. Strip markdown block markers
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    # 2. Try raw loads
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 3. Use regex to extract the JSON array or object
    match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            cleaned = match.group(1)

    # 4. Try to fix trailing commas right before closing brackets/braces
    cleaned = re.sub(r",\s*([\]}])", r"\1", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # 5. Try using literal_eval for single quote representations
    try:
        import ast
        val = ast.literal_eval(cleaned)
        if isinstance(val, (list, dict)):
            return json.loads(json.dumps(val))
    except Exception:
        pass

    # Final fallback: let standard json raise the error
    return json.loads(content)


def parse_json_robustly(content: str):
    trace = get_current_generation_trace()
    if trace:
        with trace.phase("response_parsing"):
            return _parse_json_robustly(content)
    return _parse_json_robustly(content)


# =========================
# CORE QUERY GENERATORS
# =========================


@trace_generation()
def generate_answer(
    question: str,
    context: str,
    chat_history: str = None,
    concise: bool = False,
    globe_on: bool = False,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "rag_answer",
):
    """Generate an answer using the provided context and chat history.
    
    If concise=True, produces a short focused answer (for home page library search).
    If concise=False, produces an exceptionally detailed answer (for audio/video player).
    """

    markdown_format_instruction = """
Response format:
- Always respond in well-structured Markdown format.
- Use ## for section headings, ### for subsections.
- Use **bold** for ALL key terms and definitions - this is critical.
- Use numbered lists for ordered sequences, bullet lists for unordered points.
- Use tables when comparing items or presenting structured data.
- Use `inline code` for technical terms, commands, or file names.
- Include timestamps when referencing specific media sections.
- For one timestamp use exactly `[MM:SS]` or `[HH:MM:SS]`.
- For a timestamp range use exactly `[MM:SS-MM:SS]` or `[HH:MM:SS-HH:MM:SS]`.
- Never add pipes, labels, or extra wrapper characters inside timestamp brackets (invalid: `[| 00:10-00:18]`).
- Use only valid Markdown and the supported markers below; never invent raw UI delimiters.

SPECIAL FORMATTING (MUST USE):
- Tip boxes: > [!TIP]\\n> Your tip content here
- Warning boxes: > [!WARNING]\\n> Your warning content here
- Caution boxes: > [!CAUTION]\\n> Your caution content here
- Key Insight boxes: > [!TIP]\\n> **Key Insight:** Your insight here
- Collapsible Q&A: <details><summary>Click to reveal</summary>Answer content</details>
"""

    citation_instruction = """
Citation format rules:
- The context is split into labeled chunks like [Chunk 12].
- Every factual sentence or bullet that is supported by the context must end with an inline citation using exactly `Chunk N`.
- When you use information from a chunk, cite it inline at the end of the relevant sentence using exactly `Chunk N`.
- If one sentence uses more than one chunk, cite the strongest supporting chunk only.
- Never leave a grounded claim without a chunk citation.
- Do not write the words "Chunk N" in plain text explanation style; use it only as the inline citation marker at the end of the sentence.
- Do not add a separate Sources section at the end.
"""

    if globe_on:
        prompt = f"""
You are MyAiLibrary AI Tutor, acting as a general intelligent research assistant.

Your goal is to provide a fully detailed, deep, broad, and comprehensive answer relying primarily on your own extensive general knowledge and reasoning.
Return a strong educational answer explaining definitions, how things work, examples, risks, and all relevant concepts around the topic.
Answer the question as deeply and completely as possible, even if no context is provided.

Additionally, some context from the user's personal library may be provided below.
If this context is relevant, use it as a supporting enrichment or extra flavor on top of your main answer.
Do NOT let the context narrow, block, or weaken your general knowledge answer.
If the context is weak, partial, or unrelated, ignore it entirely.
If you use the context, blend it naturally or add a short "From your library/resources" section.
You do not need to force citations unless you actually use the provided context.
{markdown_format_instruction}
{citation_instruction}

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""
    elif concise:
        prompt = f"""
You are MyAiLibrary AI Tutor.

Answer the user's question concisely and clearly based on the provided context.
Keep your answer focused, brief, and to the point — ideally 2-4 sentences.
Be faithful to the context and do not invent details.
If the answer is not contained in the provided information, say "I don't know."
{markdown_format_instruction}
{citation_instruction}

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""
    else:
        # Detect complex questions that benefit from chain-of-thought reasoning
        _complex_keywords = [
            "compare", "contrast", "difference", "explain why", "how does",
            "pros and cons", "tradeoffs", "analyze", "evaluate", "advantages",
            "disadvantages", "better", "worse", "versus", "vs", "relationship",
        ]
        is_complex = any(kw in question.lower() for kw in _complex_keywords)

        if is_complex and context:
            prompt = f"""
You are MyAiLibrary AI Tutor.

For this complex question, think step by step:
1. First, identify the key concepts from the context that relate to the question.
2. Analyze each concept step by step, citing your sources.
3. Compare or explain relationships between concepts.
4. Provide a clear, structured answer with evidence from the context.

Be thorough and detailed. Be faithful to the context and do not invent details.
If the answer is not contained in the provided information, say "I don't know."
{markdown_format_instruction}
{citation_instruction}

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""
        else:
            prompt = f"""
You are MyAiLibrary AI Tutor.

Your goal is to provide an exceptionally detailed, deep, and comprehensive explanation in response to the user's question.
Fully explain everything discussed in the context related to the question. Do not summarize briefly; instead, provide complete explanations, key points, step-by-step breakdowns, and all relevant details from the context.
Make sure your answer is long, highly informative, and covers all nuances without omitting any details.
Be faithful to the context and do not invent details.
If the answer is not contained in the provided information, say "I don't know" or "I couldn't find that information in the provided context."
{markdown_format_instruction}
{citation_instruction}

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""

    try:
        response, _model = _create_chat_completion(
            user_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as e:
        raise ValueError(_classify_api_error(e))
    answer = _clean_answer(response.choices[0].message.content)
    _record_completion(
        response,
        user_id=user_id,
        resource_id=resource_id,
        feature=feature,
        operation="chat",
        prompt_text=prompt,
        completion_text=answer,
        model=_model,
        metadata={"globe_on": globe_on, "concise": concise},
    )
    return answer


def _clean_answer(text: str) -> str:
    """Strip trailing LLM artifacts like 'undefined', 'null', leading filler phrases."""
    if not text:
        return text
    import re
    # Strip trailing artifacts
    text = re.sub(r'\s*(undefined|null|none)[\s\.\!\?]*$', '', text, flags=re.IGNORECASE)
    # Strip leading filler
    text = re.sub(r'^(Sure,?\s*|I know\s*,?\s*|Based on the context,?\s*|Here is|Here are)\s*', '', text, flags=re.IGNORECASE)
    # Normalize citation bracket variants to [N] format
    text = re.sub(r'\[\s*Doc\s+(\d+)\s*\]', r'[\1]', text)
    text = re.sub(r'\(\s*Doc\s+(\d+)\s*\)', r'[\1]', text)
    text = re.sub(r'\(\s*Chunk\s+(\d+)\s*\)', r'[\1]', text)
    text = re.sub(r'\[\s*[Cc]hunk\s+(\d+)\s*\]', r'[\1]', text)
    text = normalize_response_markup(text)
    # Capitalize first letter
    if text and text[0].islower():
        text = text[0].upper() + text[1:]
    return text.strip()


def _normalize_response_markup(text: str) -> str:
    """Normalize supported rich-response markers before storage/rendering."""
    if not text:
        return text

    timestamp = r"\d{1,2}:\d{2}(?::\d{2})?"
    text = re.sub(
        rf"\[\s*(?:\|\s*)?(?:timestamps?\s*:?\s*)?({timestamp})"
        rf"\s*(?:-->|->|[\u2013\u2014\-|])\s*({timestamp})\s*(?:\|\s*)?\]",
        r"[\1-\2]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"\[\s*(?:\|\s*)?(?:timestamps?\s*:?\s*)?({timestamp})\s*(?:\|\s*)?\]",
        r"[\1]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        rf"\(\s*(?:timestamps?\s*:?\s*)?({timestamp})"
        rf"\s*(?:-->|->|[\u2013\u2014\-|])\s*({timestamp})\s*\)",
        r"[\1-\2]",
        text,
        flags=re.IGNORECASE,
    )
    return re.sub(
        rf"\(\s*(?:timestamps?\s*:?\s*)?({timestamp})\s*\)",
        r"[\1]",
        text,
        flags=re.IGNORECASE,
    )


def normalize_response_markup(text: str) -> str:
    trace = get_current_generation_trace()
    if trace:
        with trace.phase("response_normalization"):
            return _normalize_response_markup(text)
    return _normalize_response_markup(text)


@trace_generation(streaming=True)
def generate_answer_stream(
    question: str,
    context: str,
    chat_history: str = None,
    globe_on: bool = False,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "rag_answer_stream",
    stream_state: dict | None = None,
):
    """
    Stream a detailed and comprehensive answer using the provided context and chat history.
    Yields tokens as they arrive from OpenRouter.
    """

    if globe_on:
        prompt = f"""
You are MyAiLibrary AI Tutor, acting as a general intelligent research assistant.

Your goal is to provide a fully detailed, deep, broad, and comprehensive answer relying primarily on your own extensive general knowledge and reasoning.
Return a strong educational answer explaining definitions, how things work, examples, risks, and all relevant concepts around the topic.
Answer the question as deeply and completely as possible, even if no context is provided.

Additionally, some context from the user's personal library may be provided below.
If this context is relevant, use it as a supporting enrichment or extra flavor on top of your main answer.
Do NOT let the context narrow, block, or weaken your general knowledge answer.
If the context is weak, partial, or unrelated, ignore it entirely.
If you use the context, blend it naturally or add a short "From your library/resources" section.
You do not need to force citations unless you actually use the provided context.

Response format:
- Always respond in well-structured Markdown format.
- Use ## for section headings, ### for subsections.
- Use **bold** for key terms and definitions.
- Use numbered lists for ordered sequences, bullet lists for unordered points.
- Use tables when comparing items or presenting structured data.
- Use only valid Markdown and the supported markers below; never invent raw UI delimiters.
- For one timestamp use exactly `[MM:SS]` or `[HH:MM:SS]`.
- For a timestamp range use exactly `[MM:SS-MM:SS]` or `[HH:MM:SS-HH:MM:SS]`.
- Never add pipes, labels, or extra wrapper characters inside timestamp brackets (invalid: `[| 00:10-00:18]`).
- Tip boxes: `> [!TIP]` followed by `> Your tip content`.
- Warning and caution boxes use the same form with `[!WARNING]` or `[!CAUTION]`.
- Collapsible Q&A: `<details><summary>Click to reveal</summary>Answer content</details>`.

Citation format rules:
- The context is split into labeled chunks like [Chunk 12].
- Every factual sentence or bullet that is supported by the context must end with an inline citation using exactly `Chunk N`.
- When you use information from a chunk, cite it inline at the end of the relevant sentence using exactly `Chunk N`.
- If one sentence uses more than one chunk, cite the strongest supporting chunk only.
- Never leave a grounded claim without a chunk citation.
- Do not write the words "Chunk N" in plain text explanation style; use it only as the inline citation marker at the end of the sentence.
- Do not add a separate Sources section at the end.

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""
    else:
        prompt = f"""
You are MyAiLibrary AI Tutor.

Your goal is to provide an exceptionally detailed, deep, and comprehensive explanation in response to the user's question.
Fully explain everything discussed in the context related to the question. Do not summarize briefly; instead, provide complete explanations, key points, step-by-step breakdowns, and all relevant details from the context.
Make sure your answer is long, highly informative, and covers all nuances without omitting any details.
Be faithful to the context and do not invent details.
If the answer is not contained in the provided information, say "I don't know" or "I couldn't find that information in the provided context."

Response format:
- Always respond in well-structured Markdown format.
- Use ## for section headings, ### for subsections.
- Use **bold** for key terms and definitions.
- Use numbered lists for ordered sequences, bullet lists for unordered points.
- Use tables when comparing items or presenting structured data.
- Use only valid Markdown and the supported markers below; never invent raw UI delimiters.
- For one timestamp use exactly `[MM:SS]` or `[HH:MM:SS]`.
- For a timestamp range use exactly `[MM:SS-MM:SS]` or `[HH:MM:SS-HH:MM:SS]`.
- Never add pipes, labels, or extra wrapper characters inside timestamp brackets (invalid: `[| 00:10-00:18]`).
- Tip boxes: `> [!TIP]` followed by `> Your tip content`.
- Warning and caution boxes use the same form with `[!WARNING]` or `[!CAUTION]`.
- Collapsible Q&A: `<details><summary>Click to reveal</summary>Answer content</details>`.

Citation format rules:
- The context is split into labeled chunks like [Chunk 12].
- Every factual sentence or bullet that is supported by the context must end with an inline citation using exactly `Chunk N`.
- When you use information from a chunk, cite it inline at the end of the relevant sentence using exactly `Chunk N`.
- If one sentence uses more than one chunk, cite the strongest supporting chunk only.
- Never leave a grounded claim without a chunk citation.
- Do not write the words "Chunk N" in plain text explanation style; use it only as the inline citation marker at the end of the sentence.
- Do not add a separate Sources section at the end.

Chat History:
{chat_history or "None"}

Context:
{context or "None"}

Question:
{question}
"""

    state = stream_state if stream_state is not None else {}
    state.update(
        {
            "finish_reason": None,
            "completion_status": "streaming",
            "continuation_count": 0,
            "can_continue": False,
            "output_character_count": 0,
        }
    )
    full_output = ""
    trace = get_current_generation_trace()
    provider_messages = [{"role": "user", "content": prompt}]
    finish_reason = None
    continuation_count = 0
    chat_mode = "global" if globe_on else ("resource_rag" if resource_id else "library_rag")

    while True:
        try:
            response, model = _create_chat_completion(
                user_id,
                messages=provider_messages,
                temperature=0.3,
                stream=True,
                max_tokens=CHAT_MAX_OUTPUT_TOKENS,
            )
        except Exception as error:
            raise RuntimeError(_classify_api_error(error)) from error

        request_id = None
        segment = ""
        prefix_pending = ""
        prefix_resolved = continuation_count == 0
        stream_phase = (
            trace.phase(
                "provider_stream",
                {
                    "model": model,
                    "chatMode": chat_mode,
                    "continuationCount": continuation_count,
                },
            )
            if trace
            else nullcontext({})
        )
        try:
            with stream_phase:
                for chunk in response:
                    if request_id is None:
                        request_id = getattr(chunk, "id", None)
                    choices = getattr(chunk, "choices", None) or []
                    if not choices:
                        continue
                    choice = choices[0]
                    chunk_finish = getattr(choice, "finish_reason", None)
                    if chunk_finish is not None:
                        finish_reason = str(chunk_finish)
                    delta = getattr(choice, "delta", None)
                    content = getattr(delta, "content", None) if delta else None
                    if not content:
                        continue
                    segment += content
                    if not prefix_resolved:
                        prefix_pending += content
                        if len(prefix_pending) < 512:
                            continue
                        overlap = _longest_boundary_overlap(full_output, prefix_pending)
                        content = prefix_pending[overlap:]
                        prefix_pending = ""
                        prefix_resolved = True
                    if content:
                        full_output += content
                        yield content
        except Exception as error:
            state.update(
                {
                    "finish_reason": finish_reason or "unknown",
                    "completion_status": "interrupted",
                    "continuation_count": continuation_count,
                    "can_continue": bool(full_output),
                    "output_character_count": len(full_output),
                }
            )
            raise RuntimeError(_classify_api_error(error)) from error

        if not prefix_resolved:
            overlap = _longest_boundary_overlap(full_output, prefix_pending)
            remaining = prefix_pending[overlap:]
            if remaining:
                full_output += remaining
                yield remaining

        try:
            metrics_kwargs = {
                "user_id": user_id,
                "resource_id": resource_id,
                "feature": feature,
                "model": model,
                "request_id": str(request_id) if request_id else None,
                "metadata": {
                    "globe_on": globe_on,
                    "chat_mode": chat_mode,
                    "finish_reason": finish_reason,
                    "continuation_count": continuation_count,
                },
            }
            if trace:
                with trace.phase("usage_accounting", {"model": model}):
                    metrics = record_stream_completion_usage(
                        **metrics_kwargs,
                        correlation_id=trace.correlation_id,
                    )
                trace.usage_received(metrics)
            else:
                record_stream_completion_usage(**metrics_kwargs)
        except Exception:
            pass

        if finish_reason != "length" or continuation_count >= CHAT_MAX_AUTO_CONTINUATIONS:
            break
        continuation_count += 1
        provider_messages.extend(
            [
                {"role": "assistant", "content": segment},
                {
                    "role": "user",
                    "content": (
                        "Continue exactly where the answer stopped. Do not repeat the "
                        "ending or restart any section. Return only the continuation."
                    ),
                },
            ]
        )

    # Some OpenAI-compatible providers cleanly exhaust the stream after
    # delivering the complete response but omit the optional finish_reason
    # field. Iterator exhaustion is distinguishable from a transport failure
    # (which raises above), so a non-empty clean EOF is a successful terminal
    # state rather than an interrupted answer.
    normalized_finish_reason = str(finish_reason or "").strip().lower()
    if normalized_finish_reason in {"", "unknown", "none", "null"} and full_output:
        finish_reason = "provider_eof"

    if normalized_finish_reason in {"", "unknown", "none", "null"} and not full_output:
        raise RuntimeError("The AI provider returned an empty response.")

    completion_status = (
        "complete"
        if finish_reason in {"stop", "tool_calls", "function_call", "provider_eof"}
        else "incomplete"
        if finish_reason == "length"
        else "blocked"
        if finish_reason == "content_filter"
        else "interrupted"
    )
    state.update(
        {
            "finish_reason": finish_reason or "unknown",
            "completion_status": completion_status,
            "continuation_count": continuation_count,
            "can_continue": finish_reason == "length",
            "output_character_count": len(full_output),
        }
    )
    if trace:
        trace.stream_completed(
            {
                "chatMode": chat_mode,
                "finishReason": state["finish_reason"],
                "completionStatus": completion_status,
                "continuationCount": continuation_count,
                "outputCharacterCount": len(full_output),
                "canContinue": state["can_continue"],
            }
        )


# =========================
# STUDY MATERIAL GENERATORS
# =========================


# NOTE: legacy markdown-format generate_flashcards / generate_quiz removed.
# The transcript/JSON versions defined later in this file are the active ones
# (Python only ever used those; these earlier copies were dead code).


@trace_generation()
def generate_summary(content, user_id: str | None = None, resource_id: str | None = None, feature: str = "summary_generation", chapters=None):
    """Create a detailed study summary from the provided content."""

    chapter_section = ""
    if chapters:
        chapter_lines = []
        for ch in chapters:
            start = ch.get("start_time", 0)
            end = ch.get("end_time", 0)
            title = ch.get("title", "Untitled")
            start_mm = f"{int(start)//60}:{int(start)%60:02d}"
            end_mm = f"{int(end)//60}:{int(end)%60:02d}"
            chapter_lines.append(f"- {title} [{start_mm} - {end_mm}]")
        chapter_section = "\n\nCHAPTER STRUCTURE (use these timestamps for section headings):\n" + "\n".join(chapter_lines) + "\n"

    prompt = f"""
Create a detailed study summary from the following content.

CRITICAL RULE: The content below is a transcript that contains timestamps. You MUST extract and use these timestamps in your summary. Look for patterns like:
- [00:00], [01:30], [10:45] etc.
- Or timestamps at the start of lines like "00:00 - 01:30:" 
- Or SRT format timestamps like "00:00:01,000 --> 00:00:05,000"
{chapter_section}
IMPORTANT: Use the chapter structure above to organize your summary. Each major section should correspond to a chapter, using the chapter's timestamp range as the section heading timestamp.

Include timestamps next to the relevant sections so users can jump to that part of the video/audio.

FORMATTING RULES (MUST FOLLOW):
1. TIMESTAMPS: Include timestamps in format [MM:SS] or [HH:MM:SS] next to EVERY section heading
2. BOLD: Use **double asterisks** for ALL key terms and important concepts
3. TIP BOXES: Use this exact format:
   > [!TIP]
   > Your tip content here
4. WARNING BOXES: Use this exact format:
   > [!WARNING]
   > Your warning content here  
5. CAUTION BOXES: Use this exact format:
   > [!CAUTION]
   > Your caution content here
6. NUMBERED LISTS: Use "1. " "2. " "3. " format
7. BULLET LISTS: Use "- " for unordered lists
8. SUBHEADINGS: Use ### for sub-sections
9. SECTIONS: Use format "N. Section Name [timestamp]"

Focus on:
- Main ideas with timestamps from the transcript
- Important concepts with **bold** formatting
- Key terms defined clearly
- Learning points organized in lists

Content:

{content}

Summary:
"""

    try:
        response, _model = _create_chat_completion(
            user_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as e:
        raise ValueError(_classify_api_error(e))
    output = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=output)
    return output

@trace_generation()
def generate_study_notes(content: str, user_id: str | None = None, resource_id: str | None = None, feature: str = "study_notes_generation"):
    """Create exceptionally deep, detailed, and beautifully structured study notes from the content."""

    prompt = f"""
You are MyAiLibrary AI Tutor.

Your task is to analyze the provided content and generate exceptionally deep, comprehensive, and detailed study notes. 

FORMATTING RULES (CRITICAL - YOU MUST FOLLOW):
1. TIMESTAMPS: Include timestamps next to EVERY heading, section, bullet point, and Active Recall answer.
   - A single timestamp must use exactly [MM:SS] or [HH:MM:SS]. Example: "2.1 Unanimous Vote [0:08]"
   - A timestamp range must use exactly [MM:SS-MM:SS] or [HH:MM:SS-HH:MM:SS].
   - These exact square-bracket formats are required inside <details> answers too.
   - Never put timestamps in parentheses. Never add pipes, labels, or extra wrapper characters.
   - Invalid: (0:15), (0:24-0:25), [| 0:15], [timestamp: 0:15].
2. BOLD TEXT: Use **double asterisks** for ALL key terms, important concepts, and critical phrases. Example: "**unanimous vote**", "**criminal action**"
3. TIP BOXES: Use this exact format for tips:
   > [!TIP]\\n> Your tip content here
4. WARNING BOXES: Use this exact format for warnings:
   > [!WARNING]\\n> Your warning content here  
5. CAUTION BOXES: Use this exact format for cautions:
   > [!CAUTION]\\n> Your caution content here
6. NUMBERED LISTS: Use "1. " "2. " "3. " format for ordered content
7. BULLET LISTS: Use "- " for unordered lists
8. SUBHEADINGS: Use ### for sub-sections
9. Q&A SECTIONS: Format answers like this:
   <details><summary>Click to reveal answer</summary>Your detailed answer with exact square-bracket timestamps such as [00:15] and [00:24-00:25].</details>
10. SECTION HEADERS: Use format "N. Section Name [timestamp]" with blue bar styling

STRUCTURE:
1. **Executive Overview** [timestamp range]: Deep introductory summary explaining context and importance
2. **Key Concepts & Definitions** [timestamp]: Detailed terminology with definitions and real-world analogies. Use > [!TIP] for insights
3. **Core Topic Breakdown** [timestamp]: Highly detailed bulleted subsections for every aspect
4. **Step-by-Step Explanations or Workflows** [timestamp]: Numbered processes and procedures
5. **Common Pitfalls & Misconceptions** [timestamp]: Use > [!WARNING] and > [!CAUTION] blocks
6. **Key Takeaways & Action Items** [timestamp]: Highlighted takeaways and actionable steps
7. **Active Recall & Self-Test**: 3-5 Q&A pairs with <details> expandable answers. Every answer must use the exact square-bracket timestamp syntax above.

Content:

{content}

Study Notes:
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.35,
    )
    output = normalize_response_markup(response.choices[0].message.content)
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=output)
    return output


@trace_generation()
def generate_chat_summary(conversation: str, user_id: str | None = None, resource_id: str | None = None, feature: str = "chat_history_summary"):
    """Summarize a conversation clearly and concisely."""

    prompt = f"""
Summarize the following conversation into a short, concise summary that preserves the user's questions and the assistant's answers.
Keep only the relevant points and do not add new information.

Conversation:
{conversation}

Summary:
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
    )
    output = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="chat_summary", prompt_text=prompt, model=_model, completion_text=output)
    return output


# =========================
# TRANSCRIPT-BASED GENERATORS
# =========================


@trace_generation()
def generate_chapters(transcript, user_id: str | None = None, resource_id: str | None = None, feature: str = "chapter_generation"):
    """Extract chapter structure from an SRT transcript and return valid JSON."""

    prompt = f"""
Create study chapters from this SRT transcript.

The SRT contains REAL timestamps.

You MUST use the timestamps found in the SRT.

Return ONLY valid JSON.

Rules:

1. Create logical learning chapters.
2. Use the SRT timestamps.
3. start_time and end_time must be real timestamps from the content.
4. Timestamps must be returned as seconds.
5. Chapters must cover the entire content.
6. Chapters must not overlap.

Return format:

[
{{
"title": "...",
"summary": "...",
"start_time": 0,
"end_time": 120
}}
]

SRT:

{transcript}
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
    )
    content = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)
    if not content or not content.strip():
        raise RuntimeError("LLM returned empty content for chapter generation")
    return parse_json_robustly(content)


@trace_generation()
def generate_subchapters(
    chapter_text: str,
    chapter_duration: int = None,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "subchapter_generation",
):
    """Create optional subchapters for a chapter using transcript text and duration."""

    if chapter_duration and chapter_duration < 60:
        return []

    duration_instruction = ""
    if chapter_duration:
        duration_instruction = f"""
IMPORTANT: This chapter is {chapter_duration} seconds long (approximately {chapter_duration // 60} minutes).
"""

    prompt = f"""
Create study subchapters from this chapter.

{duration_instruction}

Subchapters are OPTIONAL. Create them only when the chapter contains multiple distinct topic shifts or a clear segment break.
If the chapter is a single coherent topic, return [] and do not force subchapters.
Do not create micro-subchapters.
Return only up to 3 subchapters unless absolutely necessary.
If chapter duration is less than 60 seconds, return [].

CRITICAL RULES:
1. Timestamps are relative to the chapter start (0 seconds).
2. Subchapters must not overlap.
3. Do not force coverage of the entire chapter.
4. Each subchapter should generally be at least 30 seconds long, but lengths may be longer based on chapter context and topic structure.
5. Never create micro-subchapters.
6. Use at most 3 subchapters.
7. If the chapter has only one topic, return [] instead of inventing splits.

Return ONLY valid JSON.

Each subchapter must contain:
- title (short, descriptive)
- start_time (integer, seconds from chapter start)
- end_time (integer, seconds from chapter start)
- summary is optional

Example formats:
[]

[
  {{
    "title": "Introduction to Concept",
    "start_time": 0,
    "end_time": 60
  }},
  {{
    "title": "Practical Examples",
    "start_time": 60,
    "end_time": 150
  }}
]

Chapter text:
{chapter_text}
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
    )

    content = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)

    try:
        subchapters = parse_json_robustly(content)

        # Validate and fix timestamps
        subchapters = validate_subchapters(subchapters, chapter_duration)

        return subchapters

    except json.JSONDecodeError as e:
        return []


def validate_subchapters(subchapters, chapter_duration):
    """Validate subchapters and remove invalid or overlapping time segments."""
    if not subchapters or not chapter_duration:
        return []

    if not isinstance(subchapters, list):
        return []

    if chapter_duration < 60:
        return []

    cleaned = []

    for sub in sorted(subchapters, key=lambda x: x.get("start_time", 0)):
        try:
            start = int(sub.get("start_time", -1))
            end = int(sub.get("end_time", -1))
        except (TypeError, ValueError):
            continue

        title = str(sub.get("title", "")).strip()
        summary = str(sub.get("summary", "")).strip()

        if not title:
            continue
        if start < 0 or end <= start or end > chapter_duration:
            continue
        duration = end - start
        if duration < 30:
            continue

        cleaned.append(
            {
                "title": title,
                "summary": summary,
                "start_time": start,
                "end_time": end,
            }
        )

    if not cleaned:
        return []

    # Remove overlaps and keep the earliest valid segments
    validated = []
    current_end = 0
    for sub in cleaned:
        if sub["start_time"] < current_end:
            sub["start_time"] = current_end
        if sub["end_time"] <= sub["start_time"]:
            continue
        if sub["end_time"] - sub["start_time"] < 30:
            continue

        validated.append(sub)
        current_end = sub["end_time"]

    if not validated:
        return []

    if (
        len(validated) == 1
        and validated[0]["start_time"] == 0
        and validated[0]["end_time"] == chapter_duration
    ):
        return []

    if len(validated) > 3:
        validated.sort(key=lambda x: x["end_time"] - x["start_time"], reverse=True)
        validated = validated[:3]
        validated.sort(key=lambda x: x["start_time"])

    for sub in validated:
        sub.setdefault("summary", "")

    return validated


# =========================
# TRANSCRIPT JSON GENERATORS
# =========================


@trace_generation()
def generate_quiz(transcript, user_id: str | None = None, resource_id: str | None = None, feature: str = "quiz_generation"):
    """Generate a multiple-choice quiz from transcript content and return JSON."""

    prompt = f"""
Create a multiple choice quiz from this transcript.

Return ONLY valid JSON.

Rules:

- Create 10 questions.
- Each question must have 4 options.
- Only one correct answer.
- Correct answer must be:
  A, B, C, or D

Format:

[
  {{
    "question": "...",
    "option_a": "...",
    "option_b": "...",
    "option_c": "...",
    "option_d": "...",
    "correct_answer": "A"
  }}
]

Transcript:

{transcript}
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        temperature=0.3,
    )

    content = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)
    if not content or not content.strip():
        raise RuntimeError("LLM returned empty content for chapter generation")
    return parse_json_robustly(content)


@trace_generation()
def generate_flashcards(transcript, user_id: str | None = None, resource_id: str | None = None, feature: str = "flashcards_generation"):
    """Generate transcript-based flashcards and return valid JSON."""

    prompt = f"""
Create study flashcards from this transcript.

Return ONLY valid JSON.

Each flashcard must contain:

- front
- back

Front = question or concept.
Back = answer or explanation.

Create Based on the Transcript length, how much it needs for the length based on you analysis.

Transcript:

{transcript}

Return format:

[
  {{
    "front": "What is subnetting?",
    "back": "The process of dividing a network into smaller subnets."
  }}
]
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        temperature=0.3,
    )

    content = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)
    if not content or not content.strip():
        raise RuntimeError("LLM returned empty content for chapter generation")
    return parse_json_robustly(content)


@trace_generation()
def generate_mindmap(chapter_text, user_id: str | None = None, resource_id: str | None = None, feature: str = "mindmap_generation"):
    """Generate a study mind map from chapter text and return valid JSON."""

    prompt = f"""
Create an exceptionally deep, detailed, and comprehensive study mind map from the content below.

Determine the appropriate depth, number of main categories, and density of subtopics dynamically based on the timeline, length, and complexity of the content. 
- For longer or more complex content, generate a wider, more deeply nested tree structure with multiple levels of children.
- For shorter or simpler content, keep the structure natural and avoid forcing unnecessary branches.
- Every node title should be specific, informative, and content-rich — never vague or generic (e.g. "Overview" with no detail is not acceptable).
- Provide highly detailed, in-depth explanations and contextual details within the subtopics and leaf nodes, explaining the "why", "how", and background context of each concept rather than just summarizing them in short labels.
- Capture technical details, processes, relationships, causes, effects, and nuances — not just surface labels.
- Do NOT invent information. Everything must come from the provided content.

Return ONLY valid JSON.

Format:

{{
  "title": "Main Topic Title",
  "children": [
    {{
      "title": "Main Category 1",
      "children": [
        {{
          "title": "Detailed subtopic 1a",
          "children": [
            {{ "title": "Specific detail or fact about 1a" }},
            {{ "title": "Another specific detail about 1a" }},
            {{ "title": "Mechanism, example, or nuance of 1a" }}
          ]
        }},
        {{
          "title": "Detailed subtopic 1b",
          "children": [
            {{ "title": "Specific detail about 1b" }},
            {{ "title": "Key fact or step related to 1b" }}
          ]
        }}
      ]
    }}
  ]
}}

Content:

{chapter_text}
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        temperature=0.3,
    )

    content = response.choices[0].message.content
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)
    if not content or not content.strip():
        raise RuntimeError("LLM returned empty content for chapter generation")
    return parse_json_robustly(content)




# =========================
# RESPONSE HELPERS
# =========================
# RESPONSE HELPERS
# =========================


@trace_generation()
def answer_question(
    question: str,
    context: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "context_answer",
):
    """Answer a single question using only the provided context."""

    prompt = f"""You are answering questions about a learning resource.

Rules:

Use ONLY the provided context.
Do not invent facts.
You MAY make simple logical connections that are directly supported by the context.
If the context implies the answer, answer it.
Do NOT require exact wording from the question to appear in the context.
Only say "I could not find that information in this resource." when the answer truly cannot be inferred from the context.

Context:

{context}

Question:

{question}

Answer:
"""

    response, _model = _create_chat_completion(
        user_id,
        messages=[
            {
                "role": "system",
                "content": """
You answer questions using retrieved context.
Use only the context.
Make reasonable direct inferences.
Do not invent facts.
""",
            },
            {
                "role": "user",
                "content": prompt,
            },
        ],
        temperature=0.1,
    )
    output = _clean_answer(response.choices[0].message.content)
    _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="chat", prompt_text=prompt, model=_model, completion_text=output)
    return output


@trace_generation()
def generate_suggested_questions(
    transcript: str,
    duration_seconds: int = None,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "suggested_questions_generation",
):
    """Generate suggested questions dynamically based on audio duration."""

    # Determine question count based on duration
    if duration_seconds is not None:
        duration_minutes = duration_seconds / 60
        if duration_minutes < 5:
            num_questions = 4
        elif duration_minutes < 15:
            num_questions = 8
        elif duration_minutes < 45:
            num_questions = 12
        else:
            num_questions = 16
    else:
        # Estimate from transcript length as fallback
        word_count = len(transcript.split()) if transcript else 0
        if word_count < 500:
            num_questions = 4
        elif word_count < 2000:
            num_questions = 8
        elif word_count < 5000:
            num_questions = 12
        else:
            num_questions = 16

    prompt = f"""
Based on the following transcript from an audio/video resource, generate exactly {num_questions} relevant, insightful, and diverse questions that a user might want to ask about this content.

Rules:
- Questions should cover different aspects and topics from the transcript.
- Include a mix of factual, analytical, and conceptual questions.
- Make questions specific to the actual content, not generic.
- Return ONLY a JSON list of strings, e.g., ["question 1", "question 2", ...]. No formatting, no extra explanation.

Transcript:
{transcript}
"""
    try:
        response, _model = _create_chat_completion(
            user_id,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
        content = response.choices[0].message.content
        _record_completion(response, user_id=user_id, resource_id=resource_id, feature=feature, operation="content_generation", prompt_text=prompt, model=_model, completion_text=content)
        return parse_json_robustly(content)
    except Exception as e:
        return [
            "What is the main topic discussed?",
            "What are the key takeaways?",
            "Who are the speakers?",
            "Are there any blockers mentioned?"
        ]
