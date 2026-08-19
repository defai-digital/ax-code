# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [7.7.1] - 2026-08-19

### Added

- MiniMax Token Plan rename, Z.AI general API, GLM-4.7-Flash free SKU.
- Symbol relevance signals, DRE auto-notes, warm-up hints.
- Generate GitHub release notes from changelog sections.
- Add symbol-anchored cross-session notes.
- Ship Scout WebFetch path and /verified-fix command.
- Add backend reliability skills and verified-fix workflow.

### Fixed

- Bound warmup signal accumulator.
- Tool-calling backstop resets streak and fires at the cap (#390).
- Survive SQLITE_BUSY on bootstrap project persist (#391).
- Strip inherited AX*CODE*\* host-session flags before the suite runs.
- Measure footer context gauge against the compaction budget.

## [7.7.0] - 2026-08-19

Scout subagent, an optional risk guardian, a usage-focused dashboard, and safer autonomous mode.

### Added

- Improve CLI provider alias resolution and model ranking.
- Add a scout subagent plus backend verification skills.
- Add a dedicated guardian model with fail-closed tests.
- Add an opt-in semantic pre-approval guardian for RISK actions.
- Rework the web dashboard around usage, activity, and provider management.
- Add temporary provider disable/enable controls.
- Log server launch parameters and detect relaunch mismatches.

### Changed

- Remove unverified provider capability overrides.
- Lock model-specific context-window policy.
- Document safe upgrade temporary paths.
- Isolate the auto-update flag in release CI.

### Fixed

- Register verified Kimi and DeepSeek capabilities.
- Harden connected CLI model selection and regenerate the scout agent schema.
- Block dangerous git config keys from autonomous writes.
- Harden autonomous mode against self-escalation and config bypass.
- Preserve active sessions when dashboard toggles change.
- Refresh Groq and Zhipu catalogs and align Alibaba / Z.ai plan allowlists.
- Trim compaction history so it fits small model windows.
- Stop crash loops when the terminal dies mid-session.
- Stop in-stream output loops and recover with guidance instead of blind retries.
- Never fall back off local providers after a stream loop.
- Resume signed releases and post-publish jobs from the requested tag.

## [7.6.4] - 2026-08-18

Local models are 6-bit only, Windows can self-upgrade, and upgrade verification is complete.

### Fixed

- Finish upgrade verification and catalog documentation.
- Drop 4-bit packs so the local lineup is 6-bit only.
- Add Windows self-upgrade and post-update verification.

## [7.6.3] - 2026-08-17

Configurable request concurrency and per-model token budgets.

### Fixed

- Make request concurrency configurable.
- Tune per-model context and output token budgets.

## [7.6.2] - 2026-08-17

Status, notifications, progress, and rewind controls, plus Windows/PTY/SQLite hardening. Direct xAI cloud integration is retired.

### Added

- Add status, notifications, progress, and rewind controls.
- Enable the kitty keyboard protocol by default.

### Changed

- Retire the direct xAI cloud integration.

### Fixed

- Harden Windows, PTY, SQLite, and CLI setup.
- Set the process title and ignore tui-backend in the doctor instance check.
- Retry draft release visibility.

## [7.6.1] - 2026-08-17

Legacy-terminal newline handling, resumable signed releases, and OpenTUI Node fallbacks.

### Fixed

- Let Ctrl+J insert a newline instead of submitting in legacy terminals.
- Make signed release publication resumable after transient GitHub API failures.
- Restore valid Node.js fallback modules for Bun-only OpenTUI entrypoints.
- Make unexecutable tool-text recovery budget consecutive.
- Report the actual coverage runtime and merge sharded coverage reports.
- Preserve harmless merge interrupts.
- Repair performance-workflow dependencies and execution.
- Resolve repository self-scan regressions.

## [7.6.0] - 2026-08-17

Local AX Engine catalog, background task queue, private GPU providers, and TUI streaming performance.

### Added

- Watch ax-engine downloads — progress chip, completion toasts, submit guard.
- Idle recap — auto post-turn summary banner in TUI.
- Similarity-merge paraphrased council findings into agreement tiers.
- Add ax-code task list, show, cancel, and retry.
- Cascade stop, cap background fan-out, resume after restart.
- Push background subagent results to the parent.
- Spawn background subagents onto TaskQueue.
- Show running subagents on a TaskQueue-backed rail.
- Add dedicated alibaba-pai Ornith 397B-FP8 capability entry.
- Remove npm guard from Ornith thinking control.
- Register local 35B in AX Engine and tighten family detection.
- Vendor native Zig libraries in-repo, drop upstream npm coupling.
- Phase 1–2 ratatui dogfood skeleton (ADR-054 TUI revamp 2).
- Add a shared craft prompt so every model acts as an orchestrator.
- Add Work-session wiring and session-scoped browser snapshots.
- Add AX Work Phase 1 contract, Work agent, and planning docs.
- Add type-first provider connect pickers on Desktop and TUI.
- Add Nebius Token Factory to Private GPU cloud catalogs.
- Add private GPU cloud providers to TUI and Desktop.

### Changed

- Ax-engine: memory-constrained hot-swap, split output flag, durable prefix cache.
- Ax-engine: launch server with the model's declared output budget.
- Tui: show per-message tok/s and cache-hit in assistant footer.
- Keep the system prompt stable for prompt-cache hits.
- Feat(ax-engine)!: six-model AXQuant catalog with TUI download offer.
- Update env forwarding test for retired gemini-cli.
- Feat(provider)!: retire gemini-cli and antigravity-cli providers.
- Harden GLM selectability for no-separator IDs and future vision SKUs.
- Recover pasted tool XML after a forced wrap-up and bind council aliases.
- Rework the tool-only stall breaker around progress, not finish reason.
- Make Ornith thinking control explicitly exclusive with DashScope path.
- Slim shipped vendor tree and extract reviewable patches.
- Persist private GPU models, fix provider type select, and proxy desktop API websockets.
- Perf(tui): coalesce deltas before the RPC boundary; surface backend stream health.
- Remove experimental Ratatui sidecar.
- Perf(tui): paint streaming text as plain text, mount rich renderer once at finalize.
- Perf(tui): keep streaming rows mounted, batch event windows, calm chrome paints.
- Align GPT, Claude, Gemini, and Trinity prompts with craft.
- Remove the Work surface and relocate computer use to ax-work.
- Align Kimi, GLM, Qwen, DeepSeek, and MiniMax with OpenCode.
- Shrink the default slash menu to high-value commands.
- Keep MiniMax PAI thinking out of visible text and session titles.
- Harden ax-engine truncated-turn recovery to stop multi-minute re-pastes.
- Defer ax-engine force-text after large tool results and harden recovery.

### Fixed

- Tolerate first-launch executable scanning.
- Recover credentials and stale model state.
- Stop think-tag metadata from breaking prompt validation.
- Make ax-engine download state visible and stop dead model selections.
- Accept mlx4bit in ax-engine model action schema.
- Raise ax-engine output cap and parse prefilled think blocks.
- Surface silent failures in the UI.
- Bound window loadURL, reap orphan processes, escalate stuck kills.
- Close loopback security gaps, stop silent project loss, retry failed backend starts.
- Unblock deterministic tests hidden behind earlier gates.
- Typecheck task/TUI gates and bump osv-scanner-action.
- Restore main GitHub Actions gates.
- Preserve newlines for plain-text CLI providers.
- Clear busy status after resume joins an active prompt loop.
- Ten correctness fixes from TUI code review.
- Resolve prompt contradictions, enrich thin tool descriptions.
- Make CLI providers honor generateObject responseFormat json.
- Stop cleanly on terminal autonomy caps, exempt generated files.
- Let providers logout remove undecryptable credentials.
- Surface undecryptable credentials, harden council/arena fan-out.
- Make GLM/Qwen family matching separator- and case-insensitive.
- Dedupe model-support capability sources, add MiniMax registry.
- Tighten Ornith family detection.
- Shorten Autonomous labels to Auto.
- Make bash_output wait abort-safe and ignore consumed backlog.
- Wait on bash_output so idle polls cannot burn the tool-only breaker.
- Collapse Qwen 3.x system turns and strip MiniMax empty reasoning.
- Collapse system messages and add 35B/397B family support.
- Type Token Plan Qwen fallback as RawModel via assertion.
- Long-lived SSE subscribe and fail-closed smoke (ADR-054).
- Fix ax-engine force-text trap that kills pure read-only tasks.

## [7.5.1] - 2026-08-11

### Added

- Autonomy: adds `autonomy.budget` configuration for token limits, stall detection, burst control, and a `/limits` command that explains the active budget.

### Changed

- Quality: completes a module-by-module runtime and Desktop audit with reproducible reviewer evidence and focused regression coverage.

### Fixed

- Autonomy: reports specialist step caps honestly and keeps configured token, stall, and burst limits aligned across execution and the TUI.
- Authentication: prevents migration races from overwriting newer credentials, preserves newly-created lock files, and surfaces encryption fallback conditions.
- Desktop: shuts down the backend cleanly after fatal errors, prevents orphaned child processes, and reports terminal cleanup failures that were previously silent.
- Installation: selects the Minisign bootstrap executable for the host CPU, fixing verified installs on Linux ARM64.

## [7.5.0] - 2026-08-11

### Added

- Desktop: adds a Work | Code surface switch, a task-focused Work home, and a project home with pinning, recency, and Codex/Kimi workspace import.
- Providers: adds native DeepSeek and Meta Muse Spark cloud integrations, including setup discovery and reasoning variants.
- Distribution: adds Ubuntu 24.04+ CLI and Desktop releases for amd64 and arm64, with `.deb`, AppImage, and node-bundled archive install paths.

### Changed

- AX Engine: speeds local response-only inference, improves model download progress and recovery, and applies accurate full-agent context-budget checks before selection.
- Security: updates Hono and dependency override floors for current upstream advisories.
- Release: minisigns every downloadable asset, Apple Developer ID-signs and notarizes macOS builds, and Authenticode-signs Windows Desktop installers for x64 and ARM64 as DEFAI Private Limited.

### Fixed

- Sessions: serializes forced part writes, keeps text-only preflight estimates aligned with requests, forces a final response after completed goals, and surfaces recoverable network pauses.
- TUI and tools: preserves model selection during discovery, coalesces high-frequency stream updates, gates thinking state on live activity, and prevents duplicate LSP prewarm work.
- Reliability: hardens local AX Engine tool loops, download parsing, provider invalidation, arena eligibility, CLI stream-idle handling, Desktop endpoint contracts, and release validation.

## [7.4.1] - 2026-07-29

### Added

- Sessions: adds durable scheduled-task execution with restart recovery, catch-up policies, execution deadlines, and visible task outcomes.
- Desktop: adds assistant-message feedback plus edit-and-rerun actions, and exposes workflow-runtime status guidance.

### Fixed

- Reliability: prevents scheduled-task failures from being erased by a fast detached execution race and preserves the scheduler's short-lived caller behavior.
- Providers: refreshes access tokens proactively with single-flight protection for rotating refresh tokens.

## [7.4.0] - 2026-07-27

### Added

- Tools: adds image generation, durable process monitoring, and structured Jupyter notebook editing.
- Skills: adds built-in loop, run, simplify, and verify workflows.
- AX Engine: adds managed and attach connection modes plus model-management APIs.
- TUI: generates the help dialog from the keybinding schema and adds clearer connection-state reporting.

### Changed

- Desktop: extracts chat-input, tool-formatting, file-view, context-panel, and synchronization logic into focused tested modules.
- Performance: scales TUI streaming repaints with document length and loads Desktop file-type icons as a static asset.
- Sessions: moves child-session navigation away from plain arrow keys and caps expanded tool output.

### Fixed

- Reliability: keeps TUI sessions alive across unhandled rejections, surfaces backend death and truncated sessions, and prevents toast storms.
- Desktop: recovers from renderer crashes, reports startup and session-action failures, sanitizes Mermaid SVG, and standardizes loading states.
- Tools: hardens image generation, background process cleanup, monitor polling, and notebook editing against malformed or unsafe input.
- Release: fixes Desktop release finalization and explicitly trusts the shared Homebrew tap during install smoke tests.

## [7.3.0] - 2026-07-26

### Added

- Tools: adds durable background shell execution with output polling and explicit process termination.
- Hooks: adds `UserPromptSubmit`, `PreCompact`, and `SubagentStop` lifecycle events.
- Commands: adds built-in `/commit` and `/pr` workflows while preserving user-defined command overrides.
- Providers: adds Hugging Face and UnoRouter to the default setup experience.

### Changed

- Skills: parses full frontmatter and surfaces declared `allowed-tools` to the runtime.
- AX Engine: raises the minimum supported local-engine version to 6.11.0.
- Distribution: consolidates new Homebrew installs in `defai-digital/tap` while dual-publishing legacy taps for upgrade compatibility.

### Fixed

- Providers: aligns Hugging Face and UnoRouter setup, small-model routing, login handling, and OpenRouter attribution.
- Sessions and storage: improves automatic titles, hook ordering, queue metadata cleanup, and migration-marker parsing.
- Tools: hardens background shell cleanup against process leaks, corrupt output, and orphaned children.
- Release: signs and verifies the Desktop disk image with the Apple Developer ID before notarization, uses the correct Gatekeeper disk-image assessment, and refreshes update metadata after stapling.

## [7.2.0] - 2026-07-25

### Added

- Sessions: adds conversational `/loop` scheduled tasks, super-long run controls, and visible run engagement state.
- Code intelligence: adds the native AX Wiki compiler, tree-sitter syntactic fallback, graph highlights, and OpenWiki interoperability.
- Providers: adds Grok 4.5, provider-aware effort levels, and AX Engine MTP Auto with Direct fallback.
- Distribution: generates CLI and Desktop Winget manifests and presents platform-native install commands in Desktop onboarding.

### Changed

- Release: rotates CLI and Desktop minisign verification to key `CF42FC69BEEF0EA5` and uses the shared `~/signkey/ax.minisign.key` plus `ax.pub` local key layout.
- Runtime: bounds outbound concurrency, coalesces high-frequency writes, and improves SSE backpressure and error observability.
- Desktop: refines navigation, retry behavior, typography, accessibility, and platform-specific deployment guidance.

### Fixed

- Sessions: preserves long-run goal ceilings, prevents repeated truncated-output retries, and hardens pause and convergence behavior.
- Code intelligence: prevents accidental home-directory indexing, purges legacy home graphs, and caps LSP clients with LRU eviction.
- Desktop: fixes reliability issues across the Electron shell, UI state and synchronization, terminals, permissions, and session recovery.
- Providers and TUI: hardens CLI model resolution, stream handling, effort restoration, backend loading, and native FFI pointer lifetimes.
- Security and release: patches dependency advisories and strengthens Minisign, Apple, Windows, Homebrew, and install-matrix verification.

## [7.1.0] - 2026-07-18

### Added

- Providers: adds the Kimi Code CLI membership bridge.
- Desktop: adds a searchable project switcher in the composer.
- TUI: adds the standalone Rust native engine.

### Changed

- AX Engine: exposes the shared local-engine lifecycle in status and doctor output.

### Fixed

- Desktop: preserves session routes during hydration and keeps draft decision state isolated.
- Providers: hardens Kimi CLI stream parsing, configuration resolution, and empty-response handling.
- TUI: hardens native runtime state, provider workflows, model selection, streaming, and terminal rendering.
- Release: refreshes CI and release checks for portable native builds and tracked reports.

## [7.0.1] - 2026-07-14

### Added

- Wiki: adds the semantic repository layer with generation, status, lint, path-safety, cards, and related-link support.

### Changed

- Models: refreshes the bundled provider snapshot used by the CLI and Desktop runtime.
- Release: moves Windows Desktop Authenticode signing to the DEFAI certificate in Azure Key Vault and verifies the certificate thumbprint and RFC 3161 timestamp during packaging.

### Fixed

- Desktop: keeps Arena and Council work-mode routing consistent across the native shell and web server, including Qwen JSON fan-out.
- Providers: restores disconnect and change-key actions after a provider has connected.
- Server: returns validated route errors for malformed requests instead of surfacing internal parsing failures.
- TUI: hardens abort handling, timeout cleanup, and permission-submit latching.
- TUI: preserves the selected Unicode-width method during terminal rendering.
- Self-scan: refreshes repository policy coverage and baseline fingerprints for the current source tree.

## [7.0.0] - 2026-07-13

### Changed

- Desktop: refreshes the signed Desktop release line and aligns the application version with AX Code 7.0.0.
- Work mode: uses the Arena purple treatment consistently in Desktop and the terminal UI.

### Fixed

- Release: runs deterministic CLI tests in bounded sequential shards to avoid memory exhaustion before signed release builds.

## [6.11.4] - 2026-07-12

### Fixed

- Release: bounds deterministic CLI test worker concurrency with a Vitest-supported option.

## [6.11.3] - 2026-07-12

### Fixed

- Release: raises the deterministic CLI test heap limit so signed release builds can complete on GitHub-hosted runners.

### Fixed

- Desktop: prevents the integrated terminal's shared session from being closed during renderer lifecycle races and restores stale terminal tabs as fresh shells.
- Desktop: isolates concurrent terminal transports, deduplicates multi-view and replayed output, and prevents stale action/session events from replacing live PTYs.

## [6.11.2] - 2026-07-12

### Fixed

- Release: increases CI test capacity and strengthens SDK generation, repository policy, and Desktop-boundary verification.

## [6.11.1] - 2026-07-12

### Fixed

- Desktop: stabilizes integrated terminal sessions and multi-view transport.

## [6.11.0] - 2026-07-12

### Added

- Desktop: adds a centered application-icon source and repeatable icon generator for macOS and Windows packaging.
- Desktop: adds session-pulse and shared empty-surface UI components, with workspace-focus coverage.

### Changed

- TUI: coalesces high-frequency text stream deltas to reduce projection and RPC churn while preserving event ordering.

### Fixed

- Security: includes the latest local-only access hardening and regression fixes.

## [6.10.3] - 2026-07-08

### Changed

- **Homebrew**: the Desktop cask is published as `ax-code-desktop` again. The `ax-code` cask token (introduced 2026-06-21) collided with the `ax-code` CLI formula: Homebrew refuses to link a formula while an installed cask shares its token, so CLI formula upgrades removed the `ax-code` command from PATH entirely (#342). Existing installs of the `ax-code` cask migrate to `ax-code-desktop` automatically on their next `brew upgrade` via the tap's `cask_renames.json`.

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.10.2] - 2026-07-08

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.10.1] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.10.0] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.8] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.7] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.6] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.5] - 2026-07-07

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.4] - 2026-07-06

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.3] - 2026-07-06

