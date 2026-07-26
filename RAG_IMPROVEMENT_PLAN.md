# MyAiLibrary / Journalit — RAG Improvement Plan (7 → 9–9.5)

> A plain-language roadmap for raising the RAG system from a **7/10** to a **9–9.5/10**.
> Companion to `RAG_SYSTEM_DOCUMENTATION.md`.
>
> **The one-sentence idea:** You are not missing techniques — you have more than most
> commercial systems. You reach 9 by making everything you already built **actually run,
> actually be correct, and provably work**. This is a finishing job, not a rebuild.

---

## The mental model behind this plan

Two things separate a 7 from a 9.5:

1. **A 7 is a system with impressive parts. A 9.5 is a system where every part is correct,
   active, and measured.**
2. **You can't safely tune what you can't honestly measure.** That's why real evaluation
   (Phase 4) comes before turning features on (Phase 5) — the order matters.

### The "master switch + agent judgment" idea (important)

Every advanced feature has **two layers**, and keeping them straight is the key to this
whole plan:

- **The master switch** = *"Is this feature allowed at all?"* (the on/off default in
  `core/config.py` and per-user settings). Most of yours are currently **off**.
- **The agent's own judgment** = *"Does THIS specific question actually need it?"* This
  logic **already exists** in your code (e.g. `decide_parent_expansion`,
  `decide_hierarchical_enrichment`, and the per-query `RetrievalPlan`).

The agent already decides, question by question, whether a technique helps — and each
question is judged fresh, so nothing has to be "turned off after." The problem today is
that this smart judgment is **locked behind the master switch being off**, so the agent
never even gets asked.

**So "turning a feature on" does not mean forcing it on every query.** It means flipping
the master switch to *"allowed"* and letting the judgment code you already wrote do its job
per question. That is the safe, elegant way to activate your best work.

---

## The plan at a glance

| Phase | What it does | Rough effort | Gets you to |
|---|---|---|---|
| 1 | Fix what's silently broken | ~1 week | ~7.5 |
| 2 | Confirm the chat experience is complete | ~2–3 days | ~8 |
| 3 | Speed: batch the embeddings | ~2–3 days | ~8 |
| 4 | **Real evaluation (the graduation)** | ~2–3 weeks | **9** |
| 5 | Activate proven features via the master switch | ongoing, guided by Phase 4 | **9–9.5** |

Phases 1–3 are cleanup and hardening. Phase 4 is the real graduation. Phase 5 depends
entirely on Phase 4 existing first.

---

## Phase 1 — Fix what's silently broken  (→ ~7.5)

These are leaks in the boat: features you already paid to build that aren't running. Mostly
deleting duplicates and reconnecting things left disconnected. Low risk, high tidiness.

**Checklist:**

- [ ] **Remove duplicate function definitions.** `generate_quiz` and `generate_flashcards`
      are each defined twice in `llm_service.py`; the second silently wins, so the first
      versions are dead code. Delete the unused ones. `_default_hierarchical_expander` is
      also defined twice in `planner_executor.py` — remove the shadowed one.
