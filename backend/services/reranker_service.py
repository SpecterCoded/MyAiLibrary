import os
from datetime import datetime, timedelta
from services.dependency_failure_service import DependencyFailure, classify_provider_error, missing_configuration
import requests
import time as _time

_user_reranker_cache: dict[str, tuple] = {}


def get_user_reranker_config(user_id: str | None) -> tuple[str, str, str | None, str]:
    """Return (provider, model, api_key, base_url) configured from the user's settings.

    Results are cached for 5 minutes per user.
    Raises ValueError if the user has no configured reranker settings.
    """
    if not user_id:
        raise ValueError("No user ID provided. Each user must configure their own Reranker settings.")

    now = _time.time()
    if user_id in _user_reranker_cache:
        cached_provider, cached_model, cached_key, cached_url, cached_at = _user_reranker_cache[user_id]
        if now - cached_at < 300:
            return cached_provider, cached_model, cached_key, cached_url

    from database import SessionLocal
    from models import UserSetting
    db = SessionLocal()
    try:
        settings = db.query(UserSetting).filter(UserSetting.user_id == user_id).first()
        if not settings or not settings.reranker_base_url or not settings.reranker_api_key:
            failure = missing_configuration(
                service="Reranker",
                stage="reranking",
                settings_section="Reranker",
                fields=["Base URL", "API key"],
            )
            _notify_reranker_failure(user_id, failure)
            raise failure
        provider = "cohere" if "cohere" in (settings.reranker_base_url or "").lower() else "custom"
        model = settings.reranker_model or "rerank-v4.0-fast"
        base_url = settings.reranker_base_url.rstrip("/")
        _user_reranker_cache[user_id] = (provider, model, settings.reranker_api_key, base_url, now)
        return provider, model, settings.reranker_api_key, base_url
    finally:
        db.close()


def _notify_reranker_failure(user_id: str | None, failure: DependencyFailure) -> None:
    """Create one actionable settings notification per failure window."""
    if not user_id:
        return

    from database import SessionLocal
    from models import Notification

    db = SessionLocal()
    try:
        cutoff = datetime.utcnow() - timedelta(minutes=5)
        recent_notification = (
            db.query(Notification.id)
            .filter(
                Notification.user_id == user_id,
                Notification.category == "system",
                Notification.title == "Reranker needs attention",
                Notification.created_at >= cutoff,
            )
            .first()
        )
        if not recent_notification:
            from main import create_notification

            _, message = failure.notification_for("RAG search")
            create_notification(
                db=db,
                user_id=user_id,
                category="system",
                title="Reranker needs attention",
                message=message,
                link="/settings",
            )
    finally:
        db.close()


def rerank_results(query: str, results: list, top_k: int = 5, user_id: str | None = None):
    if not results:
        return []

    _provider, _model, _api_key, _base_url = get_user_reranker_config(user_id)

    # Use the URL exactly as the user provided — no suffix added.
    url = _base_url
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "Authorization": f"Bearer {_api_key}"
    }

    documents = [res["content"] for res in results]
    payload = {
        "model": _model,
        "query": query,
        "documents": documents,
        "top_n": top_k
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        response_json = response.json()

        rerank_results = response_json.get("results", [])
        ranked_results = []
        for item in rerank_results:
            orig_idx = item["index"]
            score = item["relevance_score"]
            orig_item = results[orig_idx]
            orig_item["rerank_score"] = float(score)
            ranked_results.append(orig_item)

        return ranked_results
    except Exception as e:
        failure = classify_provider_error(
            service="Reranker", stage="reranking", error=e,
            settings_section="Reranker", model=_model,
        )
        _notify_reranker_failure(user_id, failure)
        raise failure from e