### Fixed

- CLI: refreshes the current stable release line with accumulated runtime and release workflow fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.2] - 2026-07-06

### Fixed

- CLI: refreshes the current stable release line with runtime and native addon compatibility fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.1] - 2026-07-04

### Fixed

- CLI: stabilizes TUI slash-command autocomplete so typing `/` keeps the menu open while textarea cursor state settles.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.9.0] - 2026-07-04

### Changed

- CLI: enables the ADR-046 Rust native render core by default. The render pipeline (renderer, buffer, text/edit/editor, terminal, plus yoga/audio) routes to the in-house `@ax-code/render` addon, which is byte-parity with the bundled Zig backend across the golden-frame gate; `AX_CODE_NATIVE_RENDER=0` forces the previous library and `AX_CODE_NATIVE_RENDER_SCOPE=yoga` routes only yoga/audio. The addon ships per platform (macOS arm64, Windows x64/arm64).
- Desktop: aligns the app version with the ax-code CLI v6.9.0 release.

## [6.8.5] - 2026-07-01

### Added

- CLI: installs the pinned AX Engine v6.6.0 binary on eligible macOS hosts and documents the `AX_ENGINE_INSTALL_URL` override for managed installs.
- Desktop: lets the Models settings flow trigger the managed AX Engine install path when the bundled engine is missing.

