# PRD: Sandbox Gaps — UI, Commands, Escalation, CLI

**Author:** Engineering Team
**Date:** 2026-04-03
**Priority:** HIGH
**Estimated Effort:** 1-2 days
**Status:** Complete (SDK regeneration pending)
**Dependencies:** Sandbox core implementation (complete), SDK regeneration

---

## 1. Problem Statement

The sandbox proposal (TODOS/sandbox-proposal.md) defined a multi-phase implementation plan. The core isolation enforcement layer (config schema, runtime assertions, tool integration) is complete. However, several user-facing gaps remain:

1. **No Settings UI** — Users can only configure isolation via JSON config files.
2. **No session commands** — Users cannot toggle sandbox modes during a session.
3. **No escalation flow** — Isolation violations hard-fail instead of offering "allow once?" prompts.
4. **No CLI flag** — Users cannot set sandbox mode from the command line.

These gaps make the isolation system invisible to most users and prevent the approval-style UX described in the original proposal.

---

## 2. Goals

| Goal | Outcome |
|------|---------|
| Settings UI for isolation | Users can view and change sandbox mode, network toggle, and protected paths from settings |
| Session command palette | Users can toggle isolation mode and network access during a session |
| Escalation prompts | Isolation violations present an approval dialog instead of a hard error |
| CLI flag | Users can set sandbox mode via `--sandbox` flag or `AX_CODE_ISOLATION_MODE` env var |

---

## 3. Non-Goals

- OS-level sandboxing (Seatbelt, bubblewrap) — deferred to a future phase
- Granular approval modes (ask/on-request/untrusted/never) — existing permission system is sufficient
- `writableRoots` configuration — current `protected` paths approach is adequate
- Windows-specific sandbox support

---

## 4. Implementation Plan

### 4.1 CLI Flag and Environment Variable

Add to `src/flag/flag.ts`:
- `AX_CODE_ISOLATION_MODE` env var (read at startup)

Add to `src/index.ts`:
- `--sandbox` CLI option with choices: `read-only`, `workspace-write`, `full-access`

The CLI flag and env var override the config file value. Priority: CLI flag > env var > config file.

Integration point: `Isolation.resolve()` in `src/isolation/index.ts` should accept an optional override from flags.

### 4.2 Settings UI

Create `packages/app/src/components/settings-isolation.tsx`:
- Mode selector (Select component): Read-only, Workspace write, Full access
- Network toggle (Switch component)
- Protected paths display (read-only list showing resolved paths)
- Warning copy when "Full access" is selected

Wire into `packages/app/src/components/dialog-settings.tsx`:
- Add new tab under "Server" section with shield icon

Read/write config via `sync.data.config.isolation` and `updateConfig()`.

### 4.3 Session Commands

Add to `packages/app/src/pages/session/use-session-commands.tsx`:
- `isolation.mode.readonly` — switch to read-only mode
- `isolation.mode.workspace` — switch to workspace-write mode
- `isolation.mode.fullaccess` — switch to full-access mode (with warning toast)
- `isolation.network.toggle` — toggle network access

Commands update config via the SDK client, show toast confirmation.

### 4.4 Escalation Flow

Modify tool integration to catch `Isolation.DeniedError` and present an approval prompt instead of hard-failing.

In `src/session/prompt.ts`, wrap tool execution to catch `DeniedError`:
- For `network` denials: ask "Enable network access for this tool call?"
- For `write` denials: ask "Allow write outside workspace boundary?"
- For `bash` denials: ask "Allow bash command outside workspace?"

Use the existing `ctx.ask()` pattern with a new permission type `isolation_escalation`.

The approval is **one-time per tool call** — it does not change the session's isolation config.

### 4.5 i18n Strings

Add all required language keys to `packages/app/src/i18n/en.ts`.

### 4.6 SDK Regeneration

Run `./packages/sdk/js/script/build.ts` to include isolation types in the SDK.

---

## 5. Acceptance Criteria

1. Users can view and change isolation mode from Settings > Isolation tab
2. Users can toggle isolation mode and network via session command palette
3. Isolation violations show an approval prompt with allow-once option
4. `ax-code --sandbox workspace-write` sets isolation mode from CLI
5. `AX_CODE_ISOLATION_MODE=read-only ax-code` sets isolation mode from env
6. Warning copy is shown when selecting full-access mode
7. All controls reflect the current isolation state accurately
