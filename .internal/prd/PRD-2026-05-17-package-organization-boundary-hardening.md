# PRD: Package Organization Boundary Hardening

**Date:** 2026-05-17
**Status:** Active - guardrails, SDK cleanup, DRE graph extraction, manifest-cycle cleanup, and first UI grouping slice implemented
**Author:** ax-code agent

---

## Executive Summary

The workspace package layout is directionally correct and does not need a broad package split in the next implementation wave. The current risk is internal boundary erosion: large interface-heavy files and a flat shared UI component surface that make ownership harder to reason about.

This PRD hardens package organization in small, reviewable slices:

1. Keep package boundaries visible through structure guardrails.
2. Reduce large interface surfaces by extracting domain and view-model logic.
3. Group shared UI components by concern while preserving compatibility exports.
4. Replace runtime imports from SDK source paths with stable package exports.
5. Resolve or document workspace manifest dependency cycles.

Several slices are already complete. The remaining work should focus on continuing UI component grouping, TUI/session prompt hotspot reduction, and LSP surface cleanup.

## Current Evidence

Verified against the current checkout on 2026-05-17:

- `bun run script/structure.ts` exits successfully.
- Structure guardrails report no `@ax-code/ui` runtime dependency violations.
- Structure guardrails report no raw cross-package `src` imports.
- Structure guardrails report `SDK Runtime Source Imports` as OK.
- Structure guardrails report no workspace package manifest cycles.
- Structure guardrails report `packages/ui/src/components` with 131 direct source files, 9 child folders, and 163 total source files.
- Structure guardrails report 73 files above 500 lines and 32 files above 800 lines.
- Current largest package-boundary hotspots include:
  - `packages/ax-code/src/session/prompt.ts`: about 3,200 lines.
  - `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx`: about 3,000 lines.
  - `packages/ax-code/src/lsp/index.ts`: about 2,100 lines.
  - `packages/ax-code/src/quality/model-registry.ts`: about 2,700 lines.
- `packages/ax-code/src/server/routes/dre-graph.ts` has already been reduced to request/response glue and page composition, about 212 lines.

## Implementation Snapshot

### Completed: Phase 1 Structure Visibility

- `script/structure.ts` reports runtime imports that reach directly into SDK source files.
- `script/structure.ts` reports workspace package manifest dependency cycles.
- `script/structure.ts` separates hotspot threshold reporting from the general hotspot summary.
- Existing package cycles and 800+ line files are warnings so known debt is visible without blocking unrelated CI.
- `packages/ax-code/test/script/root-structure-script.test.ts` verifies that the root structure script emits boundary-hardening sections and exits successfully with known warnings.

### In Progress: Phase 2 UI Component Grouping

- Moved the first low-risk status batch under `packages/ui/src/components/status/`.
- Removed root-level compatibility re-export files for `animated-number`, `progress`, `progress-circle`, `spinner`, and `tag`.
- Preserved old public imports such as `@ax-code/ui/spinner` through exact package exports.
- Moved the matching status stories and CSS next to their grouped components.
- Updated internal relative imports to use `./status/*`.
- Verified `pnpm --dir packages/ui run typecheck`.
- Verified package export resolution from the `@ax-code/ui` package context with `import.meta.resolve()`.

### Completed: Phase 3 DRE Graph Route Extraction

The original DRE graph route hotspot has been materially reduced. Route-heavy parsing, formatting, page sections, scripts, styles, widgets, fingerprints, activity summaries, rollback rendering, and index rendering now live under `packages/ax-code/src/quality/`.

The completed extraction includes focused tests for:

- `dre-graph-activity-section`
- `dre-graph-activity`
- `dre-graph-assets`
- `dre-graph-branch-section`
- `dre-graph-changes-section`
- `dre-graph-fingerprint`
- `dre-graph-format`
- `dre-graph-index-page`
- `dre-graph-quality-readiness`
- `dre-graph-risk-section`
- `dre-graph-rollback`
- `dre-graph-style`
- `dre-graph-summary-section`
- `dre-graph-timeline`
- `dre-graph-validation-section`
- `dre-graph-verdict-section`
- `dre-graph-widgets`

