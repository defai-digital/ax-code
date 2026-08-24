# PRD: Computer Use Integration (OCU + Cua)

| Field    | Value                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status   | Implementation complete; public release deferred until v8.0.0; frozen during v7.x except for safety, correctness, and conformance fixes |
| Owner    | AX Code CLI & Desktop maintainers                                                                                                       |
| Created  | 2026-08-22                                                                                                                              |
| Updated  | 2026-08-23                                                                                                                              |
| Last reviewed | 2026-08-23                                                                                                                         |
| Related  | `.internal/reference/open-codex-computer-use` (OCU), `.internal/reference/cua` (Cua), `.internal/reference/deepseek-harness`            |
| Location | `.internal/prd/PRD-2026-08-22-computer-use-integration.md`                                                                              |

---

## Release decision (2026-08-22)

Implementation completion is not release authorization. Computer use and the
private `ax-computer` server must not be published, bundled, promoted in public
documentation or release notes, or presented as a supported v7.x feature.
v8.0.0 is the earliest eligible release, and still requires an explicit
release-readiness decision.

Until then, active product work is bug fixing, runtime reliability, and the
selectively adopted Codex/DeepSeek harness improvements. Computer-use work is
limited to safety, correctness, protocol/conformance maintenance, and keeping
the dormant integration buildable.

## 1. Problem statement

AX Code has no desktop computer-use capability: the agent cannot observe
screens, read accessibility trees, or drive mouse/keyboard in native macOS,
Windows, or Linux applications. Closing the gap with Codex-style computer use
requires this capability, but two viable open-source implementations exist and
naively merging either (or both) codebases into the core would saddle AX Code
with permanent upstream maintenance of OS-level edge cases.

This PRD fixes the integration strategy and the phase plan, grounded in full
code reviews of both reference implementations (vendored under
`.internal/reference/`).

## 2. Strategy decision

> **AX Code owns the abstraction; Cua is a pinned dependency; OCU's macOS core
> is absorbed later as the AX-native backend. Neither upstream repo is vendored
> wholesale.**

| Component             | Strategy                                                                                                                 | Rationale (from code review)                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `ComputerUseProvider` | 100% AX-owned (`packages/ax-computer`)                                                                                   | Insulates the agent from backend tool names, schemas, and drift                                                                 |
| Cua (`cua-driver`)    | Pinned dependency / official SDK or MCP                                                                                  | ~100k+ lines of Rust across 3 OS adapters; actively maintained upstream; ships an explicit embedding SDK (`@trycua/cua-driver`) |
| OCU                   | Absorbed (Phase 2) — port landed; the upstream `"ocu"` backend option was then retired from user config (see note below) | Small (~27 files), closest to Codex semantics; its Linux/Windows Go runtimes are C-grade re-implementations — do not absorb     |
| DeepSeek Harness      | Absorb 4 design patterns only, zero code                                                                                 | Plugin machinery is vendored Cordis; developer preview with breaking changes; no computer-use at all                            |

> **Post-Phase-2 cleanup (2026-08-22).** With the AX-native port landed,
> live compat green, and the A/B gate passed, the upstream OCU backend
> (`"ocu"` / `open-computer-use` / `AX_COMPUTER_OCU_COMMAND`) was removed
> from the user-facing config surface (`computer.provider`,
> `computer.overrides`, `Computer.BACKENDS`, doctor preflight, and the
> associated tests). User-selectable backends are now exactly two:
> `"axnative"` (macOS primary) and `"cua"` (Windows/Linux + macOS
> fallback). The `OcuProvider` class stays in `packages/ax-computer` —
> it is the shared MCP implementation `AXNativeProvider` subclasses and
> the reference arm of the live A/B harness — and the OCU repo stays in
> `.internal/reference/open-codex-computer-use` for review. Existing
> configs that still say `"ocu"` fail zod validation with a clear enum
> error naming the two valid values.

> **Provider-class refactor (2026-08-22, same day).** Two independent
> design reviews (Codex gpt-5.6-sol, Qwen3.8-Max) both rejected merging
> into a single `AXNativeProvider` (option B) — the merged class cannot
> serve as the upstream reference arm once axnative gains AX-only tools,
> and both A/B arms would report the same `provider.name`, breaking
> evidence comparability (plus a silent self-comparison hazard via the
> command-resolution chain). Both recommended option C, which landed:
> the shared implementation is now `OcuProtocolProvider` (abstract,
> `src/providers/ocu-protocol.ts`) with abstract `name` /
> `commandEnvVar()` / `defaultCommand()`; `AXNativeProvider` extends it;
> the upstream OCU adapter is test-only (`test/helpers/upstream-ocu.ts`,
> `UpstreamOcuReferenceProvider`, `name = "ocu"` preserved for report
> continuity) and is no longer exported from the package root. The
> refactor also fixed a real defect both reviews caught: model-visible
> error messages hardcoded "OcuProvider"/"OCU" even when the AX-native
> backend produced them — they now interpolate `this.name`. One
> `protected call()` hook was exposed (connection state stays private)
> so future AX-only tools land in the subclass without touching the
> dialect base. Two follow-ups from the same reviews landed with it:
> (1) a protocol-contract manifest (`src/protocol-contract.ts`,
> `OCU_DIALECT_REQUIRED_TOOLS` + `checkDialectContract`) with a live
> test (`test/contract.live.test.ts`) that verifies both dialect
> backends' `tools/list` inventories — upstream drift now fails at
> preflight time instead of mid-task; (2) A/B harness provenance —
> `runAbSuite` records each arm's resolved command and reported
> version into `last-report.json`, so historical evidence is traceable
> to the exact binary that produced it.

