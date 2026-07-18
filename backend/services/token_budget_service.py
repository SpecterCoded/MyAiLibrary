"""Shared token estimation helpers for chunk budgeting."""

from __future__ import annotations

import os
import re

DEFAULT_CHUNK_TOKEN_BUDGET = max(64, int(os.getenv("CHUNK_TOKEN_BUDGET", "320")))


def estimate_tokens(text: str) -> int:
    """Estimate model tokens safely without requiring downloaded tokenizers."""

    if not text:
        return 0
    words = re.findall(r"\b\w+\b", text)
    punctuation = re.findall(r"[^\w\s]", text)
    line_breaks = text.count("\n")
    return max(1, len(words) + max(0, len(punctuation) // 2) + max(0, line_breaks // 3))