The route now owns:

- HTTP route registration.
- Query and parameter validation.
- Session context loading.
- Cache and content-type headers.
- Response body selection.

Remaining DRE work is optional and should be triggered only if the route grows again or route-level composition becomes hard to review.

### Completed: Phase 6 SDK Source-Import Cleanup

- `packages/ax-code/src/sdk/programmatic.ts` imports generated API types through `@ax-code/sdk/v2/client`.
- Programmatic SDK types and errors come from `@ax-code/sdk/programmatic`.
- Runtime code no longer imports SDK source files through relative `packages/sdk/js/src` paths.

### Completed: Phase 7 Workspace Manifest Dependency Cycle Cleanup

- The `@ax-code/sdk -> ax-code` manifest edge was classified as a dynamic runtime load used only by the programmatic SDK entrypoint.
- The SDK no longer declares a hard package dependency on `ax-code`; this avoids the manifest cycle while preserving the dynamic runtime boundary.
- `packages/sdk/js/src/programmatic/agent.ts` reports a clear actionable error when `createAgent()` is called without a resolvable `ax-code` runtime.
- `packages/sdk/js/README.md` documents that in-process `createAgent()` needs a compatible host runtime, while `@ax-code/sdk/http` remains the service-boundary path.

## Problem Statement

The current workspace package roles are broadly correct, but several package-internal surfaces have grown large enough to weaken ownership boundaries and reviewability.

The package-level boundary is not the immediate problem. Current structure checks already confirm that runtime packages do not import `@ax-code/ui` and that raw cross-package `src` imports are absent. The remaining debt is concentrated in package-internal organization:

- Large runtime files mix multiple concerns.
- TUI route files still combine rendering, state projection, and display transformations.
- LSP behavior is centralized in a large module that spans lifecycle, cache, query, permission, and status policy.
- `packages/ui/src/components` still has a large flat direct-file surface despite existing grouped folders.
- Workspace package manifest cycles have been removed.

Without a phased boundary-hardening plan, future feature work will keep landing in interface-heavy files and make eventual package splits more expensive.

## Goals

- Preserve the current workspace package roles while improving internal ownership boundaries.
- Move domain-heavy behavior out of server routes, CLI commands, and TUI components into domain or view-model modules.
- Group shared UI components by concern without breaking public exports.
- Keep SDK/runtime contracts on stable package exports.
- Make hotspot growth and package dependency cycles visible in guardrail output.
- Keep workspace package manifests acyclic or document any future exception before merging it.

## Non-Goals

- Do not perform a broad split of `packages/ax-code` into many workspace packages in this PRD.
- Do not move terminal-specific OpenTUI code into `packages/ui`.
- Do not change public SDK APIs except for compatibility-preserving exports.
- Do not rewrite the LSP layer in Rust without measurement.
- Do not treat internal planning files as product-facing docs.

## Package Roles

- `packages/ax-code`: runtime, CLI, TUI, server, session engine, tool orchestration, storage, providers, and runtime logic.
- `packages/ui`: shared visual components, content rendering, icons, styles, and UI-only helpers.
- `packages/sdk/js`: JavaScript SDK and generated OpenAPI clients.
- `packages/plugin`: plugin contracts and plugin-facing helpers.
- `packages/util`: narrow shared helpers.
- Integration packages and native addon packages remain supporting surfaces.

## Technical Design

### Structure Guardrails

Keep `script/structure.ts` as the first visibility surface. It should continue to report:

- File-size thresholds above 500 and 800 lines.
- Hotspot direct-file counts.
- Workspace package dependency cycles.
- Runtime imports from SDK source paths.
- Raw cross-package `src` imports.
- Runtime imports of `@ax-code/ui`.
- Unexpected root folders and legacy root folders.

