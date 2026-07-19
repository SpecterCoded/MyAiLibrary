"""Structured pipeline logging for analytics and debugging.

Logs every pipeline step as structured JSON to logs/pipeline.jsonl.
Write-only, never affects pipeline logic. Failures silently ignored.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from core.paths import LOG_DIR


class PipelineLogger:
    """Structured logger for RAG pipeline events."""

    def __init__(self, user_id: str, query: str):
        self.user_id = user_id or "unknown"
        self.query = (query or "")[:100]
        self.start_time = time.time()
        self.events: list[dict] = []

    def log(self, step: str, **kwargs) -> None:
        """Log a pipeline step with arbitrary metadata."""
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": self.user_id,
            "query": self.query,
            "step": step,
            "duration_ms": round((time.time() - self.start_time) * 1000),
        }
        event.update(kwargs)
        self.events.append(event)

    def flush(self) -> None:
        """Write all logged events to the JSONL file."""
        try:
            LOG_DIR.mkdir(parents=True, exist_ok=True)
            with open(LOG_DIR / "pipeline.jsonl", "a", encoding="utf-8") as f:
                for event in self.events:
                    f.write(json.dumps(event, default=str) + "\n")
        except Exception:
            pass