Harness patterns worth absorbing: (1) staged tool-execution pipeline
(pre-execute waterfall → fail-closed guards → one-shot approval → execute →
post-execute → frozen durable result); (2) capability-seam discipline
(Definition/Provider/Consumer per capability); (3) model-visible ⟺ logged
invariant over the append-only session event log; (4) `landlock-run`'s
self-restrict-then-exec sandbox pattern (Linux).

Known OCU defects that must be fixed during the port (not copied as-is):
password-manager denylist bypass via case-variant bundle id, force-cast crashes
on malformed AX replies, double-click `clickState` bug, ~2s main-thread-blocking
cursor animation per click, unauthenticated local socket forwarding safety-gate
env vars.

## 3. Goals / non-goals

### Goals

- **G1** — Canonical `ComputerObservation` / `ComputerAction` / `ActionResult`
  contract owned by AX Code; raw backend tools never exposed to the model.
- **G2** — One active provider per `ComputerSession`; failover = stop → capture
  state → dispose → fresh observe on the new provider; stale element ids
  rejected (epoch-namespaced).
- **G3** — Both backends runnable via MCP with an A/B-capable compat suite
  (CU-001…CU-010) that gates every backend version bump.
- **G4** — Backend refusal codes propagate verbatim (e.g. cua's
  `background_unavailable`, `same_pid_keyboard_ambiguity`); no silent
  fallbacks. Backend-recommended foreground escalation is retried once, only
  when the backend itself recommends it.

### Non-goals

- No vendoring of cua or OCU source trees into the repo.
- No auto-routing between providers in early phases (manual/explicit only).
- No Linux/Windows native backend from OCU's Go runtimes.
- No use of cua's Python agent, `mcp-server`, `cuabot`, fleet, or bench
  components (known deadlocks / RCE / license concerns).

## 4. Architecture

```text
AX-Code agent
     │  canonical API only
     ▼
ComputerUseProvider            packages/ax-computer (AX-owned)
     │
     ├──────────────┬──────────────────┐
     ▼              ▼                  ▼
CuaProvider    OcuProvider      AXNativeProvider (Phase 2)
     │              │                  │
@trycua/cua-driver  MCP           OCU-derived macOS core
or MCP (Phase 0)   (open-computer-use mcp)
```

Target precedence policy: accessibility element → window-relative pixels →
desktop-absolute pixels. Coordinate contract: point targets are
**screenshot-pixel coordinates**; each provider maps into its backend's space
(cua converts via its recorded downscale ratio; OCU takes screenshot px
directly).

## 5. Phase plan

- **Phase 0 — done (2026-08-22).** `packages/ax-computer` with canonical types,
  provider interface, `ComputerSession` failover semantics, self-contained MCP
  stdio client, `OcuProvider` (incl. `parseA11yTree` text-tree → elements), and
  `CuaProvider` (incl. one-shot foreground escalation on backend
  recommendation). Compat suite CU-001…CU-010 live-green on macOS against both
  backends (OCU 0.3.1 debug build; cua-driver 0.21.0, checksum-verified,
  `mcp --direct`).
- **Phase 1 — done (2026-08-22).** A/B validation of both backends against a
  shared desktop task set on macOS + TextEdit: **6/6 tasks pass on each
  provider with 0 behavioral discrepancies**. End-to-end wall-clock totals:
  **OCU ~7.5s vs Cua ~37s per task** — OCU is roughly 5× faster on the same
  machine, settling the empirical primary/fallback ranking (OCU primary, Cua
  fallback). The transport swap to the pinned `@trycua/cua-driver` SDK landed
  in the same day (Phase 1b): `CuaProvider` accepts `transport: "mcp" | "sdk"`
  (default `"mcp"`, existing behavior and tests unchanged); the sdk path
  embeds the pinned `@trycua/cua-driver@0.21.0` SDK in-process through its
  generic `callTool` adapter surface. Details and evidence in Section 11.
  Remaining Phase 1 follow-ups (no longer blocking): live validation of the
  sdk transport and the Desktop responsibility-chain (embedded daemon)
  wiring — both continue to be env-gated behind `AX_COMPUTER_LIVE=1`.
