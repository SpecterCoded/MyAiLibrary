import contextlib
import os
from core.logger import get_logger
from .ai_cost_service import record_chat_completion_usage

logger = get_logger("SYSTEM")

_detector = None


def get_detector():
    return _detector


def detect_hallucinations(
    context_chunks: list[str],
    question: str,
    answer: str,
    user_id: str | None = None,
    resource_id: str | None = None,
    feature: str = "hallucination_detection",
    provider_override: str | None = None,
):
    if not answer.strip() or not context_chunks:
        return []

    # Determine which provider to use
    provider = provider_override or "openai"

    # If user_id is provided, check their NLI preference from settings
    if not provider_override and user_id:
        try:
            from database import SessionLocal
            from models import UserSetting
            db = SessionLocal()
            try:
                row = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
                if row and getattr(row, "rag_nli_verification", 0) == 1:
                    provider = "nli"
            finally:
                db.close()
        except Exception:
            pass

    if provider == "nli":
        from .nli_verification_service import verify_claims
        return verify_claims(answer, context_chunks)

    if provider == "openai":
        from .llm_service import get_user_chat_client, parse_json_robustly
        
        context_str = "\n\n".join(context_chunks)
        
        prompt = f"""
You are an AI fact-checker evaluating an answer generated from retrieved context.
Identify any parts of the generated answer that are hallucinations (i.e., not directly supported by or contradicting the provided context).

Context:
{context_str}

Question:
{question}

Generated Answer:
{answer}

Instructions:
1. Scan the Generated Answer and find any exact substrings containing incorrect facts, hallucinations, or unsupported claims.
2. For each hallucinated claim, specify:
   - "text": The exact substring from the generated answer that is incorrect or unsupported. Must be a precise substring match of the text.
   - "confidence": A float between 0.0 and 1.0 (where 1.0 means you are absolutely certain it is a hallucination).
3. Return your response ONLY as a JSON list of objects. No markdown formatting, no extra commentary.

Example output:
[
  {{"text": "the capital is Paris", "confidence": 0.9}}
]

If there are no hallucinations and the answer is 100% supported, return an empty list:
[]
"""

        try:
            _client, _model = get_user_chat_client(user_id)
            response = _client.chat.completions.create(
                model=_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            content = response.choices[0].message.content
            record_chat_completion_usage(
                response=response,
                user_id=user_id,
                resource_id=resource_id,
                feature=feature,
                operation="hallucination_check",
                model=_model,
                prompt_text=prompt,
                completion_text=content,
            )
            hallucinations = parse_json_robustly(content)
            
            # Simple validation on results format
            if isinstance(hallucinations, list):
                valid_results = []
                for item in hallucinations:
                    if isinstance(item, dict) and "text" in item:
                        # Ensure the text is actually a substring of the answer
                        if item["text"] in answer:
                            valid_results.append({
                                "text": item["text"],
                                "confidence": float(item.get("confidence", 0.8))
                            })
                logger.info(f"Detected {len(valid_results)} hallucination spans via DeepSeek API")
                return valid_results
            
            return []
        except Exception as e:
            logger.error(f"Error calling hallucination detection API: {e}")
            return []
            
    else:
        # No supported provider selected for this call.
        # (A LettuceDetect local fallback previously lived here, but its detector was
        # never initialized, so this path always returned no findings. It is kept as an
        # explicit, safe no-op to avoid confusion. To re-enable local detection, wire up
        # a detector via get_detector() and restore span extraction here.)
        logger.warning(
            f"Hallucination check: unsupported provider '{provider}', returning no findings."
        )
        return []
