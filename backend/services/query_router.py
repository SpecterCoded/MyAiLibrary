"""Fast query routing gate to skip retrieval for non-informational queries."""

from __future__ import annotations

import re

from core.logger import get_logger
from services.planner.planner_models import QueryClassification

logger = get_logger("QUERY_ROUTER")

# Patterns that indicate the query doesn't need retrieval
_GREETING_PATTERNS = re.compile(
    r"^(hi|hello|hey|yo|sup|howdy|greetings|good\s+(morning|afternoon|evening|day)|"
    r"what'?s\s+up|how\s+are\s+you|how\s+it\s+going|howdy|what\s+do\s+you\s+know)\b",
    re.IGNORECASE,
)

_SMALL_TALK_PATTERNS = re.compile(
    r"^(thanks|thank\s+you|thx|ok|okay|sure|yes|no|yeah|yep|nope|"
    r"cool|nice|great|awesome|perfect|good|bad|noted|got\s+it|"
    r"bye|goodbye|see\s+you|later|quit|exit|help)\s*[!.?]*$",
    re.IGNORECASE,
)

# Classifications that definitely don't need retrieval
_SKIP_CLASSIFICATIONS = {
    QueryClassification.GREETING,
    QueryClassification.SMALL_TALK,
}


def should_skip_retrieval(query: str, classification: QueryClassification) -> bool:
    """Determine if a query can skip the full RAG pipeline.

    Returns True only for clearly non-informational queries where retrieval
    would waste resources. Conservative — defaults to False (don't skip).
    """
    # Fast regex check first (no LLM needed)
    stripped = query.strip()

    if _GREETING_PATTERNS.match(stripped):
        logger.debug(f"Query router: skipping retrieval for greeting: {stripped[:50]}")
        return True

    if _SMALL_TALK_PATTERNS.match(stripped):
        logger.debug(f"Query router: skipping retrieval for small talk: {stripped[:50]}")
        return True

    # Check classification from the planner
    if classification in _SKIP_CLASSIFICATIONS:
        logger.debug(f"Query router: skipping retrieval for classification: {classification.value}")
        return True

    return False
