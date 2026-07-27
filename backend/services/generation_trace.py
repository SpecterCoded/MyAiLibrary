"""Privacy-safe tracing for generation and regeneration provider calls."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from functools import wraps
from inspect import signature
from time import perf_counter
from typing import Any, Callable, Iterator
from uuid import uuid4

from core.logger import get_logger
from core.request_context import get_request_correlation_id


logger = get_logger("GENERATION")
_CURRENT_GENERATION_TRACE: ContextVar["GenerationTrace | None"] = ContextVar(
    "current_generation_trace",
    default=None,
)

_SAFE_CONTEXT_KEYS = {
    "feature",
    "generationMode",
    "streaming",
    "resourceScoped",
    "parentRequestId",
    "model",
    "provider",
    "cacheHit",
    "outputType",
    "outputItemCount",
    "promptTokenCount",
    "completionTokenCount",
    "totalTokenCount",
    "providerCostUsd",
    "billableCostUsd",
    "walletAvailable",
    "walletBalance",
    "walletCurrency",
    "providerIndexed",
    "pendingSettlement",
    "settlementAttempt",
    "errorType",
    "errorCode",
    "reasonCode",
}


def _safe_context(values: dict[str, Any] | None) -> dict[str, Any]:
    if not values:
        return {}
    result: dict[str, Any] = {}
    for key, value in values.items():
        if key not in _SAFE_CONTEXT_KEYS or value is None:
            continue
        if isinstance(value, (bool, int, float)):
            result[key] = value
        elif isinstance(value, str):
            result[key] = value[:160]
    return result


def get_current_generation_trace() -> "GenerationTrace | None":
    return _CURRENT_GENERATION_TRACE.get()


class GenerationTrace:
    """One content-free correlated run for an LLM generation operation."""

    def __init__(
        self,
        *,
        feature: str,
        streaming: bool,
        resource_scoped: bool,
    ) -> None:
        self.correlation_id = str(uuid4())
        self.parent_request_id = get_request_correlation_id()
        self.feature = feature or "generation"
        self.streaming = streaming
        self.resource_scoped = resource_scoped
        self.started_at = perf_counter()
        self.finished = False
        normalized = self.feature.lower()
        self.generation_mode = (
            "regeneration" if "regenerat" in normalized else "generation"
        )

    def bind(self) -> Token:
        return _CURRENT_GENERATION_TRACE.set(self)

    @staticmethod
    def reset(token: Token) -> None:
        _CURRENT_GENERATION_TRACE.reset(token)

    def start(self) -> None:
        logger.info(
            f"{self.generation_mode.title()} started: {self.feature}.",
            event="generation.run_started",
            operation="generation_pipeline",
            phase="request",
            status="starting",
            correlation_id=self.correlation_id,
            context=_safe_context(
                {
                    "feature": self.feature,
                    "generationMode": self.generation_mode,
                    "streaming": self.streaming,
                    "resourceScoped": self.resource_scoped,
                    "parentRequestId": self.parent_request_id,
                }
            ),
        )

    def begin_phase(
        self,
        phase: str,
        context: dict[str, Any] | None = None,
    ) -> float:
        logger.info(
            f"Generation phase started: {phase}.",
            event="generation.phase_started",
            operation="generation_pipeline",
            phase=phase,
            status="running",
            correlation_id=self.correlation_id,
            context=_safe_context({"feature": self.feature, **(context or {})}),
        )
        return perf_counter()

    def complete_phase(
        self,
        phase: str,
        started_at: float,
        context: dict[str, Any] | None = None,
    ) -> None:
        logger.info(
            f"Generation phase completed: {phase}.",
            event="generation.phase_completed",
            operation="generation_pipeline",
            phase=phase,
            status="completed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
            context=_safe_context({"feature": self.feature, **(context or {})}),
        )

    def fail_phase(
        self,
        phase: str,
        started_at: float,
        error: BaseException,
    ) -> None:
        logger.error(
            f"Generation phase failed: {phase}.",
            event="generation.phase_failed",
            operation="generation_pipeline",
            phase=phase,
            status="failed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
            context=_safe_context(
                {
                    "feature": self.feature,
                    "errorType": type(error).__name__,
                    "errorCode": getattr(error, "code", type(error).__name__),
                }
            ),
        )

    @contextmanager
    def phase(
        self,
        phase: str,
        context: dict[str, Any] | None = None,
    ) -> Iterator[dict[str, Any]]:
        details = dict(context or {})
        started_at = self.begin_phase(phase, details)
        try:
            yield details
        except GeneratorExit:
            logger.info(
                f"Generation phase stopped: {phase}.",
                event="generation.phase_stopped",
                operation="generation_pipeline",
                phase=phase,
                status="stopped",
                correlation_id=self.correlation_id,
                duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
                context=_safe_context(
                    {
                        "feature": self.feature,
                        "reasonCode": "consumer_disconnected",
                    }
                ),
            )
            raise
        except BaseException as error:
            self.fail_phase(phase, started_at, error)
            raise
        else:
            self.complete_phase(phase, started_at, details)

    def finish(self, result: Any = None) -> None:
        if self.finished:
            return
        self.finished = True
        output_item_count = None
        if isinstance(result, (list, tuple, dict)):
            output_item_count = len(result)
        logger.info(
            f"{self.generation_mode.title()} completed: {self.feature}.",
            event="generation.run_completed",
            operation="generation_pipeline",
            phase="complete",
            status="completed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context=_safe_context(
                {
                    "feature": self.feature,
                    "generationMode": self.generation_mode,
                    "outputType": type(result).__name__ if result is not None else None,
                    "outputItemCount": output_item_count,
                }
            ),
        )

    def fail(self, error: BaseException) -> None:
        if self.finished:
            return
        self.finished = True
        logger.error(
            f"{self.generation_mode.title()} failed: {self.feature}.",
            event="generation.run_failed",
            operation="generation_pipeline",
            phase="complete",
            status="failed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context=_safe_context(
                {
                    "feature": self.feature,
                    "generationMode": self.generation_mode,
                    "errorType": type(error).__name__,
                    "errorCode": getattr(error, "code", type(error).__name__),
                }
            ),
        )

    def stop(self, reason_code: str) -> None:
        if self.finished:
            return
        self.finished = True
        logger.info(
            f"{self.generation_mode.title()} stopped: {self.feature}.",
            event="generation.run_stopped",
            operation="generation_pipeline",
            phase="complete",
            status="stopped",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context=_safe_context(
                {
                    "feature": self.feature,
                    "generationMode": self.generation_mode,
                    "reasonCode": reason_code,
                }
            ),
        )

    def usage_received(self, metrics: dict[str, Any]) -> None:
        logger.info(
            "Provider usage metadata received.",
            event="generation.usage_received",
            operation="generation_pipeline",
            phase="provider_usage",
            status="waiting" if metrics.get("pendingSettlement") else "completed",
            correlation_id=self.correlation_id,
            context=_safe_context({"feature": self.feature, **metrics}),
        )


def trace_generation(*, streaming: bool = False):
    """Decorate a generator function while retaining its original signature."""

    def decorator(function: Callable):
        function_signature = signature(function)

        if streaming:
            @wraps(function)
            def stream_wrapper(*args, **kwargs):
                bound = function_signature.bind_partial(*args, **kwargs)
                bound.apply_defaults()
                feature = str(bound.arguments.get("feature") or function.__name__)
                trace = GenerationTrace(
                    feature=feature,
                    streaming=True,
                    resource_scoped=bool(bound.arguments.get("resource_id")),
                )
                token = trace.bind()
                trace.start()
                try:
                    yield from function(*args, **kwargs)
                except GeneratorExit:
                    trace.stop("consumer_disconnected")
                    raise
                except BaseException as error:
                    trace.fail(error)
                    raise
                else:
                    trace.finish()
                finally:
                    trace.reset(token)

            stream_wrapper.__signature__ = function_signature
            return stream_wrapper

        @wraps(function)
        def wrapper(*args, **kwargs):
            bound = function_signature.bind_partial(*args, **kwargs)
            bound.apply_defaults()
            feature = str(bound.arguments.get("feature") or function.__name__)
            trace = GenerationTrace(
                feature=feature,
                streaming=False,
                resource_scoped=bool(bound.arguments.get("resource_id")),
            )
            token = trace.bind()
            trace.start()
            try:
                result = function(*args, **kwargs)
            except BaseException as error:
                trace.fail(error)
                raise
            else:
                trace.finish(result)
                return result
            finally:
                trace.reset(token)

        wrapper.__signature__ = function_signature
        return wrapper

    return decorator
