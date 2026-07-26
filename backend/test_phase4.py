"""Phase 4 self-test — run this to verify the evaluation tool works.

HOW TO RUN (from the backend folder, with your venv active):

    python test_phase4.py

It uses fake, hand-made data — it does NOT touch your app, your database, your
documents, or any API (unless you turn the optional LLM judge on at the bottom).
Every check prints PASS or FAIL. If you see "ALL CHECKS PASSED", Phase 4 is working.
"""

import os
import sys

# Make sure we can import the backend packages when run from the backend folder.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ok = True


def check(label, condition):
    global ok
    print(("  PASS  " if condition else "  FAIL  ") + label)
    if not condition:
        ok = False


print("\n=== Phase 4 evaluation self-test ===\n")

# 1) Everything imports
from evaluation.models import BenchmarkConfig, BenchmarkExample, ObservedRun, ObservedChunk, ObservedSource
from evaluation.evaluator import RAGEvaluator
from evaluation.scoring import build_regression_report, regression_gate
from evaluation.reports import build_benchmark_report, export_markdown
from evaluation.auto_benchmark import to_benchmark_dataset
print("1) Imports")
check("evaluation package imports cleanly", True)

# 2) Score a good answer that HAS ground truth
good_run = ObservedRun(
    question="What is Reciprocal Rank Fusion?",
    answer="Reciprocal Rank Fusion merges ranked lists using 1/(k+rank).",
    context="Reciprocal Rank Fusion (RRF) combines multiple ranked lists with the formula 1/(k+rank).",
    retrieved_chunks=[ObservedChunk(resource_id="r1", chunk_index=3, content="RRF combines ranked lists using 1/(k+rank).")],
    sources=[ObservedSource(resource_id="r1", excerpt="RRF ...")],
    hallucinations=[],
    confidence=0.8,
)
good_example = BenchmarkExample(
    question="What is Reciprocal Rank Fusion?",
    expected_answer="Reciprocal Rank Fusion combines ranked lists",
    expected_chunk_ids=["r1:3"],       # <-- ground truth: the right chunk
    expected_document_ids=["r1"],
    category="definition",
)
s_good = RAGEvaluator(BenchmarkConfig()).evaluate(good_example, good_run)
print("\n2) A good answer with ground truth")
print(f"      recall@k={s_good.retrieval.recall_at_k}  precision@k={s_good.retrieval.precision_at_k}  overall={s_good.overall_score}")
check("retrieved the expected chunk -> recall is a real 1.0", s_good.retrieval.recall_at_k == 1.0)
check("overall score is high for a good answer", s_good.overall_score > 0.7)

# 3) The inflation bug is fixed: no ground truth must NOT score a fake perfect 1.0
bare_run = ObservedRun(question="Q", answer="an answer", context="ctx", retrieved_chunks=[], sources=[])
s_bare = RAGEvaluator(BenchmarkConfig()).evaluate(BenchmarkExample(question="Q"), bare_run)
print("\n3) No ground truth (should NOT be inflated)")
print(f"      recall@k={s_bare.retrieval.recall_at_k}  ndcg={s_bare.retrieval.ndcg}  citation={s_bare.quality.citation_accuracy}")
check("no fake perfect scores when there is no ground truth", s_bare.retrieval.recall_at_k == 0.0 and s_bare.retrieval.ndcg == 0.0)

# 4) Auto-benchmark -> dataset bridge carries the gold IDs
ds = to_benchmark_dataset(
    [{"question": "q1", "expected_answer": "a1", "expected_chunk_ids": ["r1:0"], "expected_document_ids": ["r1"]}],
    name="demo",
)
print("\n4) Auto-benchmark dataset bridge")
check("generated example keeps its expected_chunk_ids", ds.examples[0].expected_chunk_ids == ["r1:0"])

# 5) Regression gate catches a quality drop
cfg = BenchmarkConfig()
baseline = build_benchmark_report("baseline", cfg, [s_good])
worse = s_good.model_copy(update={"overall_score": s_good.overall_score - 0.3})
candidate = build_benchmark_report("candidate", cfg, [worse])
gate = regression_gate(build_regression_report(baseline, candidate))
print("\n5) Regression gate")
print(f"      passed={gate['passed']}  failures={gate['failures']}")
check("gate FAILS when quality drops", gate["passed"] is False)

# 6) A human-readable report renders
md = export_markdown(baseline)
print("\n6) Markdown report")
check("report renders with content", "Benchmark Report" in md and len(md) > 100)

print("\n" + ("=" * 40))
print("ALL CHECKS PASSED ✅" if ok else "SOME CHECKS FAILED ❌ — see above")
print("=" * 40)

# ---------------------------------------------------------------------------
# OPTIONAL: turn on the real LLM judge (uses your chat model + costs a little).
# Uncomment and set your user id, then run again:
#
#   import evaluation.evaluator as _e
#   cfg = BenchmarkConfig(use_llm_judge=True, judge_user_id="<YOUR_USER_ID>")
#   judged = RAGEvaluator(cfg).evaluate(good_example, good_run)
#   print("LLM-judged faithfulness:", judged.quality.llm_faithfulness,
#         "answer_relevance:", judged.quality.answer_relevance)
# ---------------------------------------------------------------------------

sys.exit(0 if ok else 1)