- **Phase 2 — AX-native macOS backend. Done (2026-08-22), pending live
  validation.** OCU's macOS Swift core is ported into the repo as the
  AX-owned SwiftPM package `packages/ax-computer/native/ax-computer-driver/`
  (library `AXComputerKit` + `ax-computer-driver` executable, MCP over
  stdio only, MIT attribution preserved in `LICENSE` /
  `THIRD_PARTY_NOTICES.md` and per-file headers). All five known OCU
  defects were fixed during the port, not copied:
  1. Password-manager denylist case bypass — bundle-id matching is now
     lowercased on both sides (`AppDiscovery.swift` `AppSafetyPolicy`).
  2. Force-cast crashes on malformed AX replies — every `as!` on AX/CF
     types replaced with CFTypeID-verified optional casts; zero `as!`
     remains in the ported tree.
  3. Double-click `clickState` bug — `clickGlobally`/`clickTargeted`
     now stamp each click with its own index (first = 1, second = 2)
     instead of stamping every event with the total count.
  4. ~2s main-thread-blocking cursor animation per click — the
     software-cursor move/pulse animations are now timer-driven on the
     main run loop; `click` returns immediately after posting events.
  5. Unauthenticated local socket forwarding — fixed by omission: the
     app-agent Unix-socket proxy is not ported; the driver speaks MCP
     over stdio only.

  TS side: `AXNativeProvider extends OcuProvider`
  (`packages/ax-computer/src/providers/axnative.ts`) reuses the entire
  OCU MCP surface and argument mapping; command resolution is
  `computer.command` config > `AX_COMPUTER_AXNATIVE_COMMAND` env >
  built binary (`.build/release` → `.build/debug`) > `ax-computer-driver`
  on PATH. `computer.provider` / `computer.overrides` accept
  `"axnative"`; `ax-code doctor` preflights it with a swift-build hint.
  Build is manual (`pnpm --dir packages/ax-computer run build:native`),
  not hooked into install/Turbo, matching the Rust-addon convention.

  Verification: `swift test` 147 passed / 1 env-gated skip;
  `pnpm --dir packages/ax-computer test` 104 passed (incl. new
  `test/axnative.test.ts`); both typechecks and `check:structure`
  green; release binary smokes (`version` / `doctor` / MCP
  `initialize`+`tools/list` over stdio). **Live compat suite
  CU-001…CU-010 is green against the AX-native backend on macOS +
  TextEdit** (10/10 via `AX_COMPUTER_AXNATIVE_COMMAND`, TCC grants
  attached to the host process). **Live A/B (same day, OCU vs AX
  Native): 6/6 tasks pass on both, 0 behavioral discrepancies, and AX
  Native is ~2.2× faster — 2 832 ms vs 6 096 ms total wall-clock** —
  so the flip gate (win on speed and capability) is met and
  **AX Native is now the recommended primary macOS backend**, with
  OCU as the reference implementation and Cua as the cross-platform
  fallback. The `computer.provider` default remains unset (computer
  tools stay config-gated); "primary" here is the documented
  recommendation and doctor hint ordering, not an auto-routing change.

- **Phase 3 — routing & policy. Done (2026-08-22).** Manual provider
  selection (`computer.provider` config) was the first slice and shipped
  earlier (the tool wiring — `computer_snapshot` / `computer_action` /
  `computer_watch` / `computer_plan` register only when `computer.provider`
  is set, ask under the RISK-classified `computer` permission, and
  delegate to the `Computer` namespace in
  `packages/ax-code/src/computer/`). The remaining two Phase 3 items
  landed today:
  - **Per-app provider overrides.** New config knob
    `computer.overrides: { [appName]: "cua" | "ocu" }` (zod-validated,
    referenced in `packages/ax-code/src/config/schema-impl.ts`). The
    `Computer` namespace now keeps one lazily-created `ComputerSession`
    per distinct provider name (default + any override values), and
    routes observations by scope: app-scoped observations honor the
    override map; window-scoped and bare-desktop observations always
    use the default provider. Element acts are pinned to the session
    that issued the element ids — a `click` / `set_value` / `drag`
    carrying `kind: "element"` targets always routes to the
    observation's issuing session, so crossing providers requires a
    fresh `computer_snapshot`. The `ComputerSession` one-active-provider
    rule is preserved; a new `activeProviderName` getter (added
    minimally to `packages/ax-computer/src/session.ts`) is the only
    change in `ax-computer`.

  - **AX-Trust integration.** Computer observations, actions, and
    watches now emit dedicated replay events through the existing
    `Recorder` seam (`packages/ax-code/src/replay/recorder.ts` —
    `Recorder.emit({ type: "computer.observe", … })` and
    `Recorder.emit({ type: "computer.action", … })` on the session
    event log). Both event types are added to the `ReplayEvent`
    discriminated union in `replay/event.ts` and surface in
    `audit/export.ts` so AX-Trust reviewers see scope, backend,
    element count, refusal code, and outcome alongside the regular
    `tool.call`/`tool.result` trail. Audit emission is gated by
    `Recorder.active(sessionID)` (no-op outside an active recording)
    and tools thread `sessionID`/`messageID` via a new
    `AuditContext` parameter on `Computer.observe` / `Computer.act` /
    `Computer.reobserve`. Auto-routing/failover between providers
    remains out of scope (PRD non-goal).