Current known hotspots should remain warnings until each phase introduces a stricter, phase-specific guardrail. New guardrails should avoid blocking unrelated work because of existing debt.

### UI Component Grouping

Use the existing `packages/ui/src/components` grouping scheme as the default taxonomy instead of introducing a competing folder model.

Existing folders to extend:

- `actions`
- `forms`
- `layout`
- `navigation`
- `overlay`
- `status`
- `app-icons`
- `file-icons`
- `provider-icons`

Additional folders may be introduced only when they reduce ambiguity:

- `content`: markdown, diff, line comments, media previews.
- `message`: message parts, message files, message navigation.
- `session`: session review, session graph, session insights, rollback, retry, and compare UI.
- `file`: file search, file media, file SSR, and file display helpers that do not belong under icon-only folders.

Compatibility rules:

- Preserve `@ax-code/ui/*` direct import paths through existing files or compatibility re-exports.
- Update `packages/ui/package.json` exports only when a new grouped path must be public.
- Keep component-local CSS and stories with the moved component.
- Move small batches and run `pnpm --dir packages/ui run typecheck` after each batch.

### TUI Session Route and Prompt Extraction

Continue the existing route view-model direction:

- Pure session display transformations belong in route-local view-model modules.
- Rendering components should consume precomputed models.
- State reducers and event projection should stay in the headless runtime boundary when they are not renderer-specific.
- Prompt input helpers, history/frecency behavior, footer layout, and liveness rendering should stay split by concern.

Candidate seams:

- Message grouping and coalescing.
- Tool-part display classification.
- Usage and compaction summaries.
- Permission and question display models.
- Autonomous activity and liveness summaries.
- Prompt history and frecency helpers.

### Session Prompt Runtime Extraction

Extract from `packages/ax-code/src/session/prompt.ts` only when a narrow behavior-preserving seam is available.

Candidate seams:

- Prompt input normalization.
- Autonomous continuation policy.
- Tool result classification.
- Lifecycle status transitions.
- Provider response normalization.
- Retry and repair envelope shaping.

Each extraction must keep existing tests passing before moving to the next seam.

### LSP Surface Cleanup

Split `packages/ax-code/src/lsp/index.ts` by concern:

- Client lifecycle.
- Server definition and launch policy.
- Query and cache orchestration.
- Permission and missing-server behavior.
- Status and prewarm reporting.

Preserve the existing reliability rule: cache failures in `tool.lsp` should fall back to live LSP behavior rather than aborting the operation.

### SDK and Runtime Contract Cleanup

Runtime code should import SDK contracts through package exports, not relative paths into `packages/sdk/js/src`.

The SDK source-import cleanup is complete for the current checkout. The previous manifest cycle was resolved by removing the SDK's hard dependency on the runtime package and treating the in-process runtime as a dynamic host requirement.

## Implementation Plan

### Phase 1: Structure Metrics and Guardrails - Complete

- [x] Add or extend structure reporting for file-size thresholds and hotspot growth.
- [x] Add workspace package dependency cycle reporting.
- [x] Add detection for runtime imports from SDK source paths.
- [x] Keep existing debt as warnings or allowlisted entries.
- [x] Verify with `bun run script/structure.ts`.

Exit state:

- Structure script exits successfully.
- Known debt is visible as warnings.
- No package boundary violation is hidden behind the broader hotspot report.

### Phase 2: UI Component Grouping - In Progress

- [x] Classify current direct component files into existing UI folders before creating new folders.
- [x] Move a first low-risk status batch with compatibility package exports.
- [ ] Move content and message-specific files in separate batches.
- [ ] Move file/provider/session-specific files only after the target folder contract is clear.
- [x] Preserve existing `@ax-code/ui/*` import paths for the moved status batch.
- [x] Run `pnpm --dir packages/ui run typecheck` after the first batch.

