# TUI Native Renderer Migration PRD

Status: Draft
Scope: proposal
Last reviewed: 2026-04-14
Owner: ax-code runtime

## Problem

AX Code currently uses OpenTUI/Solid for the interactive terminal UI. This has shipped product value, but it
creates risk in areas that are core to a coding agent: terminal input, resize behavior, focus ownership, text
wrapping, selection, and offline packaging. Recent history already includes OpenTUI hardening work and a reverted
OpenTUI upgrade, so future renderer changes need a measured migration path rather than another ad hoc rewrite.

## Goals

- Make TUI renderer failures reproducible, classified, and measurable before migration work starts.
- Move product UI state toward renderer-neutral view models.
- Own the terminal rendering/input core if evidence shows OpenTUI blocks product direction.
- Preserve current CLI behavior during migration through a renderer flag and fallback.

## Non-Goals

- Do not rewrite product/session/provider logic in Rust.
- Do not remove OpenTUI before parity gates pass.
- Do not treat generic TUI bugs as renderer bugs without classification evidence.

## Phase Plan

### Phase 0: Evidence and Decision Gates

Status: Implemented in `renderer-evidence.ts` and `script/tui-renderer-evidence.ts`.

Deliverables:

- PRD and phase plan.
- Bug classification model: `product-layer`, `integration-layer`, or `renderer-specific`.
- Evidence summary tooling that combines manually classified issues and benchmark failures.
- Decision gate wired to existing `decideTuiRenderer` rules.

Exit criteria:

- Every migration-driving TUI bug has an ID, repro status, layer, criteria failures, and product impact.
- Benchmark reports can be converted into renderer evidence.
- Native work is proposed only when renderer-specific failures block product direction and packaging/build risk is
  accepted.

### Phase 1: Renderer Boundary

Status: Implemented for direct OpenTUI imports in product TUI code.

Move direct `@opentui/*` imports behind an OpenTUI adapter. Define internal types for key events, mouse events,
colors, text runs, focus, scroll, prompt, and dialog primitives. Tighten tests so product TUI modules cannot import
OpenTUI directly.

Implemented surface:

- OpenTUI bridge: `packages/ax-code/src/cli/cmd/tui/renderer-adapter/opentui.ts`
- Renderer-neutral types: `packages/ax-code/src/cli/cmd/tui/renderer-adapter/types.ts`
- Contract gate: `packages/ax-code/test/cli/tui/renderer-contract.test.ts`

### Phase 2: Renderer-Neutral UI State

Status: Implemented for the first reusable session header/footer state slices.

Extract session transcript, prompt, dialogs, sidebar, command palette, and permission flows into view models. Keep
Solid/OpenTUI as one renderer of those models while expanding pure unit coverage.

Implemented surface:

- Session header state: `packages/ax-code/src/cli/cmd/tui/routes/session/header-view-model.ts`
- Session footer state: `packages/ax-code/src/cli/cmd/tui/routes/session/footer-view-model.ts`
- Renderer-independent guard: included in `PURE_TUI_FILES` in `renderer-contract.test.ts`

### Phase 3: Native Terminal Core Prototype

Status: Implemented as a Rust/NAPI prototype crate, not yet wired into the runtime renderer.

Create a small Rust native core for raw mode lifecycle, VT/input parsing, cell-buffer diffing, ANSI styling, unicode
width/CJK wrapping, resize, mouse, paste, selection, and clean shutdown. Expose it through napi-rs or a subprocess
protocol.

Implemented surface:

- Rust crate: `crates/ax-code-terminal`
- Native package shell: `packages/ax-code-terminal-native`
- Covered primitives: raw-mode lifecycle state, viewport clamping, CSI/bracketed-paste/SGR mouse parsing, ANSI SGR
  runs, CJK cell width/wrapping, and cell-buffer diff patches.

### Phase 4: Flagged Native Vertical Slice

Status: Implemented as an opt-in direct terminal slice behind `AX_CODE_TUI_RENDERER=native`.

Add `AX_CODE_TUI_RENDERER=opentui|native`. First native slice covers startup, first frame, static transcript, prompt
echo, resize, and shutdown. Then add dialogs, autocomplete, mouse, selection, and rich transcript rendering.

Implemented surface:

- Renderer choice: `packages/ax-code/src/cli/cmd/tui/renderer-choice.ts`
- Native vertical slice: `packages/ax-code/src/cli/cmd/tui/native/vertical-slice.ts`
- Covered primitives: alternate-screen startup/shutdown, first-frame paint, static transcript projection from the
  session message endpoint, prompt echo/editing, terminal resize repaint, and Ctrl-C/Ctrl-D shutdown.

### Phase 5: Parity and Default Decision

Native can become default only after passing the renderer contract and benchmark targets for first frame, keypress
echo, paste echo, resize, mouse, selection, transcript projection, and scroll replay. Keep OpenTUI fallback for at
least one release cycle.

### Phase 6: OpenTUI Removal

Remove OpenTUI dependencies, JSX source configuration, spinner integration, and packaging hooks only after native is
default, fallback usage is low, and release telemetry/bug reports are stable.

## Phase 0 Usage

Create an evidence file:

```json
{
  "installOrBuildRiskAccepted": false,
  "offlinePackagingDeterministic": false,
  "issues": [
    {
      "id": "tui-001",
      "title": "Prompt loses focus after terminal resize",
      "layer": "renderer-specific",
      "status": "open",
      "reproducible": true,
      "source": "manual-repro",
      "criteriaFailures": ["terminal.resize-stability"],
      "blocksProductDirection": true
    }
  ]
}
```

Run the summary:

```bash
cd packages/ax-code
bun run tui:renderer:evidence -- --issues ../../tmp/tui-issues.json
```

Include benchmark failures:

```bash
bun run script/tui-benchmark.ts --run -- bun run src/index.ts --output /tmp/tui-benchmark.json
bun run tui:renderer:evidence -- --issues ../../tmp/tui-issues.json --benchmark-report /tmp/tui-benchmark.json
```
