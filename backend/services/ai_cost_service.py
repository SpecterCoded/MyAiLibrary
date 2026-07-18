from __future__ import annotations

import json
import os
import time as _time
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import requests
from sqlalchemy import func

from database import SessionLocal
from models import AiUsageEvent, User

AI_USAGE_PROVIDER = "chatqt"
AI_BILLING_TOKEN_UNIT = max(1, int(os.getenv("AI_BILLING_TOKEN_UNIT", "25000")))
AI_BILLING_UNIT_PRICE_USD = os.getenv("AI_BILLING_UNIT_PRICE_USD")
AI_DEFAULT_USER_TOKEN_LIMIT = max(1, int(os.getenv("AI_DEFAULT_USER_TOKEN_LIMIT", "25000")))
AI_USAGE_HTTP_TIMEOUT = max(2, int(os.getenv("AI_USAGE_HTTP_TIMEOUT", "15")))
AI_USAGE_RECENT_PAGES = max(1, int(os.getenv("AI_USAGE_RECENT_PAGES", "3")))

_user_billing_cache: dict[str, tuple[str, str, float]] = {}
_user_wallet_cache: dict[str, tuple[str, str, float]] = {}


def _get_user_billing_config(user_id: str | None) -> tuple[str, str]:
    """Return (base_url, api_key) for the user's billing API from their chat settings."""
    if not user_id:
        raise ValueError("No user ID provided for billing lookup.")

    now = _time.time()
    if user_id in _user_billing_cache:
        base_url, api_key, cached_at = _user_billing_cache[user_id]
        if now - cached_at < 300:
            return base_url, api_key

    from models import UserSetting
    db = SessionLocal()
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if not settings:
            raise ValueError("User settings not found for billing lookup.")
        
        base_url = (settings.chat_cost_base_url or "").rstrip("/")
        api_key = settings.chat_cost_api_key
        
        if not base_url or not api_key:
            raise ValueError("Chat Base URL and API Key are not configured for billing lookup.")
            
        _user_billing_cache[user_id] = (base_url, api_key, now)
        return base_url, api_key
    finally:
        db.close()


def _get_user_wallet_config(user_id: str | None) -> tuple[str, str]:
    """Return (base_url, api_key) for the user's wallet balance API."""
    if not user_id:
        raise ValueError("No user ID provided for wallet lookup.")

    now = _time.time()
    if user_id in _user_wallet_cache:
        base_url, api_key, cached_at = _user_wallet_cache[user_id]
        if now - cached_at < 300:
            return base_url, api_key

    from models import UserSetting
    db = SessionLocal()
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if not settings:
            raise ValueError("User settings not found for wallet lookup.")

        base_url = (getattr(settings, "wallet_balance_base_url", None) or "").strip()
        api_key = (getattr(settings, "wallet_balance_api_key", None) or "").strip()

        if not base_url or not api_key:
            raise ValueError("Wallet Base URL and API Key are not configured.")

        _user_wallet_cache[user_id] = (base_url, api_key, now)
        return base_url, api_key
    finally:
        db.close()


def _generation_endpoint(base_url: str, request_id: str | None = None) -> tuple[str, dict[str, Any] | None]:
    clean_url = (base_url or "").strip().split("?")[0].rstrip("/")
    if request_id and ("<Request_ID>" in clean_url or "<request_id>" in clean_url):
        return clean_url.replace("<Request_ID>", request_id).replace("<request_id>", request_id), None
    if not clean_url.endswith("/generation"):
        clean_url = f"{clean_url}/generation"
    return clean_url, {"id": request_id} if request_id else None
