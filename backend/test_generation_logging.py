import unittest
from unittest.mock import Mock, patch

from core.logger import _sanitize_value
from services import ai_cost_service
from services import generation_trace
from services import llm_service
from services import provider_billing_service


class _CaptureLogger:
    def __init__(self):
        self.events = []

    def _capture(self, level, message, **kwargs):
        self.events.append({"level": level, "message": message, **kwargs})

    def info(self, message, **kwargs):
        self._capture("info", message, **kwargs)

    def warning(self, message, **kwargs):
        self._capture("warning", message, **kwargs)

    def error(self, message, **kwargs):
        self._capture("error", message, **kwargs)


class GenerationLoggingTests(unittest.TestCase):
    def test_generation_trace_is_correlated_and_content_free(self):
        capture = _CaptureLogger()

        @generation_trace.trace_generation()
        def sample(prompt, feature="summary_regeneration", resource_id="resource-1"):
            return f"PRIVATE OUTPUT FOR {prompt}"

        with patch.object(generation_trace, "logger", capture):
            result = sample("PRIVATE PROMPT")

        self.assertIn("PRIVATE OUTPUT", result)
        self.assertGreaterEqual(len(capture.events), 2)
        correlation_ids = {
            event.get("correlation_id")
            for event in capture.events
            if event.get("correlation_id")
        }
        self.assertEqual(len(correlation_ids), 1)
        serialized = repr(capture.events)
        self.assertNotIn("PRIVATE PROMPT", serialized)
        self.assertNotIn("PRIVATE OUTPUT", serialized)
        self.assertIn("summary_regeneration", serialized)

    def test_token_metrics_survive_redaction_but_credentials_do_not(self):
        safe = _sanitize_value(
            {
                "promptTokenCount": 120,
                "completionTokenCount": 30,
                "totalTokenCount": 150,
                "apiToken": "secret-value",
            }
        )
        self.assertEqual(safe["promptTokenCount"], 120)
        self.assertEqual(safe["completionTokenCount"], 30)
        self.assertEqual(safe["totalTokenCount"], 150)
        self.assertEqual(safe["apiToken"], "[REDACTED]")

    def test_chat_usage_schedules_provider_settlement_and_returns_metrics(self):
        response = Mock()
        with (
            patch.object(
                ai_cost_service,
                "_resolve_chat_completion_metrics",
                return_value=(100, 25, 125, 0.0042, "request-1", True),
            ),
            patch.object(ai_cost_service, "record_ai_usage") as record_usage,
            patch.object(
                ai_cost_service,
                "_schedule_provider_usage_settlement",
            ) as schedule,
        ):
            metrics = ai_cost_service.record_chat_completion_usage(
                response=response,
                user_id="user-1",
                resource_id="resource-1",
                feature="quiz_regeneration",
                operation="content_generation",
                model="model-1",
                correlation_id="trace-1",
            )

        self.assertEqual(metrics["promptTokenCount"], 100)
        self.assertEqual(metrics["completionTokenCount"], 25)
        self.assertEqual(metrics["totalTokenCount"], 125)
        self.assertEqual(metrics["providerCostUsd"], 0.0042)
        self.assertFalse(metrics["pendingSettlement"])
        record_usage.assert_called_once()
        self.assertEqual(schedule.call_args.kwargs["correlation_id"], "trace-1")

    def test_json_generation_traces_provider_and_parsing_phases(self):
        capture = _CaptureLogger()
        response = Mock()
        response.choices = [Mock(message=Mock(content='[{"front":"A","back":"B"}]'))]
        client = Mock()
        client.chat.completions.create.return_value = response

        with (
            patch.object(generation_trace, "logger", capture),
            patch.object(
                llm_service,
                "get_user_chat_client",
                return_value=(client, "model-1"),
            ),
            patch.object(llm_service, "_record_completion"),
        ):
            result = llm_service.generate_flashcards(
                "PRIVATE TRANSCRIPT",
                user_id="user-1",
                resource_id="resource-1",
                feature="flashcards_regeneration",
            )

        self.assertEqual(result, [{"front": "A", "back": "B"}])
        serialized = repr(capture.events)
        self.assertIn("provider_configuration", serialized)
        self.assertIn("provider_request", serialized)
        self.assertIn("response_parsing", serialized)
        self.assertNotIn("PRIVATE TRANSCRIPT", serialized)

    def test_settlement_logs_indexed_cost_tokens_and_wallet(self):
        capture = _CaptureLogger()
        payload = {
            "data": {
                "prompt_tokens": 80,
                "completion_tokens": 20,
                "total_tokens": 100,
                "total_cost": 0.0035,
            }
        }
        with (
            patch.object(ai_cost_service, "_usage_logger", capture),
            patch.object(
                ai_cost_service,
                "_fetch_generation_detail",
                return_value=payload,
            ),
            patch.object(ai_cost_service, "record_ai_usage") as record_usage,
            patch.object(
                ai_cost_service,
                "get_user_wallet_balance",
                return_value={
                    "available": True,
                    "amount": 9.75,
                    "currency": "USD",
                },
            ),
            patch.object(ai_cost_service._time, "sleep"),
        ):
            ai_cost_service._settle_provider_usage(
                user_id="user-1",
                resource_id="resource-1",
                feature="summary_regeneration",
                operation="content_generation",
                model="model-1",
                request_id="provider-request-1",
                correlation_id="trace-1",
                metadata={},
                settlement_key="test-settlement",
            )

        record_usage.assert_called_once()
        settled = next(
            event
            for event in capture.events
            if event.get("event") == "provider.usage_settled"
        )
        self.assertEqual(settled["correlation_id"], "trace-1")
        self.assertEqual(settled["context"]["totalTokenCount"], 100)
        self.assertEqual(settled["context"]["providerCostUsd"], 0.0035)
        self.assertEqual(settled["context"]["walletBalance"], 9.75)

    def test_non_chat_provider_billing_reports_exact_zero_and_unavailable(self):
        capture = _CaptureLogger()
        with patch.object(provider_billing_service, "logger", capture):
            exact = provider_billing_service.report_provider_billing(
                provider_service="embedding",
                provider="custom",
                response={
                    "usage": {"prompt_tokens": 42, "total_tokens": 42},
                    "total_cost": 0.0012,
                },
            )
            zero = provider_billing_service.report_provider_billing(
                provider_service="transcription",
                provider="local_whisper_cpp",
                exact_zero_cost=True,
                zero_cost_reason="local_inference_no_provider_charge",
                unit_count=30,
                unit_label="audio_seconds",
            )
            unavailable = provider_billing_service.report_provider_billing(
                provider_service="reranking",
                provider="cohere",
                response={"meta": {"billed_units": {"search_units": 1}}},
            )

        self.assertEqual(exact["billingStatus"], "exact")
        self.assertEqual(exact["providerCostUsd"], 0.0012)
        self.assertEqual(exact["totalTokenCount"], 42)
        self.assertEqual(zero["billingStatus"], "zero")
        self.assertEqual(zero["providerCostUsd"], 0.0)
        self.assertEqual(unavailable["billingStatus"], "unavailable")
        self.assertEqual(unavailable["providerUnitCount"], 1.0)
        serialized = repr(capture.events)
        self.assertIn("provider.billing_reported", serialized)
        self.assertIn("provider.billing_unavailable", serialized)


if __name__ == "__main__":
    unittest.main()
