# ADR-009: Harden Package Organization Boundaries Before Splitting Packages

## Status

Accepted - implemented by `.internal/archive/prd/PRD-2026-05-17-package-organization-boundary-hardening.md` on 2026-05-17

## Date

2026-05-17

## Deciders

To be filled by team

## Related

- `.internal/archive/prd/PRD-2026-05-17-package-organization-boundary-hardening.md`
- `script/structure.ts`
- `packages/ax-code/ARCHITECTURE.md`
- `packages/ui/ARCHITECTURE.md`
- `packages/sdk/js/ARCHITECTURE.md`
- `.internal/architecture/repo-structure.md`

## Context

The repository is a pnpm workspace monorepo with clear shipped package roles:

- `packages/ax-code` owns the product runtime, CLI, TUI, server, session engine, tool orchestration, storage, providers, and runtime logic.
- `packages/ui` owns shared visual components and UI-only helpers.
- `packages/sdk/js` owns the JavaScript SDK and generated OpenAPI clients.
- `packages/plugin`, `packages/util`, and integration packages provide narrower supporting surfaces.
- Rust native addon packages expose optional accelerators with JavaScript fallbacks.

The current structure guardrail already validates the most important package-level rule: runtime and integration packages must not depend on `@ax-code/ui`, and package users should avoid raw cross-package `src` imports. A current review found no package boundary violations from `script/structure.ts`, and the TUI layering guardrail also passed.

The main maintainability risk is not the top-level package map. The risk is that several package-internal surfaces are too large and too interface-heavy:

- `packages/ax-code/src/session/prompt.ts` is over 3,000 lines and mixes prompt assembly, lifecycle coordination, autonomous continuation, and tool/result handling.
- `packages/ax-code/src/cli/cmd/tui/routes/session/index.tsx` is over 3,000 lines and remains a high-pressure TUI composition surface.
- `packages/ax-code/src/server/routes/dre-graph.ts` is over 2,600 lines and carries domain-heavy DRE graph behavior inside a route file.
- `packages/ax-code/src/lsp/index.ts` is over 2,000 lines and mixes LSP lifecycle, cache/query orchestration, server policy, and status behavior.
- `packages/ui/src/components` still has many direct files, even though the UI architecture already asks new components to be grouped by concern.

There is also a contract smell between `ax-code` and `@ax-code/sdk`: the package manifests currently depend on each other, and `packages/ax-code/src/sdk/programmatic.ts` reaches into SDK source types with relative deep imports. This has not created a structure-check failure, but it weakens the long-term runtime/SDK boundary.

## Decision

Do not split `packages/ax-code` into many new workspace packages as the first step.

Instead, harden the existing package boundaries and reorganize package-internal folders around clear domain and interface ownership:

1. Keep the current workspace package roles.
2. Treat `packages/ax-code` as the runtime package, but keep routes, CLI commands, and TUI files as thin interface adapters.
3. Move domain-heavy behavior out of `server/routes`, `cli/cmd`, and large TUI route files into existing domain folders before creating any new package.
4. Group `packages/ui/src/components` by concern while preserving public exports.
5. Replace SDK/runtime deep source imports with explicit exported contracts.
6. Add structure guardrails that prevent new hotspots and make package manifest dependency cycles visible.

## Policy

### Package-Level Boundaries

- `packages/ax-code` must not depend on `@ax-code/ui`.
- `packages/ui` may depend on `@ax-code/sdk` and `@ax-code/util`, but runtime-specific state or agent execution logic must stay out of UI.
- `packages/sdk/js` should expose consumer-facing contracts through package exports, not require runtime code to import SDK source files by relative path.
- Native addon packages stay narrow and optional; JavaScript fallback behavior remains in the runtime package.

### Runtime Internal Boundaries

