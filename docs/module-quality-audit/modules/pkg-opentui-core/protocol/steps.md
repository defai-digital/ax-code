# Review Protocol — pkg-opentui-core

Reviewer: ax-code-glm · Model: zai-coding-plan/glm-5.2[1m] · Date: 2026-08-11
Scope: `packages/opentui-core` (vendored terminal UI core). Independent second-pass
reading of the `.d.ts` contract files and the bundled `.js` implementations, including
each empty-catch site flagged in the static extract.

## Step 1 Scope and inventory confirmation

The unit `pkg-opentui-core` exposes its public contract through `packages/opentui-core/index.d.ts:1-24`,
a barrel that re-exports 24 submodules (`Renderable`, `buffer`, `edit-buffer`, `editor-view`,
`animation/Timeline`, `lib/index`, `NativeSpanFeed`, `audio`, `console`, `yoga`, …). The type
surface lives in the adjacent `.d.ts` files (e.g. `Renderable.d.ts`, `buffer.d.ts`, `audio.d.ts`);
the executable code is shipped as generated bundles: `index.js` (11679 lines, the canonical
SolidJS-rendered build), plus two hashed variants `index-07zpr2dg.js` (10096 lines) and
`index-pcvh9d34.js` (16052 lines, which additionally bundles the tree-sitter/LSP worker glue).
The `lib/` directory holds focused helpers (`RGBA`, `border`, `KeyHandler`, `clock`, `clipboard`,
`bunfs`, `ascii.font`). Inventory fingerprint `6d8ade5e21fdfb54` matches the audit table; nothing
was added or dropped on this pass.

## Step 2 Threat and failure model