USER_VISIBLE_OPERATIONS = {
    "chat",
    "stream_chat",
    "content_generation",
    "document_intelligence",
    "knowledge_generation",
}
INTERNAL_OPERATIONS = {
    "embedding",
    "query_expansion",
    "planning",
    "context_compression",
    "query_rewrite",
    "hyde_generation",
    "hallucination_check",
}
USER_VISIBLE_FEATURE_KEYWORDS = (
    "chat",
    "answer",
    "summary",
    "chapter",
    "subchapter",
    "notes",
    "study_notes",
    "quiz",
    "flashcard",
    "mindmap",
    "document_intelligence",
    "suggested_questions",
    "translation",
    "title_generation",
)
INTERNAL_FEATURE_KEYWORDS = (
    "embedding",
    "contextualization",
    "planner",
    "query_rewrite",
    "query_variants",
    "compression",
    "hallucination",
    "cache_lookup",
    "chat_history_summary",
    "semantic_cache",
    "search_embedding",
)


def _extract_usage(response: Any) -> tuple[int | None, int | None, int | None]:
    usage = getattr(response, "usage", None)
    prompt_tokens = getattr(usage, "prompt_tokens", None)
    completion_tokens = getattr(usage, "completion_tokens", None)
    total_tokens = getattr(usage, "total_tokens", None)
    return (
        int(prompt_tokens) if prompt_tokens is not None else None,
        int(completion_tokens) if completion_tokens is not None else None,
        int(total_tokens) if total_tokens is not None else None,
    )


def _extract_request_id(response: Any) -> str | None:
    request_id = getattr(response, "id", None)
    return str(request_id) if request_id else None


def _response_payload(response: Any) -> dict[str, Any]:
    try:
        if hasattr(response, "model_dump"):
            payload = response.model_dump()
        elif hasattr(response, "to_dict"):
            payload = response.to_dict()
        else:
            payload = {}
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}

def _coerce_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return round(float(value), 6)
    except Exception:
        return None


def _coerce_int(value: Any) -> int | None:
    try:
        if value is None:
            return None
        return int(value)
    except Exception:
        return None


def _find_first_numeric(payload: Any, keys: set[str]) -> float | None:
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in keys:
                parsed = _coerce_float(value)
                if parsed is not None:
                    return parsed
            parsed = _find_first_numeric(value, keys)
            if parsed is not None:
                return parsed
    elif isinstance(payload, list):
        for item in payload:
            parsed = _find_first_numeric(item, keys)
            if parsed is not None:
                return parsed
    return None


def _fetch_generation_detail(request_id: str, user_id: str | None = None) -> dict[str, Any] | None:
    if not request_id:
        return None
    try:
        base_url, api_key = _get_user_billing_config(user_id)
    except ValueError:
        return None
    try:
        url, params = _generation_endpoint(base_url, request_id)
            
        response = requests.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=AI_USAGE_HTTP_TIMEOUT,
        )
        if not response.ok:
            return None
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def _fetch_generation_page(page: int, user_id: str | None = None) -> list[dict[str, Any]]:
    try:
        base_url, api_key = _get_user_billing_config(user_id)
    except ValueError:
        return []
    try:
        url, _params = _generation_endpoint(base_url)
            
        response = requests.get(
            url,
            params={"page": page},
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=AI_USAGE_HTTP_TIMEOUT,
        )
        if not response.ok:
            return []
        payload = response.json()
        rows = payload.get("result") if isinstance(payload, dict) else None
        return rows if isinstance(rows, list) else []
    except Exception:
        return []


def _find_generation_in_recent_pages(request_id: str, max_pages: int = AI_USAGE_RECENT_PAGES, user_id: str | None = None) -> dict[str, Any] | None:
    if not request_id:
        return None
    for page in range(1, max_pages + 1):
        rows = _fetch_generation_page(page, user_id=user_id)
        for row in rows:
            if str(row.get("request_id") or "") == request_id:
                return row
    return None