### Changed

- CLI: aligns the AX Engine managed-install trust model with the ad-hoc minisign release artifacts used by the engine release.

### Fixed

- Desktop: reverting the latest user message no longer hides the assistant responses of earlier, non-reverted turns. Client-generated user-message ids now match the server id ordering used by assistant messages.

## [6.8.4] - 2026-07-01

### Added

- CLI: adds `ax-code webui` and a `/webui` TUI command that reuse or start the AX Code Desktop browser UI.
- Desktop: changes the browser web UI preferred port to `3100` and scans upward for the next safe free port instead of using an OS-random fallback.

### Changed

- Desktop: reduces session sync render churn with session-scoped subscriptions and streaming fast paths.

### Added

- Desktop: added a guarded `ax-code-desktop tunnel` Cloudflare quick tunnel MVP for temporary trusted browser access with UI password enforcement.

## [6.8.3] - 2026-06-30

### Changed

- Desktop: moves AX Engine server start/stop controls to the Models settings header and keeps model switching on the provider model picker hot-swap path.
- Desktop: simplifies the Models settings table status labels and reduces row text density.
- Desktop: expands the built-in Skills Catalog sources with additional curated engineering catalogs ordered by popularity.

## [6.8.2] - 2026-06-30

### Fixed

- CLI: republishes the current stable release line with accumulated startup, licensing, and Desktop integration fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: switches Windows Desktop Authenticode packaging to Azure Trusted Signing and refreshes Homebrew formula and cask updates.

