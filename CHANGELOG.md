# Changelog

All notable changes to My AI Library are documented here. Every release also has detailed, version-specific notes in `desktop/release-notes/`.

This project follows semantic versioning. Beta builds use the Testing update channel; Stable updates remain disabled until signed Windows packages are available.

## [0.1.0-beta.1] - 2026-07-28

### Added

- A private desktop library for importing, organizing, searching, and revisiting videos, audio, PDFs, documents, notes, and research material.
- Background import and processing workflows with progress reporting, transcript extraction, metadata handling, pinned FFmpeg tools, and resumable desktop feedback.
- Source-aware chat and Ask AI experiences with citations, clickable timestamps, direct media seeking, rich Markdown, and streaming responses.
- A multi-stage RAG pipeline with batched embeddings, cache invalidation, parent-child and hierarchical retrieval, HyDE queries, routing, overlap-aware chunks, ranking, evaluation, and regression self-tests.
- Generated summaries, transcripts, chapters and subchapters, flashcards, quizzes, mind maps, notes, active recall, and self-test material.
- Video and audio players with captions, chapter timelines, playback controls, timeline navigation, starred items, attachments, and media metrics.
- Detachable workspace windows, reattachment controls, custom title bars, tab-aware navigation, draggable floating tools, compact layouts, and responsive minimum-window behavior.
- Settings for appearance, AI providers and models, storage, integrations, diagnostics, and application updates.
- Structured full-stack diagnostics with sanitized event history, filters, exports, log access, retention limits, and correlation across desktop, backend, and renderer work.
- A bundled Journalit integration package and in-app setup guidance.
- A Testing update channel for unsigned GitHub prereleases, including manual checks, download progress, restart/install states, post-update confirmation, and saved channel preferences.
- Pre-update backup, database integrity checks, migration recovery, pending-update tracking, and restoration safeguards.
- Branded Windows application, executable, installer, uninstaller, and system-tray artwork with high-resolution ICO frames.

### Changed

- Fresh beta-capable installations default to the Testing channel so future beta releases are discoverable in Settings → Updates.
- Explicitly saved Stable or Testing channel choices are preserved across launches and upgrades.
- The desktop shell, authentication flow, settings, menus, carousel, chat composer, floating tools, detached windows, and media layouts were refined for clearer spacing and more reliable resizing.
- The white sparkle mark now occupies approximately 84% of the source icon area while the blue gradient continues to fill the complete canvas.
- Chat streaming and generated-content rendering now use consistent structured formatting for citations and timestamp badges.

### Fixed

- Fixed embedding-compression user scoping, NLI truncation and label ordering, stale embedding caches, and dormant retrieval paths.
- Fixed chat-stream interruption and recovery behavior, renderer/backend error visibility, processing-state feedback, desktop voice flows, and workspace tab flicker.
- Fixed detachable-window navigation and reattachment behavior, title-bar overlap, minimum-size wrapping, and clipped tab controls.
- Fixed video-player control layout, compact tab behavior, and media timestamp navigation.
- Fixed timestamp rendering inside Active Recall and Self-Test answers and removed exposed formatting tokens.

### Security and release safeguards

- Stable updates remain signed-only; no GitHub credentials or release tokens are embedded in the application.
- Beta publishing is restricted to pushed `v*-beta.*` tags whose version matches the committed desktop package.
- Every release requires both this cumulative changelog and a detailed version-specific release-notes file.
- The unsigned Windows beta is published as a GitHub prerelease and may show Windows SmartScreen's expected Unknown Publisher warning.

[0.1.0-beta.1]: https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v0.1.0-beta.1
