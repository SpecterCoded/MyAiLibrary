"""Run your gold set through your REAL RAG pipeline and score it.

HOW TO USE
----------
1. Open this file and edit the SETTINGS block below (at minimum, put your USER_ID).
2. From the backend folder, with your venv active, run:

       python run_eval.py

3. It asks each question through your live RAG pipeline, scores the answers, prints a
   report, and saves it to eval_report.md.

Notes:
- Uses your library-wide RAG (resource_id = None) by default, i.e. "ask across
  everything". Set RESOURCE_ID to a specific resource id to scope it to one document.
- USE_LLM_JUDGE=True uses your chat model to grade faithfulness + answer relevance
  (small API cost). Set it False for a free, faster run that skips the AI judge.
- This reads from your database and calls your providers, exactly like the app does.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ----------------------------- SETTINGS (edit) -----------------------------
USER_ID = "PUT-YOUR-USER-ID-HERE"          # required
RESOURCE_ID = None                          # None = whole library; or a resource id
DATASET_PATH = os.path.join("evaluation", "datasets", "starter_goldset.json")
USE_LLM_JUDGE = True                        # False = skip the AI judge (free/faster)
OUTPUT_PATH = "eval_report.md"
# ---------------------------------------------------------------------------

from evaluation.models import BenchmarkConfig
from evaluation.benchmark_dataset import BenchmarkDatasetLoader
from evaluation.evaluator import RAGEvaluator
from evaluation.reports import build_benchmark_report, export_markdown


def _provider(question: str):
    """Ask one question through the real RAG pipeline and return its result dict."""
    from database import SessionLocal
    from services.rag_service import run_rag_pipeline

    db = SessionLocal()
    try:
        return run_rag_pipeline(
            db=db,
            user_id=USER_ID,
            resource_id=RESOURCE_ID,
            question=question,
            n_results=5,
        )
    finally:
        db.close()


def main() -> int:
    if USER_ID == "PUT-YOUR-USER-ID-HERE":
        print("ERROR: edit run_eval.py and set USER_ID to your real user id first.")
        return 1

    dataset = BenchmarkDatasetLoader.load_file(DATASET_PATH)
    print(f"Loaded {len(dataset.examples)} questions from '{dataset.name}'.\n")

    cfg = BenchmarkConfig(
        use_llm_judge=USE_LLM_JUDGE,
        judge_user_id=USER_ID if USE_LLM_JUDGE else None,
    )
    evaluator = RAGEvaluator(cfg)

    samples = []
    for i, example in enumerate(dataset.examples, start=1):
        print(f"[{i}/{len(dataset.examples)}] {example.question}")
        try:
            payload = _provider(example.question)
        except Exception as e:
            print(f"    !! pipeline error: {e}")
            continue
        run = evaluator.normalize_observed_run(payload, default_question=example.question)
        sample = evaluator.evaluate(example, run)
        samples.append(sample)
        extra = ""
        if sample.quality.llm_judge_used:
            extra = f", judged-faithfulness={sample.quality.llm_faithfulness}, relevance={sample.quality.answer_relevance}"
        print(f"    overall={sample.overall_score}{extra}")

    if not samples:
        print("\nNo questions were scored — check USER_ID / that your backend is configured.")
        return 1

    report = build_benchmark_report(dataset.name, cfg, samples)
    md = export_markdown(report)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(md)

    print("\n" + "=" * 50)
    print(md)
    print("=" * 50)
    print(f"\nReport saved to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
