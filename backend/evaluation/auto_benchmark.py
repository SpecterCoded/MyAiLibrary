"""Auto-generate benchmark test sets from ingested documents.

Splits document transcripts into sections, generates factual questions
for each section, and produces expected answers from the source text.
"""

from __future__ import annotations

import re
from core.logger import get_logger

logger = get_logger("AUTO_BENCHMARK")


def generate_benchmark_from_resource(
    resource_id: str,
    db,
    questions_per_section: int = 3,
) -> list[dict]:
    """Generate a benchmark test set from a resource's transcript.

    Returns a list of dicts with keys: question, expected_answer, source_chunk_index.
    """
    from models import Resource, ChunkIndex

    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource or not resource.transcript:
        logger.warning(f"Resource {resource_id} has no transcript; cannot generate benchmark.")
        return []

    chunks = (
        db.query(ChunkIndex)
        .filter(ChunkIndex.resource_id == resource_id)
        .order_by(ChunkIndex.chunk_index)
        .all()
    )

    if not chunks:
        logger.warning(f"Resource {resource_id} has no chunks; cannot generate benchmark.")
        return []

    test_set: list[dict] = []
    try:
        from services.llm_service import get_user_chat_client
        
        user_id = resource.user_id

        for chunk_row in chunks:
            chunk_text = chunk_row.content
            if not chunk_text or len(chunk_text) < 100:
                continue

            prompt = f"""Based on the following text, generate {questions_per_section} factual questions that can be answered directly from the text. For each question, provide the correct answer.

Text:
{chunk_text[:2000]}

Return ONLY a JSON list of objects with "question" and "answer" keys. No markdown, no explanation.
Example: [{{"question": "...", "answer": "..."}}]"""
            _client, _model = get_user_chat_client(user_id)
            response = _client.chat.completions.create(
                model=_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                response_format={"type": "json_object"},
            )

            import json
            content = response.choices[0].message.content or "{}"
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(lines[1:-1]).strip()

            parsed = json.loads(content)
            items = parsed if isinstance(parsed, list) else parsed.get("questions", parsed.get("items", []))

            for item in items:
                if isinstance(item, dict) and "question" in item and "answer" in item:
                    test_set.append({
                        "question": item["question"],
                        "expected_answer": item["answer"],
                        "source_chunk_index": chunk_row.chunk_index,
                        "resource_id": resource_id,
                    })

    except Exception as e:
        logger.error(f"Benchmark generation failed for {resource_id}: {e}")

    logger.info(f"Generated {len(test_set)} test questions from resource {resource_id}")
    return test_set