## [6.8.1] - 2026-06-30

### Fixed

- CLI: republishes the current stable release line with the supported security-policy table aligned to the 6.8 minor line.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.8.0] - 2026-06-29

### Fixed

- CLI: publishes the current stable release line with accumulated TUI, provider, and local model management fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.20] - 2026-06-29

### Fixed

- CLI: publishes the current stable release line with accumulated TUI and provider fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.19] - 2026-06-29

### Fixed

- CLI: publishes the current stable release line with accumulated provider, TUI, and Desktop integration fixes.
- Desktop: refreshes signed Desktop release assets from the current monorepo release line.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.18] - 2026-06-28

### Fixed

- CLI: publishes the current stable release line with accumulated Desktop reliability fixes.
- Desktop: stabilizes update checks, event stream retries, SSH status refreshes, browser navigation, and open-in-app metadata handling.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.17] - 2026-06-28

### Fixed

- CLI: publishes Groq output reservation and Qwen 3.7 capability updates.
- Desktop: hardens host IPC token handling, tray actions, canvas saves, and release minisign tests.
- Release: refreshes signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.16] - 2026-06-28

### Fixed

- CLI: excludes Groq OpenAI-compatible models from unsupported reasoning-effort variants.
- CLI: improves tool-only turn convergence with a nudge before hard limits.
- Desktop: republished signed Desktop assets from the current monorepo release line.

## [6.7.15] - 2026-06-28

### Fixed

- CLI: strips provider-specific reasoning content from Groq assistant history before sending OpenAI-compatible requests.
- CLI: publishes Groq Qwen 3.6 27B and GPT-OSS 120B message-shape compatibility fixes.
- Desktop: republished signed Desktop assets from the current monorepo release line.

## [6.7.14] - 2026-06-28

### Fixed

