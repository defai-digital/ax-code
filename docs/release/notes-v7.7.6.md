# AX Code v7.7.6

Status: Active
Scope: public, current release notes (CLI/TUI)
Last reviewed: 2026-08-21
Owner: AX Code release engineering

Released August 20, 2026 · [Full changelog](https://github.com/defai-digital/ax-code/compare/v7.2.0...v7.7.6)

These notes cover the CLI and terminal TUI surfaces for the v7.2.0 → v7.7.6 line.
Desktop-app changes are tracked separately in
[`desktop/CHANGELOG.md`](../../desktop/CHANGELOG.md).

The v7.7 line hardened the CLI and TUI for long-running, unattended work: streaming
correctness, crash resilience, provider reliability, and a large CLI ergonomics pass —
alongside per-project storage sharding and a substantial streaming-performance rework.

## Highlights

- **Streaming performance rework** — the TUI now coalesces deltas before the RPC
  boundary, paints streaming text as plain text (mounting the rich renderer once at
  finalize), keeps streaming rows mounted with batched event windows, and scales the
  paint interval with document length. Long sessions stay responsive.
- **Crash and terminal resilience** — the TUI keeps the session alive on unhandled
  rejections, surfaces backend death instead of silently hanging, stops the crash loop
  when the terminal dies mid-session, and hardens terminal input handling.
- **CLI reliability pass** — command failures now produce readable errors and non-zero
  exit codes (#398–#400); `ax-code run` validates the model before creating a session
  (#405); session delete/prune require confirmation or `--force` (#403); `doctor`
  native-addon flags are annotated when the addon is missing (#401) and no longer
  reports health false positives.
- **Per-project storage sharding** — sessions, messages, replay event logs, todos,
  goals, task queues, scheduled tasks, and workflow tables can route to per-project
  SQLite shards (Phase 2, gated by `AX_CODE_SHARD_SESSIONS`), with hardened concurrent
  writes and `SQLITE_BUSY` survival on bootstrap.
- **Provider reliability** — provider fallback surfaces as a transcript notice (#394),
  streamed text deltas reconcile against snapshots, output-loop detection recovers with
  guidance instead of blind retries, and active sessions survive provider toggles.

## New features

- `feat(tui)`: status, notifications, progress, and rewind controls; mode chips on the
  start screen and in the prompt footer; running-subagent rail backed by the task queue;
  help dialog generated from the keybind schema; kitty keyboard protocol enabled by
  default; AX Engine download visibility (progress chip, completion toasts, submit
  guard); idle recap banner after each turn.
- `feat(cli)`: `ax-code task list|show|cancel|retry` for background task management.
- `feat(agent)`: `waitfor` tool, lifecycle hook events (ADR-057), Scout subagent with
  WebFetch path, and the `/verified-fix` workflow.
- `feat(autonomy)`: opt-in semantic pre-approval guardian with a dedicated guardian
  model and fail-closed tests; autonomous mode hardened against self-escalation and
  dangerous git-config writes.
- `feat(provider)`: provider manager UI with temporary disable/enable; Hugging Face and
  UnoRouter added to default login providers; catalog family filters; AX Engine managed
  vs attach connection modes with a six-model AXQuant catalog and TUI download offer.
- `feat(code-intelligence)`: symbol relevance signals, symbol-anchored cross-session
  notes, DRE auto-notes, and warm-up hints.
- `feat(session)`: `/loop`-style scheduling hardening and long-running task execution
  improvements.

## Improvements

- `refactor(tui)`: consolidated the AX-owned renderer package; restored OpenTUI package
  contracts with hardened checks; reproducible opentui-spinner build with typecheck.
- `perf(tui)`: footer context gauge now measures against the compaction budget; stale
  tool footer status simplified.
- `refactor(ax-engine)`: model-specific context policy locked; 6-bit-only local lineup.
- Config persistence now survives JSONC comments for isolation and settings.
- `ax-code` sets its process title and the doctor instance check ignores TUI backends.

## Fixes

- **Sessions**: reconciled streamed text deltas against snapshots; tool-calling backstop
  resets its streak and fires at the cap (#390); compaction history trimmed to fit small
  model windows; in-stream model output loops stopped without falling back off local
  providers; scheduled tasks hardened against stringified params.
- **Providers**: Kimi headless runs stabilized; verified Kimi and DeepSeek capability
  registrations; connected-CLI model selection hardened; MiniMax Token Plan aux-model
  preference, renames, and stale-SKU drops; Alibaba Token Plan allowlist filtering; Groq
  and Zhipu catalogs refreshed from official docs; runtime SDK installs pinned.
- **Auth**: login survives canary failure and guards non-TTY flows (#392, #393);
  `providers logout` can remove undecryptable credentials.
- **TUI**: ten correctness fixes from an internal TUI code review; `ctrl+j` inserts a
  newline instead of submitting; selected model preserved during discovery; dead model
  selections stopped; session truncation, connection state, and toast storms tamed.
- **Platform**: Windows self-upgrade with post-update verification; PTY, SQLite, and
  CLI setup hardening; standalone runtime packaging hardened.
- **Tests**: the suite strips inherited `AX_CODE_*` host-session flags before running.

## Deprecations and removals

- `feat(provider)!`: the `gemini-cli` and `antigravity-cli` providers were retired.
- `feat(ax-engine)!`: the AXQuant catalog moved to a fixed six-model lineup.

## Install and verify

Signed archives are attached to this release for `darwin-arm64`, `windows-x64`, and
`windows-arm64`, plus `install.ps1`. Verify any asset against the published
[`ax-minisign.pub`](./ax-minisign.pub) using the steps in the
[release verification guide](./README.md).
