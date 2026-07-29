# Changelog

All notable changes to My AI Library are documented here. Every release also has detailed, version-specific notes in `desktop/release-notes/`.

This project follows semantic versioning. Beta builds use the Testing update channel; Stable updates remain disabled until signed Windows packages are available.

## [0.1.0-beta.7] - 2026-07-29

### Added

- Added an authenticated application-level AI task registry shared by Chat, Home Ask AI, Video Ask AI, and Audio Ask AI.
- Added wall-clock response progress so answers catch up after navigation, workspace-tab changes, minimization, tray hiding, or application focus changes.
- Added production-renderer release validation for background generation, hidden result panels, explicit cancellation, late subscribers, and wall-clock catch-up.

### Improved

- AI requests now continue while their page or result panel is not visible, provided My AI Library remains running.
- Adaptive typing is faster while retaining Unicode-safe grapheme animation, Markdown-safe boundaries, reserve protection, and smooth final draining.
- Completed answers return in their correct final state instead of replaying when the user revisits a page.
- Globe, attachment, and microphone controls now perform their action on the first pointer interaction even when the composer starts collapsed.
- The native tray menu now uses the clearer `Open My AI Library` and `Quit My AI Library` actions, with no separator and an updated application tooltip.

### Reliability

- Navigation, tab switching, minimization, hiding to the tray, lost focus, and result-panel dismissal no longer cancel active generation.
- Stop Generation preserves partial text, while Clear Conversation, logout, and application shutdown cancel and remove the appropriate background tasks.
- Main Chat reconciles active task snapshots with conversation history; Home, Video, and Audio restore tasks using their surface and resource identities.
- Independent AI tasks can run on different surfaces while each conversation or resource keeps only one active generation.

### Release safeguards

- Expanded frontend regression coverage for tasks without subscribers, late subscribers, concurrent surfaces, replacement, cancellation, errors, logout cleanup, remount reconciliation, and historical-message behavior.
- Added packaged production-renderer validation for deterministic AI completion across a simulated page unmount and return.
- The release workflow validates the complete Beta 6 to Beta 7 version order and exercises update discovery, download, installation, restart, version reporting, and application-data preservation before publication.
- Beta 7 remains an unsigned Windows x64 prerelease on the Testing channel; Stable updates remain disabled until signed packages are available.

## [0.1.0-beta.6] - 2026-07-29

### Added

- Introduced the final frameless book identity across the Windows executable, installer, system tray, splash screen, loading view, sidebar, and browser favicon.
- Added adaptive AI response animation shared by Chat, Home Ask AI, Video Ask AI, and Audio Ask AI.
- Added packaged Windows validation for WtP/Canine model download, loading, and sentence segmentation.
- Added an isolated NSIS installation smoke test and a non-publishing GitHub preflight workflow.

### Fixed

- Removed visible pauses between streamed AI paragraphs by forwarding provider chunks immediately and adapting the typewriter speed to the live text reserve.
- Stopped complete provider streams from being incorrectly labelled as interrupted when the provider ends cleanly without a finish reason.
- Preserved distinct completed, stopped, length-limited, and genuinely interrupted response states across new answers and continuations.
- Hardened workspace schema migration and persistence behavior for existing accounts and registered storage folders.
- Included the dynamically loaded `skops.io.old` compatibility modules required by packaged WtP/SaT models.
- Prevented sidebar navigation links and the account avatar from being dragged as links or images.
- Ensured a newly started development or packaged session removes only stale My AI Library processes it owns instead of accumulating old renderer and backend tasks.

### Release safeguards

- Expanded frontend regression coverage for uneven token arrival, Markdown-safe animation boundaries, final draining, historical messages, and stream completion classification.
- Expanded backend coverage for clean provider EOF, explicit completion, empty streams, provider failures, continuation behavior, and exact final-then-done ordering.
- Added desktop process-lifecycle tests for graceful shutdown, ownership-scoped cleanup, and process-tree fallback behavior.
- The release pipeline now performs a full GitHub-hosted preflight before tagging, verifies packaging resources, tests the unpacked and installed applications, validates Beta 5 to Beta 6 update metadata, and publishes only after every gate succeeds.

## [0.1.0-beta.5] - 2026-07-28

### Added

