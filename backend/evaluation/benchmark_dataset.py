"""Load benchmark datasets from JSON or YAML files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

from .models import BenchmarkDataset


class BenchmarkDatasetLoader:
    """Parse benchmark datasets without depending on production services."""

    SUPPORTED_SUFFIXES = {".json", ".yaml", ".yml"}

    @classmethod
    def load_file(cls, path: str | Path) -> BenchmarkDataset:
        source = Path(path)
        suffix = source.suffix.lower()
        if suffix not in cls.SUPPORTED_SUFFIXES:
            raise ValueError(f"Unsupported dataset format: {suffix}")
        raw = source.read_text(encoding="utf-8")
        payload = cls.loads(raw, suffix=suffix)
        if isinstance(payload, list):
            dataset_name = source.stem.replace("_", " ").strip() or "benchmark"
            payload = {"name": dataset_name, "examples": payload}
        payload.setdefault("name", source.stem or "benchmark")
        payload.setdefault("description", "")
        payload.setdefault("examples", [])
        return BenchmarkDataset.model_validate(payload)

    @staticmethod
    def loads(raw: str, *, suffix: str = ".json") -> dict[str, Any] | list[dict[str, Any]]:
        if suffix == ".json":
            return json.loads(raw)
        return yaml.safe_load(raw) or {}