def _extract_generation_metrics(payload: dict[str, Any]) -> tuple[int | None, int | None, int | None, float | None]:
    prompt_tokens = _coerce_int(
        _find_first_numeric(payload, {"prompt_tokens", "tokens_prompt", "input_tokens", "promptTokens", "inputTokens"})
    )
    completion_tokens = _coerce_int(
        _find_first_numeric(payload, {"completion_tokens", "tokens_completion", "output_tokens", "completionTokens", "outputTokens"})
    )
    total_tokens = _coerce_int(
        _find_first_numeric(payload, {"total_tokens", "tokens_total", "totalTokens", "usage_total_tokens"})
    )
    provider_cost_usd = _find_first_numeric(payload, {"cost", "price", "total_cost", "totalCost"})

    if total_tokens is None and prompt_tokens is not None and completion_tokens is not None:
        total_tokens = prompt_tokens + completion_tokens

    return prompt_tokens, completion_tokens, total_tokens, provider_cost_usd


def _resolve_chat_completion_metrics(response: Any, user_id: str | None = None) -> tuple[int | None, int | None, int | None, float | None, str | None]:
    request_id = _extract_request_id(response)
    prompt_tokens, completion_tokens, total_tokens = _extract_usage(response)
    payload = _response_payload(response)
    provider_cost_usd = _find_first_numeric(payload, {"cost", "price", "total_cost", "totalCost"})

    if request_id:
        detail_payload = _fetch_generation_detail(request_id, user_id=user_id)
        if detail_payload:
            detail_prompt, detail_completion, detail_total, detail_cost = _extract_generation_metrics(detail_payload)
            prompt_tokens = detail_prompt if detail_prompt is not None else prompt_tokens
            completion_tokens = detail_completion if detail_completion is not None else completion_tokens
            total_tokens = detail_total if detail_total is not None else total_tokens
            provider_cost_usd = detail_cost if detail_cost is not None else provider_cost_usd
        else:
            recent_payload = _find_generation_in_recent_pages(request_id, user_id=user_id)
            if recent_payload:
                detail_prompt, detail_completion, detail_total, detail_cost = _extract_generation_metrics(recent_payload)
                prompt_tokens = detail_prompt if detail_prompt is not None else prompt_tokens
                completion_tokens = detail_completion if detail_completion is not None else completion_tokens
                total_tokens = detail_total if detail_total is not None else total_tokens
                provider_cost_usd = detail_cost if detail_cost is not None else provider_cost_usd

    return prompt_tokens, completion_tokens, total_tokens, provider_cost_usd, request_id


def _billable_cost(total_tokens: int, provider_cost_usd: float | None) -> tuple[float | None, float | None]:
    if AI_BILLING_UNIT_PRICE_USD is None or str(AI_BILLING_UNIT_PRICE_USD).strip() == "":
        return None, None
    try:
        unit_price = float(AI_BILLING_UNIT_PRICE_USD)
    except Exception:
        return None, None
    billable_cost = round((total_tokens / AI_BILLING_TOKEN_UNIT) * unit_price, 6)
    return billable_cost, unit_price


