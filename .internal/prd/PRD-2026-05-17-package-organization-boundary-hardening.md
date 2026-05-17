# PRD: Package Organization Boundary Hardening

**Date:** 2026-05-17
**Status:** Partially Implemented - Phase 1 visibility slice
**Author:** ax-code agent

---

## Implementation Notes

### 2026-05-17 - Phase 1 Visibility Slice

Implemented the first low-risk guardrail slice:

- `script/structure.ts` now reports runtime imports that reach directly into SDK source files.
- `script/structure.ts` now reports workspace package manifest dependency cycles.
- `script/structure.ts` now separates hotspot threshold reporting from the general hotspot summary.
- Existing SDK/runtime source imports, workspace package cycles, and 800+ line files are reported as warnings so known debt is visible without breaking unrelated CI.
- `packages/ax-code/test/script/root-structure-script.test.ts` verifies that the root structure script emits the new boundary-hardening sections and exits successfully with current known warnings.

### 2026-05-17 - Phase 6 SDK Source Import Cleanup Slice

Implemented the first SDK/runtime contract cleanup:

- `packages/ax-code/src/sdk/programmatic.ts` now imports API types through `@ax-code/sdk/v2/client`.
- Programmatic SDK types and error classes now come from `@ax-code/sdk/programmatic`.
- `script/structure.ts` now reports `SDK Runtime Source Imports` as OK for the current checkout.
- The broader workspace manifest dependency cycle remains visible as a warning and is intentionally left for a separate package-boundary slice.

### 2026-05-17 - Phase 3 DRE Graph Timeline Extraction Slice

Implemented the first route/domain extraction:

- Extracted DRE graph timeline parsing into `packages/ax-code/src/quality/dre-graph-timeline.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now consumes parsed timeline data instead of owning that parser inline.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-timeline.test.ts` for headings, metadata, step parsing, tool parsing, route/LLM/error capture, and duration parsing.
- Existing DRE graph route tests still cover page/fingerprint behavior after the extraction.

### 2026-05-17 - Phase 3 DRE Graph Fingerprint Extraction Slice

Implemented the second route/domain extraction:

- Extracted DRE graph index/session fingerprint shaping into `packages/ax-code/src/quality/dre-graph-fingerprint.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now delegates fingerprint JSON shaping instead of owning it inline.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-fingerprint.test.ts` for session-list fingerprints, graph/DRE/risk summaries, quality readiness rollups, branch rank summaries, and rollback counts.
- Existing DRE graph route tests still cover fingerprint endpoints after the extraction.

### 2026-05-17 - Phase 3 DRE Graph Format Helper Extraction Slice

Implemented another pure-helper extraction:

- Extracted DRE graph display formatting, escaping, safe JSON, risk tone, readiness tone, validation labels, timestamps, and number/duration formatting into `packages/ax-code/src/quality/dre-graph-format.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now imports these pure helpers instead of owning them inline.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-format.test.ts` for HTML escaping, script-safe JSON escaping, agent labels, timestamps, duration formatting, and tone/readiness/validation classification.
- Existing DRE graph route tests still cover page behavior after the extraction.

### 2026-05-17 - Phase 3 DRE Graph Widget Helper Extraction Slice

Implemented a follow-up display-helper extraction:

- Extracted DRE graph chip, stat, flow, step summary, gauge, bar chart, and donut HTML helpers into `packages/ax-code/src/quality/dre-graph-widgets.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now imports reusable widget helpers instead of owning route-local visual primitives.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-widgets.test.ts` for HTML escaping, flow compression/truncation, step summary filtering, gauge tone color, bar chart output, and donut percentages.
- Existing DRE graph route tests remain the route-level regression boundary after the extraction.

### 2026-05-17 - Phase 3 DRE Graph Asset Helper Extraction Slice

Implemented a client-asset extraction:

- Extracted DRE graph theme bootstrap, theme toggle, live-refresh, and Mermaid graph loader scripts into `packages/ax-code/src/quality/dre-graph-assets.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now imports client-side asset helpers instead of owning those scripts inline.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-assets.test.ts` for theme wiring, live polling config generation, directory URL encoding, EventSource setup, Mermaid graph fetch wiring, and script-safe session id escaping.
- Left the large CSS helper in the route for a separate mechanical extraction slice so this commit stays reviewable.

### 2026-05-17 - Phase 3 DRE Graph Style Asset Extraction Slice

Implemented the CSS asset extraction:

- Extracted the DRE graph page stylesheet helper into `packages/ax-code/src/quality/dre-graph-style.ts`.
- `packages/ax-code/src/server/routes/dre-graph.ts` now imports the stylesheet helper instead of owning the large CSS template inline.
- Added focused coverage in `packages/ax-code/test/quality/dre-graph-style.test.ts` for theme variables, core page selectors, widget selectors, graph visualization selectors, and responsive CSS.
- Kept the new style module below the 800-line hotspot threshold while reducing the route file to page composition and request glue.

Still pending:

- UI component grouping.
- Further DRE graph route domain extraction beyond timeline, fingerprint shaping, display formatting helpers, widget helpers, client asset scripts, and CSS asset extraction.
- TUI session route and session prompt hotspot reduction.
- LSP surface cleanup.
- Workspace package manifest dependency-cycle cleanup.

## Problem Statement

The current workspace package layout is broadly correct, but several package-internal files and folders have grown large enough to weaken boundaries and maintainability.

The current structure guardrail passes and validates that runtime packages do not import `@ax-code/ui`, raw cross-package `src` imports are absent, and required architecture notes exist. That means a broad workspace package split is not the best first move.

The real debt is concentrated in large runtime and UI surfaces:

- `packages/ax-code/src/session/prompt.ts` is over 3,000 lines.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` is over 3,000 lines.
- `packages/ax-code/src/server/routes/dre-graph.ts` is over 2,600 lines.
- `packages/ax-code/src/lsp/index.ts` is over 2,000 lines.
- `packages/ui/src/components` still has a large flat direct-file surface.
- `ax-code` and `@ax-code/sdk` have a package-manifest dependency cycle smell, and runtime code still imports SDK source types through relative deep paths.

Without a phased boundary-hardening plan, future feature work will keep landing in interface-heavy files and make eventual package splits more expensive.

## Goals

- Goal 1: Preserve the current workspace package roles while improving internal ownership boundaries.
- Goal 2: Move domain-heavy behavior out of server routes, CLI commands, and TUI components into domain or view-model modules.
- Goal 3: Group shared UI components by concern without breaking public exports.
- Goal 4: Remove or formally contain SDK/runtime deep source imports.
- Goal 5: Add structure guardrails that make hotspot growth and dependency cycles visible.
- Non-goal: Do not perform a broad multi-package split in the first implementation wave.
- Non-goal: Do not move terminal-specific OpenTUI code into `packages/ui`.
- Non-goal: Do not change public SDK APIs unless a compatibility-preserving export is required.

## Current State

### Package Roles

- `packages/ax-code` contains runtime, CLI, TUI, server, session engine, tool orchestration, storage, and provider integration.
- `packages/ui` contains shared UI components, content rendering, icons, styles, and UI-only helpers.
- `packages/sdk/js` contains the JavaScript SDK and generated OpenAPI clients.
- `packages/plugin`, `packages/util`, integration packages, and native addon packages remain narrower supporting surfaces.

### Existing Guardrails

- `script/structure.ts` checks required architecture notes, `@ax-code/ui` dependency violations, raw cross-package `src` imports, V4 guarded directory imports, hotspot summaries, legacy root folders, and unexpected root folders.
- `packages/ax-code/script/check-tui-layering.ts` checks selected TUI view-model and pure-helper files for Solid/OpenTUI renderer imports.
- `packages/ax-code/ARCHITECTURE.md` already says domain logic belongs in domain folders and interface layers should stay in `cli`, server routes, and other entry surfaces.
- `packages/ui/ARCHITECTURE.md` already says new components should be grouped by concern and primitive controls should stay separate from session/file/content-specific components.

### Observed Hotspots

- `packages/ax-code/src/cli` contains the largest source count under `packages/ax-code/src`, with TUI as the largest sub-surface.
- `packages/ax-code/src/quality` contains many promotion and rollout modules, with several large policy files.
- `packages/ax-code/src/server/routes/dre-graph.ts` carries too much DRE graph behavior in an HTTP route.
- `packages/ax-code/src/lsp/index.ts` centralizes too many LSP concerns.
- `packages/ui/src/components` still has many direct files even though grouped folders already exist.

## Proposed Solution

### Overview

Implement a phased internal reorganization that hardens boundaries before any package split:

1. Add better visibility and guardrails.
2. Group UI files while preserving exports.
3. Extract the clearest route/domain seam first.
4. Reduce TUI and prompt hotspots through pure helper and view-model extraction.
5. Clean up SDK/runtime contract imports.

### Technical Design

#### Structure Guardrails

Extend `script/structure.ts` or add a supporting script to report:

- new files above 500 lines,
- new or expanded files above 800 lines,
- direct-file count under `packages/ui/src/components`,
- package manifest dependency cycles,
- runtime imports from SDK source paths.

Known existing hotspots should initially be warnings or explicitly allowlisted so the guardrail prevents growth without blocking unrelated work.

#### UI Grouping

Move shared UI components from `packages/ui/src/components` into concern-based folders while preserving current package exports:

- `primitives/`: button, checkbox, input, dialog primitives, popover, menus.
- `content/`: markdown, diff, line comments, media previews.
- `message/`: message parts, message files, message navigation.
- `session/`: session review, session graph, session insights, rollback/retry/compare.
- `file/`: file icon, file media, file search, file SSR.
- `provider/`: provider icons and provider-specific display helpers.

Update `packages/ui/package.json` exports only when necessary and preserve old export paths through compatibility re-exports.

#### DRE Graph Route Extraction

Extract domain-heavy logic from `packages/ax-code/src/server/routes/dre-graph.ts` into a domain module under `packages/ax-code/src/quality/` or `packages/ax-code/src/graph/`.

The route should own:

- HTTP request parsing,
- authentication/context binding,
- response shaping,
- route-specific errors.

The domain service should own:

- DRE graph assembly,
- quality snapshot composition,
- graph topology and summary calculations,
- reusable testable pure helpers.

#### TUI Session Route and Prompt Extraction

Continue the existing layering direction:

- Pure session display transformations go into route-local view-model modules.
- Rendering components stay thin and consume precomputed models.
- State reducers and event projection stay in the headless runtime boundary where applicable.
- Prompt input helpers, history/frecency behavior, footer layout, and liveness rendering stay split by concern.

#### Session Prompt Runtime Extraction

Extract from `packages/ax-code/src/session/prompt.ts` only when a narrow behavior-preserving seam is available:

- prompt input normalization,
- autonomous continuation policy,
- tool result classification,
- lifecycle status transitions,
- provider response normalization.

Each extraction must keep existing tests passing before moving to the next seam.

#### LSP Surface Extraction

Split `packages/ax-code/src/lsp/index.ts` by concern:

- client lifecycle,
- server definition and launch policy,
- query/cache orchestration,
- permission and missing-server behavior,
- status and prewarm reporting.

Existing behavior for cache fallback must remain: cache failures should fall back to live LSP behavior rather than aborting operations.

#### SDK / Runtime Contract Cleanup

Replace relative imports from `packages/ax-code/src/sdk/programmatic.ts` into `packages/sdk/js/src/...` with explicit SDK exports or a small shared contract surface.

Preferred order:

1. Export required programmatic SDK types from `@ax-code/sdk/programmatic`.
2. Export required generated API types from stable SDK entry points.
3. Update runtime imports to package exports.
4. Re-evaluate whether the package manifest dependency cycle is still needed.

### API / Interface Changes

No user-facing API changes are intended.

No CLI command behavior changes are intended.

Any `@ax-code/ui` export moves must preserve existing import paths or provide compatibility re-exports.

SDK export additions are allowed only to remove deep source imports and should be semver-compatible.

## Alternatives Considered

### Alternative 1: Split `packages/ax-code` Into Many Workspace Packages

- Description: Create new packages such as `@ax-code/runtime`, `@ax-code/quality`, `@ax-code/lsp`, or `@ax-code/server`.
- Pros: Strong package-level ownership and dependency enforcement.
- Cons: High import churn, packaging risk, release complexity, and unclear seams while large files still mix concerns.
- Why not chosen: Current package-level guardrails pass; internal boundary hardening is lower risk and more immediately useful.

### Alternative 2: Only Add Guardrails, No Reorganization

- Description: Keep files in place and only prevent future growth.
- Pros: Lowest short-term risk.
- Cons: Does not reduce existing large-file maintenance cost or interface-layer domain drift.
- Why not chosen: Existing hotspots are already large enough to slow reviews and changes.

### Alternative 3: Move More UI Into `packages/ui`

- Description: Shift TUI components or terminal UI state into the shared UI package.
- Pros: Could reduce `packages/ax-code/src/cli/cmd/tui` size.
- Cons: Violates the current runtime/UI separation and risks tying shared UI to OpenTUI-specific runtime behavior.
- Why not chosen: `packages/ui` should remain shared visual infrastructure, not runtime agent state.

## Implementation Plan

### Phase 1: Structure Metrics and Guardrails

- [ ] Add or extend structure reporting for file-size thresholds and hotspot growth.
- [ ] Add workspace package dependency cycle reporting.
- [ ] Add detection for runtime imports from SDK source paths.
- [ ] Keep existing debt as warnings or allowlisted entries.
- [ ] Verify with `bun run script/structure.ts`.

### Phase 2: UI Component Grouping

- [ ] Define target folders under `packages/ui/src/components`.
- [ ] Move a small first batch of primitive components with compatibility re-exports.
- [ ] Move message/session/file-specific components in separate small batches.
- [ ] Update exports only when necessary.
- [ ] Run `pnpm --dir packages/ui run typecheck`.

### Phase 3: DRE Graph Route Domain Extraction

- [ ] Extract pure graph and quality summary helpers from `server/routes/dre-graph.ts`.
- [ ] Keep the route as request/response glue.
- [ ] Add focused unit tests for extracted helpers.
- [ ] Verify server route tests that cover DRE graph behavior.

### Phase 4: TUI Session Route and Prompt Hotspot Reduction

- [ ] Extract remaining pure display transformations from the TUI session route.
- [ ] Add or extend route view-model tests.
- [ ] Extract one behavior-preserving seam from `session/prompt.ts`.
- [ ] Verify targeted session and TUI tests before any second extraction.

### Phase 5: LSP Surface Cleanup

- [ ] Extract query/cache orchestration from `lsp/index.ts`.
- [ ] Extract lifecycle/status policy only if tests can pin behavior.
- [ ] Preserve live fallback behavior on cache failures.
- [ ] Run targeted LSP tests.

### Phase 6: SDK / Runtime Contract Cleanup

- [ ] Export required programmatic and generated types from stable SDK entry points.
- [ ] Replace runtime relative imports into SDK source paths.
- [ ] Re-run SDK OpenAPI validation and package typechecks.
- [ ] Decide whether the manifest dependency cycle remains necessary.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Import churn breaks package consumers | Medium | Medium | Preserve exports and move in small batches |
| Guardrails block unrelated work because of existing debt | Medium | Medium | Start with warnings or explicit allowlists for known hotspots |
| UI grouping breaks Storybook or package exports | Medium | Medium | Use compatibility re-exports and run UI typecheck |
| Route extraction changes DRE graph behavior | Medium | High | Extract pure helpers first and add snapshot/contract tests |
| Session prompt extraction changes agent loop behavior | Medium | High | Extract one narrow seam at a time and run targeted session tests |
| SDK contract cleanup creates circular import/runtime load issues | Medium | High | Prefer type-only exports and stable SDK entry points |

## Testing Strategy (TDD)

### Test Cases (write these first)

| # | Test Name | Input | Expected Output | Type |
|---|-----------|-------|-----------------|------|
| 1 | structure reports package cycles | package manifests with a cycle | report includes the cycle path | unit |
| 2 | structure reports direct SDK source imports | source file importing `../../../sdk/js/src/...` | report includes the offending import | unit |
| 3 | structure keeps existing boundary checks | current repository | no `@ax-code/ui` runtime violation | integration |
| 4 | UI compatibility export remains stable | existing import path | resolves to moved component | typecheck |
| 5 | DRE graph helper preserves output | representative DRE graph inputs | same graph summary as current route path | unit |
| 6 | TUI session view model is renderer-free | view-model imports | no Solid/OpenTUI imports | guardrail |
| 7 | LSP cache failure fallback remains live | cache query failure with available server | operation falls back instead of aborting | unit/integration |
| 8 | SDK runtime imports use public exports | runtime SDK entry file | no relative SDK source imports | guardrail |

### Test Files to Create

- `script/structure.test.ts` or an equivalent script test harness for new structure checks.
- `packages/ui/src/components/<group>/compat.test.ts` if compatibility re-exports need runtime checks.
- `packages/ax-code/test/server/dre-graph-domain.test.ts` for extracted DRE graph helpers.
- `packages/ax-code/test/cli/tui-session-view-model.test.ts` for extracted TUI session models.
- `packages/ax-code/test/lsp/index.test.ts` or narrower LSP module tests for fallback behavior.
- `packages/ax-code/test/sdk/programmatic-contract.test.ts` for public SDK contract import behavior if needed.

### Coverage Goals

- Guardrail coverage for dependency and import boundary checks.
- Focused pure-helper coverage for DRE graph and TUI session transformations.
- Regression coverage for LSP fallback behavior.
- Typecheck coverage for UI export compatibility and SDK contract exports.

### Existing Tests to Verify

- `bun run script/structure.ts`
- `cd packages/ax-code && bun run check:tui-layering`
- `cd packages/ax-code && bun run typecheck`
- `cd packages/ax-code && bun test <targeted session/tui/server/lsp tests>`
- `pnpm --dir packages/ui run typecheck`
- `pnpm --dir packages/sdk/js run validate:openapi`

## Dependencies

- No new external packages are expected.
- Internal modules affected:
  - `script/structure.ts`
  - `packages/ui/src/components/**`
  - `packages/ui/package.json`
  - `packages/ax-code/src/server/routes/dre-graph.ts`
  - `packages/ax-code/src/quality/**`
  - `packages/ax-code/src/cli/cmd/tui/routes/session/**`
  - `packages/ax-code/src/session/prompt.ts`
  - `packages/ax-code/src/lsp/**`
  - `packages/ax-code/src/sdk/programmatic.ts`
  - `packages/sdk/js/src/**`
- Breaking changes to existing APIs are not planned.

## Success Criteria

- The structure report passes with no package boundary violations.
- New guardrail output identifies hotspot growth and SDK/runtime source-import violations.
- `packages/ui/src/components` has fewer direct files and stable compatibility exports.
- `server/routes/dre-graph.ts` is materially smaller and routes domain work through a reusable service/helper module.
- TUI session route and prompt hotspots shrink through behavior-preserving extractions.
- Runtime code no longer imports SDK source files through relative `../../../sdk/js/src/...` paths, or a documented transitional exception exists with an owner and removal target.
- Targeted typecheck and tests pass for each phase before the next phase begins.
