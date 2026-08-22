# PRD: Computer Use Integration (OCU + Cua)

| Field    | Value                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Status   | Active — Phase 0 complete (abstraction + MCP adapters + compat suite, live-green on macOS)                                   |
| Owner    | AX Code CLI & Desktop maintainers                                                                                            |
| Created  | 2026-08-22                                                                                                                   |
| Related  | `.internal/reference/open-codex-computer-use` (OCU), `.internal/reference/cua` (Cua), `.internal/reference/deepseek-harness` |
| Location | `docs/prd/PRD-2026-08-22-computer-use-integration.md`                                                                        |

---

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

| Component             | Strategy                                   | Rationale (from code review)                                                                                                    |
| --------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `ComputerUseProvider` | 100% AX-owned (`packages/ax-computer`)     | Insulates the agent from backend tool names, schemas, and drift                                                                 |
| Cua (`cua-driver`)    | Pinned dependency / official SDK or MCP    | ~100k+ lines of Rust across 3 OS adapters; actively maintained upstream; ships an explicit embedding SDK (`@trycua/cua-driver`) |
| OCU                   | Absorb macOS Swift core later (port + fix) | Small (~27 files), closest to Codex semantics; its Linux/Windows Go runtimes are C-grade re-implementations — do not absorb     |
| DeepSeek Harness      | Absorb 4 design patterns only, zero code   | Plugin machinery is vendored Cordis; developer preview with breaking changes; no computer-use at all                            |

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
- **Phase 1 — A/B + embedded cua.** Run a shared desktop task set through both
  providers to settle primary/fallback empirically; swap `CuaProvider`
  transport to the pinned `@trycua/cua-driver` SDK (interface unchanged). The
  macOS embedded host spawns its daemon inside AX Code Desktop's responsibility
  chain so TCC grants attach to our app.
- **Phase 2 — AX-native macOS backend.** Port OCU's macOS Swift core into
  `AXNativeProvider`, fixing the known defects during the port; keep MIT
  attribution. Flip primary only when the compat suite says AX Native wins.
- **Phase 3 — routing & policy.** Manual provider selection
  (`computer.provider` config), optional per-app overrides, AX-Trust policy
  integration for computer actions. _Update (2026-08-22): the tool wiring
  landed — `computer_snapshot` / `computer_action` register only when
  `computer.provider` is set, ask under the RISK-classified `computer`
  permission, and delegate to the `Computer` namespace in
  `packages/ax-code/src/computer/`. Auto-routing/failover between providers
  remains out of scope; per-app overrides are still future work._

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
