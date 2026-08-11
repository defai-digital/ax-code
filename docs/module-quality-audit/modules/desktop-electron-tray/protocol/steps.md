# Protocol Steps — desktop-electron-tray

Reviewer: ax-code-glm (model: zai-coding-plan/glm-5.2[1m])
Unit: `desktop-electron-tray` — `desktop/packages/electron/src/tray.mjs` (340 LOC, 1 export)
Verifer lane: codex-sol
Date: 2026-08-11

## Step 1 Scope and map

The unit is a single file, `desktop/packages/electron/src/tray.mjs`, exporting one symbol: `createTrayController` at line 97. The factory returns a two-method handle `{ update, destroy }` (lines 305, 328, 338). All presentation helpers (`truncate` 23, `statusIconKey` 31, `sessionLabel` 39, `approvalLabel` 45, `computeTitle` 57, `computeIconState` 66, `computeTooltip` 72) are module-private and side-effect free. The MODULE-AUDIT inventory (1 file / 340 LOC / 0 empty catches / 0 TODOs) matches the source exactly; the analysis fingerprint `4f9d7a54c2d5ed38` is consistent with what I read.

## Step 2 Threat and failure surface

This module touches no secrets, no spawn, no filesystem writes, and no network. The only I/O is `nativeImage.createFromPath` (line 89) over icon paths supplied by the caller — `main.js:2040` resolves them via `trayIconAssets()` under the app bundle, not from user input, so there is no path-traversal vector inside `desktop-electron-tray`. Untrusted data does not reach this module: the snapshot arrives over the trusted `desktop_tray_update` IPC bridge from the renderer, and `onAction` is routed only to `dispatchTrayAction` (`main.js:1993`). The desktop risk tag is therefore about process/UI surface, not data ingress.

## Step 3 Control-flow correctness

`update()` (line 305) defensively coerces its argument: a non-object `rawSnapshot` becomes `{}` (306), and `sessions`/`approvals` fall back to `[]` (307–308). `applyIconState` (142) short-circuits on equal state, then guards a destroyed tray before mutating (145). The animation interval (127–139) re-checks `tray.isDestroyed?.()` on every tick and falls back to `idleFrame` if `breathFrames[animIndex]` is undefined (129), so an empty `breathIconPaths` array cannot crash the timer. `destroy()` (328) stops the timer, nulls `tray`/`lastTitle`/`iconState`, and is idempotent through the `!tray.isDestroyed?.()` guard. One benign stale-state window: `iconState` is assigned (144) before the destroyed-tray early return, but the next `update` always re-derives it and `destroy` resets it, so it never leaks observably.

## Step 4 Performance and resource lifecycle

The breathing animation is the only recurring timer: `setInterval(..., ANIM_INTERVAL_MS=75)` at line 127, started only on the busy transition (147) and always torn down by `stopAnim` on idle/unseen/destroy (116–121, 149, 152). No interval can outlive the controller. `update` is invoked on every `desktop_tray_update` push and unconditionally calls `setToolTip` (324) and `setContextMenu` → `Menu.buildFromTemplate` (325); only `setTitle` is diff-guarded via `lastTitle` (319). On menu-bar update cadence this is negligible, but a snapshot-level equality short-circuit at the top of `update` would remove redundant menu object allocation during bursts. Counts are computed with two `filter`/one `reduce` over arrays capped by `MAX_SESSIONS=8`/`MAX_APPROVALS=10` (20–21, 231, 256) — trivially O(n).

## Step 5 Design and ownership boundary

The boundary is clean and explicitly documented in the header (lines 12–16): the renderer owns live state, this module owns presentation, and `main.mjs` owns routing. Inversion of control is via a single `onAction` callback (97) consumed solely by `dispatchTrayAction` (`main.js:1993–2036`). The controller is a factory, not a class, and exposes only `{update, destroy}` — a minimal, honest interface. `statusIcons[statusIconKey(session)] || statusIcons.blank` (248) encodes a real contract: the caller must ship a `blank` key in `statusIconPaths` or idle rows lose their gutter alignment. That precondition is satisfied by `trayIconAssets` (`main.js:1974`) but is implicit; a single assertion at construction would make it explicit without adding abstraction.

## Step 6 Hygiene and dead code

No empty catch blocks, no TODOs, no commented-out code, and no unused imports — `Tray`, `Menu`, `nativeImage` (18) are all referenced. Every declared closure variable (`tray`, `lastTitle`, `iconState`, `animTimer`, `animIndex`, `animDir`) is both written and read. The `header` variable (167–170) correctly prefers a trimmed `instanceName` and falls back to `"AX Code"`. Module constants `MAX_SESSIONS`, `MAX_APPROVALS`, `ANIM_INTERVAL_MS` are named rather than magic, and each is explained by an adjacent comment. Overflow handling for both approvals (234–240) and sessions (259–265) nests excess items under an `N more…` submenu rather than truncating silently — deliberate, user-respectful behavior.

## Step 7 Error and contract handling

The snapshot shape is trusted: `approval.sessionId`/`approval.id` (188, 208) and `session.id` (251) are forwarded verbatim into `onAction`. If the renderer ever pushed an approval missing `id`, `respond-permission` would emit `id: undefined` and the renderer would have to no-op — the module does not validate. Given the producer is the same trust domain, this is acceptable, but it is the single place a future regression in the renderer could surface as a silent no-op. `Number.isFinite(s.unseen)` (314) is the one defensive numeric coercion and it is correct — non-numeric `unseen` contributes 0 rather than `NaN` poisoning the reduce seed.

## Step 8 Test coverage reality

`grep` for `createTrayController` across `*.test.*` files returns **zero** matches. The three files listed under "Tests" in MODULE-AUDIT (`desktop-handoff.test.ts`, `webui.test.ts`, `desktop-release-workflow.test.ts`) exercise desktop hand-off, the web UI, and the release workflow — none instantiate the tray controller or assert on its output. Consequently the seven pure helpers (`truncate`, `statusIconKey`, `sessionLabel`, `approvalLabel`, `computeTitle`, `computeIconState`, `computeTooltip`) and the stateful paths (`applyIconState` transitions, `startAnim`/`stopAnim` lifecycle, `destroy` idempotency, overflow submenus) have no automated coverage. This is the most actionable gap for the unit: the helpers are trivially unit-testable because they take and return plain data.

## Step 9 Verification and disposition

No Critical, High, or Medium findings were accepted during this pass; `findings/` is empty and consistent with that. Observations worth recording for future work, none blocking: (a) add unit tests for the seven pure helpers and the `{update, destroy}` lifecycle — the controller is designed for it; (b) consider an equality short-circuit in `update` to skip `setContextMenu` when the snapshot is unchanged; (c) optionally assert `statusIconPaths.blank` at construction to make the row-alignment contract explicit. Static extract fingerprint `4f9d7a54c2d5ed38` is consistent with the source read. Primary review (ax-code-glm) is complete; independent verification by codex-sol remains pending per the dual-agent protocol.
