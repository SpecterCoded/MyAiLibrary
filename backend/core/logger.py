import json
import logging
import os
import re
import sys
import traceback
import warnings
from datetime import datetime, timezone
from typing import Any

from rich.console import Console
from rich.logging import RichHandler


STRUCTURED_EVENT_PREFIX = "MYAI_EVENT "
DESKTOP_MODE = os.getenv("MYAI_DESKTOP_MODE", "0").lower() in ("1", "true", "yes")

CATEGORY_COLORS = {
    "AUTH": "magenta",
    "RESOURCE": "blue",
    "UPLOAD": "blue",
    "PROCESSING": "yellow",
    "EMBEDDING": "cyan",
    "RAG": "cyan",
    "GENERATION": "bright_magenta",
    "BILLING": "bright_green",
    "CHAT": "blue",
    "SEARCH": "green",
    "CACHE": "green",
    "SUMMARY": "yellow",
    "FLASHCARDS": "yellow",
    "QUIZ": "yellow",
    "MINDMAP": "yellow",
    "DATABASE": "yellow",
    "SYSTEM": "white",
    "ERROR": "red",
}

NOISY_LIBS = [
    "transformers",
    "sentence_transformers",
    "tokenizers",
    "httpx",
    "urllib3",
    "chromadb",
    "onnxruntime",
    "huggingface_hub",
    "uvicorn.access",
    "openrouter",
    "watchfiles",
    "watchfiles.main",
]

_SENSITIVE_KEY = re.compile(
    r"(api[_-]?key|authorization|cookie|credential|password|prompt|secret|token|"
    r"transcript|document[_-]?content|request[_-]?body|response[_-]?body|"
    r"(?:^|[_-])(?:query|question|answer|context|content|sources?)(?:$|[_-]))",
    re.IGNORECASE,
)
_AUTH_VALUE = re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.\-]+", re.IGNORECASE)
_URL_SECRET = re.compile(
    r"([?&](?:api[_-]?key|key|token|secret|password|signature)=)[^&#\s]+",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT = re.compile(
    r"\b(api[_-]?key|authorization|cookie|credential|password|secret|token)"
    r"\s*[:=]\s*[\"']?[^\s,\"']+",
    re.IGNORECASE,
)
_USER_PATH = re.compile(r"([A-Za-z]:\\Users\\)[^\\\r\n]+", re.IGNORECASE)
_MAX_STRING_LENGTH = 4000
_MAX_DEPTH = 5
_SAFE_METRIC_KEYS = {
    "promptTokenCount",
    "completionTokenCount",
    "totalTokenCount",
    "tokenCount",
    "tokensBurned",
}


def _sanitize_string(value: str) -> str:
    sanitized = _AUTH_VALUE.sub(r"\1 [REDACTED]", value)
    sanitized = _URL_SECRET.sub(r"\1[REDACTED]", sanitized)
    sanitized = _SECRET_ASSIGNMENT.sub(r"\1=[REDACTED]", sanitized)
    sanitized = _USER_PATH.sub(r"\1%USER%", sanitized)
    if len(sanitized) > _MAX_STRING_LENGTH:
        return sanitized[:_MAX_STRING_LENGTH] + "..."
    return sanitized


def _sanitize_value(value: Any, *, key: str = "", depth: int = 0) -> Any:
    if key not in _SAFE_METRIC_KEYS and _SENSITIVE_KEY.search(key):
        return "[REDACTED]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _sanitize_string(value)
    if depth >= _MAX_DEPTH:
        return "[TRUNCATED]"
    if isinstance(value, dict):
        return {
            str(item_key): _sanitize_value(item_value, key=str(item_key), depth=depth + 1)
            for item_key, item_value in list(value.items())[:60]
        }
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_value(item, depth=depth + 1) for item in list(value)[:40]]
    return _sanitize_string(str(value))


class CategoryFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "category"):
            record.category = record.name.upper() if record.name else "SYSTEM"
        return True


class StructuredStdoutHandler(logging.Handler):
    """Emit one compact, machine-readable record per line for Electron."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            context = getattr(record, "context", None)
            safe_context = _sanitize_value(context) if isinstance(context, dict) else {}
            if record.exc_info:
                exc_type, exc_value, _exc_tb = record.exc_info
                safe_context = {
                    **safe_context,
                    "exception": {
                        "type": getattr(exc_type, "__name__", "Exception"),
                        "message": _sanitize_string(str(exc_value)),
                        "stack": _sanitize_string(
                            "".join(traceback.format_exception(*record.exc_info))
                        ),
                    },
                }

            payload = {
                "timestamp": datetime.fromtimestamp(
                    record.created, tz=timezone.utc
                ).isoformat(),
                "source": "backend",
                "level": (
                    "warning" if record.levelname.lower() == "warn"
                    else record.levelname.lower()
                ),
                "category": str(getattr(record, "category", "SYSTEM")).upper(),
                "event": str(getattr(record, "event_name", "backend.message")),
                "message": _sanitize_string(record.getMessage()),
            }
            optional_fields = {
                "operation": getattr(record, "operation", None),
                "phase": getattr(record, "phase", None),
                "status": getattr(record, "status", None),
                "correlationId": getattr(record, "correlation_id", None),
                "durationMs": getattr(record, "duration_ms", None),
            }
            payload.update({
                key: _sanitize_value(value)
                for key, value in optional_fields.items()
                if value is not None
            })
            if safe_context:
                payload["context"] = safe_context

            sys.stdout.write(
                STRUCTURED_EVENT_PREFIX
                + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                + "\n"
            )
            sys.stdout.flush()
        except Exception:
            self.handleError(record)


class CategoryAdapter(logging.LoggerAdapter):
    _STRUCTURED_KEYS = {
        "event": "event_name",
        "operation": "operation",
        "phase": "phase",
        "status": "status",
        "correlation_id": "correlation_id",
        "duration_ms": "duration_ms",
        "context": "context",
    }

    def process(self, msg, kwargs):
        extra = dict(kwargs.pop("extra", {}) or {})
        extra["category"] = self.extra["category"]
        for public_key, record_key in self._STRUCTURED_KEYS.items():
            if public_key in kwargs:
                extra[record_key] = kwargs.pop(public_key)
        kwargs["extra"] = extra
        return msg, kwargs


def setup_logger():
    warnings.filterwarnings(
        "ignore",
        category=DeprecationWarning,
        message=".*asyncio.iscoroutinefunction.*",
    )
    warnings.filterwarnings(
        "ignore",
        category=DeprecationWarning,
        message=".*on_event is deprecated.*",
    )

    if DESKTOP_MODE:
        handler: logging.Handler = StructuredStdoutHandler()
        log_level = logging.INFO
    else:
        console = Console()
        handler = RichHandler(
            console=console,
            show_time=True,
            show_path=False,
            show_level=True,
            rich_tracebacks=os.getenv("DEBUG", "false").lower() == "true",
        )
        log_level = logging.WARNING

    handler.addFilter(CategoryFilter())
    logging.basicConfig(
        level=log_level,
        format="[%(asctime)s] [%(category)s] [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        handlers=[handler],
        force=True,
    )

    logging.getLogger("SYSTEM").setLevel(logging.INFO)
    for library in NOISY_LIBS:
        logging.getLogger(library).setLevel(logging.WARNING)
    return logging.getLogger("MyAILibrary")


def get_logger(category: str):
    normalized_category = (category or "SYSTEM").upper()
    logger = logging.getLogger(normalized_category)
    logger.setLevel(logging.INFO)
    return CategoryAdapter(logger, {"category": normalized_category})
