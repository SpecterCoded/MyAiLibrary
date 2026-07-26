# MyAiLibrary / Journalit — RAG System: Complete Technical Documentation

> A component-by-component reference for the Retrieval-Augmented Generation stack in the
> `backend/` service layer. Covers ingestion, chunking, embedding, retrieval, query
> understanding, reranking, agentic orchestration, answer generation, verification,
> confidence scoring, caching, and evaluation.
>
> **Scope note:** This document is derived from a full read of the backend source
> (`backend/services/`, `backend/embedding_service.py`, `backend/evaluation/`,
> `backend/core/config.py`). A handful of behaviors that live in un-read files
> (`main.py` route wiring, the exact `store_resource_embeddings` writer internals) are
> marked as *inferred* where relevant.

---

## 0. Overall rating

**7 / 10.**

This is a genuinely sophisticated, well-architected RAG system that implements techniques
most production RAG stacks never reach for: Anthropic-style **contextual retrieval**,
**parent-child (small-to-big)** retrieval, **hierarchical** multi-level enrichment, a real
**agentic self-correction loop**, hybrid dense+sparse fusion with **RRF**, **HyDE**,
multi-query expansion, cross-encoder **reranking**, three-way **hallucination
verification** (LLM self-check / NLI / LettuceDetect), a multi-signal **confidence score**,
a **semantic answer cache**, and an **evaluation harness**. The engineering discipline is
high — typed Pydantic contracts, immutable plans, defensive try/except around every
telemetry call, per-user provider abstraction, multi-tenant workspace isolation, and
incremental (diff-based) re-indexing that avoids re-embedding unchanged chunks.

What keeps it from an 8–9 is the gap between **breadth of ambition** and **what is actually
active and correct in production**:

- Many of the most advanced features ship **disabled by default** (parent-child,
  hierarchical, HyDE, query routing, semantic document chunking, embedding compression,
  chunk overlap are all `0` in `core/config.py`), so the impressive code paths may rarely
  execute unless explicitly turned on.
- There are **real defects**: duplicate `generate_quiz`/`generate_flashcards` definitions
  (dead code), a duplicate `_default_hierarchical_expander`, an embedding compressor that
  is effectively a no-op (called without `user_id`), a LettuceDetect detector that is never
  initialized, and the evaluation `benchmark_runner` importing a **non-existent
  `reports.py`** (so the batch path fails to import).
- **Correctness/calibration concerns**: the confidence formula's docstring disagrees with
  its code; NLI verification concatenates all context into one premise (truncation risk)
  and assumes an unverified label order; the streaming answer path runs **no** hallucination
  check, confidence, or citation enforcement.
- **Performance**: embeddings are sent **one string per HTTP call** (no batching), the
  single biggest throughput bottleneck.
- The **evaluation harness's quality metrics are lexical token-overlap**, dressed in
  RAGAS-style names — not a rigorous faithfulness/relevance judge.

If the dormant features were enabled and tuned, the handful of concrete bugs fixed, and
embedding batching plus an LLM/NLI-based eval judge added, this would comfortably be an
8.5. The bones are excellent; the finish is uneven.

