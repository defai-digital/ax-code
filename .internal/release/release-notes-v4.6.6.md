# ax-code v4.6.6

This release introduces project-scoped session management commands, fixes non-git project identity isolation, adds autonomous stall detection, and ships a richer subagent status display in the TUI.

## Highlights

- **Project-scoped session commands** — `ax-code storage session clear-project`, `backup-project`, and `project-status` give you surgical control over sessions tied to the current working directory, with automatic JSON backup before any deletion.
- **Non-git project identity** — projects not backed by a git repository previously all shared a single global project ID (`/` worktree). They now get a stable directory-hash ID so sessions, permissions, and the HTTP guard all scope correctly per directory.
- **Autonomous stall guard** — autonomous mode now detects when pending todos haven't changed across two consecutive continuation retries and stops with reason `stalled`, preventing infinite loops when the model can't make progress.
- **Richer subagent status** — the in-session subagent panel now shows a spinner with per-agent activity labels (Thinking / Scanning files / Running command / …), stale warnings, elapsed time, and a collapsed "+N more active" overflow for large agent fans.

## TUI

- **Subagent status view** (`subagent-status-view.ts`): replaces the simple running/done counter with a structured view. Tasks are correlated to child sessions via `sessionID`; each item tracks `active`, `done`, and `stale` state. Stale items (>90s since last activity) render in warning colour; the spinner itself turns warning-coloured when any active agent is stale.
- **"Finished" indicator**: after a session completes (last message is an assistant message with no error and a `completed` timestamp), the footer shows a green "Finished" label instead of blank space.
- **Home loading hint**: while the provider bundle is still initialising, the home screen shows a yellow "• Provider is loading · please wait about 10 seconds while models initialize" hint instead of nothing.
- **Footer status labels**: "Waiting for response" → "Thinking"; "Working" → "Thinking"; tool labels are now context-aware (`footerTaskLabel` replaces generic "Running tool" with "Editing files", "Scanning files", "Running command", "Analysing code", etc.). Stale suffix wording tightened ("no tool update Xs" / "no model output Xs").
- **Footer layout**: removed the agents hint slot from the footer layout calculation; `showAgents` and `agentsWidth` fields dropped from `PromptFooterLayout`.
- **Submit pending colour**: the pending-submit status text is now shown in warning (yellow) instead of muted.
- **Busy status display**: always shows `label` (full label with elapsed) in warning colour; short-label and model-name suffix removed.
- **Subagent parent double-click**: double-clicking the subagent session header (within 400 ms) triggers `session.parent`, navigating back to the parent session.
- **Toast wording**: "Providers are still loading" toast updated to "Providers are still loading. Please wait about 10 seconds and try again."

## Session

- **`session clear-project`** (`storage session clear-project [--yes] [--backup-dir]`): lists all sessions for the current project ID, writes a full JSON backup (messages + events via `buildTransfer`) to `cleanup-backups/session-project-<stamp>.json`, then deletes by root sessions. Without `--yes`, prints a dry-run summary.
- **`session backup-project`** (`storage session backup-project [--backup-dir]`): same backup logic but no deletion.
- **`session project-status`** (`storage session project-status`): prints a JSON summary (session counts, latest 5 sessions, duplicate identity warnings) to stdout.
- **`SessionClearProjectCommand` / `SessionBackupProjectCommand` / `SessionProjectStatusCommand`** all surface duplicate-identity warnings when the current worktree has more than one project ID.
- **Stagnant todo guard** (`session/prompt.ts`): `pendingTodoSignature` hashes pending-todo content+status+priority; if the signature is identical across `MAX_STAGNANT_TODO_RETRIES` (2) continuations, the loop breaks with `reason: "stalled"` and publishes a `Session.Event.Error`.
- **`agentRouting: "preserve"`** field on `SessionPrompt.create` input: synthetic continuation messages (todo retries, tool-output continuations) now pass `agentRouting: "preserve"` so the v2-style keyword router skips them, preventing agent-switching mid-task.
- **Blast-radius LRU cap** (`session/blast-radius.ts`): `BlastRadius.get` now enforces a 256-session ceiling, evicting the oldest entry when the map is full and promoting accessed entries to the tail (LRU order).
- **`isCompatibleWithCurrentProject`**: new predicate on `Session` namespace; used by the HTTP guard.
- **Replay schema** (`replay/event.ts`): `SessionEndEvent.reason` extended with `"stalled"`.

## Server

- **Cross-project session guard** (`server/routes/session.ts`): `requireCurrentProjectSession` checks that the requested session's `projectID` matches `Instance.project.id` (with worktree-overlap fallback). All session read, prompt, command, shell, and todo routes now call this guard and return HTTP 409 when the session belongs to a different project directory.

## Project identity

- **`ProjectIdentity` namespace** (`project/project-identity.ts`): `listWorktreeIdentities` queries distinct project IDs for a given worktree with session counts; `listDuplicateWorktreeIdentities` returns only entries where there is more than one ID (indicates an identity migration occurred).
- **Non-git project ID** (`project/project.ts`): directories without a `.git` ancestor now receive `id = directoryProjectID(directory)` (SHA-1 of the resolved path, prefixed `dir-`) and `worktree = directory` instead of the former `id: ProjectID.global` / `worktree: "/"`. Existing sessions created under the old global ID will not match the new ID; run `session clear-project` if a clean slate is preferred.
- **`Instance.containsPath`** comment updated to document the legacy `"/"` sentinel behaviour.

## Doctor

- **Duplicate project identity check**: `getDuplicateProjectIdentityCheck` queries `ProjectIdentity.listWorktreeIdentities` for the current worktree; if more than one project ID is found, it surfaces a `warn`-level check with the IDs and session counts.

## Storage

- **Read cross-process lock** (`storage/storage.ts`): `Storage.getItem` now acquires a `FileLock` in addition to the in-process read lock, preventing a concurrent write from another `ax-code` process being observed mid-read-modify-write.

## Context / Memory

- **Context analyzer file cap** (`context/analyzer.ts`): the 5 000-file ceiling now uses `>=` comparisons and slices `batchToRead` exactly to the remaining budget, eliminating off-by-one over-reads.
- **Memory token budget** (`memory/generator.ts`): `remaining` is now floored at zero with `Math.max(0, remaining - tokens)` to prevent negative token budgets on large sections.

## Install

- npm compiled package: `npm install -g @defai.digital/ax-code@4.6.6`
- npm source package: `npm install -g @defai.digital/ax-code-source@4.6.6`
- Homebrew compiled formula: `brew upgrade ax-code` or `brew install defai-digital/ax-code/ax-code`
- Homebrew source formula: `brew upgrade ax-code-source` or `brew install defai-digital/ax-code/ax-code-source`

## Release Artifacts

- macOS: `ax-code-darwin-arm64.zip`
- Linux x64: `ax-code-linux-x64-baseline.tar.gz`
- Linux arm64: `ax-code-linux-arm64.tar.gz`
- Windows x64: `ax-code-windows-x64.zip`
- Windows arm64: `ax-code-windows-arm64.zip`
