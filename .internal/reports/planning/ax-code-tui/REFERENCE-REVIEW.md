# AX Code TUI Reference Review

| Field | Value |
| --- | --- |
| Date | 2026-08-20 |
| Scope | AX renderer baseline, pi-tui, and Kimi Code's TUI integration |
| Decision | Keep the Solid/native renderer, consolidate ownership, and adopt selected reliability patterns incrementally |

## Executive finding

The strongest design is not a wholesale copy of either reference. AX already has the richer retained-mode renderer,
Yoga layout, Solid reconciler, native framebuffer, selection model, and two proven screen profiles. pi-tui and Kimi Code
are most valuable as examples of how to make terminal behavior explicit, observable, and regression-driven.

The implementation therefore keeps AX's renderer baseline behind one `@ax-code/tui` package and treats the reference
projects as a pattern library. No new renderer dependency or parallel component tree is introduced.

## Sources reviewed

- `.internal/reference/kimi-code/packages/pi-tui/src/terminal.ts`: a small terminal-driver contract, raw-mode ownership,
  keyboard-protocol negotiation, configurable SSH escape timing, bracketed paste, and input draining.
- `.internal/reference/kimi-code/packages/pi-tui/src/tui.ts`: coalesced render requests, an input-sensitive immediate path,
  overlay focus restoration, responsive overlay visibility, IME cursor ownership, and lifecycle ordering.
- `.internal/reference/kimi-code/packages/pi-tui/src/tui-main-screen.ts`: synchronized terminal writes, differential line
  updates, defensive width truncation, viewport-aware redraw decisions, and render-state diagnostics.
- `.internal/reference/kimi-code/packages/pi-tui/src/tui-alt-screen.ts`: separate alternate-screen layout, selection,
  search, mouse, and scrolling behavior instead of conditionals spread through one coordinator.
- `.internal/reference/kimi-code/packages/pi-tui/src/stdin-buffer.ts` and `src/paste-burst.ts`: chunk-safe escape parsing,
  bracketed-paste framing, configurable lone-Escape timing, and a fallback for terminals that omit paste markers.
- `.internal/reference/kimi-code/packages/pi-tui/test/virtual-terminal.ts` plus renderer, overlay, input, and narrow-width
  tests: `@xterm/headless` verifies the terminal's interpreted viewport rather than only checking emitted byte strings.
- `.internal/reference/kimi-code/apps/kimi-code/src/tui/utils/input-latency.ts`: a debug-only input-to-frame probe with
  p50/p95/p99/max statistics, slow-event counters, and an optional JSONL trace.
- `.internal/reference/kimi-code/.agents/skills/write-tui/SKILL.md` and `DESIGN.md`: thin coordinator guidance,
  controller boundaries, semantic theme tokens, consistent dialog behavior, width enforcement, and colocated tests.
- `packages/ax-code-tui`: the current renderer, Solid integration, native artifacts, patch contracts, and package surface.
- `packages/ax-code/src/cli/cmd/tui`: AX product composition, renderer profiles, cleanup, focus, dialogs, streaming, and
  performance contracts.

## Comparative assessment