- CLI: published the current GLM 5.x model capability registry updates.
- CLI: hardened Super-Long pacing lock recovery and z.ai wire-shape handling.
- Desktop: republished signed Desktop assets from the current monorepo release line.

## [6.7.13] - 2026-06-28

### Fixed

- CLI: published the current provider setup and supported-provider documentation updates.
- Desktop: republished signed Desktop assets from the current monorepo release line.
- Release: refreshed signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.12] - 2026-06-28

### Fixed

- CLI: refreshed provider catalog filtering and TUI command aliases for the current release line.
- Desktop: aligned provider connection UX and remote install defaults with the Node runtime release path.
- Release: republished signed CLI and Desktop assets with Homebrew formula and cask updates.

## [6.7.11] - 2026-06-28

### Fixed

- CLI: hardened TUI event stream connection timeout handling.
- Desktop: hardened tool state finalization and packaged release smoke recovery and timeout parsing.
- Release: refreshed signed Desktop asset publication and Homebrew cask update paths.

## [6.7.10] - 2026-06-28

### Fixed

- TUI: hardened background task, listener, timer, terminal cleanup, and renderable safety paths.
- Desktop: added stricter stability checks for IPC, endpoint contracts, package test scripts, and packaged app smoke coverage.
- Release: refreshed bundled provider model metadata and dependency patch updates.

## [6.7.9] - 2026-06-27

### Fixed

- TUI: improved leader-key feedback, slash-command filtering, permission prompt Enter handling, and deleted-session exit text.
- Desktop: fixed browser address navigation and prevented the terminal dock from opening as a blank unusable panel.
- Windows: switches the CLI launcher to UTF-8 code page before rendering the TUI.

## [6.7.7] - 2026-06-27

### Fixed

- Model picker navigation now skips unavailable memory-blocked models in Desktop.
- Favorite-model shortcuts no longer select unavailable models in Desktop.

## [6.7.6] - 2026-06-25

### Fixed

- Runtime: replaced direct `Bun.*` API usage in shared CLI paths with Node-native compatibility helpers so bundled Node runtime surfaces stay Bun-free.

## [6.7.5] - 2026-06-25

### Fixed

- Prompt: clarified `@` autocomplete grouping for files, resources, and subagents, and hardened subagent instruction generation for malformed permission rulesets.
- Session: restored the `/diff` baseline snapshot so `/diff` reports file changes made during the agent step.
- Providers: hid Grok Cloud API from the default provider connection lists while preserving explicit configuration support.

## [6.7.4] - 2026-06-24

### Fixed

- Release: align the Desktop release with the AX Code 6.7.4 issue-fix build, including minisign-signed GitHub assets and the Homebrew cask refresh.

## [1.4.3] - 2026-06-23

### Fixed

- **Sync**: tool parts no longer revert from a final state (`completed`/`error`) to a stale `pending`/`running` state when `message.part.updated` events arrive out of order. The event-pipeline coalescer now preserves the finalized state, so finished tools stop showing a perpetual spinner. Pairs with the ax-code 6.7.3 server-side guard that breaks read-only tool-calling loops.

## [1.4.0] - 2026-06-20

### Changed

- Release: publish the current desktop line as v1.4.0 from the ax-code monorepo release path.

## [1.3.0] - 2026-06-19

### Changed

- **Infrastructure**: migrated from Bun to Node.js + pnpm for better ecosystem compatibility and native module support. All scripts, CI workflows, and contributor documentation updated. Bun lockfile removed, pnpm workspace and lockfile added.
- **Performance**: optimized startup and shutdown paths to reduce latency. Server shutdown now uses structured lifecycle hooks with configurable timeouts.

### Fixed

- **Sync**: resolved persistent "no assistant response" errors on second+ prompts through multiple fixes:
  - Increased watchdog timeout from 12s to 60s and grace window from 30s to 60s (v1.2.9)
  - Added grace-window re-arm to prevent false errors from transient SSE idle events (v1.2.8)
  - Cancelled stale watchdog timers from previous prompts (v1.2.7)
  - Guarded async recovery against cross-turn clobbering (v1.2.7)
- **Tests**: stubbed WebSocket in event-pipeline tests for vitest/jsdom compatibility. Fixed test runner to use vitest instead of bun test.
- **Electron**: renamed app from "AX Code Desktop" to "AX Code" for consistency. Fixed electron-builder configuration to pass resolved electronVersion.
- **Docker**: kept vendored @ax-code/sdk dist in build context to prevent missing dependencies.
- **Dependencies**: overrode node-gyp to ^11 so native builds work on Python 3.12.

### Added

- **Testing**: added comprehensive vitest configuration with coverage reporting. Migrated all test files from bun test to vitest.

## [1.2.9] - 2026-06-19

### Fixed

- Sync: increased watchdog timeout from 12s to 60s and grace window from 30s to 60s to prevent false "no assistant response" errors on slower models or network conditions. The watchdog now waits longer before fabricating an error, giving the assistant more time to respond. This addresses persistent reports of the error appearing on second+ prompts even after previous fixes.

## [1.2.8] - 2026-06-18

### Fixed

- Sync: the accepted-prompt watchdog no longer fabricates a false "no assistant response" error when an SSE `session.idle` / `session.status:idle` event transiently clobbers busy→idle during the 30s prompt-accepted grace window. The grace window (`wasPromptRecentlyAccepted`) previously only guarded the status-poll/reconnect path (`resolveResyncedSessionStatus`), not the event-reducer's direct status writes. The watchdog's fabrication branch now checks `wasPromptRecentlyAccepted` and re-arms itself to fire again after the grace window expires, so transient grace-window clobbers do not produce false errors while genuinely dead turns (idle + no response after grace expires) are still caught. This fixes the "first prompt works, second prompt fails" pattern in v1.2.7.

## [1.2.7] - 2026-06-18

### Fixed