- Server routes validate inputs, bind HTTP contracts, and call domain services.
- CLI commands parse flags, wire logging/output, and call domain services.
- TUI components compose state and rendering; pure state reducers, view models, projection logic, and formatting should live outside component bodies.
- Domain folders such as `session`, `quality`, `lsp`, `runtime`, `project`, `provider`, `permission`, and `tool` own reusable behavior.

### Guardrails

The repository should grow guardrails before broad file movement:

- Warn on new or expanded files above the review threshold.
- Fail or warn on new 800+ line files unless explicitly allowed.
- Track direct-file count in `packages/ui/src/components`.
- Detect workspace dependency cycles.
- Continue checking raw cross-package `src` imports and `@ax-code/ui` runtime dependency violations.

## Consequences

### Positive

- Maintains current build, packaging, and release assumptions.
- Improves maintainability without high-risk import churn across many packages.
- Keeps domain extraction close to existing tests and ownership boundaries.
- Preserves public package exports while allowing internal folder cleanup.
- Makes future package splits evidence-based instead of speculative.

### Negative / Costs

- Some very large files will remain temporarily while phased extraction lands.
- Guardrails may initially report known debt rather than fail the build.
- Keeping `packages/ax-code` as the runtime package means the package is still broad by design.
- SDK/runtime contract cleanup may require careful export compatibility work.

## Implementation Outcome

The related PRD completed the decision in bounded, behavior-preserving slices:

- Structure guardrails now report hotspot thresholds, SDK runtime source imports, and workspace manifest dependency cycles.
- Shared UI components were grouped by concern while preserving existing public import paths.
- DRE graph route behavior moved out of the server route and into quality-domain helpers.
- TUI session route and session prompt hotspots each gained a focused renderer-free or pure-helper extraction.
- LSP cache orchestration moved into a named `lsp/cache.ts` module while preserving live fallback behavior on cache failures.
- Runtime SDK imports now use stable package exports, and workspace package manifest cycles are absent in structure output.

The decision remains to harden package-internal boundaries before considering broader workspace package splits. Future lifecycle/status cleanup in LSP should be tracked as a separate PRD only after behavior-specific tests identify a narrow seam.

## Alternatives Considered

### Split `packages/ax-code` Into Many Workspace Packages Now

This could create strong package-level ownership, but it would introduce high import churn, packaging complexity, and release risk before the internal domain seams are clean. The current evidence does not justify this as the first step because existing package-level structure checks pass.

### Leave Structure As-Is

This avoids churn, but it lets large files and interface-layer drift continue. The file-size evidence shows maintainability debt is already material.

### Move All UI Code Into `packages/ui`

This would blur the distinction between shared product UI and terminal/runtime-specific TUI behavior. `packages/ax-code` must remain independent from `@ax-code/ui`, and terminal-specific rendering should stay in the runtime package unless a stable renderer-neutral contract is defined.

## Follow-Up Status

The related PRD implemented the required follow-up in low-risk phases:

1. Completed: add structure metrics and guardrails for known hotspots.
2. Completed: group shared UI components without breaking exports.
3. Completed: extract DRE graph route domain logic into quality-domain helpers.
4. Completed: reduce TUI session route and prompt component size through view-model and pure-helper extraction.
5. Completed: clarify SDK/runtime contract exports and remove relative SDK source imports from runtime code.

## Non-Decisions

This ADR does not choose a future package split for `quality`, `lsp`, `runtime`, or `server`.

This ADR does not require moving OpenTUI-specific TUI code into `packages/ui`.

This ADR does not change public SDK APIs.

This ADR does not replace existing ADRs for headless runtime, server operation mode, or agent control-plane boundaries.

## Acceptance Criteria

- `script/structure.ts` continues to pass.
- TUI layering guardrails continue to pass.
- New structure metrics make hotspot growth visible.
- No package-level `@ax-code/ui` dependency is introduced into runtime or integration packages.
- SDK/runtime deep source imports are replaced with exported contracts or a documented transitional exception.