- [ ] **Fix the embedding compressor.** `compress_by_embedding` is called without a
      `user_id`, so it always throws and silently falls back to "first N chunks" — i.e. it
      does nothing. Pass the `user_id` through so it actually works (or remove it if you
      don't want it).
- [ ] **Wire up (or remove) LettuceDetect.** The `_detector` in `hallucination_service.py`
      is never initialized, so that whole detection path is dead. Either initialize it at
      startup or delete the branch to reduce confusion.
- [ ] **Restore the missing evaluation file.** `evaluation/benchmark_runner.py` imports
      `build_benchmark_report` from `evaluation/reports.py`, which **doesn't exist** — so
      the batch/benchmark path fails to even import. Create `reports.py` (this becomes the
      foundation for Phase 4) or stub it.
- [ ] **Give the planner control of HyDE and RRF-k.** `planner_prompt.py` leaves
      `use_hyde` and `rrf_k` out of the required fields, so in the (default) LLM planner
      path they never get set. Add them so the planner can actually choose them.
- [ ] **Reconcile the confidence formula.** The docstring in `confidence_service.py` says
      40/40/20 but the code is 35/30/15/10/10. Make the comment match the code (or the code
      match the intended design) so the number is trustworthy.

---

## Phase 2 — Confirm the chat experience is complete  (→ ~8)

**Correction to an earlier note:** the streaming chat path (`run_rag_pipeline_stream`, used
by `/resources/{resource_id}/chat-stream` and `/api/chat-stream` — i.e. your chat page and
Ask AI tabs) **does** run verification after the answer finishes: it applies citation
cleanup, always computes a confidence score, and runs the hallucination check *when the plan
enables it*. So this is a small polish, not a rewrite.

**Checklist:**

- [ ] **Confirm the frontend swaps in the final answer.** During streaming the user sees
      *raw* tokens; a cleaned, cited version is sent right after in a follow-up event. Make
      sure the UI replaces the displayed answer with that final cited version so users
      actually see the citations.
- [ ] **Consider forcing the hallucination check on for the chat tabs.** Today it's the
      planner's per-query call, so simple questions may skip it. Since chat is your main
      surface, you may want it always on there (or on for anything above "simple").
- [ ] **Confirm confidence is shown to the user.** The score is computed on every answer —
      surface it (e.g. a small badge) so people know how grounded an answer is.

---

## Phase 3 — Speed: batch the embeddings  (part of → 8)

Right now indexing sends **one chunk at a time** to the embedding API — like mailing 100
letters in 100 separate envelopes. The API accepts arrays; one envelope is enough.

**Checklist:**

- [ ] **Batch embedding calls** in `embedding_service.store_resource_embeddings` /
      `embed_text` (send arrays instead of one string per call). Biggest speed and cost win
      in the system.
- [ ] **Validate the embedding dimension** against the collection instead of the hardcoded
      3072, so switching to a smaller model (e.g. a 1536-dim one) doesn't corrupt vectors.
- [ ] **Add semantic-cache invalidation** on re-index, so a cached answer can't stay stale
      after its source document changes.

---

## Phase 4 — Real evaluation: the graduation  (→ 9)

This is the honest truth about 8 → 9: **an excellent RAG system is one you can prove is
excellent.** Today your evaluation grades answers by counting shared words, so a
confidently *wrong* answer that reuses the document's vocabulary scores as "faithful." That
isn't measurement — it's a mirror. Fix this and two things happen: you can trust your own
quality number, and you can finally tell which dormant features actually help (which
unlocks Phase 5).

**Checklist:**

- [ ] **Add a real judge.** Replace the word-overlap "faithfulness/relevance" metrics with
      an LLM-as-judge (or your NLI model) that decides whether each answer is genuinely
      supported by the sources. Add a true **answer-relevance** metric too.
- [ ] **Build a human-checked gold set.** Your `auto_benchmark` currently writes both the
      questions *and* the "correct" answers with the same model — that measures
      self-consistency, not correctness. Have a human verify a starter set of ~50–100
      question/answer/expected-source items.
- [ ] **Fix the score-inflating defaults.** `recall_at_k` returns 1.0 when there are no
      relevant IDs, and `citation_accuracy` returns 1.0 when there are no expectations —
      both quietly inflate results on ungrounded data.
- [ ] **Fix the auto-benchmark schema mismatch.** It emits `source_chunk_index`/
      `resource_id`, but the evaluator expects `expected_chunk_ids`/`expected_document_ids`.
      Add the adapter so auto-generated data can actually drive retrieval metrics.
- [ ] **Finish the reports + a simple regression gate.** Build the `reports.py` from
      Phase 1 into real JSON/Markdown output, and add a basic pass/fail comparison between
      runs so a change that lowers quality is caught before shipping.

---

## Phase 5 — Activate proven features, guided by the evaluation  (→ 9–9.5)

Now — and only now — you turn on the dormant features, because you can finally measure
whether each one helps. Remember the master-switch idea: flipping the switch to *"allowed"*
lets your existing per-question judgment code decide when to actually use it. You are not
forcing anything onto every query.

**Candidates to test (already built, currently off):** parent-child retrieval,
hierarchical retrieval, HyDE, query routing, contextual enrichment, semantic document
chunking.

**How to do it safely, one feature at a time:**

1. Flip that feature's master switch to *allowed* in a test setup.
2. Run the Phase 4 evaluation with it on vs. off.
3. If it improves quality → promote it to **on by default**. If it doesn't → leave it as a
   user-controlled option and move on.

**The middle path (my actual recommendation), not "flip everything" or "touch nothing":**

- **Fix the bugs regardless** (Phase 1) so any feature works correctly when someone does
  enable it.
- **Leave the expensive/experimental ones user-controlled** — that's a defensible product
  choice, especially for cost (e.g. contextual enrichment is one LLM call *per chunk*).
- **Promote the 2–3 that clearly help to on-by-default.** This is what actually earns the
  9, because the score reflects the *default* experience a normal user gets — and most
  users will never know to turn a feature on themselves.

---

## Bonus hardening (nice-to-have, pushes toward 9.5)

- [ ] **Make the reranker fail-soft.** It's currently the one component that hard-fails on
      an outage; fall back to the fused order instead, and add a minimum relevance-score
      floor so weak top-5 results don't silently reach the answer.
- [ ] **Harden NLI verification.** Verify the model's label order at load, and score each
      claim against its most-relevant chunk(s) rather than one big truncated blob of
      context.
- [ ] **Unify the token-size math.** Different parts of the code measure chunk size in
      characters, tokens, and `len//4`. Pick one and use it everywhere.

---

## Suggested order to actually start

1. **Phase 1 bug fixes** — quick, safe, and they make everything else trustworthy.
2. **Phase 4 evaluation** — the highest-leverage work; everything about reaching 9 depends
   on it.
3. Then Phases 2, 3, and 5 in whatever order fits your priorities.

*If you'd like, the next step is turning the Phase 1 checklist into concrete code changes —
that's the fastest visible progress.*
