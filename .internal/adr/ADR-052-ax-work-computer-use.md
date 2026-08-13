Status: Partially superseded
Scope: planning
Last reviewed: 2026-08-12
Owner: AX Code Desktop + runtime

# ADR-052: AX Work Computer Use

> **D1 superseded** by [ADR-053](ADR-053-ax-work-product-split.md): do not
> complete a Work surface inside AX Code Desktop. **D2–D8** (helper, a11y,
> two tools, exact grant, never autonomous, cloud qualification, macOS
> foreground) relocate to `~/code/ax-work`.

| Field | Value |
|-------|-------|
| Status | Accepted (D1 superseded by ADR-053) |
| Date | 2026-08-12 |
| Deciders | AX Code maintainers |
| Supersedes | Informal "ADR-047" comments on visual/browser tools (official ADR-047 remains TUI Stability) |
| Related | PRD-2026-08-12-ax-work; SPEC-2026-08-12-ax-work; `desktop/docs/PROJECT_BOUNDARIES.md` |
| Dual review | Codex Sol Max, QoderCLI Qwen 3.8 Max, Kimi k3 (2026-08-12) |

---

## Context

Desktop already exposes a Work surface. The runtime can screenshot (see-only)
and drive an isolated Playwright browser. Users now expect Claude/Codex-class
**live desktop** control. Three tempting shortcuts are wrong for this repo:

1. Extend `visual/native.ts` (AppleScript + `screencapture`) into click/type.
2. Bolt on `@qwen-code/open-computer-use` as the production privilege boundary.
3. Put capture/act on Electron renderer IPC.

`PROJECT_BOUNDARIES.md` says Electron is a thin shell; feature behavior lives
in the runtime. Computer use is also uniquely dangerous: screenshots leave the
machine, and input mutates the user's real apps.

## Decision

### D1 — Complete the Work surface; do not add a product tab

Desktop `Work | Code` is the entry. Sessions are `agent: "work"` with
`metadata.work`. `WorkMode` (Agent/Council/Arena) stays send-routing only and
is locked to Agent while computer is enabled.

### D2 — Runtime owns policy; signed helper owns OS primitives

| Layer | Owns |
|-------|------|
| `packages/ax-code` | Work agent, tools, loop, permissions, frame contract, model gate, budget, audit |
| `crates/ax-code-computer` + native package | Capture, a11y tree, identity, input, stale-frame, Esc/human-input |
| Electron main / utility process | Helper lifecycle, TCC UX, overlay, emergency stop |
| Desktop UI | Status, permission cards, pause/stop |
| MCP / plugins | High-level connectors only |

The helper is an Electron **utility process** loading a native addon. It does
not know providers or prompts. Transport is a pre-opened, non-inheritable
capability stream — not an env bearer token.

### D3 — Accessibility first, pixels for verify and gaps

Same hybrid as Codex Computer Use and Qwen `open-computer-use`. Coordinates
are always in the returned image; the helper remaps. Default target is a
window group, not the display.

Do **not** use `visual/native.ts` for the live loop. It remains one-shot
review.

### D4 — Two tools, one primitive, exclusive lease

Model-facing: `computer_snapshot`, `computer_action`. Action requires
`frameID`, prefers `elementID`, executes one primitive, returns a new frame.
`COMPUTER_BUSY` if another session holds the lease.

Internal helper RPC: `computer.capabilities|acquire|snapshot|act|pause|release`.

Renderer IPC is presence/safety only (`desktop_work_*`, `safeForRemote: false`).
No `desktop_work_capture` / `desktop_work_act`.

### D5 — Action ladder

1. Connector / MCP / purpose-built API
2. Code/file tools
3. Existing `browser_*` (after session + `snapshotID` hardening)
4. OS computer use

Playwright's isolated Chromium is not the user's signed-in Chrome. That case
uses OS control in v1.

### D6 — Permission plane is stricter than ordinary risk

Permissions: `computer_capture`, `computer_input`, `computer_commit`.

- `EXACT_GRANT_ONLY` — wildcard allow does not match
- `NEVER_AUTONOMOUS_AUTOAPPROVE` — including `full-access` (today full-access
  auto-approves `risk`)
- `computer_commit` is `INTERACTIVE_ONLY`
- User-scoped storage, not `PermissionTable` project key
- Local attestation; remote reply is insufficient
- Capture consent is bound to the selected provider

### D7 — Cloud-only qualified models; one adapter surface

All models use the AX tool contract. Adapters only format images / quirks.
No provider-native computer tool in v1.

Qualify explicitly. `supportsLongAgent` is not enough. Pin the session model;
disable `prompt-provider-fallback` for Work (Phase 8; no production model
is eligible until a live image-in-tool-result probe lands).

Catalog call-outs: no `gpt-4.6`, no `grok-3.5`, no bare `openai/gpt-5.6`.
Start with `openai/gpt-5.6-sol` and `xai/grok-4.5`. Add
`alibaba-token-plan/qwen3.8-max` only after the checked-in route advertises
image input and passes a live tool-result-image probe.

### D8 — v1 is macOS, foreground, one controller, 50 actions

Background / own-cursor is a later architecture. Feature flag
`AX_CODE_EXPERIMENTAL_COMPUTER_AGENT`.

## Alternatives considered

- **MCP-only production backend** — rejected: privilege boundary would sit
  outside AX permissions, leases, and packaging/TCC identity.
- **Pixels-only on the live desktop** — rejected: brittle, expensive, no
  semantic targeting; OK only in a future isolated VM.
- **Per-click confirmation** — rejected: unusable. App/session grants +
  `computer_commit` for consequential steps.
- **Extend `visual/native.ts`** — rejected: shell/AppleScript is not a
  secure low-latency actuation backend.
- **Four provider-native CUA adapters** — rejected (OpenCode RFC trap). One
  AX schema.
- **Official ADR-047 reuse** — rejected: ADR-047 is TUI stability. Computer
  use is ADR-052. Code comments that say "ADR-047" for browser tools stay as
  historical nicknames until a later rename.

## Consequences

- New crate and Electron utility process; packaging must sign the helper so
  TCC grants are representative.
- Browser runtime must become session-scoped before Work can trust `browser_*`.
- Autonomous / full-access semantics become more precise (computer excluded).
- Work agent cannot fan out to task/council/arena while computer is enabled.
- SDK/OpenAPI regen when `SessionMetadata.work` is added.
