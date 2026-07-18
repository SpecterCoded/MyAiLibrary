"""LLM-assisted retrieval planner with a deterministic local fallback."""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable
from typing import Any

from core.logger import get_logger
from services.ai_cost_service import record_chat_completion_usage

from .planner_models import QueryClassification, RetrievalMode, RetrievalPlan
from .planner_prompt import build_planner_prompt

logger = get_logger("RAG")
PlanGenerator = Callable[[str], dict[str, Any]]


class RetrievalPlanner:
    """Create validated retrieval plans without coupling to retrieval services.

    A generator can be injected for tests or another LLM provider. When no
    generator is supplied, the existing chat client is used if enabled.
    Invalid output and provider failures degrade to deterministic heuristics.
    """

    def __init__(
        self,
        plan_generator: PlanGenerator | None = None,
        use_llm: bool | None = None,
    ) -> None:
        self._plan_generator = plan_generator
        self._use_llm = (
            os.getenv("RETRIEVAL_PLANNER_USE_LLM", "true").lower() in {"1", "true", "yes"}
            if use_llm is None
            else use_llm
        )

    def create_plan(
        self,
        query: str,
        has_chat_history: bool = False,
        user_id: str | None = None,
        resource_id: str | None = None,
    ) -> RetrievalPlan:
        """Return a valid plan for every input, even when the LLM is unavailable."""

        normalized = query.strip()
        if not normalized:
            return RetrievalPlan.legacy_fallback()

        if self._use_llm:
            try:
                generator = self._plan_generator or self._generate_with_existing_llm
                return RetrievalPlan.model_validate(
                    generator(
                        build_planner_prompt(normalized, has_chat_history),
                        user_id=user_id,
                        resource_id=resource_id,
                    )
                )
            except Exception as exc:
                logger.warning("Retrieval planner LLM fallback: %s", exc)

        return self._heuristic_plan(normalized, has_chat_history)

    @staticmethod
    def _generate_with_existing_llm(
        prompt: str,
        user_id: str | None = None,
        resource_id: str | None = None,
    ) -> dict[str, Any]:
        """Call the existing LLM client; imported lazily to keep planner portable."""

        from services.llm_service import get_user_chat_client
        _client, _model = get_user_chat_client(user_id)
        response = _client.chat.completions.create(
            model=_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        record_chat_completion_usage(
            response=response,
            user_id=user_id,
            resource_id=resource_id,
            feature="retrieval_planner",
            operation="planning",
            model=_model,
            prompt_text=prompt,
            completion_text=content,
        )
        return json.loads(content)

    @staticmethod
    def _heuristic_plan(query: str, has_chat_history: bool) -> RetrievalPlan:
        q = query.lower()
        words = len(q.split())

        if re.match(r"^(hi|hello|hey|good (morning|afternoon|evening))\b", q):
            classification = QueryClassification.GREETING
        elif has_chat_history and re.match(r"^(and|also|what about|how about|why|then)\b", q):
            classification = QueryClassification.FOLLOW_UP
        elif re.search(r"\b(page\s+\d+|equation|exact|quote|filename|section\s+\d+|according to)\b", q):
            classification = QueryClassification.EXACT_LOOKUP
        elif re.search(r"\b(compare|contrast|difference|versus|\bvs\.?\b)\b", q):
            classification = QueryClassification.COMPARISON
        elif re.search(r"\b(summarize|summary)\b", q):
            classification = QueryClassification.SUMMARIZATION
        elif re.search(r"\b(every document|all documents|across (the )?(documents|library)|multiple documents)\b", q):
            classification = QueryClassification.MULTI_DOCUMENT_REASONING
        elif re.search(r"\b(research|investigate|comprehensive|in depth|deep dive)\b", q):
            classification = QueryClassification.BROAD_RESEARCH
        elif re.search(r"\b(error|fails?|broken|debug|fix|issue|troubleshoot)\b", q):
            classification = QueryClassification.TROUBLESHOOTING
        elif re.match(r"^(how (do|can|to)|steps? to|walk me through)\b", q):
            classification = QueryClassification.PROCEDURAL
        elif re.match(r"^(what (is|are)|define|meaning of)\b", q) and words <= 10:
            classification = QueryClassification.DEFINITION
        elif re.match(r"^(who|when|where|how many|which)\b", q) and words <= 12:
            classification = QueryClassification.SIMPLE_FACT
        elif re.search(r"\b(explain|why|how does|describe)\b", q):
            classification = QueryClassification.EXPLANATION
        else:
            classification = QueryClassification.SMALL_TALK if words <= 4 else QueryClassification.EXPLANATION

        exact = classification is QueryClassification.EXACT_LOOKUP
        simple = classification in {QueryClassification.GREETING, QueryClassification.SMALL_TALK, QueryClassification.SIMPLE_FACT, QueryClassification.DEFINITION}
        broad = classification in {QueryClassification.COMPARISON, QueryClassification.SUMMARIZATION, QueryClassification.MULTI_DOCUMENT_REASONING, QueryClassification.BROAD_RESEARCH}
        exhaustive = classification is QueryClassification.SUMMARIZATION and bool(re.search(r"\b(every|all|entire|whole)\b", q))

        mode = RetrievalMode.KEYWORD_ONLY if exact else RetrievalMode.VECTOR_ONLY if simple else RetrievalMode.HYBRID
        max_chunks = 20 if exhaustive else 8 if broad else 3 if simple else 6
        depth = 50 if exhaustive else 40 if broad else 20 if exact else 12 if simple else 30
        # Adaptive RRF k: tighter fusion for exact lookups, standard for broad research
        rrf_k = 30 if exact else 40 if simple else 60
        # HyDE for complex queries that benefit from answer-like search terms
        use_hyde = classification in {
            QueryClassification.EXPLANATION,
            QueryClassification.BROAD_RESEARCH,
            QueryClassification.MULTI_DOCUMENT_REASONING,
            QueryClassification.COMPARISON,
        }

        return RetrievalPlan(
            query_classification=classification,
            retrieval_mode=mode,
            enable_multi_query=broad or classification in {QueryClassification.PROCEDURAL, QueryClassification.TROUBLESHOOTING, QueryClassification.FOLLOW_UP},
            rerank=exact or broad or not simple,
            compress_context=exhaustive or broad,
            hallucination_check=not simple,
            max_chunks=max_chunks,
            retrieval_depth=depth,
            confidence_threshold=0.72 if broad else 0.65,
            trust_semantic_cache=classification not in {QueryClassification.BROAD_RESEARCH, QueryClassification.TROUBLESHOOTING} and not exhaustive,
            rrf_k=rrf_k,
            use_hyde=use_hyde,
            reasoning=f"{classification.value} query; selected {mode.value} retrieval with {'broad' if broad else 'focused'} evidence coverage.",
        )
