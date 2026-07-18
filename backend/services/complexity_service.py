import re


def analyze_question_complexity(question: str) -> dict:
    """Analyze question to determine answer length and pipeline depth.

    Returns:
        {
            "complexity": "simple" | "medium" | "complex",
            "max_answer_words": int,
            "use_citation_grounding": bool,
            "use_context_compression": bool,
            "use_multi_query": bool,
            "use_hallucination_check": bool,
        }
    """
    q = question.lower().strip()

    # Simple patterns: who, what (short), when, where, is, are, can, do, does
    simple_patterns = [
        r"^(who|what|when|where|is|are|can|do|does|did|was|were)\s",
        r"^(what|who)\s+(is|are|was|were)\s+(the\s+)?",
        r"^(how many|how much|how long|how old)",
        r"^(yes|no)\s+question",
        r"^(name|list|give me|tell me)\s",
        r"^can\s+you\s+(explain|tell|describe|show)\s+(to\s+me\s+)?(what|how|when|where)\b",
        r"^please\s+(explain|tell|describe|show)\s",
        r"^(could|would)\s+you\s+(explain|tell|describe|show)\s",
        r"^(define|what\s+does)\b",
    ]

    # Complex patterns: explain, compare, analyze, summarize in detail, describe fully
    complex_patterns = [
        r"(explain|describe|analyze|compare|contrast|discuss|evaluate)\s+(in\s+detail|fully|comprehensively|thoroughly|deeply)",
        r"(summarize|summary)\s+(the\s+)?(entire|full|whole|complete|everything)",
        r"(what are the|what is the)\s+(different|various|main|key|important)\s+(types|ways|reasons|factors|aspects|components|elements)",
        r"(how does|how do|how can|how would|how could)\s",
        r"(why does|why do|why did|why is|why are|why would|why should)",
        r"(what are the|what are all|list all|name all)",
        r"(compare|contrast|difference between|similarities between)",
        r"(pros and cons|advantages and disadvantages|benefits and drawbacks)",
        r"(step by step|walk me through|guide me through)",
        r"(what would happen|what could happen|what might happen|what should happen)",
        r"(implications|consequences|effects|impact)\s+of",
    ]

    # Check complexity
    is_simple = any(re.search(p, q) for p in simple_patterns)
    is_complex = any(re.search(p, q) for p in complex_patterns)

    # Word count factor
    word_count = len(question.split())

    # Determine complexity
    if is_complex or word_count > 12:
        complexity = "complex"
        max_answer_words = 500
        use_citation_grounding = True
        use_context_compression = True
        use_multi_query = True
        use_hallucination_check = True
    elif is_simple and word_count <= 12:
        complexity = "simple"
        max_answer_words = 50
        use_citation_grounding = False
        use_context_compression = False
        use_multi_query = False
        use_hallucination_check = False
    else:
        complexity = "medium"
        max_answer_words = 150
        use_citation_grounding = False
        use_context_compression = True
        use_multi_query = True
        use_hallucination_check = True

    return {
        "complexity": complexity,
        "max_answer_words": max_answer_words,
        "use_citation_grounding": use_citation_grounding,
        "use_context_compression": use_context_compression,
        "use_multi_query": use_multi_query,
        "use_hallucination_check": use_hallucination_check,
    }
