import unittest
from types import SimpleNamespace
from unittest.mock import patch

from services import llm_service


def _chunk(content=None, finish_reason=None, request_id="request-1"):
    if content is None and finish_reason is None:
        return SimpleNamespace(id=request_id, choices=[])
    return SimpleNamespace(
        id=request_id,
        choices=[
            SimpleNamespace(
                delta=SimpleNamespace(content=content),
                finish_reason=finish_reason,
            )
        ],
    )


class ChatStreamReliabilityTests(unittest.TestCase):
    def _generate(self, responses):
        state = {}
        calls = []

        def create(*_args, **kwargs):
            calls.append(kwargs)
            return responses.pop(0), "test-model"

        with (
            patch.object(llm_service, "_create_chat_completion", side_effect=create),
            patch.object(llm_service, "record_stream_completion_usage", return_value={}),
        ):
            output = "".join(
                llm_service.generate_answer_stream(
                    "PRIVATE QUESTION",
                    "PRIVATE CONTEXT",
                    user_id="user-1",
                    resource_id="resource-1",
                    stream_state=state,
                )
            )
        return output, state, calls

    def test_stop_and_empty_choice_chunks_are_complete(self):
        output, state, calls = self._generate(
            [[_chunk(), _chunk("A complete answer."), _chunk(finish_reason="stop")]]
        )
        self.assertEqual(output, "A complete answer.")
        self.assertEqual(state["finish_reason"], "stop")
        self.assertEqual(state["completion_status"], "complete")
        self.assertFalse(state["can_continue"])
        self.assertEqual(calls[0]["max_tokens"], 4096)

    def test_length_continues_twice_and_removes_boundary_overlap(self):
        output, state, calls = self._generate(
            [
                [_chunk("Alpha boundary"), _chunk(finish_reason="length")],
                [_chunk("boundary continues"), _chunk(finish_reason="length")],
                [_chunk("continues done"), _chunk(finish_reason="stop")],
            ]
        )
        self.assertEqual(output, "Alpha boundary continues done")
        self.assertEqual(len(calls), 3)
        self.assertEqual(state["continuation_count"], 2)
        self.assertEqual(state["completion_status"], "complete")

    def test_length_after_limit_offers_manual_continuation(self):
        output, state, calls = self._generate(
            [
                [_chunk("one"), _chunk(finish_reason="length")],
                [_chunk(" two"), _chunk(finish_reason="length")],
                [_chunk(" three"), _chunk(finish_reason="length")],
            ]
        )
        self.assertEqual(output, "one two three")
        self.assertEqual(len(calls), 3)
        self.assertEqual(state["completion_status"], "incomplete")
        self.assertTrue(state["can_continue"])

    def test_content_filter_is_terminal_but_not_complete(self):
        _, state, _ = self._generate(
            [[_chunk("partial"), _chunk(finish_reason="content_filter")]]
        )
        self.assertEqual(state["completion_status"], "blocked")
        self.assertFalse(state["can_continue"])


if __name__ == "__main__":
    unittest.main()