- Sync: stale accepted-prompt watchdog from a previous prompt no longer fires during the next prompt's turn and clobbers the busy status to idle. The watchdog timer is now cancelled when a new prompt is sent for the same session (`scheduleAcceptedPromptWatchdog` tracks and clears the previous timer via `acceptedPromptWatchdogTimers`). A defense-in-depth guard also prevents the idle-forcing branch from running when a newer user message exists without its own assistant reply. This was the root cause of the "The request was accepted, but no assistant response or error was produced" error appearing on every 2nd+ prompt in v1.2.6.
- Sync: the watchdog's async server-refetch recovery path (`recoverAcceptedPromptFromServer`) no longer clobbers a newer prompt's busy status. The `await` during recovery created a timing window where a new prompt could start; when recovery completed, it found the old prompt's completed response and forced idle based on `isSessionWorking()` alone — without checking whether a newer unanswered user message existed. Extracted `hasNewerUnansweredUserMessage` as a shared guard applied to both the initial-match and recovery branches.

## [1.2.6] - 2026-06-18

- Sync: the session watchdog (12s busy-to-idle timeout) no longer fires on 2nd+ prompts. `markPromptAccepted` now runs synchronously before the async `input.send()` call, closing the ~50-200ms race window where the periodic status poll could clobber the optimistic busy state to idle. Once clobbered, the watchdog's guard treated the existing idle status as a no-op, so it always timed out on every subsequent prompt. A regression test exercises the exact race across 4 consecutive prompts.

## [1.2.5] - 2026-06-18

- Origins (loopback): the request-security same-origin/CSRF check now treats `localhost`, `127.0.0.1`, and `[::1]` as interchangeable loopback addresses, so accessing the app via one when it is bound to another no longer fails the origin check. Host parsing now uses `new URL()` instead of a naive `host.split(':')`, which previously broke on bracketed IPv6 hosts (e.g. `[::1]:3000`).
- Passkeys: `getCurrentRequestOrigin` now derives the WebAuthn relying-party origin via `new URL().origin` (with a safe fallback) for consistent, IPv6-safe origin derivation across registration and authentication.
- Skills catalog (SSH parsing): the server-side `parseSkillRepoSource` and the client-side catalog label guesser now handle bracketed IPv6 SSH hosts (e.g. `git@[2001:db8::1]:group/repo.git`) and nested groups (`group/subgroup/repo`), instead of mis-splitting the host or dropping path segments. The UI label logic was extracted from `AddCatalogDialog` into a testable `catalogSourceLabels` module.
- Plugins: `isExactSemver` now correctly accepts combined pre-release + build metadata (e.g. `1.2.3-beta.1+build.5`) using proper semver character classes, instead of the overly loose previous pattern.

## [1.2.4] - 2026-06-18

- Terminal: when a backpressured SSE client disconnected before its socket drained, cleanup ended the response so the one-shot `drain` listener never fired, leaving the session's shared pty paused indefinitely. Because the pty is shared across all clients of the session and also feeds the output replay buffer, this froze terminal output for every remaining client and any later reconnect. Teardown now tracks whether this client left the pty paused and resumes it, mirroring the close/error/abort-aware drain handling already used by the ax-code SSE proxy.
- Event stream: when a client reconnected with a `Last-Event-ID` whose anchor had been evicted from the replay buffer (instead of merely being behind it), the bridge failed to recover. Both the server-side event-stream bridge and the browser-side event-stream layer now replay the full buffer when the anchor is missing/evicted, restoring a complete view after a gap.
- Sync: resolved reconnect, streaming, and watchdog correctness bugs in the UI sync layer.
- Electron: handle the reveal-path and open-file-in-app IPC messages; normalize fetched app-icon payloads before rendering; detect packaged Windows Terminal installs (in addition to portable) when resolving the default terminal.
- Build/tooling: TypeScript path aliases are now baseUrl-free; the desktop smoke workflow defaults to the current repo; the release smoke step honors the no-bundle flag; the About dialog's upstream link now points at the correct repo.

## [1.2.3] - 2026-06-17

- Server (critical): the dedicated `/api/session/:id/prompt_async` and `/command` proxy handlers now forward the real request body verbatim instead of `JSON.stringify(req.body ?? {})`. The `/api/session/*` routes intentionally bypass `express.json()` so the generic streaming proxy can forward raw bodies, which left `req.body` undefined and caused the handler to send `{}` to ax-code — no model, no parts — producing an opaque `InvalidRequestError` (400) for **every** prompt. The handler now reads the raw stream and forwards it as-is, parsing locally only to recover the message/command id for dedup. This was the root cause behind the prompt-send 400s that the earlier client-side model-guard work could not fix.
- Client: `sendMessage` now guards against an empty/undefined `providerID` or `modelID` and throws a clear, actionable error before sending, protecting every caller (assistant-fork, new-worktree, GitHub-issue, multi-run-fusion) — not just the ChatInput path. On a terminal non-OK response it also logs the rejected payload shape (provider/model/agent/variant + summarized parts) for diagnosis.
- Client: the stale-model error message now detects the real backend envelope (`details.resource === 'providerModel'` / "Provider model not found") instead of a `ProviderModelNotFoundError` name the backend never emits.
- Client: `sendMessage` now drops a file part `id` unless it is a valid `prt_` part id and regenerates a non-`msg`-prefixed message id when needed, since either bad prefix makes the backend reject the whole prompt with the same opaque 400.

## [1.2.2] - 2026-06-17

- Client: `sendMessage` now parses structured backend error bodies and maps `ProviderModelNotFoundError` (returned by `prompt_async` when the provider/model pair is stale) to a clear "The selected model is no longer available" message instead of surfacing the raw 400 JSON. Fixes #40.
- Client: `sendMessage` now omits the `agent` and `variant` fields from the prompt payload when they are unset, instead of serializing them as `null`. The AX Code backend rejects `null` for these fields with `InvalidRequestError` (400). The payload now uses conditional spread matching the `sendCommand` pattern.
- Client: removed dead `readFile`/`listFiles` methods that were never called and used `POST` against `GET`-only `/api/fs/read` and `/api/fs/list` endpoints. The actual implementations in `RuntimeAPIs` (`packages/web/src/api/files.ts`) are unaffected and use the correct verbs.
- Electron: support/help links now point at the AX Code monorepo (`defai-digital/ax-code`) rather than a separate desktop source repo.