def record_ai_usage(
    *,
    user_id: str | None,
    feature: str,
    operation: str,
    model: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    resource_id: str | None = None,
    provider: str | None = None,
    provider_cost_usd: float | None = None,
    request_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not user_id:
        return
    usage_scope = _classify_usage_scope(feature, operation, metadata or {})
    if usage_scope != "user_visible":
        return

    billable_cost_usd, unit_price_usd = _billable_cost(total_tokens, provider_cost_usd)

    db = SessionLocal()
    try:
        event = None
        if request_id:
          event = (
              db.query(AiUsageEvent)
              .filter(
                  AiUsageEvent.user_id == user_id,
                  AiUsageEvent.request_id == request_id,
                  AiUsageEvent.feature == feature,
                  AiUsageEvent.operation == operation,
              )
              .first()
          )
        if event is None:
            event = AiUsageEvent(
                id=str(uuid4()),
                user_id=user_id,
                created_at=datetime.utcnow(),
            )
            db.add(event)
        event.resource_id = resource_id
        event.feature = feature
        event.operation = operation
        event.provider = provider or AI_USAGE_PROVIDER
        event.model = model
        event.request_id = request_id
        event.prompt_tokens = max(0, int(prompt_tokens or 0))
        event.completion_tokens = max(0, int(completion_tokens or 0))
        event.total_tokens = max(0, int(total_tokens or 0))
        event.provider_cost_usd = provider_cost_usd
        event.billable_cost_usd = billable_cost_usd
        event.unit_tokens = AI_BILLING_TOKEN_UNIT
        event.unit_price_usd = unit_price_usd
        event.metadata_json = json.dumps(metadata or {})
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def record_chat_completion_usage(
    *,
    response: Any,
    user_id: str | None,
    feature: str,
    operation: str,
    model: str | None,
    prompt_text: str = "",
    completion_text: str = "",
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    prompt_tokens, completion_tokens, total_tokens, provider_cost_usd, request_id = _resolve_chat_completion_metrics(response, user_id=user_id)
    pending = total_tokens is None
    record_ai_usage(
        user_id=user_id,
        resource_id=resource_id,
        feature=feature,
        operation=operation,
        model=model,
        prompt_tokens=int(prompt_tokens or 0),
        completion_tokens=int(completion_tokens or 0),
        total_tokens=int(total_tokens or 0),
        provider_cost_usd=provider_cost_usd,
        request_id=request_id,
        metadata={
            **(metadata or {}),
            "exact_tokens": not pending,
            "exact_provider_cost": provider_cost_usd is not None,
            "pending_settlement": pending,
        },
    )


def record_stream_completion_usage(
    *,
    user_id: str | None,
    feature: str,
    model: str | None,
    request_id: str | None = None,
    resource_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not request_id:
        return
    detail_payload = _fetch_generation_detail(request_id, user_id=user_id)
    if not detail_payload:
        detail_payload = _find_generation_in_recent_pages(request_id, user_id=user_id)
    prompt_tokens, completion_tokens, total_tokens, provider_cost_usd = _extract_generation_metrics(detail_payload or {})
    pending = total_tokens is None
    record_ai_usage(
        user_id=user_id,
        resource_id=resource_id,
        feature=feature,
        operation="stream_chat",
        model=model,
        prompt_tokens=int(prompt_tokens or 0),
        completion_tokens=int(completion_tokens or 0),
        total_tokens=int(total_tokens or 0),
        provider_cost_usd=provider_cost_usd,
        request_id=request_id,
        metadata={
            **(metadata or {}),
            "exact_tokens": not pending,
            "exact_provider_cost": provider_cost_usd is not None,
            "pending_settlement": pending,
        },
    )


def serialize_ai_usage_event(event: AiUsageEvent) -> dict[str, Any]:
    metadata = _load_metadata(event.metadata_json)
    usage_scope = _classify_usage_scope(event.feature, event.operation, metadata)
    event_ts = None
    if event.created_at:
        if event.created_at.tzinfo is None:
            event_ts = event.created_at.replace(tzinfo=timezone.utc).isoformat()
        else:
            event_ts = event.created_at.astimezone(timezone.utc).isoformat()
    return {
        "id": event.id,
        "ts": event_ts,
        "user_id": event.user_id,
        "resource_id": event.resource_id,
        "feature": event.feature,
        "operation": event.operation,
        "provider": event.provider,
        "model": event.model,
        "request_id": event.request_id,
        "prompt_tokens": event.prompt_tokens or 0,
        "completion_tokens": event.completion_tokens or 0,
        "total_tokens": event.total_tokens or 0,
        "provider_cost_usd": event.provider_cost_usd,
        "billable_cost_usd": event.billable_cost_usd,
        "unit_tokens": event.unit_tokens,
        "unit_price_usd": event.unit_price_usd,
        "metadata": metadata,
        "usage_scope": usage_scope,
        "is_user_visible": usage_scope == "user_visible",
        "is_exact_settled": _is_exact_settled_tokens(
            event.total_tokens or 0,
            metadata,
        ),
    }


def _load_metadata(raw: str | None) -> dict[str, Any]:
    try:
        payload = json.loads(raw or "{}")
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _is_exact_settled_tokens(total_tokens: int | None, metadata: dict[str, Any]) -> bool:
    return bool(
        (total_tokens or 0) > 0
        and metadata.get("exact_tokens") is True
        and metadata.get("pending_settlement") is not True
    )


def _classify_usage_scope(
    feature: str | None,
    operation: str | None,
    metadata: dict[str, Any],
) -> str:
    explicit_scope = metadata.get("usage_scope")
    if explicit_scope in {"user_visible", "internal"}:
        return explicit_scope

    normalized_feature = (feature or "").lower()
    normalized_operation = (operation or "").lower()

    if normalized_operation in INTERNAL_OPERATIONS:
        return "internal"
    if any(keyword in normalized_feature for keyword in INTERNAL_FEATURE_KEYWORDS):
        return "internal"
    if normalized_operation in USER_VISIBLE_OPERATIONS:
        return "user_visible"
    if any(keyword in normalized_feature for keyword in USER_VISIBLE_FEATURE_KEYWORDS):
        return "user_visible"
    return "internal"


def _is_user_visible_usage(
    feature: str | None,
    operation: str | None,
    metadata: dict[str, Any],
) -> bool:
    return _classify_usage_scope(feature, operation, metadata) == "user_visible"


def read_ai_usage(db, user_id: str, limit: int = 2000) -> list[dict[str, Any]]:
    rows = (
        db.query(AiUsageEvent)
        .filter(AiUsageEvent.user_id == user_id)
        .order_by(AiUsageEvent.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        event
        for event in (serialize_ai_usage_event(row) for row in reversed(rows))
        if event.get("usage_scope") == "user_visible"
    ]


def reconcile_pending_ai_usage(db, user_id: str | None = None, max_pages: int = AI_USAGE_RECENT_PAGES) -> int:
    query = db.query(AiUsageEvent)
    if user_id:
        query = query.filter(AiUsageEvent.user_id == user_id)
    rows = query.order_by(AiUsageEvent.created_at.desc()).limit(200).all()
    recent_pages_cache = {page: _fetch_generation_page(page, user_id=user_id) for page in range(1, max_pages + 1)}
    recent_rows = {
        str(item.get("request_id") or ""): item
        for page_rows in recent_pages_cache.values()
        for item in page_rows
        if isinstance(item, dict) and item.get("request_id")
    }
    updated = 0
    for row in rows:
        try:
            metadata = json.loads(row.metadata_json or "{}")
        except Exception:
            metadata = {}
        if not metadata.get("pending_settlement"):
            continue
        request_id = str(row.request_id or "")
        if not request_id:
            continue
        payload = _fetch_generation_detail(request_id, user_id=row.user_id) or recent_rows.get(request_id)
        if not payload:
            continue
        prompt_tokens, completion_tokens, total_tokens, provider_cost_usd = _extract_generation_metrics(payload)
        if total_tokens is None:
            continue
        row.prompt_tokens = int(prompt_tokens or 0)
        row.completion_tokens = int(completion_tokens or 0)
        row.total_tokens = int(total_tokens or 0)
        row.provider_cost_usd = provider_cost_usd
        billable_cost_usd, unit_price_usd = _billable_cost(row.total_tokens, row.provider_cost_usd)
        row.billable_cost_usd = billable_cost_usd
        row.unit_price_usd = unit_price_usd
        metadata["pending_settlement"] = False
        metadata["exact_tokens"] = True
        metadata["exact_provider_cost"] = provider_cost_usd is not None
        row.metadata_json = json.dumps(metadata)
        updated += 1
    if updated:
        db.commit()
    return updated


def get_user_token_usage(db, user_id: str) -> int:
    rows = (
        db.query(AiUsageEvent)
        .filter(AiUsageEvent.user_id == user_id)
        .all()
    )
    total = 0
    for row in rows:
        metadata = _load_metadata(row.metadata_json)
        if (
            _is_exact_settled_tokens(row.total_tokens, metadata)
            and _is_user_visible_usage(row.feature, row.operation, metadata)
        ):
            total += int(row.total_tokens or 0)
    return total


def get_user_usage_summary(db, user_id: str) -> dict[str, Any]:
    used_tokens = get_user_token_usage(db, user_id)
    rows = (
        db.query(AiUsageEvent)
        .filter(AiUsageEvent.user_id == user_id)
        .all()
    )
    pending_events = 0
    settled_events = 0
    provider_total_tokens = 0
    provider_total_cost_usd = 0.0
    user_visible_events = 0
    for row in rows:
        metadata = _load_metadata(row.metadata_json)
        if not _is_user_visible_usage(row.feature, row.operation, metadata):
            continue
        if metadata.get("pending_settlement"):
            pending_events += 1
            continue
        if _is_exact_settled_tokens(row.total_tokens, metadata):
            settled_events += 1
            provider_total_tokens += int(row.total_tokens or 0)
            provider_total_cost_usd += float(row.provider_cost_usd or 0.0)
            user_visible_events += 1
    return {
        "used_tokens": used_tokens,
        "unit_tokens": AI_BILLING_TOKEN_UNIT,
        "units_burned": round(used_tokens / AI_BILLING_TOKEN_UNIT, 4),
        "settled_events": settled_events,
        "pending_events": pending_events,
        "user_visible_events": user_visible_events,
        "provider_total_tokens": provider_total_tokens,
        "provider_total_cost_usd": round(provider_total_cost_usd, 6),
    }


def _extract_wallet_amount(payload: Any) -> tuple[float | None, str | None]:
    amount = _find_first_numeric(payload, {"balance", "amount", "wallet_balance", "walletBalance", "credit", "credits"})
    currency = None
    if isinstance(payload, dict):
        for key in ("currency", "unit", "symbol"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                currency = value.strip().upper()
                break
        if currency is None:
            nested = payload.get("data") or payload.get("result")
            if isinstance(nested, dict):
                for key in ("currency", "unit", "symbol"):
                    value = nested.get(key)
                    if isinstance(value, str) and value.strip():
                        currency = value.strip().upper()
                        break
    return amount, currency


def get_user_wallet_balance(user_id: str | None) -> dict[str, Any]:
    try:
        base_url, api_key = _get_user_wallet_config(user_id)
    except ValueError:
        return {
            "configured": False,
            "available": False,
            "amount": None,
            "currency": None,
            "message": "Wallet balance is not configured.",
        }

    try:
        response = requests.get(
            base_url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            timeout=AI_USAGE_HTTP_TIMEOUT,
        )
        if not response.ok:
            return {
                "configured": True,
                "available": False,
                "amount": None,
                "currency": None,
                "message": f"Wallet API returned HTTP {response.status_code}.",
            }
        payload = response.json()
        amount, currency = _extract_wallet_amount(payload)
        return {
            "configured": True,
            "available": amount is not None,
            "amount": amount,
            "currency": currency,
            "message": None if amount is not None else "Wallet API response did not include a recognizable balance.",
        }
    except requests.exceptions.Timeout:
        return {
            "configured": True,
            "available": False,
            "amount": None,
            "currency": None,
            "message": "Wallet API timed out.",
        }
    except requests.exceptions.RequestException:
        return {
            "configured": True,
            "available": False,
            "amount": None,
            "currency": None,
            "message": "Wallet API request failed.",
        }
    except Exception:
        return {
            "configured": True,
            "available": False,
            "amount": None,
            "currency": None,
            "message": "Wallet API returned an unreadable response.",
        }


