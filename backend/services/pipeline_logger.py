"""Privacy-safe, request-scoped tracing for the complete RAG pipeline."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from functools import wraps
from inspect import signature
from time import perf_counter
from typing import Any, Callable, Iterator
from uuid import uuid4

from core.logger import get_logger


logger = get_logger("RAG")
_CURRENT_RAG_TRACE: ContextVar["RagPipelineTrace | None"] = ContextVar(
    "current_rag_trace",
    default=None,
)

_SAFE_CONTEXT_KEYS = {
    "streaming",
    "resourceScoped",
    "selectedResourceCount",
    "chatHistoryPresent",
    "concise",
    "globeMode",
    "mode",
    "reasonCode",
    "classification",
    "retrievalMode",
    "multiQuery",
    "rerank",
    "compressContext",
    "hallucinationCheck",
    "hyde",
    "cacheHit",
    "cacheAccepted",
    "cacheTrusted",
    "queryCount",
    "candidateCount",
    "deduplicatedCount",
    "resultCount",
    "chunkCount",
    "sourceCount",
    "hallucinationCount",
    "confidence",
    "confidenceLabel",
    "maxChunks",
    "retrievalDepth",
    "rrfK",
    "retryCount",
    "attempt",
    "quality",
    "parallel",
    "executed",
    "selected",
    "selectedLevelCount",
    "parentSectionCount",
    "contextCharacterCount",
    "contextTokenEstimate",
    "modulesExecuted",
    "modulesSkipped",
    "errorType",
    "errorCode",
    "outputType",
    "workflowNodeCount",
    "workflowEdgeCount",
}


def _safe_context(values: dict[str, Any] | None) -> dict[str, Any]:
    if not values:
        return {}
    safe: dict[str, Any] = {}
    for key, value in values.items():
        if key not in _SAFE_CONTEXT_KEYS or value is None:
            continue
        if isinstance(value, (bool, int, float)):
            safe[key] = value
        elif isinstance(value, str):
            safe[key] = value[:120]
        elif isinstance(value, (list, tuple, set)):
            safe[key] = [
                item if isinstance(item, (bool, int, float)) else str(item)[:80]
                for item in list(value)[:30]
            ]
    return safe


class RagPipelineTrace:
    """Emit one correlated, content-free trace for a RAG request."""

    def __init__(
        self,
        *,
        streaming: bool,
        resource_scoped: bool,
        selected_resource_count: int,
        chat_history_present: bool,
        concise: bool,
        globe_mode: bool,
    ) -> None:
        self.correlation_id = str(uuid4())
        self.streaming = streaming
        self.started_at = perf_counter()
        self._finished = False
        self._base_context = {
            "streaming": streaming,
            "resourceScoped": resource_scoped,
            "selectedResourceCount": selected_resource_count,
            "chatHistoryPresent": chat_history_present,
            "concise": concise,
            "globeMode": globe_mode,
        }

    @property
    def finished(self) -> bool:
        return self._finished

    def bind(self) -> Token:
        return _CURRENT_RAG_TRACE.set(self)

    @staticmethod
    def reset(token: Token) -> None:
        _CURRENT_RAG_TRACE.reset(token)

    def start(self) -> None:
        logger.info(
            "RAG pipeline started.",
            event="rag.pipeline_started",
            operation="rag_pipeline",
            phase="request",
            status="starting",
            correlation_id=self.correlation_id,
            context=self._base_context,
        )

    def begin_phase(
        self,
        phase: str,
        context: dict[str, Any] | None = None,
    ) -> float:
        logger.info(
            f"RAG phase started: {phase}.",
            event="rag.phase_started",
            operation="rag_pipeline",
            phase=phase,
            status="running",
            correlation_id=self.correlation_id,
            context=_safe_context(context),
        )
        return perf_counter()

    def complete_phase(
        self,
        phase: str,
        started_at: float,
        context: dict[str, Any] | None = None,
    ) -> None:
        logger.info(
            f"RAG phase completed: {phase}.",
            event="rag.phase_completed",
            operation="rag_pipeline",
            phase=phase,
            status="completed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
            context=_safe_context(context),
        )

    def fail_phase(self, phase: str, started_at: float, error: BaseException) -> None:
        logger.error(
            f"RAG phase failed: {phase}.",
            event="rag.phase_failed",
            operation="rag_pipeline",
            phase=phase,
            status="failed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
            context={
                "errorType": type(error).__name__,
                "errorCode": getattr(error, "code", type(error).__name__),
            },
        )

    def stop_phase(
        self,
        phase: str,
        started_at: float,
        *,
        reason_code: str,
    ) -> None:
        logger.info(
            f"RAG phase stopped: {phase}.",
            event="rag.phase_stopped",
            operation="rag_pipeline",
            phase=phase,
            status="stopped",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - started_at) * 1000),
            context={"reasonCode": reason_code},
        )

    def skip_phase(
        self,
        phase: str,
        *,
        reason_code: str,
        context: dict[str, Any] | None = None,
    ) -> None:
        logger.info(
            f"RAG phase skipped: {phase}.",
            event="rag.phase_skipped",
            operation="rag_pipeline",
            phase=phase,
            status="stopped",
            correlation_id=self.correlation_id,
            context=_safe_context({"reasonCode": reason_code, **(context or {})}),
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
            self.stop_phase(
                phase,
                started_at,
                reason_code="consumer_disconnected",
            )
            raise
        except BaseException as error:
            self.fail_phase(phase, started_at, error)
            raise
        else:
            self.complete_phase(phase, started_at, details)

    def finish(self, context: dict[str, Any] | None = None) -> None:
        if self._finished:
            return
        self._finished = True
        logger.info(
            "RAG pipeline completed.",
            event="rag.pipeline_completed",
            operation="rag_pipeline",
            phase="complete",
            status="completed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context=_safe_context(context),
        )

    def stop(self, reason_code: str) -> None:
        if self._finished:
            return
        self._finished = True
        logger.info(
            "RAG pipeline stopped.",
            event="rag.pipeline_stopped",
            operation="rag_pipeline",
            phase="complete",
            status="stopped",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context={"reasonCode": reason_code},
        )

    def fail(self, error: BaseException) -> None:
        if self._finished:
            return
        self._finished = True
        logger.exception(
            "RAG pipeline failed.",
            event="rag.pipeline_failed",
            operation="rag_pipeline",
            phase="complete",
            status="failed",
            correlation_id=self.correlation_id,
            duration_ms=max(0.0, (perf_counter() - self.started_at) * 1000),
            context={
                "errorType": type(error).__name__,
                "errorCode": getattr(error, "code", type(error).__name__),
            },
        )


def get_current_rag_trace() -> RagPipelineTrace | None:
    return _CURRENT_RAG_TRACE.get()


def _trace_from_call(func: Callable, args: tuple, kwargs: dict, streaming: bool) -> RagPipelineTrace:
    bound = signature(func).bind_partial(*args, **kwargs)
    values = bound.arguments
    selected_resources = values.get("selected_resource_ids") or []
    return RagPipelineTrace(
        streaming=streaming,
        resource_scoped=bool(values.get("resource_id")),
        selected_resource_count=len(selected_resources),
        chat_history_present=bool(values.get("chat_history")),
        concise=bool(values.get("concise", False)),
        globe_mode=bool(values.get("globe_on", False)),
    )


def trace_rag_pipeline(*, streaming: bool):
    """Decorate regular or generator RAG entry points with one safe run trace."""

    def decorator(func: Callable):
        if not streaming:
            @wraps(func)
            def wrapped(*args, **kwargs):
                trace = _trace_from_call(func, args, kwargs, False)
                token = trace.bind()
                trace.start()
                try:
                    result = func(*args, **kwargs)
                    trace.finish()
                    return result
                except BaseException as error:
                    trace.fail(error)
                    raise
                finally:
                    trace.reset(token)

            return wrapped

        @wraps(func)
        def wrapped_generator(*args, **kwargs):
            trace = _trace_from_call(func, args, kwargs, True)

            def generate():
                token = trace.bind()
                trace.start()
                try:
                    yield from func(*args, **kwargs)
                    trace.finish()
                except GeneratorExit:
                    trace.stop("consumer_disconnected")
                    raise
                except BaseException as error:
                    trace.fail(error)
                    raise
                finally:
                    trace.reset(token)

            return generate()

        return wrapped_generator

    return decorator


class PipelineLogger:
    """Compatibility shim for older call sites; never stores query text."""

    def __init__(self, _user_id: str, _query: str):
        self.trace = get_current_rag_trace()

    def log(self, step: str, **kwargs) -> None:
        if not self.trace:
            return
        started = self.trace.begin_phase(step)
        self.trace.complete_phase(step, started, _safe_context(kwargs))

    def flush(self) -> None:
        return