## [1.2.1] - 2026-06-17

- Security: the `/api/fs/reveal` endpoint (reveal in Finder / Explorer) now resolves the requested path through the shared `resolveWorkspaceOrApprovedPathFromContext` authorization helper, rejecting paths outside the project workspace and the user's approved directories with HTTP 400. Previously it called `path.resolve()` directly, which allowed arbitrary filesystem paths to be opened in the host file explorer. This closes the last authorization gap among the filesystem endpoints, which otherwise already enforced workspace/approved-directory containment.

## [1.2.0] - 2026-06-17

- Release: minor version bump. No application changes since 1.1.9.

## [1.1.9] - 2026-06-17

- Provider: centralized provider fetch logic into a shared `providerApi` module with retry, parsing, and three read functions; refactored ProvidersPage and ProvidersSidebar to use it. Added SDK base URL normalization to prevent stale `/api/config` suffixes from breaking provider endpoints. Added proxy compatibility rewrite counters for diagnostic visibility.
- Desktop: prevented data loss in `moveDirectoryContents` and removed stale `useEffect` dependencies.

## [1.1.8] - 2026-06-16

- Proxy: the SSE forwarder (`/api/event`, `/api/global/event`) now signals `restarting: true` on its 503 when the AX Code upstream is unreachable, matching the established transient-unreachability contract from the generic API proxy error handler and the readiness gate. Previously it emitted a bare 503 (no `restarting`), which could dead-end EventSource clients instead of letting them reconnect/poll until ax-code recovers.

## [1.1.7] - 2026-06-16

- Tooling: ported the hardened minisign signer feature set from ax-engine_v5 into `scripts/minisign-artifacts.sh` and `scripts/minisign-keygen.sh`, while keeping the desktop-specific release key (`5B7AB63CD6D674BE`). The signing script now supports `--public-key-string` (verify with a raw key string, no `.pub` file), `--signature-dir`, `--keychain-service`/`--keychain-account` flags, `--pinned-public-key` override, and verify-with-string-or-file, with robust passphrase resolution (env > macOS Keychain > prompt), up-front path validation for accurate dry-runs, and a pinned-key fail-closed check. This is release tooling only; it does not change the shipped app or how released artifacts verify.

## [1.1.6] - 2026-06-16

- CI: enabled automatic release-asset signing in GitHub Actions by configuring the `AX_CODE_DESKTOP_MINISIGN_SECRET_KEY_B64` and `AX_CODE_DESKTOP_MINISIGN_PASSWORD` secrets and pinning the new desktop minisign public key in the verify workflows. Releases cut from this point forward are signed in CI directly, and the Homebrew cask is bumped automatically — no manual recovery signing or cask edit required.

## [1.1.5] - 2026-06-16

- Release: rotated the AX Code Desktop minisign release-signing key to a desktop-specific keypair (public key id `5B7AB63CD6D674BE`). The pinned public key in the signing script, verify workflows, README, and docs, plus the pinning tests, now reference the new key. Releases before this change were signed with the previous shared key (`8138FAD32CAD95BA`).

## [1.1.4] - 2026-06-16

- Security: hardened the desktop IPC origin guard, session IDs, and HTTP headers.
- Proxy: report `restarting` state when the AX Code upstream is unreachable so the UI surfaces the reconnect attempt instead of an opaque failure.
- UI: corrected a "below" typo in the multirun fork prompt template.

## [1.1.3] - 2026-06-14

- UI: fixed the first-run and cold-start provider load path so setup no longer dead-ends while provider configuration is still loading.
- CI: retried dependency installs to absorb transient GitHub tarball download failures during the main verification workflow.

## [1.1.2] - 2026-06-14

- Desktop: fixed Electron desktop update detection so the local desktop shell uses the native updater instead of the web update path.
- Desktop: normalized OS open-project paths before matching existing projects, preventing duplicate handling for equivalent dropped folder paths.

## [1.1.1] - 2026-06-14

- Desktop: added macOS and Windows OS shell handling so dropping a folder onto AX Code Desktop can add or activate that project.
- UI: fixed first-run provider loading and improved project knowledge detection for AGENTS.md files.
- Tests: kept the Electron open-path coverage compatible with the repository's Bun/Vitest test runner split.

## [1.1.0] - 2026-06-14

- Desktop: made the Electron shell the default desktop runtime and removed the legacy Tauri shell.
- Desktop: added VS Code-style zoom controls to the Electron View menu.
- UI: added the AutomatosX theme defaults and aligned add-provider and scrollbar highlights with the active theme color.
- Runtime: fixed desktop event delivery, SSH cleanup, and mini-chat hand-off reliability.

## [1.0.1] - 2026-06-12

- UI: added session activity badges, permission notifications, done-not-committed prompts, diff comment summaries, and loading/error polish for desktop workflows.
- Security: hardened AX Code integration startup/proxy handling and desktop-native path boundaries.
- Windows: corrected session sorting and async file reads in the desktop server proxy.

## [1.0.0] - 2026-06-11

- Desktop: hardened updater error handling, sidecar shutdown, resource path validation, and packaged search paths for the first stable AX Code Desktop release.
- Server: preserved leading slashes in file-search requests so desktop search endpoints resolve correctly in packaged builds.

## [0.12.1] - 2026-06-11

- Desktop: restored the leading slash in the packaged health-check URL so the desktop boot probe calls `/api/global/health` correctly.

## [0.12.0] - 2026-06-10

