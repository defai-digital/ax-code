# AX Code v7.2.0

Status: Archived
Scope: public, historical release notes
Last reviewed: 2026-07-26
Owner: AX Code release engineering

Released July 26, 2026 · [Full changelog](https://github.com/defai-digital/ax-code/compare/v7.1.0...v7.2.0)

v7.2.0 broadens model steering, hardens long-running sessions, and adds a native
AX Wiki compiler — alongside substantial stability, dependency-security, and
Desktop polish work.

## Highlights

- **Effort levels across providers** — Anthropic, OpenAI, xAI, and CLI providers now
  expose configurable effort levels. `Auto` selects a balanced baseline and is
  preserved across retries, model switches, and session restore, and workflow effort
  is wired through to reasoning-depth policy.
- **Grok 4.5** is now the curated xAI flagship model.
- **Super-long runs** get a pacing grace window, `rateLimitTier` wiring, and
  run-engagement visibility, so long-running goals stay engaged instead of stalling.
- **`/loop` recurring prompts** and conversational scheduled tasks let you automate
  repeat work directly from a session.
- **Native AX Wiki compiler** replaces the external dependency.
- **Code intelligence** gains a tree-sitter syntactic fallback, graph highlights, and
  openwiki interop — and no longer indexes your home directory.

## New features

- `feat(ax-engine)`: MTP Auto runtime with Direct fallback and a Homebrew install path.
- `feat(desktop)`: inline retry for failed assistant turns; secondary-view back bar,
  `focus_chat` shortcut, and auto-collapsing left sidebar.
- `feat(provider)`: effort levels for Anthropic/OpenAI with a polished `/effort` UX;
  Grok 4.5 added as the xAI flagship.
- `feat(ux)`: model variants presented as effort levels.
- `feat`: workflow effort wired to reasoning-depth policy.

## Improvements

- `refactor`: improved error observability, SSE backpressure handling, and type safety
  across the server.
- `refactor(desktop)`: converged font sizes onto semantic typography classes and removed
  the disabled feature tour.
- `refactor(tui)`: renamed the built-in `opencode` theme to `classic`.
- Desktop onboarding now shows platform-native CLI install commands; Windows/macOS
  install and enterprise/winget UX improved; Windows install verified with minisign.

## Fixes

- **Sessions**: long-run step ceiling with convergence warning and pause-at-limit; goal
  ceiling preserved through budget wrap-up; avoided 1-step agent livelock under infinite
  continuation caps; stopped repeated truncated-output retries; cut prompt-loop DB reloads.
- **Concurrency**: added outbound concurrency caps and coalesced stream part writes; fixed
  a permit-transfer open-slot race (now covered by a regression test).
- **Code intelligence / LSP**: stopped indexing the home directory and purged legacy home
  graphs; capped connected LSP clients per server with LRU eviction.
- **TUI**: pinned `node:ffi` pointer sources against V8 GC during native calls; resolved
  the backend loader from the startup working directory.
- **Formatting**: prevented duration and compact-unit formatters from emitting overflow
  units (e.g. `60m` / `24h` remainders) for scheduled tasks and durations.
- **Desktop**: 15 fixes across the Electron shell, UI stores/sync, and web server, plus
  chat empty-state, toast, motion-a11y, ConfirmDialog migration, tab-persistence, and
  effort-on-retry fixes.
- **Dependencies**: resolved 12 of 13 open advisories via scoped overrides; patched freshly
  published `protobufjs` and `tar` advisories; bumped `adm-zip` (GHSA-xcpc-8h2w-3j85).
- Plus stability, release-safety, display-formatting, and path-label hardening from several
  code-review passes.

## Deprecations and removals

- Removed the native Ratatui TUI mode. The SolidJS terminal TUI and the Desktop app are the
  supported surfaces going forward.

## Install and verify

Signed archives are attached to this release for `darwin-arm64`, `windows-x64`, and
`windows-arm64`, plus `install.ps1`. Verify any asset against the published
[`ax-minisign.pub`](./ax-minisign.pub) using the steps in the [release verification guide](./README.md).
