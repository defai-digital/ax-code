Status: Active
Scope: planning
Last reviewed: 2026-08-12
Owner: AX Code Desktop + runtime

# AX Work — multiphase plan

Related: PRD-2026-08-12-ax-work, ADR-052, SPEC-2026-08-12-ax-work.

## Phase 1 — Contract (this change)

In-tree, no native code.

- ADR-052 / PRD / spec / this plan
- Protocol, errors, fake host
- Permission exact-grant + never-autonomous + `computer_commit`
- `work` agent + tools behind `AX_CODE_EXPERIMENTAL_COMPUTER_AGENT`
- `SessionMetadata.work`
- Unit tests

**Exit:** tools fail closed without a host; wildcards/autonomous cannot grant.

## Phase 2 — Browser session hardening

Depends on: 1 (router can prefer `browser_*` safely).

- `BrowserRuntime.forSession(sessionID)`
- `browser_snapshot` returns `snapshotID`
- `browser_action` requires it and returns a fresh snapshot
- Tests: two sessions, stale snapshot

## Phase 3 — macOS observe-only helper

Depends on: 1.

- `crates/ax-code-computer` + `packages/ax-code-computer-native`
- Electron utility host, capability transport
- ScreenCaptureKit + pruned AX tree, image budget, secure-surface mask
- Signed packaged identity

**Exit:** approved Calendar window observed; raw image never on renderer IPC.

## Phase 4 — Snapshot tool + Work session UX (observe)

Depends on: 1, 3.

- Bind host to `computer_snapshot`
- Ephemeral/model-only attachments
- `WorkHome` creates `agent:"work"` sessions
- Observe-only status UI

## Phase 5 — Local permission plane

Depends on: 1, 4.

- User-scoped `ComputerPermission` table
- `desktop_work_get_capabilities|request_os_access|authorize|emergency_stop`
- `ComputerPermissionCard` + TCC handoff
- Tests: wildcard / autonomous / full-access / project config / remote reply

## Phase 6 — macOS input

Depends on: 3, 5.

- AX actions first, CGEvent fallback
- `computer_action`, lease, 50-action cap, Esc/human pause
- Flag still not on for ordinary users

## Phase 7 — Safety loop + control UX

Depends on: 6.

- `computer_commit` semantic classes
- Injection labels; 3-repeat no-progress
- Control bar, overlay ring, provider disclosure

## Phase 8 — Model qualification + opt-in

Depends on: 7.

- Qualify `openai/gpt-5.6-sol`, `xai/grok-4.5`; pin session model and disable provider fallback (R25/R26)
- Gate Alibaba `qwen3.8-max` on image-in-tool-result probe
- Enable `AX_CODE_EXPERIMENTAL_COMPUTER_AGENT` as macOS Desktop opt-in

## PR mapping

| PR | Phase | Title |
|----|-------|-------|
| 1 | 1 | AX Work contract, Work agent, computer tools (fail closed) |
| 2 | 2 | Session-scoped browser snapshots |
| 3 | 3 | macOS observe-only computer host |
| 4 | 4 | Work session observe UX |
| 5 | 5 | User-scoped computer permissions + local IPC |
| 6 | 6 | macOS computer_action primitives |
| 7 | 7 | Commit gates, overlay, pause/stop |
| 8 | 8 | Qualified cloud models + opt-in flag |

Windows/Linux backends are post-v1 and reuse the Phase 1 contract unchanged.
