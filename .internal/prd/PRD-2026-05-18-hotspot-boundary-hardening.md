# PRD: Hotspot Boundary Hardening

**Date:** 2026-05-18
**Status:** Active - Phase 2 registry aggregation complete
**Author:** ax-code agent

---

## Executive Summary

The most fragile `ax-code` areas are large interface-heavy files where multiple state machines and render policies share one module. The highest-risk examples are:

- `packages/ax-code/src/session/prompt.ts`
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`
- `packages/ax-code/src/lsp/index.ts`
- `packages/ax-code/src/server/routes/session.ts`
- `packages/ax-code/src/quality/model-registry.ts`

This PRD continues the package-boundary hardening direction from ADR-009, but narrows the next implementation to a low-risk TUI session route slice. Current working-tree changes already touch session runtime files, so this PRD avoids `session/prompt.ts` until those changes are resolved.

## Problem Statement

`packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` mixes route lifecycle, sync recovery, transcript rendering, tool rendering, and tool-specific display policy. Tool rendering is a good first seam because it is user-visible, heavily extended, and currently relies on inline dispatch inside the largest TUI session file.

The current shape makes small tool display changes harder than necessary:

- New tool renderers require editing a long route file.
- Fallback behavior for unknown tools is embedded in JSX control flow.
- Coalesced tool labels are component-local instead of a pure contract.
- Tests cannot directly validate tool dispatch without reading source shape or mounting more UI than needed.

## Goals

- Create a renderer-free helper module for TUI session tool rendering policy.
- Replace inline tool dispatch with a local registry keyed by a pure helper.
- Keep behavior unchanged for all existing tool renderers.
- Add focused tests for renderer key selection, unknown fallback, and coalesced labels.
- Keep the first implementation slice small enough to review in isolation.

## Non-Goals

- Do not move all tool JSX renderers out of `index.tsx` in this slice.
- Do not change transcript visuals.
- Do not change tool metadata contracts.
- Do not touch `session/prompt.ts`, `session/processor.ts`, `session/compaction.ts`, or `tool/registry.ts` while the current worktree has unrelated dirty changes in those files.
- Do not introduce a plugin renderer API.

## Current Evidence

- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` is about 1,778 lines after Phase 2's registry aggregation.
- The tool dispatch area starts at `ToolPart` and branches on every specialized tool name.
- The coalesced group label policy is embedded inside `CoalescedTool`.
- Existing tests cover broader TUI session helpers, renderer contracts, and anti-patterns, but not a pure tool renderer dispatch contract.

## Implementation Plan

### Phase 1: Tool Rendering Dispatch Boundary

Status: Complete on 2026-05-18.

Files:

- Add `packages/ax-code/src/cli/cmd/tui/routes/session/tool-rendering.ts`.
- Add `packages/ax-code/test/cli/tui-session-tool-rendering.test.ts`.
- Update `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`.

Tasks:

- Completed: define `SESSION_TOOL_RENDERER_KEYS`.
- Completed: implement `sessionToolRendererKey(tool)`.
- Completed: implement `isKnownSessionToolRenderer(tool)`.
- Completed: implement `coalescedToolLabel(tool, count)`.
- Completed: replace the inline `ToolPart` `Switch` with a registry-backed `Dynamic` component dispatch.
- Completed: replace component-local coalesced label logic with `coalescedToolLabel`.
- Completed: add tests for all known tools, unknown fallback, and label text.

Validation:

- Passed: `cd packages/ax-code && bun test test/cli/tui-session-tool-rendering.test.ts`
- Passed: `cd packages/ax-code && bun test test/cli/tui/session-view-model.test.ts`
- Passed: `cd packages/ax-code && bun run check:tui-layering`
- Passed: `cd packages/ax-code && bun run typecheck`
- Passed: `bun run script/structure.ts`

### Phase 2: Tool Renderer Component Extraction

Status: Registry aggregation complete on 2026-05-18.

Completed:

- Added `packages/ax-code/src/cli/cmd/tui/routes/session/context.ts` so extracted renderers can consume the session route context without importing the route component.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/primitives.tsx` for `InlineTool`, `BlockTool`, and the shared `ToolProps` contract.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/basic.tsx` for low-dependency inline renderers: `Glob`, `Grep`, `List`, `WebFetch`, `CodeSearch`, `WebSearch`, and `Skill`.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/session.tsx` for medium-dependency session-state renderers: `Read`, `TodoWrite`, and `Question`.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/file-edits.tsx` for code/diff renderers: `Bash`, `Write`, `Edit`, `ApplyPatch`, and their diagnostics display.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/task.tsx` for the delegated `Task` renderer and child-session preview sync.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/dre.tsx` for Debugging & Refactoring Engine renderers: `RefactorPlan`, `RefactorApply`, `ImpactAnalyze`, and `DedupScan`.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/generic.tsx` for the fallback `GenericTool` renderer.
- Added `packages/ax-code/src/cli/cmd/tui/routes/session/tool-renderers/index.tsx` as the renderer registry aggregator.
- Removed the unused local `ToolTitle` helper from `index.tsx`.
- Added a boundary test that prevents the extracted renderer modules from importing the route index.

Validation:

- Passed: `cd packages/ax-code && bun test test/cli/tui-session-tool-rendering.test.ts`
- Passed: `cd packages/ax-code && bun test test/cli/tui/session-view-model.test.ts`
- Passed: `cd packages/ax-code && bun run check:tui-layering`
- Passed: `cd packages/ax-code && bun run typecheck`
- Passed: `bun run script/structure.ts`

Remaining Phase 2 work:

- Close Phase 2 after a final review pass confirms the route imports only the renderer aggregator and the route still owns only transcript-level concerns.

### Phase 3: Session Runtime Loop Boundary

Status: Deferred.

Do not start while current dirty worktree changes touch session runtime files. Future work should target pure helpers around compaction task handling, autonomous completion decisions, and attachment hydration.

### Phase 4: LSP Client Selection Boundary

Status: Deferred.

Extract repeated client selection and spawn planning from `lsp/index.ts` into a pure planning helper only after adding focused tests for existing selection priority, method support, and broken-server cooldown behavior.

## Acceptance Criteria

- Phase 1 lands without touching unrelated dirty session/runtime files.
- Unknown tools continue to render through `GenericTool`.
- Coalesced labels remain unchanged for `read`, `list`, `glob`, and `grep`.
- Tests cover the new helper module.
- TUI layering and typecheck pass.

## Progress Log

- 2026-05-18: PRD created. Phase 1 selected as the first implementation slice because it avoids current dirty session/runtime files.
- 2026-05-18: Phase 1 implemented. Tool renderer key selection and coalesced labels now live in `tool-rendering.ts`; `ToolPart` dispatches through a registry-backed `Dynamic` component. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 initial extraction implemented. Session route context, renderer primitives, and low-dependency inline renderers moved out of `index.tsx`; the route file dropped to about 2,697 lines. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 second extraction implemented. `Read`, `TodoWrite`, and `Question` moved into `tool-renderers/session.tsx`; the route file dropped to about 2,574 lines. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 third extraction implemented. `Bash`, `Write`, `Edit`, `ApplyPatch`, and diagnostics rendering moved into `tool-renderers/file-edits.tsx`; the route file dropped to about 2,297 lines. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 fourth extraction implemented. `Task` moved into `tool-renderers/task.tsx` with its existing child-session preview sync and navigation behavior preserved; the route file dropped to about 2,220 lines. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 fifth extraction implemented. Debugging & Refactoring Engine renderers moved into `tool-renderers/dre.tsx`; the route file dropped to about 1,850 lines and is no longer among the top three largest files in the structure report. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
- 2026-05-18: Phase 2 registry aggregation implemented. `GenericTool` and the renderer registry moved into `tool-renderers/generic.tsx` and `tool-renderers/index.tsx`; the route file dropped to about 1,778 lines and now imports only `toolRendererComponent` from the renderer package. Targeted tests, TUI layering, package typecheck, and structure guard all pass.