A per-component score table appears in [§13](#13-scorecard).

---

## 1. Architecture at a glance

### 1.1 The two pipelines

The backend actually contains **two distinct knowledge pipelines** that share
infrastructure but serve different purposes:

1. **The chat-RAG pipeline** (the subject of this document): question → retrieve →
   rerank → generate answer → verify → score. Orchestrated by
   `services/rag_service.py`.
2. **The knowledge-graph pipeline** (`services/knowledge_service.py`): an 18-stage
   concept-extraction pipeline that turns a resource transcript into a versioned concept
   graph. It is a *sibling* subsystem, not part of the answer path, and is described
   briefly in [§11](#11-adjacent-subsystems).

### 1.2 End-to-end chat-RAG flow

```
                          ┌─────────────────────────────────────────────┐
   INGESTION (offline)    │  processing_service.process_resource()       │
                          │   extract / transcribe → chapter → subchapter│
                          │   → (manual) store_resource_embeddings()     │
                          └───────────────┬─────────────────────────────┘
                                          │ chunk_resource() [chunking_router]
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                   media_chunking   document_chunking   chunking_service
                   (audio/video)    (pdf/docx/image)    (semantic fallback)
                          │               │               │
                          └───────┬───────┴───────────────┘
                                  ▼  contextual_service.build_embedding_text()
                                  ▼  parent_child_service.chunk_parent_metadata()
                          embedding_service.store_resource_embeddings()
                                  │  → ChromaDB (vectors) + ChunkIndex (SQL text) + SearchIndex (FTS)


   QUERY (online)   rag_service.run_rag_pipeline() / run_rag_pipeline_stream()
     0. workspace resolution (storage_root)
     1. query_rewrite_service.rewrite_query()          (if chat history)
     2. cache_service.get_cached_answer()              (semantic cache, before retrieval)
     2b. retrieval_planner.create_plan()               (LLM or heuristic → RetrievalPlan)
     2c. query_router.should_skip_retrieval()          (greeting/small-talk bypass)
     3. prepare_rag_context()  ──► RetrievalAgent.run()  (agent/planner path)
            multi_query + HyDE → hybrid_service.search_resource_hybrid()
                                     ├─ retrieval_service.search_resource() [dense/Chroma]
                                     └─ bm25_service.search_resource_bm25()  [sparse]
                                  → RRF fusion (k=60)
            reranker_service.rerank_results()          (cross-encoder / Cohere)
            parent_child_service.expand_parent_context()   (opt-in)
            hierarchical_retrieval_service.enrich_with_hierarchy() (opt-in)
            context_compression_service.compress_context()
            embedding_service.build_context()
     4. llm_service.generate_answer[_stream]()          (per-user LLM)
        + enforce_inline_chunk_citations()
     5-6. source extraction + hallucination_service.detect_hallucinations()
     7. confidence_service.calculate_confidence()
     8. cache_service.save_to_cache()
     9. metrics / pipeline logging
```

### 1.3 Design principles observed throughout

- **Per-user, OpenAI-compatible providers.** Chat, embedding, and reranker endpoints are
  each configured per user in the `UserSetting` table (`base_url` + `api_key` + `model`).
  Nothing is hardcoded to a single vendor; users point at OpenRouter, DeepSeek, Cohere,
  local servers, etc. Clients are cached per user for **300 s**.
- **Fail-soft auxiliaries.** Query rewrite, multi-query, HyDE, compression, contextual
  enrichment, and planning all degrade gracefully to a sensible default on any error, so a
  flaky helper call never breaks the main answer. (The reranker is the notable
  exception — it re-raises.)
- **Feature flags everywhere.** `core/config.py` exposes ~25 env-driven toggles; advanced
  retrieval features default **off**.
- **Multi-tenant isolation.** One ChromaDB collection per workspace
  (`resource_chunks_v2` or `ws_<sha1>_v2`), plus `where` filters on `user_id`/`resource_id`.

---

## 2. Ingestion & processing

### 2.1 `processing_service.py` — the ingestion state machine

The top-level offline pipeline. `process_resource(resource_id, job_id, job_type)` drives a
resource through: **transcribe → summarize → chapter → subchapter → embed → index →
ready**, with resumability, pause/abort handling, content-hash dedup, and structured
failure notifications.

- **Job types:** `"full"`, `"manual_index"`, `"transcript_only"`, `"resume:<stage>"`.
- **Resume logic:** `_infer_resume_stage`, `_extract_failed_stage` reconstruct a
  restart point from `processing_status`. Valid stages: `transcribing, summarizing,
  chaptering, subchaptering, embedding, indexing, ready`.
- **Preflight:** `_preflight_resource_dependencies` validates only the config the selected
  job actually needs (Whisper for media, chat provider for summaries, embedding provider
  for indexing) and fails early with a structured `DependencyFailure`.
- **Content-type routing:**
  - `DOCUMENT_EMBED_ONLY_TYPES = {pdf, docx, image}` → text extraction only; **no** summary
    or chaptering.
  - `{video, audio, youtube}` → Whisper transcription → SRT → LLM chaptering /
    subchaptering (subchapters only when a chapter is ≥ 60 s).
- **Extraction dispatch:** `extract_pdf_text`, `extract_docx_text`, `extract_image_text`
  (OCR), `transcribe_audio`, `extract_audio_from_video`, `get_youtube_content`.
- **Keyword index:** `rebuild_resource_search_index` builds a `SearchIndex` row from
  `title + summary + transcript` — the lexical side of hybrid retrieval.

> ⚠️ **Important product behavior:** auto-embedding is **disabled for essentially all real
> content types** (`should_embed=False` unless `job_type=="manual_index"` or a resume). In
> practice a user must **manually index** a resource before it becomes retrievable. This is
> a deliberate cost-control decision, but it is a silent gap if not surfaced in the UI.

- **Dedup:** `find_duplicate_resource_by_hash` — a new resource identical to an
  already-embedded one is marked `is_embedded="false"`, `ready`, and skipped (no duplicate
  embeddings).

---

## 3. Chunking

Chunking uses a **strategy-router** pattern with a universal fallback. Everything emits a
single normalized contract, `ChunkPayload{content: str, metadata: dict}`
(`chunking_models.py`).

### 3.1 `chunking_router.py` — strategy dispatch

`chunk_resource(resource_id, transcript, db)` selects the chunker by resource type:

| Resource type | Chunker | Strategy |
|---|---|---|
| audio / video / youtube | `media_chunking_service` | time/speaker/topic-aware |
| pdf / docx / image | `document_chunking_service` | structure-aware |
| everything else / any failure | `chunking_service.semantic_chunk_text` | semantic fallback |

Every branch is wrapped defensively: a chunker returning `[]` or raising falls through to
the semantic fallback, so ingestion never hard-fails on chunking.

> ⚠️ On fallback, all rich metadata is lost (the fallback emits `metadata={}`), silently
> degrading retrieval quality for that resource.

### 3.2 `chunking_service.py` — semantic (fallback) chunker

Sentence-embedding-based semantic chunker; the default for plain text.

`semantic_chunk_text(text, target_chunk_size=1000)`:
1. Split into sentences via WTP/SaT (`sentence_segmentation_service`).
2. Load a **local** `all-MiniLM-L6-v2` boundary model (used only for boundary detection —
   **never** the paid embedding API).
3. If the model is unavailable or there are < 3 sentences → pure size-based accumulation.
4. Otherwise: for each position, compute cosine similarity between the mean embedding of a
   trailing window (`window_size=2`) and a leading window. Start a new chunk when either:
   - **size cap**: `len(current)+len(sentence)+1 > target_chunk_size` (character-based), or
   - **topic shift**: `sim < SEMANTIC_SIMILARITY_THRESHOLD` (default **0.45**, env
     `CHUNK_SIMILARITY_THRESHOLD`) **and** `len(current) >= MIN_CHUNK_CHARS` (**200**).

Optional character overlap (`ENABLE_CHUNK_OVERLAP` / `CHUNK_OVERLAP_CHARS`, default 150)
prepends the tail of the previous chunk.

> Note: this chunker is **character-based**, while the document and media chunkers are
> token-aware — an inconsistency in how "chunk size" is measured across strategies.

### 3.3 `document_chunking_service.py` — structure-aware chunker (the most sophisticated)

Chunks PDFs/DOCX/OCR text while respecting pages, headings, and block types.

Pipeline (`chunk_document_text`):
1. `_split_pages()` on `^[Page N]$` markers.
2. `_detect_repeated_page_lines()` strips running headers/footers.
3. `_build_sections()` → `_split_blocks()` classifies each block (paragraph / table / code /
   formula / list / caption / footnote via `_classify_block`), `_detect_heading()` starts
   new sections, `_annotate_section_paths()` builds a breadcrumb hierarchy (`section_path`)
   using a heading-level stack.
4. `_chunk_section()` packs blocks until `max_chunk_chars` **or** `max_chunk_tokens` is
   exceeded. **Tables / code / formulas are forced into their own chunk boundaries.**
   Under-min trailing chunks are back-merged.

Constants (env-overridable): `DOC_MAX_CHUNK_CHARS=1400`, `DOC_MIN_CHUNK_CHARS=250`,
`DOC_MAX_CHUNK_TOKENS=DEFAULT_CHUNK_TOKEN_BUDGET` (320), `DOC_MIN_CHUNK_TOKENS=80`. Dual
char + token budgeting via `estimate_tokens()`.

Per-chunk metadata: `document_chunking_strategy="section_paragraphs"`, `section_title`,
`heading_level`, `section_path`, `estimated_tokens`, `block_types`, `block_count`,
`primary_block_type`, `attached_captions`, `attached_footnote_count`, `page_start/end`.

Six **optional additive passes**, all default **OFF** via env flags: semantic split
(`DOC_SEMANTIC_SPLIT`, MiniLM, threshold 0.40), adaptive limits (`DOC_ADAPTIVE_CHUNKING`),
cross-chunk dedup (`DOC_CHUNK_DEDUP`), recursive split (`DOC_RECURSIVE_CHUNKING`),
embed-aware merge (`DOC_EMBED_AWARE_MERGE`), overlap (`DOC_CHUNK_OVERLAP`, 150 chars).

> ⚠️ **Known minor bug:** `DOC_CHUNK_OVERLAP` boundary search does
> `max(overlap_tail.rfind(". "), overlap_tail.rfind(". "), ...)` — `". "` is searched
> twice; newline/paragraph boundaries are not considered. All optional passes are wrapped
> in bare `except: pass` (silent failure).

### 3.4 `media_chunking_service.py` — time/speaker/topic-aware chunker

Turns timed SRT segments + chapter/subchapter structure into coherent, **timestamped**
chunks.

`_should_start_new_chunk()` cuts on a rich multi-signal OR:
- `chapter_changed` / `subchapter_changed` (structural — always cut)
- `speaker_boundary` (speaker change + min size)
- `time_limit` (> `MEDIA_MAX_CHUNK_SECONDS`, **75 s**)
- `char_limit` (> `MEDIA_MAX_CHUNK_CHARS`, **1200**)
- `token_limit` (> `DEFAULT_CHUNK_TOKEN_BUDGET`)
- `pause_boundary` (silence gap ≥ `MEDIA_PAUSE_GAP_SECONDS`, **4.0 s** + min size)
- `semantic_boundary` (topic shift + min size)

Topic-shift detection defaults to **lexical Jaccard overlap**
(`MEDIA_TOPIC_SHIFT_THRESHOLD=0.08`); opt-in `MEDIA_SEMANTIC_TOPIC_SHIFT` switches to MiniLM
cosine. Metadata: `start_time`, `end_time`, `duration_seconds`, `segment_count`, `speakers`,
`speaker_count`, `chapter_id/title`, `subchapter_id/title`,
`media_chunking_strategy="timed_segments"`.

> Note: the default lexical threshold of 0.08 is very low; in practice most cuts come from
> time/char/pause limits, and the semantic boundary rarely fires unless tuned up.

### 3.5 Supporting: `sentence_segmentation_service.py` & `srt_parser.py`

- **Sentence segmentation** uses **wtpsplit's SaT** ("Segment any Text") ONNX models,
  loaded strictly from local paths (offline/Electron-safe, `local_files_only=True`,
  CPU-only ORT). `split_into_sentences()` **raises** on load failure — making WTP a silent
  *hard* dependency for the semantic fallback chunker.
- **`srt_parser.parse_srt`** is a clean, dependency-free SRT → `[{start, end, text}]`
  parser handling the `HH:MM:SS,mmm` format and missing index lines.

---

## 4. Retrieval-augmentation layers (ingest + query time)

### 4.1 `contextual_service.py` — Anthropic's Contextual Retrieval

Prepends a one-sentence, LLM-generated situating description to each chunk **before
embedding**, so isolated chunks retain document-level meaning.

- `contextualize_chunk()` sends `document[:8000]` + the chunk to the user's chat LLM
  (`temperature=0.0`, `timeout=15 s`) asking for one situating sentence; records cost;
  returns `""` on failure or if output > 500 chars.
- `build_embedding_text()` returns `f"{context}\n\n{chunk}"` (what gets embedded) — the
  **raw chunk** is still what's stored as the retrievable document.
- **Enablement:** global default on (`CONTEXTUAL_ENRICHMENT`), but per-type opt-in gates
  mean docs (`pdf/docx/image`) and media require explicit `UserSetting` opt-in
  (`rag_contextual_enrichment` / `media_contextual_enrichment`). A **circuit breaker**
  (3 consecutive failures → 60 s cooldown) protects ingestion throughput.

> ⚠️ Costs **one LLM call per chunk** — expensive at scale (why it's gated off for
> docs/media by default). Module-global failure counters are not process-safe, and
> `document[:8000]` truncation means late-document chunks are situated against only the
> document head.

### 4.2 `parent_child_service.py` — small-to-big retrieval

Small child chunks are embedded for precise matching; at query time, matched children are
expanded into larger parent sections — but only when worthwhile and within a token budget.

- **Ingest:** `build_parent_sections()` groups consecutive children into parents
  (`PARENT_CHILD_GROUP_SIZE`, default 3, or at a detected heading); `chunk_parent_metadata()`
  tags each child with `parent_id`, `parent_heading`, `parent_start/end_chunk_index`.
- **Query:** `decide_parent_expansion()` is a deterministic cost/benefit gate — it refuses
  to expand when results are self-contained (e.g. DEFINITION/SIMPLE_FACT with high rerank
  and coverage) or the token budget is insufficient. `expand_parent_context()` merges
  overlapping parent ranges, loads chunk text from `ChunkIndex`, dedups, and trims around
  matched children within `PARENT_CHILD_MAX_SECTION_TOKENS` (700) /
  `PARENT_CHILD_MAX_CONTEXT_TOKENS` (1800). Always falls back to original results.
- **Flag:** `ENABLE_PARENT_CHILD_RETRIEVAL` (default **off**).

### 4.3 `hierarchical_retrieval_service.py` — multi-level enrichment

Optionally **appends** section/chapter/document-level nodes to chunk results (never
replaces children). Level selection is driven by `query_classification`:

- COMPARISON/EXPLANATION/TROUBLESHOOTING/PROCEDURAL/FOLLOW_UP → SECTION
- SUMMARIZATION → CHAPTER
- BROAD_RESEARCH/MULTI_DOCUMENT_REASONING → all three levels
- DEFINITION/SIMPLE_FACT/EXACT_LOOKUP with a strong top hit → skip (self-contained)

Budget: `HIERARCHICAL_MAX_CONTEXT_TOKENS` (2200), `HIERARCHICAL_MAX_NODE_TOKENS` (500).
Flag: `ENABLE_HIERARCHICAL_RETRIEVAL` (default **off**).

> ⚠️ The `_score()` self-contained gate compares against `>= 0.82`, but if only an RRF
> `hybrid_score` is present (typically ~0.03 for k=60) the gate can **never** fire; it only
> works when a normalized `rerank_score` (0–1) is present. Behavior is inconsistent
> depending on whether reranking populated scores.

---

## 5. Embedding & vector store

### 5.1 `embedding_service.py` — the core embedding + Chroma module

- **Provider:** **API-only**, per-user, OpenAI-compatible. Default model
  `openai/text-embedding-3-large` (**assumed 3072-dim** — the empty-text fallback is a
  hardcoded `[0.0] * 3072`). No local embedding model despite `sentence-transformers`/`torch`
  being installed.
- **Vector store:** ChromaDB `PersistentClient` on local disk. IDs are
  `f"{resource_id}_{chunk_index}"`. One collection per workspace
  (`resource_chunks_v2` default, else `ws_<sha1(storage_root)[:16]>_v2`).
- **Dual storage:** raw chunk text is *also* written to the SQL `ChunkIndex` table (kept
  clean for display and BM25); the *contextualized* text is what gets embedded.
- **Rich metadata per chunk:** `key_terms`, `chunk_position`, `chunk_summary`,
  `chunk_token_count`, `content_type`, `section_chunk_index`, `quality_score`,
  `reindex_signature`, `chunk_signature`, `indexed_at`, plus all chunker metadata
  (timestamps, page numbers, parent IDs).
- **Incremental re-index:** signature-based diffing (`_diff_chunk_records`,
  `_build_reusable_embedding_pool`) reuses embeddings for unchanged chunks and skips full
  no-ops entirely — a real cost saver.
- **Robustness:** every Chroma op is wrapped in a `ThreadPoolExecutor(max_workers=1)` with a
  **30 s timeout** and fallback.
- **Read paths:** `search_embeddings`, `search_resource`, `search_all_resources`, plus RAG
  helpers `build_context`, `deduplicate_results`, `extract_rich_sources`,
  `find_chunk_timestamp`.
- **Caching:** collection handles (unbounded, process-life), per-user embedding client
  (300 s TTL). Invalidates BM25 cache after writes.
- **Distance filter:** `MAX_DISTANCE = 1.8` in `search_resource`/`search_all_resources`
  (note: `retrieval_service.search_resource` uses **1.5** — two different constants).

> ⚠️ **Biggest weakness: no embedding batching.** `embed_text` sends one string per HTTP
> round-trip; `store_resource_embeddings` loops chunk-by-chunk. Indexing a large document
> is N sequential API calls. The OpenAI embeddings endpoint accepts arrays — this is the
> highest-value fix.
>
> ⚠️ The **3072 dimension is hardcoded/unvalidated** — configuring a 1536-dim model
> (`text-embedding-3-small`) risks dimension errors on empty-text chunks.

### 5.2 `embedding_compression_service.py` — similarity-based context compression

`compress_by_embedding(query, chunks, max_chunks=5)` embeds the query + each chunk, cosine-
scores, and returns the top-N in original order. Gated by `EMBEDDING_COMPRESSION` (default
off).

> ⚠️ **Effectively a no-op in the normal path:** it calls `embed_text(query)` **without a
> `user_id`**, which raises `ValueError`; the exception is swallowed and it returns
> `chunks[:max_chunks]`. It also re-embeds chunks whose vectors already exist in Chroma
> (wasted cost when it does run).

### 5.3 `cache_service.py` — semantic answer cache

Stores question→answer pairs keyed by embedding similarity in a SQL `SemanticCache` table.

- **Hit threshold:** `CACHE_THRESHOLD = 0.90` cosine. **Dedupe/overwrite:** `0.995`.
- **Ranking:** `(similarity, confidence, created_at, id)`.
- **TTL:** `CACHE_TTL_HOURS` (24 h, lazy expiry — expired rows are skipped, not deleted).
- **Size cap:** `CACHE_MAX_ENTRIES` (1000) per `(user, resource)` scope, oldest evicted.
- **Guards:** dimension-mismatch skip (handles embedding-model changes).

> ⚠️ **No content-based invalidation** — re-indexing a resource does not purge its cached
> answers, so a stale answer can survive up to 24 h. Lookup is a full in-Python scan of the
> scope (O(N), no ANN); embeddings are stored as JSON in SQL (large rows).

---

## 6. Query understanding (pre-retrieval)

### 6.1 `query_rewrite_service.py`

- `rewrite_query(current_question, chat_history, ...)` — resolves pronouns/references
  against history into a self-contained query. System+user prompt, 3 few-shot examples,
  `temperature=0.0`, first-line-only, 500-char cap, empty→original fallback.
- `generate_query_variants(question, n=2)` — multi-query paraphrase expansion for recall.
  `temperature=0.3`, one-per-line parsing, `[]` on failure.

> ⚠️ A debug `print()` in `rewrite_query` leaks query text to stdout.

### 6.2 `query_router.py`

`should_skip_retrieval(query, classification)` — a cheap two-tier gate that bypasses
retrieval for greetings/small talk: anchored regex patterns first
(`_GREETING_PATTERNS`, `_SMALL_TALK_PATTERNS`), then the planner's `QueryClassification`
(`GREETING`/`SMALL_TALK`). Conservative — defaults to **not** skipping.

### 6.3 `hyde_service.py` — Hypothetical Document Embeddings

`generate_hypothetical_answer(question, ...)` generates a short, factual, textbook-style
hypothetical answer (`temperature=0.7`, `max_tokens=150`, 800-char reject) whose embedding
sits closer to real chunks than the question does. Single-hypothetical (not the paper's
ensemble). Flag: `ENABLE_HYDE` (default off).

### 6.4 `complexity_service.py` — rule-based complexity tiering

`analyze_question_complexity(question)` (no LLM) maps a question to `simple/medium/complex`
via regex + word count (threshold **12 words**), and decides which modules to activate and
the answer length cap:

| Tier | max words | modules on |
|---|---|---|
| simple (≤12 words, simple phrasing) | 50 | none |
| medium | 150 | compression, multi-query, hallucination check |
| complex (complex phrasing OR >12 words) | 500 | all (incl. citation grounding) |

### 6.5 `concept_extraction_service.py`

Ingestion-time extraction of 1–10 key concepts per subchapter via a structured LLM call,
persisted as `Concept` rows. (Feeds the knowledge graph, not live retrieval.)

> ⚠️ No error handling / input truncation — malformed JSON raises `KeyError`; long
> transcripts inline unbounded.

---

## 7. Retrieval core & fusion

### 7.1 `retrieval_service.py` — dense vector search

Thin wrapper over the Chroma workspace collection. `search_resource()` embeds the query,
runs `collection.query(where={$and:[resource_id, user_id]})`, and filters
`distance > MAX_DISTANCE` (**1.5**). Returns `{documents, metadatas, distances}`.

### 7.2 `bm25_service.py` — sparse retrieval

In-memory `BM25Okapi` (`rank_bm25`) over SQL `ChunkIndex` rows. `_tokenize` = `\b\w+\b`
lowercased; optional Porter stemming / stopwords (`BM25_STEMMING`, `BM25_STOPWORDS`, default
off). Per-resource TTL cache (`CACHE_TTL=300 s`, `MAX_CACHE_SIZE=50`).
`search_global_bm25()` combines cached per-resource corpora but **rebuilds** a fresh
combined index each call.

> ⚠️ IDF statistics differ between the per-resource and combined-global indexes, so the same
> chunk scores differently in single vs global paths (fine internally, but the scores
> aren't comparable across paths).

### 7.3 `hybrid_service.py` — dense + sparse RRF fusion

`search_resource_hybrid(resource_id, query, top_k=20, rrf_k=60)` runs dense and BM25 in
parallel (`max_workers=2`), ranks each signal independently (Chroma ascending by distance,
BM25 descending by score where `> 0`), and fuses via **Reciprocal Rank Fusion**:

```
score(d) = Σ_signals  1 / (rrf_k + rank(d))     # rrf_k = 60, rank is 0-indexed
```

Returns the top-k by `hybrid_score`. The math is textbook-correct: scale-invariant,
rank-based, and fair to chunks appearing in only one signal.

### 7.4 Global-library fusion (inside `rag_service.prepare_rag_context`)

For `resource_id is None`, the pipeline runs `search_all_resources()` (dense, dedup by
lowercased content) → gather resource IDs → `search_global_bm25()` → an **inline RRF**
(same `RRF_K=60`, keyed by `(resource_id, chunk_index)`).

> ⚠️ The RRF logic is **duplicated** — once in `hybrid_service` and once inline here. Also
> the global-path dedup runs only on the dense side (asymmetric).

---

## 8. Reranking & context reduction (post-retrieval)

### 8.1 `reranker_service.py`

`rerank_results(query, results, top_k=5, user_id)` calls a **hosted rerank API**, per-user
configured (Cohere or any Cohere-compatible endpoint; provider inferred from base URL).
Default model **`rerank-v4.0-fast`**. Payload `{model, query, documents, top_n}`; the cut is
delegated to the API (`top_n=top_k`). Each result gets `rerank_score = float(...)`. Config
cached 300 s.

> ⚠️ **This is the only non-fail-soft component** — on error it fires a deduped `/settings`
> notification and **re-raises**, so a reranker outage hard-fails search. There is also
> **no local relevance-score floor**: the top-5 pass even if all their scores are low.

### 8.2 `context_compression_service.py`

`compress_context(question, chunks, max_chunks=5)` reduces the candidate set to the most
relevant chunks (selection, not summarization). Two backends, chosen by
`EMBEDDING_COMPRESSION`:
- **default (LLM):** numbers each chunk (truncated to `chunk[:300]`), asks the LLM for a
  JSON list of the `max_chunks` most relevant indices (`temperature=0.0`).
- **fast (embedding):** `compress_by_embedding` (see §5.2 — currently a no-op in practice).

> ⚠️ The LLM sees only the first 300 chars of each chunk, so relevance is judged on chunk
> heads; a chunk whose relevant content is later is under-scored.

### 8.3 `token_budget_service.py`

`DEFAULT_CHUNK_TOKEN_BUDGET = 320` (floor 64). `estimate_tokens(text) = words +
punctuation//2 + line_breaks//3` — a tokenizer-free heuristic that **under-counts** vs real
BPE tokenizers (risk of exceeding real context limits when it drives budgets).

---

## 9. Agentic orchestration

Two cooperating packages layer a self-correction loop on top of the retrieval core.

### 9.1 `services/planner/` — the strategy layer

- **`retrieval_planner.create_plan()`** produces an immutable `RetrievalPlan`. LLM-first
  (`RETRIEVAL_PLANNER_USE_LLM`, default true, `temperature=0.0`, JSON mode) with a
  deterministic **heuristic fallback** (`_heuristic_plan`) and a conservative
  `legacy_fallback()` for empty queries.
- **`QueryClassification` taxonomy** (13 members): Greeting, Small Talk, Simple Fact, Exact
  Lookup, Definition, Explanation, Comparison, Summarization, Multi-document reasoning,
  Broad research, Procedural, Troubleshooting, Follow-up.
- **Plan fields:** `query_classification`, `retrieval_mode` (KEYWORD_ONLY / VECTOR_ONLY /
  HYBRID), `enable_multi_query`, `rerank`, `compress_context`, `hallucination_check`,
  `max_chunks` (1–50), `retrieval_depth` (1–200), `confidence_threshold` (0–1),
  `trust_semantic_cache`, `rrf_k` (default 60), `use_hyde`, `reasoning`.
- **Mode selection (heuristic):** `EXACT_LOOKUP → KEYWORD_ONLY`; simple classes →
  `VECTOR_ONLY`; everything else → `HYBRID`.
- **`planner_executor.py`** already contains a full RAG engine (multi-query fan-out, RRF,
  rerank, hierarchical, parent-child, compression). The agent layer *composes* this rather
  than re-implementing it.

> ⚠️ `planner_prompt.py` omits `use_hyde` and `rrf_k` from the required-fields list, so in
> the LLM path they fall to defaults — HyDE and adaptive-`rrf_k` effectively only fire under
> the heuristic fallback. And `planner_executor._default_hierarchical_expander` is defined
> twice (the static version is dead code).

### 9.2 `services/agent/` — the self-correction loop

`RetrievalAgent.run()` runs a bounded `while True` loop:

1. `memory.begin_attempt(signature)` — dedup guard (`query|mode|depth|multi_query`); an
   identical attempt breaks the loop.
2. Execute the **retrieve** node (via `WorkflowExecutor` → `PlannerExecutor.execute`).
3. Execute the **evaluate** node → `RetrievalEvaluation` (deterministic, **no extra LLM
   call**).
4. `_choose_candidate` / `_merge_results` — merges the current results with the best-so-far
   (dedup by `(resource_id, chunk_index)`, keep higher score), keeps the merge only if it
   strictly improves confidence.
5. `ReflectionEngine.reflect_on_retrieval()` → `RetryStrategy.decide()`.
6. Retry or stop.

**Quality gate** (`RetrievalEvaluator.evaluate`), confidence weighted `0.30·count +
0.25·relevance + 0.20·coverage + 0.15·metadata + 0.10·diversity`:
- `GOOD` if `confidence >= plan.confidence_threshold` and `count_quality >= 0.60`
- `BORDERLINE` if `>= threshold*0.75` and `count_quality >= 0.35`
- `POOR` otherwise

Only `GOOD` stops cleanly; `BORDERLINE`/`POOR` re-retrieve if a distinct adaptation remains.

**Retry escalation ladder** (`retry_strategy.decide`, "smallest distinct escalation"):
mode→HYBRID → add query variants → rewrite query (if coverage < 0.4) → increase top-k (+4)
→ increase depth (≈2×, cap 200) → stop. Max retries `RETRIEVAL_AGENT_MAX_RETRIES` (default
**2**, clamped 0–10).

**Workflow model** (`workflow_models.py`): a validated DAG of ~10 nodes (plan, rewrite,
cache, retrieve, evaluate, reflect, answer, sources, hallucination, confidence) with
conditional edges (`QUALITY_GOOD/BORDERLINE/POOR`, `RETRY_AVAILABLE/EXHAUSTED`). A
`ToolRegistry` holds ~18 capability-tagged, cost-ranked tool adapters.

> **Honest assessment:** this is a **real but shallow, deterministic** self-correction
> loop, not an LLM-driven agent. The LLM is called exactly once (initial planning);
> everything after is a fixed if/else ladder. The elaborate conditional-edge graph is
> **largely decorative in the hot path** — `run()` executes only retrieve→evaluate→reflect
> imperatively and never runs the answer/sources/hallucination/confidence nodes (those are
> driven externally by `rag_service`). The registry's cost-based tool selection is
> speculative generality (each capability currently has one tool). It is genuinely
> well-engineered and honest about *extending* rather than *replacing* the core, but carries
> more framework than the current loop exercises.

---

## 10. Generation, verification & confidence

### 10.1 `llm_service.py` — the LLM gateway

- **Per-user client:** `get_user_chat_client()` builds an `OpenAI` client from `UserSetting`
  (`chat_base_url/api_key/model`, `timeout=60 s`), cached 300 s. No hardcoded model (users
  commonly point at OpenRouter/DeepSeek).
- **Answer generation** (`generate_answer`) packs persona + format rules + citation rules +
  history + context + question into a **single user message** (no system role). Four modes:
  - **globe** (`globe_on`) — relies on the model's general knowledge, treats context as
    optional; **deliberately un-grounded**.
  - **concise** — 2–4 sentences, "say 'I don't know' if not in context."
  - **complex** — keyword-triggered chain-of-thought scaffold.
  - **detailed** (default) — comprehensive, "don't invent."
  Temperature 0.3.
- **Citation contract:** context is split into labeled `[Chunk N]` blocks; every grounded
  sentence must end with an inline citation. `enforce_inline_chunk_citations()` is a
  deterministic backstop that appends `[Chunk N]` (best chunk chosen by token overlap +
  position + reuse bonus) to any grounded sentence missing one. `_clean_answer` normalizes
  all citation variants to `[N]`.
- **Streaming** (`generate_answer_stream`) yields tokens with a trailing-20-char holdback for
  cleanup.

> ⚠️ **The streaming path runs NO citation enforcement, NO hallucination check, and NO
> confidence scoring** — only regex tail cleanup. Grounding guarantees hold only on the
> non-streaming path.
>
> ⚠️ `generate_quiz` and `generate_flashcards` are each **defined twice**; the second wins,
> so the Markdown variants are dead code.

### 10.2 `hallucination_service.py`

`detect_hallucinations(context, question, answer, ...)` → `list[{text, confidence}]`. Three
backends dispatched by provider:
- **`openai`** (default; really the user's own chat model): a fact-checker prompt asks for a
  JSON list of hallucinated substrings; validated by exact substring membership in the
  answer (`item["text"] in answer`).
- **`nli`** (when `UserSetting.rag_nli_verification == 1`): delegates to
  `nli_verification_service`.
- **LettuceDetect** fallback.

> ⚠️ **LettuceDetect is effectively dead** — `_detector` is never initialized in this
> module. The LLM self-check's exact-substring gate drops any paraphrased flag, and
> self-checks with the same model that wrote the answer (weak independence).

### 10.3 `nli_verification_service.py`

Loads a `sentence_transformers.CrossEncoder`, default
**`cross-encoder/nli-deberta-v3-base`**. `verify_claims(answer, context)` splits the answer
into claims, uses the **joined context** as the premise, softmaxes logits assumed to be
`[contradiction, entailment, neutral]`, and flags a claim when
`contradiction > 0.5`, or when it's highly neutral/unsupported
(`entailment < 0.3 & contradiction < 0.3 & (1-entailment) > 0.6`).

> ⚠️ Concatenating all context into one premise **truncates** at ~512 tokens (a claim
> supported by a late chunk reads as unsupported). The label-order assumption is
> **unverified** — a different checkpoint's `id2label` would silently invert results. The
> neutral→"unsupported" rule over-reports on legitimate paraphrase.

### 10.4 `confidence_service.py`

`calculate_confidence(reranked_results, hallucinations)` → `(score 0–1, label)`:

```
confidence = 0.35·sigmoid(top_rerank)
           + 0.30·min(1, top_hybrid / RRF_BEST)     # RRF_BEST = (1/60)*2 ≈ 0.0333
           + 0.15·(1.0 if no hallucinations else max(0, 1 - 0.3·count))
           + 0.10·coverage        # fraction of chunks with start_time or page_number
           + 0.10·diversity       # distinct resource_ids / chunk count
```
Penalties: rerank spread < 0.5 → ×0.85; < 2 chunks → ×0.7; < 3 chunks → ×0.85. Labels:
≥0.90 Very High, ≥0.75 High, ≥0.60 Medium, ≥0.40 Low, else Very Low.

> ⚠️ The **docstring says 40/40/20** but the code is 35/30/15/10/10. `RRF_BEST` hardcodes
> k=60 (any `hybrid_score ≥ 0.033` maxes that term). Coverage/diversity reward *metadata
> richness and spread*, not actual answer support, and hallucination **severity** is ignored
> (a weak neutral flag costs the same as a certain contradiction).

### 10.5 `evidence_service.py`

`extract_best_evidence(answer, chunk)` picks the chunk sentence with the highest **Jaccard**
overlap with the answer (plus neighbors, ≤ 400 chars). Length-biased and no stopword
filtering; purely lexical (paraphrased evidence scores near zero).

---

## 11. Adjacent subsystems

### 11.1 `rag_library_service.py` — cross-library retrieval & health

Cross-resource / whole-library retrieval and **operational observability**, scoped per
`user_id + storage_root` (+ optional folder/playlist). Provides:
- `get_rag_library_overview()` — per-resource RAG health dashboard (chunk/vector/search-index
  counts, `health_score = max(0, 100 - issues·18 - warnings·6)`, `ready_for_retrieval`).
- `get_rag_library_retrieval_preview()` — the **global** four-lane preview (vector / BM25 /
  hybrid-RRF / reranked) across a set of resources.
- `get_rag_resource_detail/chunks()` — chunk↔vector drift detection.
- `search_rag_library()` — plain SQL `ILIKE` browse.

It **retrieves but does not synthesize answers** (no LLM answer generation here). It differs
from single-resource RAG by fanning out across a resource set, using the global primitives,
doing its own in-service RRF fusion, and layering health diagnostics.

### 11.2 `knowledge_service.py` — knowledge-graph pipeline (not chat-RAG)

An 18-stage, versioned concept-extraction pipeline
(`run_knowledge_pipeline`): resource_intelligence → concept_extraction → alias_resolution →
entity_resolution → duplicate_merge → relationship_extraction → confidence_engine →
timeline_builder → learning_order → difficulty_engine → frequency_engine →
cross_resource_intelligence → resource_references → concept_summaries → concept_analytics →
recommendation_engine → global_graph_publish → complete. It uses a **separate** Chroma
collection `knowledge_concepts_v1` for concept alias/entity resolution and includes a
domain-specific ICT-trading alias map. Checkpoint/resume + versioning throughout. It is a
sibling to, not part of, the answer path.

---

## 12. Evaluation harness (`backend/evaluation/`)

A **purely observational** layer — it never calls the RAG stack; it ingests an `ObservedRun`
snapshot and scores it after the fact ("No evaluation code is imported by the production
retrieval path").

- **`evaluator.py`** — normalizes heterogeneous outputs into `ObservedRun`, optionally
  enriches from `logs/metrics.jsonl`, and computes per-sample metrics.
- **`metrics.py`** — retrieval IR metrics at `default_k=5`: `precision_at_k`, `recall_at_k`,
  `mrr`, `ndcg`, `hit_rate` (textbook-correct). Answer-quality metrics: `faithfulness`,
  `groundedness`, `citation_accuracy`, `context_utilization`, `completeness`,
  `hallucination_rate`, `confidence_calibration` — **all bag-of-words token overlap**
  (faithfulness = sentences with ≥ 0.35 context overlap). Performance + cost metrics too.
- **`scoring.py`** — composite `retrieval·0.4 + quality·0.4 + latency·0.1 + cost·0.1`;
  regression deltas (`improved/regressed/unchanged`).
- **`auto_benchmark.py`** — generates Q/A pairs from resource chunks via the user's LLM
  (self-referential gold set).

> ⚠️ **Significant rigor gaps:** (1) `benchmark_runner` imports `build_benchmark_report` from
> a **non-existent `reports.py`** — the batch/suite path fails to import as shipped;
> README-advertised JSON/CSV/HTML export has no implementation. (2) Quality metrics are
> **lexical overlap**, not LLM-as-judge / NLI / embedding — a factually wrong answer reusing
> context vocabulary scores as "faithful." (3) `context_utilization` is a literal duplicate
> of `groundedness`; the RAGAS trio (answer relevance, context precision/recall) is **not**
> computed. (4) `recall_at_k` returns 1.0 when there are no relevant IDs, and
> `citation_accuracy` returns 1.0 with no expectations — score-inflating defaults. (5)
> Auto-benchmark emits `source_chunk_index`/`resource_id` but the evaluator expects
> `expected_chunk_ids`/`expected_document_ids` — a schema mismatch with no adapter. The
> harness is a **well-structured scaffold that is only partially operational**.

---

## 13. Scorecard

| Subsystem | Rating | Notes |
|---|---:|---|
| Ingestion & processing | 8/10 | Robust state machine, resume, dedup; manual-index gap |
| Chunking (3 strategies) | 8.5/10 | Genuinely differentiated & structure-aware; advanced passes dormant, char/token unit drift |
| Contextual + parent-child + hierarchical | 8/10 | Rare, mature techniques; mostly off by default; hierarchical score-gate bug |
| Embedding & vector store | 6.5/10 | Great incremental reindex & isolation; **no batching**, hardcoded 3072, cache no invalidation |
| Query understanding | 7.5/10 | Rewrite/HyDE/multi-query/routing all present; 3 overlapping classifiers; debug print |
| Retrieval core & RRF | 8/10 | Correct RRF fusion; duplicated logic, two MAX_DISTANCE constants |
| Reranking & compression | 7/10 | Per-user Cohere/custom; no score floor, non-fail-soft, 300-char preview |
| Agentic orchestration | 7/10 | Real bounded self-correction; graph largely decorative, LLM used once |
| Generation & citations | 7/10 | Strong prompt + deterministic citation backstop; **streaming unverified**, duplicate defs |
| Verification (hallucination/NLI) | 5.5/10 | Three backends but LettuceDetect dead, NLI truncation/label risk, substring gate brittle |
| Confidence scoring | 6/10 | Sensible multi-signal blend; doc/code drift, rewards metadata not grounding |
| Semantic cache | 6.5/10 | Good guards; O(N) scan, no content invalidation |
| Evaluation harness | 4.5/10 | Correct IR math but lexical quality metrics, broken import, self-referential gold |
| **Overall** | **7/10** | Excellent breadth & architecture; uneven activation, several concrete bugs |

---

## 14. Top recommendations (highest impact first)

1. **Batch embedding calls.** Send arrays to the embeddings endpoint in
   `store_resource_embeddings` / `embed_text`. This is the single biggest throughput and
   cost win.
2. **Verify the streaming answer path.** Run citation enforcement + hallucination check +
   confidence on `generate_answer_stream` output (post-stream), or clearly document that
   streamed answers are unverified.
3. **Fix the concrete bugs:** remove the duplicate `generate_quiz`/`generate_flashcards` and
   `_default_hierarchical_expander`; initialize (or remove) the LettuceDetect `_detector`;
   fix `compress_by_embedding` to receive a `user_id`; add `use_hyde`/`rrf_k` to the planner
   prompt's required fields; restore or stub `evaluation/reports.py`.
4. **Validate embedding dimension** against the collection instead of the hardcoded 3072;
   make `MAX_DISTANCE` a single env-configurable, metric-aware constant.
5. **Upgrade evaluation quality metrics** to an LLM-judge or NLI/embedding-based
   faithfulness + answer-relevance, and use human-verified gold sets; fix the score-inflating
   defaults and the auto-benchmark schema mismatch.
6. **Reconcile confidence** docstring vs code, weight hallucination severity, and base
   coverage on actual grounding rather than metadata presence.
7. **Add semantic-cache invalidation** on resource re-index.
8. **Consider enabling & tuning the dormant features** (parent-child, hierarchical, HyDE,
   query routing) behind measured A/B, since the code already exists.
9. **Harden NLI:** verify the checkpoint's label order at load, and score each claim against
   its most-relevant chunk(s) rather than the truncated joined context.
10. **Make the reranker fail-soft** (fall back to fused order on outage) and add a minimum
    relevance-score floor.

---

*Generated from a full source read of the `backend/` RAG stack. Constants, thresholds, and
file/function names are quoted directly from the code as of the reviewed snapshot.*