| Concern | AX baseline to retain | Lesson from pi-tui/Kimi | AX disposition |
| --- | --- | --- | --- |
| Component model | Solid signals, TSX, Yoga, native renderables | Small imperative `render(width)` components | Retain Solid; do not rewrite product components. |
| Renderer | Native cell renderer and framebuffer tests | ANSI line diff plus synchronized output | Retain native renderer; borrow test and scheduling discipline. |
| Packaging | Previously mirrored three upstream packages | One cohesive package with a narrow export | Implement one `@ax-code/tui` workspace and explicit subpaths. |
| Terminal I/O | Capable renderer API but generated implementation | Explicit `Terminal` driver with owned start/stop | Add an AX driver seam during source ownership, behind the Solid API. |
| Screen modes | Compatible main screen and advanced alternate screen | Separate main/alternate implementations | Preserve both profiles and move ownership into explicit modules in Phase 2/3. |
| Render scheduling | Existing coalescing and immediate-render state in the snapshot | Normal throttled lane plus input-preempting lane | Preserve now; expose and regression-test it when source replaces generated chunks. |
| Input | Existing keyboard/mouse/paste handling | Chunk-safe parser, SSH-aware Escape timeout, paste-burst fallback | Add focused transport tests before adopting code; avoid heuristic fallback without telemetry. |
| Focus/overlays | Solid focus manager and product dialogs | Explicit stack order, non-capturing overlays, deterministic restoration | Translate invariants into AX tests; do not import the imperative overlay API. |
| Width/Unicode | Native width/layout plus golden frames | Extensive CJK, grapheme, width-one, ANSI, and overlay-boundary regressions | Expand AX's edge-case matrix and test both profiles. |
| End-to-end tests | Native framebuffer, PTY startup, golden frames | xterm/headless interpreted viewport | Add a complementary virtual terminal harness; keep native golden tests. |
| Performance | Declared input/paste/resize criteria | Live input-to-frame percentiles and worst-sample trace | Add opt-in AX diagnostics and CI threshold sampling in Phase 3. |
| Product architecture | Solid context/routes/components | Coordinator delegates event, streaming, replay, and keyboard controllers | Continue extracting orchestration from large product components, independent of renderer internals. |

## Adopt in this implementation

1. One AX-owned package and one manifest, with `solid` and `spinner` as supported subpaths.
2. A deliberately narrow export map based on observed AX consumers.
3. An upstream provenance record and a test-backed divergence ledger.
4. Separate AX product identity from immutable third-party filenames, symbols, license text, and upstream package IDs.
5. Package, patch, native-manifest, renderer-contract, golden-frame, startup-profile, and release-staging gates.
6. A single-engine architecture decision that prevents a second production renderer from appearing accidentally.

## Adopt after consolidation

### Source ownership

Replace generated hashed chunks with reviewed source modules matching the pinned native ABI. The first source boundaries
should be terminal I/O, screen-mode lifecycle, input decoding, render scheduling, native resolution, and diagnostics.
This makes existing AX fixes readable and allows each divergence to point to a source module rather than a text patch.

### Terminal behavior harness

Add an `@xterm/headless` adapter as a development/test dependency. Test the interpreted viewport for start, append,
shrink, resize, suspend/resume, teardown, overlays, and both screen profiles. Keep native framebuffer tests because the
two harnesses detect different classes of failure.

### Input and latency hardening

Expose input-received and frame-committed timestamps behind a debug flag. Report rolling p50/p95/p99/max and optionally
write JSONL. Add split escape-sequence, slow-SSH Escape, bracketed-paste chunking, IME cursor, grapheme, CJK boundary,
and one-column-terminal regressions before changing input behavior.

### Product-layer consistency

Use AX semantic theme tokens and shared dialog primitives as the single source for selection markers, hints, focus,
truncation, and keyboard rules. Kimi's design checklist is useful process evidence, but AX should encode the rules in
components and tests rather than copy its visual language verbatim.

## Explicitly not adopted

- pi-tui as a runtime dependency or a replacement for Solid/Yoga/native rendering;
- a second renderer, compatibility shim package, or feature-flagged dual component tree;
- Kimi's visual branding, component copy, coordinator classes, or application state model;
- blind copying of terminal escape logic without matching AX's render thread and native lifecycle;
- removal or renaming of upstream native symbols and filenames that are part of the current ABI;
- removal of licenses, notices, repository URLs, pinned upstream package IDs, or other provenance.

## Best-practice guardrails

- Keep package/API consolidation behavior-neutral; make renderer upgrades separate changes.
- Treat JavaScript and native artifacts as one ABI-coupled release unit.
- Fail closed when a patch marker, native hash, required export, or single-target packaging invariant drifts.
- Measure terminal output as interpreted state where possible, not only as emitted escape strings.
- Give input-triggered frames a bounded low-latency path without disabling normal frame coalescing.
- Make focus restoration an explicit state machine and test nested, hidden, non-capturing, and removed overlays.
- Test Unicode by grapheme and displayed columns, including width-one and overlay-boundary cases.
- Keep provenance complete while ensuring active AX imports, commands, diagnostics, and environment variables use AX names.