Exit criteria:

- `packages/ui/src/components` direct source-file count continues to shrink from the original 140.
- Existing public imports continue to typecheck.
- Moved CSS and stories stay colocated with their components.

### Phase 3: DRE Graph Route Domain Extraction - Complete

- [x] Extract pure graph, formatting, activity, risk, verdict, validation, branch, rollback, style, asset, and index helpers from `server/routes/dre-graph.ts`.
- [x] Keep the route focused on request parsing, context loading, headers, and response writing.
- [x] Add focused unit tests for extracted helpers.
- [x] Preserve route-level integration coverage for DRE graph behavior.

Exit state:

- `packages/ax-code/src/server/routes/dre-graph.ts` is no longer a large hotspot.
- DRE graph behavior is covered primarily through `packages/ax-code/test/quality/dre-graph*.test.ts`.

### Phase 4: TUI Session Route and Prompt Hotspot Reduction - Pending

- [ ] Extract one renderer-free display/view-model seam from the TUI session route.
- [ ] Add or extend route view-model tests.
- [ ] Run `cd packages/ax-code && bun run check:tui-layering`.
- [ ] Extract one behavior-preserving seam from `session/prompt.ts`.
- [ ] Run targeted session and prompt tests before any second extraction.

Exit criteria:

- At least one TUI session route concern moves out of the 3,000-line route file.
- At least one session prompt concern moves out of `session/prompt.ts`.
- New modules have focused tests and do not import Solid or OpenTUI unless they are renderer modules.

### Phase 5: LSP Surface Cleanup - Pending

- [ ] Extract query/cache orchestration from `lsp/index.ts`.
- [ ] Extract lifecycle/status policy only after tests pin behavior.
- [ ] Preserve live fallback behavior on cache failures.
- [ ] Run targeted LSP tests.

Exit criteria:

- `lsp/index.ts` delegates at least one major concern to a named module.
- Cache failure fallback remains covered by tests.
- Missing-server and no-server conditions remain checked before prompting for LSP permission.

### Phase 6: SDK Source Import Cleanup - Complete

- [x] Export required programmatic SDK types from stable SDK entry points.
- [x] Export required generated API types from stable SDK entry points.
- [x] Replace runtime relative imports into SDK source paths.
- [x] Verify `script/structure.ts` reports SDK runtime source imports as OK.

Exit state:

- Runtime code imports SDK contracts through package exports.
- No transitional exception is required for SDK source imports in the current checkout.

### Phase 7: Workspace Manifest Dependency Cycle Cleanup - Complete

- [x] Classify each edge in `@ax-code/plugin -> @ax-code/sdk -> ax-code -> @ax-code/plugin`.
- [x] Classify each edge in `@ax-code/sdk -> ax-code -> @ax-code/sdk`.
- [x] Move type-only contracts to a stable package export or narrower contract module if needed.
- [x] Remove unnecessary runtime dependencies.
- [x] If a cycle is intentionally retained, document the owner, reason, and removal trigger in this PRD or a follow-up ADR.
- [x] Verify with `bun run script/structure.ts`.

Exit state:

- Structure output reports no workspace manifest cycles.
- The SDK programmatic entrypoint preserves the dynamic load of `ax-code/sdk/programmatic`.
- Missing runtime resolution fails with a clear install/service-boundary error.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Import churn breaks package consumers | Medium | Medium | Preserve exports and use compatibility re-exports |
| Guardrails block unrelated work because of existing debt | Medium | Medium | Start with warnings and make stricter checks phase-specific |
| UI grouping creates competing taxonomies | Medium | Medium | Extend existing folders first and introduce new folders only with clear contracts |
| TUI extraction changes rendering behavior | Medium | High | Extract renderer-free view models first and keep route tests targeted |
| Session prompt extraction changes agent loop behavior | Medium | High | Extract one narrow seam at a time and run targeted session tests |
| LSP extraction breaks fallback behavior | Medium | High | Pin cache-failure fallback before moving orchestration |
| Manifest-cycle cleanup creates runtime loading issues | Medium | High | Classify dependency edges before changing manifests |