- Added permanent deletion for workspaces created from Settings, with a project-themed confirmation dialog and retry-safe progress state.
- Protected the original onboarding workspace from deletion in both the interface and backend.
- Added workspace ownership markers so the application can distinguish an app-created directory from an existing folder adopted by the user.

### Fixed

- Fixed workspace registration when the desktop folder picker returns an existing directory.
- Made global Settings save include a complete open workspace draft and retain failed drafts for retry.
- Corrected dark-theme folder icon and folder-picker contrast in Workspace Storage.
- Made canonical Windows paths, capitalization, and duplicate registration behave consistently.
- Prevented failed workspace saves from being overwritten by a false “Saved” state.

### Data safety

- Workspace deletion removes its library records, resources, notes, generated study data, conversations, diagnostics, vector index, tracked files, and app-owned generated directories.
- If My AI Library created the workspace root, a matching ownership marker is required before the root can be removed.
- If the user selected an existing folder, its root and unrelated personal files are preserved; only My AI Library-owned data and tracked files are removed.
- Deleting the active secondary workspace safely switches the account back to its protected default workspace.
- Schema migration marks the first existing workspace per account as the protected onboarding workspace without requiring a database reset.

### Release safeguards

- Added backend coverage for creation, persistence, canonical duplicates, ownership isolation, default protection, migration, deletion, retry locking, and preservation of unrelated files.
- Added frontend coverage for complete drafts, partial failures, authoritative refresh, and protected deletion requests.
- Expanded the packaged Windows smoke gate to create a default workspace, register and activate a secondary workspace, reject default deletion, delete the secondary workspace, and verify the active workspace returns to the default.

## [0.1.0-beta.4] - 2026-07-28

### Fixed

- Replaced packaged Firebase certificate parsing with JSON Web Key verification so installed Windows builds authenticate through the same standards-based path as development.
- Made Firebase signing-key caching resilient to key rotation and temporary network failures while continuing to fail closed when no trusted key is available.
- Prevented email verification from reporting signup success until the local account has actually been created.
- Preserved the originally selected username throughout signup and made username availability, login resolution, and account updates consistently case-insensitive.
- Added a clear recovery path for accounts that need one email login to restore their local username mapping.
- Removed internal token-verification exception details from user-facing authentication errors.

### Release safeguards

- Added Firebase token and account regression tests, including the pure-Python RSA backend used by frozen applications.
- Added frontend signup and username-resolution regression tests.
- The exact packaged Electron application must now create an ephemeral Firebase account, verify its real ID token, complete signup, resolve mixed-case usernames, establish a session, load `/me`, and round-trip the refresh token through encrypted Windows storage before release publication.
- The release workflow deletes its ephemeral Firebase account after validation and verifies every published prerelease asset.

## [0.1.0-beta.3] - 2026-07-28

### Fixed

- Corrected the Windows release configuration used by Firebase authentication.
- Normalized configuration values defensively before Firebase initialization.
- Moved persistent refresh tokens from renderer `localStorage` into Electron `safeStorage`, encrypted through Windows data protection.
- Added automatic migration of legacy refresh tokens after a successful encrypted write.

### Release safeguards

- Firebase release validation now rejects values with wrapping quotes.
- Firebase API keys must match the expected Google web API-key format before packaging can begin.
- The configured public web key is validated against Firebase before release.
- The packaged Electron application must mount its renderer and pass an encrypted refresh-token round trip before release assets can be uploaded.

## [0.1.0-beta.2] - 2026-07-28

### Fixed

- Fixed the installed Windows application opening to a blank black window when the release build did not receive its Firebase web configuration.
- Changed Firebase initialization to occur only when an authentication action needs it, so an unavailable optional service can no longer crash the renderer before the interface appears.
- Authentication screens now show a clear in-app configuration error if a custom build omits Firebase values.

### Release safeguards

- Windows beta and stable workflows now inject the required Firebase web configuration from GitHub Actions secrets.
- Release builds now fail before packaging when any required Firebase build value is absent or malformed, preventing another unusable installer from being published silently.
- No Firebase values, user credentials, backend secrets, or GitHub credentials are committed to the repository.

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

[0.1.0-beta.4]: https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v0.1.0-beta.4
[0.1.0-beta.3]: https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v0.1.0-beta.3
[0.1.0-beta.2]: https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v0.1.0-beta.2
[0.1.0-beta.1]: https://github.com/SpecterCoded/MyAiLibrary/releases/tag/v0.1.0-beta.1
