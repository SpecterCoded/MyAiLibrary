"""Shared chunk payload contracts for ingestion-time chunking."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ChunkPayload:
    """Normalized chunk plus metadata produced by any chunking strategy."""

    content: str
    metadata: dict = field(default_factory=dict)
