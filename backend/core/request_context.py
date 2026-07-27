"""Request-scoped correlation shared by API, generation, and billing logs."""

from __future__ import annotations

from contextvars import ContextVar, Token


_REQUEST_CORRELATION_ID: ContextVar[str | None] = ContextVar(
    "request_correlation_id",
    default=None,
)


def get_request_correlation_id() -> str | None:
    return _REQUEST_CORRELATION_ID.get()


def set_request_correlation_id(correlation_id: str) -> Token:
    return _REQUEST_CORRELATION_ID.set(correlation_id)


def reset_request_correlation_id(token: Token) -> None:
    _REQUEST_CORRELATION_ID.reset(token)