## 6. Verification

- Mock-path suite runs in CI by default; live runs are env-gated:
  `AX_COMPUTER_LIVE=1`, backend paths via `AX_COMPUTER_OCU_COMMAND` /
  `AX_COMPUTER_CUA_COMMAND`, target app via `AX_COMPUTER_LIVE_APP`
  (default TextEdit).
- Live debugging probe: `AX_COMPUTER_PROBE=1` (`test/probe.live.test.ts`).
- Live validation to date exercised real TextEdit end-to-end on macOS and
  surfaced four genuine integration bugs, all fixed (coordinate space, focus
  before type, scroll element anchoring, deliberate window selection).

## 7. Security & permission model

- macOS TCC identity: proxy/embedded mode → grants attach to the host `.app`;
  `--direct`/debug mode → grants attach to the responsible terminal process.
  Production must use the app-owned path so prompts read "AX Code Desktop".
- Element targets are epoch-namespaced per observation; cross-provider and
  stale indices are rejected, preventing post-failover mis-clicks.
- OCU's MCP tool annotations understate risk (`destructiveHint: false` on
  action tools); AX Code must not trust backend annotations for policy
  decisions — computer actions default to requiring approval under AX-Trust.

## 8. Risks / open items

- Cua cross-platform drift bugs found in review (pid-keyed HiDPI registry
  mis-clicks on Windows/Linux, key-name vocabulary divergence, X11 error
  handler race) — the compat suite is the detection net; report upstream.
- OCU's SkyLight private SPI is ABI-fragile per macOS release; owning the port
  means owning that maintenance (same burden cua carries).
- Remaining unverified adapter assumptions: cua `double_click`/`right_click`
  argument shapes (unit-fixtured, not live-covered; the suite clicks
  left/single only).
- Live green to date means macOS + TextEdit only. Electron/Chromium apps,
  browsers, and multi-window apps are Phase 1 A/B scope.

## 9. References

- OCU: `.internal/reference/open-codex-computer-use` (MIT; `sky_click` itself
  derives from Cua Driver per its THIRD_PARTY_NOTICES)
- Cua: `.internal/reference/cua` (MIT; avoid `som`/OmniParser AGPL/CC-BY parts)
- DeepSeek Harness: `.internal/reference/deepseek-harness` (MIT, developer
  preview)
- Implementation: `packages/ax-computer/` (see its README for commands)

---

## 10. Phase 1b findings (2026-08-22) — SDK transport swap: NOT VIABLE, no code changed

> **Superseded (2026-08-22, same day) — see Section 11.** This evaluation ran
> without npm-registry reach and enumerated only the SDK's _typed_ surface
> (the `*Input` records and their methods); it missed the published package's
> generic `callTool(name, argumentsJson)` protocol-adapter surface, which is
> downstream of the same Rust tool registry as the MCP server and therefore
> covers every "hard gap" listed below. The transport swap was subsequently
> implemented and landed; the "no code changed / no dependency added"
> statements in §10.5 are stale.

**Decision: leave `CuaProvider` on the MCP transport. Do not adopt
`@trycua/cua-driver` as a replacement while keeping the
`ComputerUseProvider` interface unchanged.** This section records the
evidence so Phase 1c / Phase 2 can decide whether a contract change, a
hybrid (SDK for desktop actions + MCP for app/window enumeration), or
absent of any swap is the right next move.

### 10.1 What exists on npm

`@trycua/cua-driver` is published. The live `cua-driver mcp` binary on
this machine is v0.21.0 and that is the same version present in the
vendored reference at `.internal/reference/cua/libs/cua-driver/typescript`
(`package.json` name `@trycua/cua-driver`, version `0.21.0`, MIT,
`publishConfig.access: public`). The host had no live npm registry reach
during this evaluation (`getaddrinfo ENOTFOUND registry.npmjs.org`); the
package identity and version were confirmed against the vendored source
that ships in the cua monorepo, which the cua release pipeline uses to
build the npm tarball. Phase 1b's npm-registry verification step
therefore stands on the vendored source as ground truth for what the
package contains.

The package declares `main: dist/index.js`, `types: dist/index.d.ts`,
and `exports`:

- `.` → `./dist/index.js` (the native SDK)
- `./embedded` → `./dist/embedded.js` (`EmbeddedCuaDriverHost`)
- `./electron` → `./dist/electron.js` (macOS TCC permission primitives)

