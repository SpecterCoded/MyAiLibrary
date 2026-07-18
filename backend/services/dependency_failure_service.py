"""Safe, user-actionable failures for configured local and AI dependencies."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Iterable


_STAGE_LABELS = {
    "transcribing": "transcription",
    "summarizing": "summary generation",
    "chaptering": "chapter generation",
    "subchaptering": "subchapter generation",
    "chunking": "chunking",
    "embedding": "embedding",
    "indexing": "text extraction",
    "reranking": "RAG reranking",
    "knowledge_generation": "knowledge generation",
}


@dataclass
class DependencyFailure(Exception):
    code: str
    service: str
    stage: str
    settings_section: str
    fields: tuple[str, ...] = ()
    path_label: str | None = None
    model: str | None = None
    detail: str | None = None
    retry_after_seconds: int | None = None

    def __post_init__(self):
        Exception.__init__(self, self.safe_detail)

    @property
    def safe_detail(self) -> str:
        return f"{self.code}: {self.service} failed during {self.stage}."

    @property
    def stage_label(self) -> str:
        return _STAGE_LABELS.get(self.stage, self.stage.replace("_", " "))

    def notification_for(self, resource_title: str) -> tuple[str, str]:
        resource = resource_title or "AI Resource"
        prefix = f'“{resource}” stopped at {self.stage_label}'
        section = f"Settings → {self.settings_section}"

        # Use plain ASCII so notifications render correctly in every client.
        prefix = f'"{resource}" stopped at {self.stage_label}'
        section = f"Settings \u2192 {self.settings_section}"

        if self.code == "config_missing":
            fields = _join_fields(self.fields) or "required settings"
            return (
                f"Setup required: {self.service}",
                f"{prefix} because {self.service} is not configured. Open {section}, enter the required {fields}, save, test the connection, then resume the pipeline.",
            )
        if self.code == "path_missing":
            return (
                f"Setup required: {self.service}",
                f"{prefix} because the configured {self.path_label or 'path'} is empty. Open {section}, select the correct path, then resume the pipeline.",
            )
        if self.code == "path_not_found":
            return (
                f"Configuration error: {self.service}",
                f"{prefix} because {self.path_label or 'the configured path'} was not found on this computer. Open {section}, correct the path, then resume the pipeline.",
            )
        if self.code == "path_not_executable":
            return (
                f"Configuration error: {self.service}",
                f"{prefix} because {self.path_label or 'the configured path'} cannot be run. Verify it points to the required executable, then resume the pipeline.",
            )
        if self.code == "path_not_loadable":
            return (
                f"Configuration error: {self.service}",
                f"{prefix} because {self.path_label or 'the configured model folder'} could not be loaded. Open {section}, choose a valid downloaded model folder, test it, then resume the pipeline.",
            )
        if self.code == "model_not_found":
            return (
                f"Configuration error: {self.service}",
                f"{prefix} because the configured model “{self.model or 'selected model'}” was not found or is unavailable for this provider. Open {section}, correct the model, test it, then resume the pipeline.",
            )
        if self.code == "invalid_api_key":
            return (
                f"Authentication failed: {self.service}",
                f"{prefix} because the {self.service} API key was rejected. Open {section}, replace the API key, test the connection, then resume the pipeline.",
            )
        if self.code == "insufficient_balance":
            return (
                f"Provider balance required: {self.service}",
                f"{prefix} because your {self.service} provider account has insufficient balance or credits. Add funds or use a funded API key, test the connection in {section}, then resume the pipeline.",
            )
        if self.code == "rate_limited":
            return (
                f"Provider rate limit: {self.service}",
                f"{prefix} because the {self.service} provider rate limit was reached. Wait for the provider limit to reset, then resume the pipeline.",
            )
        if self.code == "service_unreachable":
            return (
                f"Connection failed: {self.service}",
                f"{prefix} because MyAILibrary could not reach the configured {self.service} URL. Check the URL and network connection in Settings, test it, then resume the pipeline.",
            )
        if self.code == "service_timeout":
            return (
                f"Provider timeout: {self.service}",
                f"{prefix} because the {self.service} provider did not respond in time. Check the provider status and URL, then resume the pipeline.",
            )
        if self.code in {"transcription_failed", "ocr_failed"}:
            return (
                f"Processing failed: {self.service}",
                f"{prefix} because {self.service} could not process the source file. Verify the source file and its configured executable/model, then resume the pipeline.",
            )
        return (
            f"Provider error: {self.service}",
            f"{prefix} because the {self.service} provider rejected the request. Check the URL, model, API key, and provider account, test it in Settings, then resume the pipeline.",
        )


def _join_fields(fields: Iterable[str]) -> str:
    values = [field for field in fields if field]
    if len(values) < 2:
        return values[0] if values else ""
    if len(values) == 2:
        return " and ".join(values)
    return ", ".join(values[:-1]) + f", and {values[-1]}"


def missing_configuration(*, service: str, stage: str, settings_section: str, fields: Iterable[str]) -> DependencyFailure:
    return DependencyFailure(
        code="config_missing",
        service=service,
        stage=stage,
        settings_section=settings_section,
        fields=tuple(fields),
    )


def local_path_failure(*, code: str, service: str, stage: str, settings_section: str, path_label: str) -> DependencyFailure:
    return DependencyFailure(
        code=code,
        service=service,
        stage=stage,
        settings_section=settings_section,
        path_label=path_label,
    )


def classify_provider_error(*, service: str, stage: str, error: Exception, settings_section: str | None = None, model: str | None = None) -> DependencyFailure:
    """Map variable provider/SDK exceptions to stable, non-secret error codes."""
    text = str(error).lower()
    status = getattr(error, "status_code", None) or getattr(getattr(error, "response", None), "status_code", None)
    section = settings_section or service

    if status == 402 or any(token in text for token in ("insufficient", "balance", "credits", "quota exceeded")):
        code = "insufficient_balance"
    elif status in {401, 403} or any(token in text for token in ("unauthorized", "forbidden", "invalid api key", "authentication")):
        code = "invalid_api_key"
    elif status == 404 or "model not found" in text or "model does not exist" in text:
        code = "model_not_found"
    elif status == 429 or "rate limit" in text or "too many requests" in text:
        code = "rate_limited"
    elif any(token in text for token in ("timed out", "timeout", "read timeout")):
        code = "service_timeout"
    elif any(token in text for token in ("connection", "network", "dns", "name resolution", "refused")):
        code = "service_unreachable"
    else:
        code = "service_request_failed"

    retry_after_seconds = None
    response = getattr(error, "response", None)
    headers = getattr(response, "headers", {}) or {}
    raw_retry_after = headers.get("retry-after") if hasattr(headers, "get") else None
    try:
        retry_after_seconds = max(1, int(float(raw_retry_after))) if raw_retry_after else None
    except (TypeError, ValueError):
        retry_after_seconds = None

    return DependencyFailure(
        code=code,
        service=service,
        stage=stage,
        settings_section=section,
        model=model,
        detail=_redact(str(error)),
        retry_after_seconds=retry_after_seconds,
    )


def connection_test_failure_response(*, service: str, error: Exception, model: str | None = None) -> dict[str, str | bool]:
    """Return a safe Settings connection-test payload without provider error text."""
    failure = classify_provider_error(
        service=service,
        stage="connection test",
        error=error,
        settings_section=service,
        model=model,
    )
    title, message = failure.notification_for("Connection test")
    return {"success": False, "code": failure.code, "message": f"{title}. {message}"}


def _redact(value: str) -> str:
    """Keep diagnostics useful without retaining bearer/API-secret material."""
    value = re.sub(r"(?i)(bearer\s+)[^\s,;]+", r"\1[REDACTED]", value)
    return re.sub(r"(?i)(sk-[a-z0-9_-]{6,}|api[_-]?key\s*[=:]\s*)[^\s,;]+", r"\1[REDACTED]", value)
