"""Unified, privacy-safe billing events for non-chat providers."""

from __future__ import annotations

from typing import Any

from core.logger import get_logger


logger = get_logger("BILLING")

_COST_KEYS = {
    "cost",
    "price",
    "total_cost",
    "totalCost",
    "provider_cost",
    "providerCost",
    "provider_cost_usd",
}
_PROMPT_TOKEN_KEYS = {
    "prompt_tokens",
    "input_tokens",
    "promptTokens",
    "inputTokens",
}
_COMPLETION_TOKEN_KEYS = {
    "completion_tokens",
    "output_tokens",
    "completionTokens",
    "outputTokens",
}
_TOTAL_TOKEN_KEYS = {
    "total_tokens",
    "totalTokens",
    "usage_total_tokens",
}
_UNIT_KEYS = {
    "billed_units",
    "search_units",
    "units",
    "usage_units",
}


def _payload(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        if hasattr(value, "model_dump"):
            result = value.model_dump()
        elif hasattr(value, "to_dict"):
            result = value.to_dict()
        else:
            result = {}
    except Exception:
        result = {}
    return result if isinstance(result, dict) else {}


def _first_numeric(value: Any, keys: set[str]) -> float | None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in keys:
                try:
                    return float(item)
                except (TypeError, ValueError):
                    pass
            nested = _first_numeric(item, keys)
            if nested is not None:
                return nested
    elif isinstance(value, list):
        for item in value:
            nested = _first_numeric(item, keys)
            if nested is not None:
                return nested
    return None


def extract_provider_billing_metrics(value: Any) -> dict[str, Any]:
    payload = _payload(value)
    prompt_tokens = _first_numeric(payload, _PROMPT_TOKEN_KEYS)
    completion_tokens = _first_numeric(payload, _COMPLETION_TOKEN_KEYS)
    total_tokens = _first_numeric(payload, _TOTAL_TOKEN_KEYS)
    if (
        total_tokens is None
        and prompt_tokens is not None
        and completion_tokens is not None
    ):
        total_tokens = prompt_tokens + completion_tokens
    return {
        "promptTokenCount": int(prompt_tokens or 0),
        "completionTokenCount": int(completion_tokens or 0),
        "totalTokenCount": int(total_tokens or 0),
        "providerCostUsd": _first_numeric(payload, _COST_KEYS),
        "providerUnitCount": _first_numeric(payload, _UNIT_KEYS),
    }


def report_provider_billing(
    *,
    provider_service: str,
    provider: str,
    model: str | None = None,
    response: Any = None,
    correlation_id: str | None = None,
    exact_zero_cost: bool = False,
    billing_lookup_pending: bool = False,
    zero_cost_reason: str | None = None,
    unit_count: float | int | None = None,
    unit_label: str | None = None,
    duration_ms: float | None = None,
) -> dict[str, Any]:
    """Emit exact, zero, or unavailable billing without estimating cost."""
    if correlation_id is None:
        try:
            from services.ai_cost_service import _active_correlation_id

            correlation_id = _active_correlation_id()
        except Exception:
            correlation_id = None
    metrics = extract_provider_billing_metrics(response)
    provider_cost = metrics["providerCostUsd"]
    if provider_cost is not None:
        billing_status = "exact"
        cost_reason = "provider_reported"
    elif exact_zero_cost:
        billing_status = "zero"
        provider_cost = 0.0
        cost_reason = zero_cost_reason or "local_or_non_billed_provider"
    elif billing_lookup_pending:
        billing_status = "pending"
        cost_reason = "waiting_for_provider_billing_index"
    else:
        billing_status = "unavailable"
        cost_reason = "provider_did_not_expose_cost"

    resolved_units = (
        float(unit_count)
        if unit_count is not None
        else metrics.get("providerUnitCount")
    )
    context = {
        "providerService": provider_service,
        "provider": provider,
        "model": model,
        "billingStatus": billing_status,
        "costReason": cost_reason,
        "providerCostUsd": provider_cost,
        "promptTokenCount": metrics["promptTokenCount"],
        "completionTokenCount": metrics["completionTokenCount"],
        "totalTokenCount": metrics["totalTokenCount"],
        "providerUnitCount": resolved_units,
        "providerUnitLabel": unit_label,
    }
    log_method = logger.info if billing_status != "unavailable" else logger.warning
    event_name = (
        "provider.billing_reported"
        if billing_status in {"exact", "zero"}
        else "provider.billing_pending"
        if billing_status == "pending"
        else "provider.billing_unavailable"
    )
    log_method(
        (
            f"Provider billing recorded for {provider_service}."
            if billing_status in {"exact", "zero"}
            else f"Provider billing is pending for {provider_service}."
            if billing_status == "pending"
            else f"Provider billing is unavailable for {provider_service}."
        ),
        event=event_name,
        operation="provider_billing",
        phase=provider_service,
        status="waiting" if billing_status == "pending" else "completed",
        correlation_id=correlation_id,
        duration_ms=duration_ms,
        context=context,
    )
    return context