## Testing Strategy

### Guardrail Tests

- `bun run script/structure.ts`
- `packages/ax-code/test/script/root-structure-script.test.ts`

Expected behavior:

- The script exits successfully.
- Boundary sections are present.
- SDK runtime source imports are OK.
- Package cycles are absent.

### UI Grouping Tests

- `pnpm --dir packages/ui run typecheck`
- Optional compatibility tests for moved public components when a re-export is non-trivial.

Expected behavior:

- Existing public import paths continue to resolve.
- Grouped component paths typecheck.
- Stories and CSS imports stay valid.

### DRE Graph Tests

- `cd packages/ax-code && bun test test/quality/dre-graph*.test.ts`
- Existing route-level DRE graph tests, when touched.

Expected behavior:

- Extracted helpers preserve escaping, formatting, summaries, fingerprints, and section rendering behavior.
- Route-level tests continue to cover request/response integration.

### TUI and Prompt Tests

- `cd packages/ax-code && bun run check:tui-layering`
- Targeted tests under `packages/ax-code/test/cli/tui/**`.
- Targeted tests under `packages/ax-code/test/session/**`.

Expected behavior:

- View-model modules stay renderer-free.
- Prompt behavior remains unchanged for the extracted seam.

### LSP Tests

- Targeted tests under `packages/ax-code/test/lsp/**`.
- Add or extend fallback tests before moving query/cache orchestration.

Expected behavior:

- Cache failure falls back to live LSP behavior.
- Missing-file and no-server conditions do not prompt for permission prematurely.

### SDK and Manifest Tests

- `pnpm --dir packages/sdk/js run validate:openapi`
- `cd packages/ax-code && bun run typecheck`
- `bun run script/structure.ts`

Expected behavior:

- SDK contract exports remain stable.
- Runtime SDK source imports stay absent.
- Manifest cycles are absent.

## Dependencies

No new external packages are expected.

Internal modules affected:

- `script/structure.ts`
- `packages/ui/src/components/**`
- `packages/ui/package.json`
- `packages/ax-code/src/cli/cmd/tui/routes/session/**`
- `packages/ax-code/src/session/prompt.ts`
- `packages/ax-code/src/lsp/**`
- `packages/ax-code/src/sdk/programmatic.ts`
- `packages/sdk/js/src/**`
- Workspace package manifests that participate in the remaining cycles.

## Success Criteria

This PRD is complete when:

- `bun run script/structure.ts` exits successfully.
- Runtime package boundary violations remain absent.
- SDK runtime source imports remain absent.
- Workspace package manifest cycles are absent, or any future exception is documented with owner, reason, and removal trigger before merging.
- `packages/ui/src/components` direct source-file count is materially reduced from the original 140 while preserving public import compatibility.
- `packages/ax-code/src/server/routes/dre-graph.ts` remains below hotspot thresholds and owns only route-level responsibilities.
- TUI session route, session prompt, and LSP hotspots each shrink through at least one behavior-preserving extraction.
- Each completed phase records the targeted validation command that passed.

## Next Best Slice

The next best implementation slice is the second Phase 2 UI grouping batch. The status batch reduced the direct source-file count from 140 to 131, but `packages/ui/src/components` still has a large flat direct-file surface.

Recommended first task:

1. Pick either the content batch (`markdown`, `diff-changes`, `line-comment`, `image-preview`) or the message batch (`message-*`) after checking internal relative imports.
2. Move a small low-risk batch with compatibility package exports.
3. Run `pnpm --dir packages/ui run typecheck`.
4. Update this PRD with the direct-file count after the batch.
