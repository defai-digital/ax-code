Status: Superseded
Scope: planning
Last reviewed: 2026-08-12
Owner: AX Code Desktop

# PRD: AX Work (Desktop Computer Use)

> **Superseded** by [PRD-2026-08-12-ax-work-split](PRD-2026-08-12-ax-work-split.md)
> and [ADR-053](../adr/ADR-053-ax-work-product-split.md). Combining Work with
> AX Code Desktop is rejected. Computer-use safety (old R6–R23) relocates;
> G1 / Work tab / coding ladder do not.

| Field | Value |
|-------|-------|
| Status | Superseded |
| Owner | AX Code Desktop + runtime |
| Created | 2026-08-12 |
| Related | Dual review (Codex Sol Max + QoderCLI Qwen 3.8 Max + Kimi k3, 2026-08-12); ADR-052; `.internal/spec/SPEC-2026-08-12-ax-work.md`; `.internal/reports/planning/ax-work/PHASES.md` |
| Location | `.internal/prd/PRD-2026-08-12-ax-work.md` |

---

## 1. Problem statement

AX Code Desktop already has a Codex-shaped **Work \| Code** surface
(`DesktopSurfaceToggle`, `WorkHome`, work-oriented starters). That surface is
chat-first general work. It cannot see or operate the user's real apps.

Competitors now ship that missing capability:

- ChatGPT Work / Codex Computer Use — accessibility-first, own cursor, background
- Claude Cowork + Computer Use — folder VM for files; live desktop when no connector exists
- OpenClaw — `screen.snapshot` + `computer.act` with frame IDs
- Qwen 3.8 Max + `@qwen-code/open-computer-use` — hybrid coding + GUI, OSWorld 86.1
- OpenCode Desktop — desktop shell only; computer use is still a request

Users want AX Work to take a goal ("book this meeting", "export this sheet",
"fill this form") and complete it by **seeing the screen and acting**. The
runtime already has ADR-047-style **see-only** native snapshots and Playwright
browser tools. `ComputerAppPermission` is a stub. There is no OS actuation,
no frame identity, and no Work agent.

## 2. Goals

- **G1 — Complete the existing Work surface.** Do not add a third header tab.
  Distinguish Desktop `Work` (product surface) from `WorkMode`
  (Agent/Council/Arena send routing).
- **G2 — Hybrid action ladder.** Connector/API/file/bash first; existing
  `browser_*` second; OS computer use last.
- **G3 — Accessibility-first, pixels for verify/fallback.** Frame IDs,
  stale-frame fail-closed, verify-after-act.
- **G4 — Cloud-only qualified models.** Default candidates: Qwen 3.8 Max
  (Alibaba token plan, after image-in-tool-result is proven), OpenAI
  `gpt-5.6-sol` (catalog ID; there is no bare `gpt-5.6` or `gpt-4.6`),
  xAI `grok-4.5`. User-named GPT-4.6 and Grok 3.5 are not catalog IDs.
- **G5 — Safety is the product.** Exact per-app grants, never autonomous
  auto-approve, never wildcard allow, never remote grant, screenshots
  model-only and ephemeral, Esc / physical input pauses.

## 3. Non-goals (v1)

- Windows/Linux input (observe-only or later backend PRs)
- Background / own-cursor / parallel desktop agents
- Pixels-only live-desktop clicking
- Third-party MCP (`open-computer-use`) as the privileged production boundary
- Renderer IPC that can capture or click
- Attaching Playwright to the user's signed-in Chrome profile
- Computer tools on `build`, Council, Arena, subagents, scheduled jobs, remote clients
- Persisting screenshots in chat, session DB, logs, or `.ax-code/visual-runs`
- Clipboard read, password managers, lock screens, AX Code controlling itself
- Unattended Dispatch-style live-desktop from a phone

## 4. Users and jobs

| Job | Success |
|-----|---------|
| Knowledge worker on Desktop Work surface | Give a goal; watch Calendar/Numbers/Slack complete; pause with Esc |
| Developer who still needs Code | Toggle back to Code; computer lease does not reset from the toggle |
| Security-conscious user | See which app, which model, how many actions; deny input; no screenshot in transcript |

## 5. Requirements

### Product (R1–R5)

- **R1** Work surface creates `agent: "work"` sessions with `metadata.work`.
- **R2** Switching Work/Code does not grant, revoke, or reset computer control.
- **R3** Computer-enabled Work sessions lock send routing to Agent (hide Council/Arena).
- **R4** Visible control bar: status, app, provider/model, action count, Pause/Stop.
- **R5** Overlay says which app is controlled; hidden before capture so it cannot become model input.

### Visual (R6–R11)

- **R6** Default capture is the granted app's window group, not the whole display.
- **R7** Observation = pruned a11y tree + downsampled image (≤1280 long edge, ~900KB) + opaque `frameID`.
- **R8** Model coordinates are returned-image pixels; helper remaps DPI/crop.
- **R9** Every successful input consumes the frame and returns a fresh observation.
- **R10** Stale / focus-changed / human-interfered frames return `COMPUTER_STALE_FRAME`.
- **R11** Screenshots are `visibility: "model"`, `lifetime: "ephemeral"`. Persist a text summary + hashes only.

### Actuation (R12–R16)

- **R12** Two model tools only: `computer_snapshot`, `computer_action`.
- **R13** One primitive per `computer_action`. No batches. Prefer `elementID`.
- **R14** Exclusive lease per helper: a second session gets `COMPUTER_BUSY`.
- **R15** 50 input actions per task; user may extend by 25; pause after 3 unchanged outcomes.
- **R16** Helper (not renderer) detects Esc and untagged physical input and pauses atomically.

### Permissions (R17–R23)

- **R17** Permissions: `computer_capture`, `computer_input`, `computer_commit`.
- **R18** Patterns are exact `app:<canonicalAppID>`. Canonical ID from the helper (macOS bundle ID).
- **R19** `computer_commit` is interactive-only (send/submit/pay/create/delete/account).
- **R20** `EXACT_GRANT_ONLY`: `{ permission: "*", pattern: "*", action: "allow" }` must not match.
- **R21** `NEVER_AUTONOMOUS_AUTOAPPROVE` including `full-access` sandbox.
- **R22** Grants are user-scoped, not project-scoped. Project config cannot grant desktop control.
- **R23** Remote `permission.reply` cannot authorize computer control. Local desktop attestation required.

### Models (R24–R27)

- **R24** Work eligibility: cloud route + image input + tool call + checked-in qualification + live image-in-tool-result probe.
- **R25** Pin provider/model for the run. Disable cross-provider fallback.
- **R26** Changing provider requires new capture consent.
- **R27** `supportsLongAgent` alone is not visual eligibility.

## 6. Success metrics

- Packaged macOS app can observe an approved Calendar window without leaking raw images to the renderer.
- A qualified cloud model can complete a 10-step TextEdit / Calendar task with stale-frame rejection on interference.
- Wildcard allow, autonomous, full-access, project config, and remote reply cannot grant capture/input (tested).
- No screenshot bytes in persisted session payloads.

## 7. Launch

Experimental flag `AX_CODE_EXPERIMENTAL_COMPUTER_AGENT`. macOS Desktop opt-in only.
TUI/headless may inspect the contract but cannot acquire a lease.
