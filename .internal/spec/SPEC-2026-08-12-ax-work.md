Status: Superseded as product spec
Scope: planning
Last reviewed: 2026-08-12
Owner: AX Code Desktop + runtime

# Tech Spec: AX Work Computer Use

> **Product spec superseded** by
> [SPEC-2026-08-12-ax-work-split](SPEC-2026-08-12-ax-work-split.md).
> This file remains the as-built note for the in-tree Phase 1 contract
> until Track A3 deletes it.

| Field | Value |
|-------|-------|
| Status | Superseded as product spec (Phase 1 still in-tree until A3) |
| Date | 2026-08-12 |
| PRD | [PRD-2026-08-12-ax-work](../prd/PRD-2026-08-12-ax-work.md) |
| ADR | [ADR-052](../adr/ADR-052-ax-work-computer-use.md) |
| Plan | [PHASES.md](../reports/planning/ax-work/PHASES.md) |

---

## 1. Scope

Phase 1 (this change):

- Protocol types, errors, fake host, frame helpers
- Model qualification policy (no silent fallback)
- Permission classification + exact-grant + never-autonomous
- Built-in `work` agent + prompt
- `computer_snapshot` / `computer_action` tools (host required; fail closed)
- `SessionMetadata.work`
- Feature flag `AX_CODE_EXPERIMENTAL_COMPUTER_AGENT`
- Unit tests

Later phases: native crate, Electron helper, browser session hardening,
desktop UX, live model probes. See PHASES.md.

## 2. As-built (relevant)

```
Desktop Work surface     — UI only (WorkHome, starters, chrome collapse)
WorkMode                 — Agent | Council | Arena send routing (unrelated)
visual/native.ts         — see-only screencapture + AppleScript
browser_*                — Playwright singleton, acts on "latest"
ComputerAppPermission    — type stub in visual/permission.ts, unused
Permission.ask           — full-access + autonomous auto-approves risk
image-resize.ts          — 2000×2000 / 5MB, too loose for CUA
prompt-provider-fallback — may switch providers after failure
```

## 3. Design

### 3.1 Protocol

`packages/ax-code/src/visual/computer/protocol.ts`

```ts
type ComputerFrame = {
  frameID: string
  app: { appID: string; displayName: string; pid: number }
  window: { windowID: string; title?: string; bounds: Rect; scaleFactor: number }
  image: { width: number; height: number; mime: "image/png" | "image/jpeg" }
  elements: Array<{
    elementID: string
    role: string
    name?: string
    value?: string
    state?: string[]
    bounds?: Rect
  }>
  capturedAt: number
}
```

Errors: `COMPUTER_HOST_UNAVAILABLE`, `COMPUTER_OS_PERMISSION_REQUIRED`,
`COMPUTER_PERMISSION_DENIED`, `COMPUTER_BUSY`, `COMPUTER_STALE_FRAME`,
`COMPUTER_APP_CHANGED`, `COMPUTER_SECURE_SURFACE`, `COMPUTER_PAUSED`,
`COMPUTER_ACTION_LIMIT`, `COMPUTER_UNSUPPORTED`, `COMPUTER_MODEL_INELIGIBLE`.

`frameID` is an opaque random string. Model coordinates are image pixels.

### 3.2 Host seam

`ComputerHost` is injected. Production later binds the Electron-supervised
native helper. Tests bind a fake. If unset, tools throw
`COMPUTER_HOST_UNAVAILABLE`.

### 3.3 Tools

| Tool | Permission | Notes |
|------|------------|-------|
| `computer_snapshot` | `computer_capture` | Host resolves `frontmost` to a bundle ID first; permission is always exact `app:<canonicalAppID>` |
| `computer_action` | `computer_input` (+ `computer_commit` when semantic class requires it) | Requires `frameID`; one action enum |

Registered only when the flag is on **and** `agent.name === "work"` and
`agent.options.computer === true`.

### 3.4 Work agent

Primary-gated primary agent. Prompt encodes the action ladder, untrusted
observation wrapping, and "one primitive then verify". Permission merge
denies `task`, `task_parallel`, `council`, `arena`.

### 3.5 Permissions

`evaluate()` for `EXACT_GRANT_ONLY` permissions:

- deny rules may still wildcard
- allow rules must match permission name and pattern exactly

`ask()` skips autonomous / full-access auto-approve when
`NEVER_AUTONOMOUS_AUTOAPPROVE` contains the permission.

`computer_commit` is in `INTERACTIVE_ONLY`.

### 3.6 Model policy

`WorkModelPolicy.isEligible({ providerID, modelID, capabilities })`:

- provider must be in the cloud allow-list
- `capabilities.input.image` and `capabilities.toolcall`
- model must be in the checked-in qualification table (no user-facing
  override; tests construct `WorkModelRef` directly)

No use of `Provider.defaultModel()` — callers pass the active session model.

### 3.7 Session metadata

```ts
work: { version: 1, computer: boolean, providerID?: string, modelID?: string }
```

Added to `SessionMetadata.Namespace` / `Product`. Triggers OpenAPI/SDK
regen when server routes expose it; Phase 1 only adds the schema.

## 4. Test plan

- Frame schema + opaque id + image-pixel coords
- Exact-grant: `*` allow does not match `computer_capture`
- Autonomous + full-access do not auto-approve computer permissions
- Tools throw `COMPUTER_HOST_UNAVAILABLE` without a host
- Fake host: action consumes frame, second act with old id is stale
- Model policy rejects text-only and unknown IDs
- Registry omits computer tools for `build` even when the flag is on

## 5. Out of scope here

Native ScreenCaptureKit/CGEvent, Electron overlay, browser `snapshotID`,
durable user-scoped grant table, SDK regen unless metadata is already
exported through an existing OpenAPI path.