Runtime deps: `@ubjs/core@0.31.0-3`, `@ubjs/node@0.31.0-3`. Native
package: installed transitively as an optional platform-matched binary
(the README: "The npm package installs one optional native package
selected for the current OS and CPU"). Node ≥ 20, macOS 13+ for the
macOS native build.

The package's own README is explicit about the boundary:

> "The package does not contain a TypeScript MCP client. Agents already
> have runtime-neutral MCP clients and should configure the executable
> directly… The language packages are for client applications, not agents.
> They contain no language-native MCP facade and have no `/sdk`, `/mcp`,
> or `/native` public suffix. MCP remains implemented by the `cua-driver`
> executable as the runtime-neutral agent boundary."

That sentence is the architectural reason Phase 1b cannot be a clean
drop-in transport swap.

### 10.2 What the API actually offers

The complete set of `*Input` types exported by the SDK's generated
contract (`typescript/src/native/cua_driver_contract.ts`) is, verbatim:

```
ClickInput, ClipboardReadInput, ClipboardWriteInput, DragInput,
EndSessionInput, EscalateSessionInput, GetAgentCursorStateInput,
GetCursorPositionInput, GetDesktopStateInput, GetScreenSizeInput,
GetSessionInput, GetSessionStateInput, HotkeyInput, InvokeMenuInput,
ListSessionsInput, MoveCursorInput, PressKeyInput, ScrollInput,
SetAgentCursorEnabledInput, SetAgentCursorMotionInput,
SetAgentCursorThemeInput, SetWindowFrameInput, StartSessionInput,
TypeTextInput, VerifyStateInput
```

Confirmed by `grep -oE 'export type [A-Z][A-Za-z]+Input' ... | sort -u`
in this session; zero hits for `ListApps`, `ListWindows`,
`GetWindowState`, `LaunchApp`, `BringToFront`, or `SetValue` (and zero
hits for the snake_case tool names the MCP path uses).

The `CuaDriver` instance methods exposed via UniFFI map to those
inputs. Concretely the SDK surface is:

- **Desktop observation:** `getDesktopState` (full-desktop screenshot
  only), `getScreenSize`, `moveCursor`, `getCursorPosition`.
- **Session lifecycle:** `startSession`, `endSession`, `listSessions`,
  `getSession`, `getSessionState`, `escalateSession`.
- **Action primitives:** `click`, `typeText`, `pressKey`, `hotkey`,
  `scroll`, `drag`, `clipboardRead`, `clipboardWrite`, `invokeMenu`,
  `setWindowFrame`, `verifyState`.
- **Cursor theming:** `getAgentCursorState`, `setAgentCursorEnabled`,
  `setAgentCursorMotion`, `setAgentCursorTheme`.
- **Embedded host:** `EmbeddedCuaDriverHost` for spawning the daemon
  inside a signed desktop app (macOS TCC ownership), plus
  `/electron` permission primitives
  (`requestMacOSPermissions`, `hasRequiredMacOSPermissions`,
  `openMacOSScreenRecordingSettings`).

`GetSessionStateInput` accepts only `{ session?: string }` and
`SessionStateOutput` returns `{ session, captureScope, effectiveScope,
desktopUnlocked, escalationReason?, escalationDetail? }` — it is
**session metadata**, not window-scoped state with a screenshot,
elements, or an accessibility tree. It is not a substitute for the MCP
`get_window_state`.

`ToolResult` (the return envelope for action primitives) carries
`text`, `images[]`, `structuredJson?`, `isError`, `errorCode?`,
`action?`, `verification?`, `degraded`, `rawJson`. Refusals surface via
`errorCode` plus the structured payload — shape is compatible with the
current `mcpRefusal`/`toActionResult` mapping in principle.

### 10.3 What is missing vs the `ComputerUseProvider` contract

`packages/ax-computer/src/provider.ts` requires:

```ts
listApps(): Promise<AppInfo[]>
listWindows?(): Promise<WindowInfo[]>
observe(scope: ObserveScope): Promise<ComputerObservation>
act(action: ComputerAction): Promise<ActionResult>
```

`CuaProvider` (`packages/ax-computer/src/providers/cua.ts`) realises
that via the MCP tools below; each row records whether the SDK has an
equivalent and the gap if not:

| Contract method            | MCP tool used today                               | SDK equivalent                                                                                | Gap                                                                                                                               |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `listApps()`               | `list_apps`                                       | **none** (`listSessions` lists SDK sessions, not OS apps; pid/bundleId are not in its output) | Cannot enumerate running applications. `observe({ app })` cannot resolve a pid.                                                   |
| `listWindows()`            | `list_windows`                                    | **none**                                                                                      | Cannot enumerate windows of an app; cannot resolve `observe({ windowId })`.                                                       |
| `observe({ desktop })`     | `get_desktop_state`                               | `getDesktopState`                                                                             | Covered (desktop screenshot only — no elements/a11y, matching today's `get_desktop_state`).                                       |
| `observe({ app })`         | `list_apps` + `list_windows` + `get_window_state` | partial: `getDesktopState` exists, but no list_windows / get_window_state                     | No per-window screenshot, no elements, no a11y tree for a specific (pid, window_id).                                              |
| `observe({ windowId })`    | `list_windows` + `get_window_state`               | none                                                                                          | Same as above; no window enumeration, no window-scoped state.                                                                     |
| `act({ click })`           | `click` / `double_click` / `right_click`          | `ClickInput`                                                                                  | Covered for primitive shape; element-token + element_index routing and `delivery_mode` escalation are MCP-tool-specific concerns. |
| `act({ type })`            | `type_text`                                       | `TypeTextInput`                                                                               | Covered; no `delivery_mode` parameter (SDK has no background-input refusal contract today).                                       |
| `act({ keypress })`        | `press_key` / `hotkey`                            | `PressKeyInput` / `HotkeyInput`                                                               | Covered.                                                                                                                          |
| `act({ scroll })`          | `scroll`                                          | `ScrollInput`                                                                                 | Covered.                                                                                                                          |
| `act({ drag })`            | `drag`                                            | `DragInput`                                                                                   | Covered.                                                                                                                          |
| `act({ set_value })`       | `set_value`                                       | **none**                                                                                      | No element-value setter; the SDK has no `set_value` primitive at all.                                                             |
| `act({ activate_window })` | `bring_to_front`                                  | **none** (`setWindowFrame` moves/resizes but does not raise)                                  | Cannot bring a window to front without raising it programmatically.                                                               |
| `act({ launch_app })`      | `launch_app`                                      | **none** (`invokeMenu` activates a menu item, not an application)                             | Cannot launch an app from the SDK surface.                                                                                        |

Six hard gaps: `listApps`, `listWindows`, `get_window_state`,
`set_value`, `bring_to_front` (activate_window), and `launch_app`. The
first three are load-bearing for `observe()` — without app/window
enumeration the provider cannot construct a window-scoped
`ComputerObservation` (which is the default mode the contract's tests
exercise and the only mode the PRD's `target precedence policy`
relies on for element targeting).

Secondary concerns even for the methods the SDK does cover:

- **Background input refusal contract.** `FOREGROUND_CAPABLE_TOOLS` and
  `recommendsForeground()` in `cua.ts` are wired to MCP refusal codes
  (`background_unavailable`, `same_pid_keyboard_ambiguity`,
  `escalation.recommended:"foreground"`). The SDK has no `delivery_mode`
  parameter on its primitives and no equivalent refusal vocabulary. The
  one-shot foreground escalation path that the Phase 0 compat suite
  (`packages/ax-computer/test/compat/`) validates as a backend
  capability cannot be preserved without contract drift.
- **Element tokens.** MCP returns `element_token` / `element_index` per
  element in `get_window_state`. The SDK's `ClickInput` accepts x/y but
  its `verifyState`/`getSessionState` outputs do not enumerate
  accessibility elements with frame data, so the `ComputerElement[]`
  payload and the `stale_target` epoch enforcement downstream of
  `ComputerSession` would have to be synthesised.
- **`raw` payload for forward-compat.** MCP responses carry
  `structuredContent` (apps, windows, elements, tree_markdown). The SDK
  exposes `structuredJson` on `ToolResult`, but `getDesktopState` in
  the SDK has no element list at all, so the desktop-observation
  payload becomes strictly thinner.

Net effect: keeping the `ComputerUseProvider` interface unchanged is
**not achievable** by swapping transports. Any swap requires either (a)
a contract change (drop `launch_app` / `activate_window` / `set_value`
from `ComputerAction`, accept desktop-only observation, give up window
enumeration), or (b) a hybrid that still drives the MCP executable for
the app/window-management tools and uses the SDK only for desktop
actions — at which point the "swap" is not a transport swap, it is a
two-process composition, and the PRD's TCC-ownership rationale for the
swap (process-isolated runtime owned by the host `.app`) is better
served by `EmbeddedCuaDriverHost` over the daemon socket than by
replacing the MCP client with an in-process SDK.

### 10.4 Recommended path forward

Three options, ordered by cost / blast radius:

1. **Keep MCP as the primary transport; defer the swap.** (Status quo,
   no code change.) Phase 1's stated goal of "embedded cua so TCC
   grants attach to our app" is met instead by
   `EmbeddedCuaDriverHost` launching the `cua-driver` daemon as a
   direct child of the AX Code Desktop process — the MCP client talks
   to that daemon over its socket, and macOS attributes the TCC
   requests to the host `.app`. This is the path the SDK README
   documents ("Daemon-backed MCP hosts") and is strictly less
   disruptive than re-cutting the `ComputerUseProvider` interface.
2. **Adopt the SDK as the desktop-action transport alongside MCP**
   (hybrid). Keep MCP for `list_apps` / `list_windows` /
   `get_window_state` / `set_value` / `bring_to_front` / `launch_app`;
   route click / type / keypress / hotkey / scroll / drag through the
   SDK. Requires two live connections per provider, careful epoch
   reconciliation between MCP-observation element ids and
   SDK-coordinate clicks, and a second native dependency. Not
   recommended before Phase 1 A/B data shows a real semantic gap.
3. **Re-cut `ComputerUseProvider` for an SDK-first world.** Drop
   `launch_app` / `activate_window` / `set_value`, treat observation
   as desktop-only with element lists synthesised from the snapshot,
   let the agent call OS-level launchers (e.g. `open -a`) out of band.
   This is a contract change that ripples into
   `packages/ax-code/src/computer/` and every consumer. Hold for
   Phase 2 when the AX-native macOS backend absorbs the
   app/window-management surface anyway.

**Recommendation: option 1** (no code change in Phase 1b; `CuaProvider`
remains on the MCP transport). Move the TCC-ownership work to a
Phase 1c that introduces `EmbeddedCuaDriverHost` + a daemon socket
client, and revisit the SDK-as-transport question after the Phase 1
A/B task set has settled which backend semantics we actually want to
keep.

### 10.5 What this section does not change

- No source file under `packages/ax-computer/` or elsewhere was
  modified during this evaluation.
- No new dependency was added to `pnpm-workspace.yaml` or any
  `package.json`.
- All Phase 0 unit / compat / live tests remain authoritative and
  unchanged.
- `pnpm install` was not run; the `@trycua/cua-driver` native package
  is not on disk. The TypeScript SDK source examined here comes from
  the vendored reference tree, not from a fetched tarball.

---

## 11. Phase 1b addendum (2026-08-22) — SDK transport implemented; Section 10 overturned

A second Phase 1b evaluation ran the same day with live npm-registry
reach and reached the opposite conclusion; the transport swap is
implemented and landed. This section records why Section 10's NOT
VIABLE finding was wrong on its central technical claims, and what
exactly shipped.

### 11.1 What Section 10 missed

Section 10 enumerated only the SDK's **typed** surface — the `*Input`
records and the named methods (`click`, `typeText`, `getDesktopState`,
…). That surface is real but deliberately partial. The published
package (fetched from npm this session: `@trycua/cua-driver@0.21.0`,
version-matched to the pinned binary) additionally exposes, on both
`CuaDriver` and `CuaDriverSession` (`dist/native/cua_driver_sdk.d.ts`):

```ts
/**
 * Generic protocol-adapter surface. Ordinary applications should prefer
 * typed methods; MCP and other open-ended adapters use this method so they
 * remain downstream of the same public SDK runtime.
 */
callTool(name: string, argumentsJson: string): Promise<ToolResult>
/** Canonical tool inventory for MCP and other protocol adapters. */
listToolsJson(): Promise<string>
```

`callTool` takes the same tool names and JSON argument objects the MCP
server accepts and returns a transport-neutral `ToolResult` envelope
(`text`, `images[{mimeType, dataBase64}]`, `structuredJson?`, `isError`,
`errorCode?`, `rawJson`). The vendored Rust sources confirm this is not
a second, thinner registry:

- `CuaDriver::call_tool` (`rust/crates/cua-driver-sdk/src/lib.rs`)
  parses arguments through `parse_arguments` — the same per-tool schema
  registry the MCP server validates against — strips only
  `_`-prefixed reserved keys (`sanitize_reserved_args`; none of
  ax-computer's arguments are reserved), and dispatches through
  `invoke` into the embedded runtime.
- The MCP server itself is a downstream adapter of this runtime:
  `cua-driver/src/serve.rs` routes every `tools/call` through
  `SdkAdapter::invoke_raw` → `call_tool_from_trusted_adapter` →
  the same `invoke_with_context_and_evidence` with the same registry
  and authorization context.
- The SDK's own Rust tests call `call_tool("list_windows", "{}")`,
  `call_tool("start_session", "{}")`, etc. — the "missing" tools are
  reachable through the generic surface.
- `normalize_result` converts the core's MCP-shaped results
  (`content` text/image blocks + `structuredContent`) into `ToolResult`,
  so structured payloads (apps, windows, elements, `tree_markdown`,
  refusal `code`, `escalation.recommended`) survive verbatim in
  `structuredJson` and map back losslessly.

Consequently, all six §10.3 "hard gaps" (`list_apps`, `list_windows`,
`get_window_state`, `set_value`, `bring_to_front`, `launch_app`) are
available via `callTool`, and the background-input refusal contract
(`delivery_mode`, `background_unavailable`,
`same_pid_keyboard_ambiguity`, escalation recommendation) is preserved
because arguments and results traverse the identical registry.

### 11.2 What shipped

- `pnpm-workspace.yaml`: catalog pin `"@trycua/cua-driver": "0.21.0"`;
  `packages/ax-computer/package.json`: runtime dependency via
  `"catalog:"`.
- `CuaProviderConfig.transport?: "mcp" | "sdk"` (default `"mcp"` —
  existing behavior and all existing tests unchanged) plus a
  `driver?` injection hook mirroring the existing `client?` hook.
- sdk path: `SdkMcpAdapter` presents the embedded driver through the
  existing `McpClient` surface (`callTool` → JSON args → `ToolResult`
  mapped back to the MCP result shape), so all argument construction
  (`toCuaArgs`), observation parsing, refusal propagation, and the
  one-shot foreground escalation are shared code, unchanged.
- The SDK is loaded via **dynamic import** only when the sdk transport
  connects: `@trycua/cua-driver` loads its platform native library at
  import time, and the default mcp path (and every mock-based test)
  must never pay for it or fail on hosts without the native package.
  Construction failures surface as `ComputerUseError`
  (`provider_unavailable`).
- `test/cua-sdk.test.ts`: 10 mock-covered unit tests (observe flows,
  argument serialization, refusal passthrough, escalation retry,
  dispose → `shutdown()` + `uniffiDestroy()`, malformed-envelope
  tolerance, driver-error propagation, default-transport invariant).
  All existing tests pass unchanged; the interface is untouched.

### 11.3 What remains

- Live A/B validation of the sdk transport against the compat suite
  (Phase 1's original A/B scope; unit tests exercise the envelope
  mapping, not the native runtime).
- The Desktop responsibility-chain wiring (`EmbeddedCuaDriverHost`,
  TCC ownership) is unaffected by this swap and remains future work —
  `CuaDriver.create(undefined)` runs the same-process runtime, so in
  the CLI the host process owns the TCC grants directly.

---

## 12. Follow-on capabilities landed (2026-08-22) — Agent-S3-derived intelligence layer

After Phase 3, a review against Codex computer-use and the Agent S3
architecture (observe → reason → ground → act → reflect → recover)
identified capability gaps in the shipped tooling. These are now closed
with AX-owned implementations that absorb Agent S3's _concepts_ only —
no Agent S3 code, and specifically not its model-generated-Python
`exec()` action model; every action still flows through structured
`ComputerAction` → permission → provider. All items are committed and
pushed (`97d6b2c0d` … `62df4c2f9`).

- **Grounder fallback** (`packages/ax-code/src/computer/ground.ts`,
  commit `adeffef5a`). `computer_action` targets accept
  `{ describe: "natural-language description" }` in addition to element
  ids and coordinates. A configured vision model
  (`computer.grounder.model`) resolves the description against the
  latest screenshot to an `{x, y}` point — **coordinates only**; the
  model output is parsed for a point and clamped to image bounds, never
  executed. This is the Agent-S3 "grounder" role (UI-TARS-like)
  implemented over AX Code's existing provider system. Unset config =
  describe targets unavailable with a clear error. The model call is
  injectable (`GroundDeps`) so tests never touch a live provider.

- **Plan-level Best-of-N with behavior judge** (`computer_plan` tool,
  `packages/ax-code/src/tool/computer/computer_plan.ts` + `plan.ts`,
  commit `09232c9b9`). Inspired by Agent S3's Behavior Best-of-N but
  applied at _plan_ level instead of running N real GUI trajectories:
  the tool asks the model for N candidate next-step plans against the
  current observation, then a judge pass selects the best one; only the
  winning plan is executed (once) via normal `computer_action`. Cheap
  robustness for high-value / low-confidence steps without triple
  desktop side effects.

- **Reflection trajectory** (`Computer.record` / ring buffer in
  `packages/ax-code/src/computer/computer.ts`, commit `f66b9a888`).
  Every computer-use step (observe/act outcome, target, refusal) is
  appended to an instance-scoped trajectory (capped ring buffer), and
  `computer_action` results include the recent trajectory so the model
  can reflect on its own recent GUI history — the Agent-S3
  worker/reflection feedback loop.

- **Monitoring** (`computer_watch` tool, commit `e80917ba7`). Poll an
  app/window and report accessibility-tree / screenshot changes between
  observations, covering the "watch the screen while a long operation
  runs" Codex capability.

- **Desktop discovery** (commit `b9e666f90`). A desktop-scope
  `computer_snapshot` now includes the discoverable app/window list so
  the agent can find targets without knowing app names in advance.

- **Browser gap closed via CDP** (commit `03e5ae158`). Browser pages
  attach over Chrome DevTools Protocol (`browser.cdpUrl` config),
  giving DOM-level read/act for web apps — complementing pixel/AX-level
  desktop control rather than duplicating it.

- **Operator preflight** (commit `aa0e044f1`). `ax-code doctor` checks
  the computer-use backend (binary present, version, TCC reachability)
  so setup failures surface before a session starts.

- **Hardening** (commit `01ddc772d`). Eleven review-found bugs fixed
  across the tools, providers, and CDP attach (validation, error
  propagation, edge-case handling).

Verification for the section-12 items: `packages/ax-code` typecheck
green, mock-covered unit tests for each new tool/module, and the full
core suite green at the time of each commit; live A/B (`test/ab/`)
remains the env-gated end-to-end gate for backend behavior.

### What remains open

- **Phase 2 follow-ups** — AX-native backend landed, live compat green,
  and the A/B gate passed (AX Native recommended primary on macOS).
  Remaining: Windows/Linux coverage still comes from Cua only, and the
  SkyLight private-SPI maintenance burden now belongs to us (Section 8).
- **Live validation of the sdk transport** and Desktop
  `EmbeddedCuaDriverHost` wiring (Section 11.3).
- **A second grounder quality gate** — the grounder is currently a
  single generalist vision model call; if a dedicated grounding model
  (UI-TARS-class) is adopted later it plugs into the same
  `computer.grounder.model` knob with no contract change.
- **Auto Best-of-N triggering** — `computer_plan` is invoked explicitly
  by the agent; confidence-based auto-triggering (e.g. after two failed
  recoveries) is policy work for a later phase.