Risk tag for this unit is `ui`, so the dominant failure surface is silent UI state corruption and
native FFI misuse, not credential handling. Three concrete boundaries: (a) the public export
contract, (b) six empty-catch sites (each re-read below), and (c) the Zig/FFI boundary around
`FFIRenderLib`. I confirmed there are no secrets, auth, or pty paths in this package — the
mitigation note in the finding file ("High-risk kill/auth paths fixed elsewhere
(terminal/pty/auth)") is accurate. The genuinely interesting silent failure is at
`packages/opentui-core/index-pcvh9d34.js:15104-15106`, where the top-level
`try { opentuiLib = new FFIRenderLib(opentuiLibPath); } catch (error) {}` swallows a native render
library load error; downstream callers then hit an undefined `opentuiLib` with no proximate cause.

## Step 3 Correctness of public surfaces

I traced the control flow of the highest-leverage types. `NativeSpanFeed`
(`NativeSpanFeed.d.ts:9-52`) is a zero-copy Zig wrapper whose doc comment (lines 5-8) warns that
chunk/state typed-array views are borrowed and invalid after `destroy()`; the state machine
(`closed`, `destroyed`, `draining`, `pendingClose`, `inCallback`, `closeQueued`,
`pendingHandlerError`) plus `idle(): Promise<void>` resolved by `resolveIdleIfNeeded` gives a
coherent drain/close ordering. `Renderable` (`Renderable.d.ts:118-309`) documents the render-pass
re-entrancy hazard at lines 260-264 ("Requesting a render during a render pass will drop the
requested render … use process.nextTick") and the `live`/`liveCount` propagation
(`propagateLiveCount`) drives renderer keep-alive, with `RootRenderable.propagateLiveCount`
overriding the base. `Timeline` + `TimelineEngine` (`animation/Timeline.d.ts:80-124`) bind a frame
callback to the renderer and toggle `isLive` via `updateLiveState`; `add`/`once`/`call`/`sync`
compose items and sub-timelines cleanly. One correctness watch-item: `EditBuffer` keeps a static
`registry` and a single `nativeEventsSubscribed` flag (`edit-buffer.d.ts:12-13`), so all instances
share one global native-event subscription — safe only if every instance calls `destroy()`.

## Step 4 Performance and resource lifecycle

Native resources are wrapped with destroy guards: `OptimizedBuffer` (`buffer.d.ts:8-113`) holds a
`bufferPtr` with a `destroy()` and `_destroyed` flag, and `Renderable.destroy`
(`index-07zpr2dg.js:1255-1262`) frees the yoga node inside `try { this.yogaNode.free(); } catch (e) {}`.
`NativeSpanFeed` implements explicit backpressure (`isBackpressured`, `drainAll`, `idle`) rather
than unbounded buffering. `Audio` (`audio.d.ts:52-88`) exposes symmetric `dispose()` and its
`loadSoundFile` returns a `Promise<AudioSound | null>` so async I/O is not blocking the render
thread. The lifecycle gap to watch is the `EditBuffer.registry` static map: if any caller forgets
`destroy()`, entries (and possibly native pointers retained for events) accumulate for the process
lifetime — worth a leak test rather than a code change today.

## Step 5 Design and coupling

The barrel in `index.d.ts` produces a very wide public fan-out (334 exports per the audit table).
Because this is a vendored framework consumed by `packages/opentui-solid` and the `packages/ax-code`
TUI, that breadth is expected, but it means any internal rename is a breaking change for two
in-tree consumers — changes here should be treated as semver-sensitive. `Renderable`
(`Renderable.d.ts:118-310`) is the coupling hotspot: it owns layout (yoga), focus, selection,
mouse, keyboard, z-index and frame-buffering in one ~190-member class. For a vendored framework
that centralisation is tolerable and is not worth refactoring at this stage. By contrast
`TerminalConsole` (`console.d.ts:42-145`) is well-factored: it takes a `CliRenderer` and an
injectable `Clock` (`lib/clock.d.ts:2-8`), which keeps timers testable and avoids global state.

## Step 6 Hygiene and dead code

All six empty-catch sites were re-read in source. My independent dispositions diverge from the
blanket "review-needed" in the finding file:

| Site                                     | Context read                                                           | Disposition                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `index-07zpr2dg.js:1259-1261`            | `this.yogaNode.free()` inside `destroy()`                              | accepted-best-effort (teardown; throwing during destruction would be worse)                                  |
| `index-07zpr2dg.js:5235-5237`            | user-supplied `options.onCopySelection(text)` in `triggerCopy()`       | review-needed — should log, otherwise copy-callback bugs are invisible                                       |
| `index-pcvh9d34.js:8319-8321`            | `Promise.resolve(worker.terminate()).catch(()=>{})` in worker shutdown | accepted-best-effort (already double-guarded by inner `.catch`)                                              |
| `index-pcvh9d34.js:15104-15106`          | top-level `new FFIRenderLib(opentuiLibPath)` probe                     | review-needed — silent native-load failure yields confusing downstream errors                                |
| `lib/tree-sitter/update-assets.js:34-40` | `readFile(cacheFile)` cache-miss fallthrough                           | accepted-best-effort (ENOENT expected before fetch); narrowing to `error.code === 'ENOENT'` would be cleaner |
| `parser.worker.js:73-79`                 | identical cache-miss fallthrough                                       | accepted-best-effort (same rationale)                                                                        |

TODO count is 0 across the inventory; no dead exports were evident from the barrel.

## Step 7 Tests and verification coverage

Coverage is integration-level on the consumer side, not unit-level against these `.d.ts` surfaces.
The five referenced suites live in `packages/ax-code/test/`:
`cli/tui/opentui-ffi-coordinate-guard.test.ts`, `cli/tui/opentui-ffi-pointer-pin.test.ts`,
`cli/tui/opentui-spinner.test.ts`, `script/opentui-package-integrity.test.ts`, and
`session/semantic-core.test.ts`. The two FFI guard/pointer-pin suites are the most relevant here
because they pin native memory safety for `NativeSpanFeed` chunk pinning — directly exercising the
"borrowed views invalid after destroy" contract documented at `NativeSpanFeed.d.ts:5-8`. There is
no direct unit coverage of `Timeline`, `TerminalConsole`, or `EditBuffer` lifecycle inside this
package; that gap is acceptable for a vendored library but should be noted when judging risk.

## Step 8 Finding register and disposition

A single finding exists: `AUDIT-pkg-opentui-core-empty-catch` (category `silent-error`,
severity **Low**, origin `new`, status `deferred`, owner `ax-code-glm`, independent verifier
`codex-sol`). My second pass confirms Low is the correct ceiling: none of the six sites touch
kill/auth/secret paths. I recommend refining the finding's per-site table from the current uniform
"review-needed: 6" to **2 actionable** (copy-callback log at `index-07zpr2dg.js:5237`; native-lib
load log at `index-pcvh9d34.js:15106`) plus **4 accepted-best-effort**, which lets the verifier
sign off the remaining sites without churn. No Critical findings exist, so no `reverify.md` gate
item is produced from this lane.

## Step 9 Verification and exit

Because `pkg-opentui-core` is a read-only library consumed by the core runtime, the meaningful
gate is consumer typecheck plus the FFI/integrity suites, not a build of the package itself. The
recommended verification command set is: `pnpm --dir packages/ax-code run typecheck` (covers the
type contract re-exported through `index.d.ts`), then the targeted suites
`opentui-ffi-coordinate-guard`, `opentui-ffi-pointer-pin`, `opentui-spinner`, and
`opentui-package-integrity` via `AX_TEST_FILES=…` under `packages/ax-code`. Reviewer (ax-code-glm)
sign-off is recorded here; independent verifier (codex-sol) second pass is the remaining open
checkbox. Exit recommendation: **pass with Low-severity follow-ups deferred** — no blocking issues
found in this lane.