- Desktop: tightened the AX Code runtime boundary with shared endpoint contracts, SDK version gates, and runtime readiness forwarding.
- Server: tracked SDK handle exits and surfaced runtime readiness state through the desktop server health path.
- Performance: reduced desktop runtime overhead and moved integration paths toward the public AX Code UI/API surface.
- Internal: added boundary-hardening checks and planning docs for search index ownership and desktop runtime consolidation.

## [0.11.1] - 2026-06-08

- Config: reload providers, agents, commands, and skills in the background so settings changes no longer block the UI.
- Config: added shared background reload handling and route coverage for non-blocking AX Code config refreshes.

## [0.11.0] - 2026-06-08

- Desktop: isolated the managed AX Code runtime behind desktop-only bridge headers and hardened server access against browser-origin requests.
- Desktop: added startup diagnostics for packaged server failures, including manifest checks, executable checks, port checks, and log tailing.
- Release: added a packaged Electron smoke test gate so desktop release builds verify app startup before publishing.

## [0.10.2] - 2026-06-08

- UI: removed the remaining CSS mask rendering paths from scroll-shadow and reveal surfaces to avoid masked rendering artifacts.

## [0.10.1] - 2026-06-08

- Desktop: isolated the bundled web server into an Electron `utilityProcess` and moved renderer hot paths off unbounded synchronous work.
- Desktop: packaged the Electron server process explicitly and waits for graceful server shutdown before quit.
- Git/Remote SSH: hardened remote command probing by shell-quoting command names before execution.
- Sync/UI: kept sessions with pending questions visible while trimming event windows and bounded long-running in-memory Maps.
- CI: split Windows release builds by architecture to avoid cross-architecture native module reuse.

## [0.10.0] - 2026-06-08

- Security: removed browser/server voice, TTS, STT, and microphone permission surfaces from AX Code Desktop.
- Security: removed built-in Cloudflare/ngrok public tunnel provisioning and related CLI, settings, docs, and server routes.
- SDK: refreshed the vendored AX Code JavaScript SDK from `defai-digital/ax-code` and kept desktop integration on the current v2 app API.
- Desktop: completed the AX Code Desktop naming cleanup, English-only UI cleanup, and canonical AX Code package usage for remote SSH installs.
- Release: added Windows arm64 packaging support and per-architecture update manifest merging.

## [0.9.2] - 2026-06-07

- Release: moved minisign signing into the GitHub release workflow, pinned the release public key, and requires signature coverage before publishing release drafts.
- Desktop: refreshed the Windows icon asset used by Electron packaging.
- Docs: consolidated desktop documentation around the maintained web and Electron surfaces, including release, install, proxy, tunnel, and security guidance.

## [0.9.0] - 2026-06-06

- Release: added a guarded GitHub release publishing script with local validation, tag creation, workflow watching, and optional minisign signature upload.
- Release: documented minisign key generation, artifact signing, and the GitHub publishing workflow.
- Branding: refreshed web favicon and logo assets, including a 512px touch icon.

## [0.8.0] - 2026-06-06

- Git: surface fetch errors when resolving an existing remote branch instead of silently swallowing them.
- Settings: align settings copy with desktop support status.
- Cleanup: remove unused mobile context usage view, unused git sync translations, and redundant code paths.

## [0.7.0] - 2026-06-06

- Runtimes: removed the unsupported VS Code extension and mobile/PWA runtimes — the app now targets the desktop and web experiences only, dropping the associated dead code, layouts, and update branches.
- Git: clarified push behavior and removed the implicit auto-push of commits and branches.
- Docs: rewrote the README around desktop downloads and added direct release download links.
- Internal: centralized viewer-mode, browser-voice, and git-conflict preferences, moved legacy settings resources, and removed unused exports/parameters and stale comments.

## [0.6.6] - 2026-06-06

- Release: macOS desktop artifacts are now Apple Silicon only; release, smoke, Electron updater, and legacy Tauri updater manifest paths no longer build or require macOS x64 artifacts.
- Desktop/Windows: rebuilt the Windows app icon as a 256x256 ICO so electron-builder can produce the unsigned Windows installer and portable zip.

## [0.6.5] - 2026-06-06

- Branding: aligned the settings source namespace, notification fallbacks, issue template text, About dialog title, and theme metadata with AX Code Desktop while preserving legacy compatibility paths.

## [0.6.4] - 2026-06-06

- Release: fixed the desktop packaging pipeline — macOS and Windows builds now package correctly (electron-builder config and Windows binary resolution), and npm registry publishing is opt-in and non-fatal so it no longer blocks releases.

## [0.6.3] - 2026-06-06

- Release: the release workflow now skips signing, notarization, and npm publish gracefully when their secrets aren't configured, so a release still publishes unsigned desktop artifacts and the npm tarball instead of failing.

## [0.6.2] - 2026-06-05

- Chat: added an execution-mode selector (Manual / Autonomous / Supervised long-run) to the composer toolbar.
- Desktop: the in-app updater now uses AX Code's own release channel instead of surfacing inherited package metadata and release notes.
- Updates: the web/CLI update source is now configurable via env and no longer defaults to inherited upstream endpoints; with nothing configured it reports no update without phoning home.
- Desktop/Windows: added a portable zip build alongside the installer, and renamed the published npm tarball to ax-code-web.
- Chat: fixed a scroll-spy bookkeeping leak that retained detached nodes.

## [0.6.1] - 2026-06-05

- Desktop: renamed the packaged app to AX Code Desktop and removed the startup splash window.
- Desktop: fixed packaged startup failures caused by missing bundled server assets and JSONC parser internals.
- Chat: reduced send latency by lowering the upstream SSE reconnect delay.
- Sync: fixed relative changed-file path matching and an upstream SSE reader leak.

## Pre-Rebrand History

Earlier upstream history is intentionally omitted from this AX Code Desktop changelog. Current release notes should describe AX Code Desktop only; legacy implementation names belong in compatibility notes when they are required for paths, environment variables, or endpoint names.
