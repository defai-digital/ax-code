# ADR-001: Ship ratatui as the bundled renderer and keep OpenTUI rollback-only

**Status:** Partially Superseded (2026-04-25)
**Date:** 2026-04-23
**Deciders:** (to be filled by team)
**Supersedes:** None
**Superseded by (rendering decision):** ADR-003: Keep OpenTUI and Bun as the mainline runtime and harden them directly.

---

## Supersession Note (added 2026-04-25)

The ratatui migration described below was prototyped end-to-end and **rejected by users on UI/UX grounds**. The team evaluated and also rejected sidebar-only ratatui (the hybrid renderer cost — cursor/color/resize/mouse coordination plus dual maintenance surface — does not justify the partial benefit, and it does not solve the install-channel hangs that motivated this ADR's release-correctness goal).

Current strategic position (see `project_tui_migration_strategy.md` and ADR-002):

- **OpenTUI is the permanent rendering layer.** Hardening it is mainline investment, not bridge work.
- **The brew/npm install hang problem is solved by ADR-002 (source + bun distribution)**, not by replacing the renderer.
- The renderer-abstraction infrastructure listed below in "Context" (`renderer-decision.ts`, `renderer-contract.ts`, `performance-criteria.ts`) stays useful as a boundary for future renderer experiments, but the ratatui target itself is retired.

Sections of this ADR that are **still in force**:
- "Non-negotiable implementation guardrails" applies to *any* renderer migration, not just ratatui — keep it as a contract for future renderer work.
- "Alternatives Considered → Alternative 2: Stay on OpenTUI plus source launcher workaround" — this alternative has effectively been chosen (ADR-002 productionizes the source launcher), but for different reasons than originally weighed.

Sections that are **no longer in force**:
- The "Decision" section (ship ratatui, drop OpenTUI as bundled fallback) — reverted; OpenTUI is the only renderer.
- "Consequences" — most negative consequences (release pressure, dual-renderer maintenance) no longer apply.
- "Risks → Ratatui may not reach release quality" — moot; not shipping ratatui.

ADR-003 is now the authoritative rendering/runtime decision. This ADR remains as historical context and as a source of renderer guardrails that still apply to future experiments.

---

## Context

AX Code's current TUI depends on OpenTUI (`@opentui/core`, `@opentui/solid`) plus a Bun Worker bridge. The current TUI entrypoint is rooted in `packages/ax-code/src/cli/cmd/tui/thread.ts`, which spawns `worker.ts` and multiplexes fetch plus SSE through an internal transport. The worker path in `packages/ax-code/src/cli/cmd/tui/worker.ts` also owns reconnect logic and debug logging.

This renderer path has already forced product-level mitigation because bundled Bun binaries can hang in TUI startup and rendering paths. Keeping OpenTUI in the bundled runtime path means keeping the known risk in the shipped product.

The repo already contains strong evidence that a renderer migration must be treated as a real architecture decision, not an implementation detail:

- `packages/ax-code/src/cli/cmd/tui/renderer-decision.ts`
- `packages/ax-code/src/cli/cmd/tui/renderer-contract.ts`
- `packages/ax-code/src/cli/cmd/tui/performance-criteria.ts`
- `packages/ax-code/src/cli/cmd/tui/util/resilient-stream.ts`
- `packages/ax-code/src/cli/cmd/tui/util/request-headers.ts`
- `packages/ax-code/script/build.ts`
- `script/setup-cli.ts`

The current TUI is also much larger than a thin renderer layer. It has broad bootstrap orchestration in `packages/ax-code/src/cli/cmd/tui/context/sync-bootstrap-request.ts`, a large test surface under `packages/ax-code/test/cli/tui/`, and many product behaviors beyond simple transcript rendering.

At the same time, official ratatui, crossterm, and tokio guidance all point toward a stable set of best practices for a native terminal client:

- async event handling via a dedicated event task and channels
- a single input model instead of mixing crossterm APIs
- explicit terminal capability enable/disable handling
- graceful shutdown with coordinated task cancellation
- snapshot testing with `TestBackend`

## Decision

AX Code will ship `ratatui` as the only bundled/release TUI renderer for `v4.1.0`, and OpenTUI will not be kept as a bundled runtime fallback. OpenTUI may remain temporarily only as a source/dev or version-rollback asset during migration.

The approach is:

1. Keep the existing Bun server, HTTP routes, SSE model, auth behavior, and backend logic as the source of truth.
2. Add a new Rust crate, `crates/ax-code-tui`, as the shipped renderer path for bundled/release builds.
3. Treat OpenTUI as unsupported in bundled/release mode. If requested there, fail fast with clear messaging.
4. Allow additive, renderer-neutral projection routes only where they reduce fragile duplication of bootstrap/session orchestration.
5. Implement the Rust client as a single event/action/reducer/render pipeline, with explicit terminal lifecycle guards and graceful shutdown.
6. Use fixtures, contract tests, snapshot tests, and PTY smoke tests as migration gates.

This decision intentionally prefers release-path correctness over short-term comfort from a fallback that shares the same failure mode.

Non-negotiable implementation guardrails:

- one crossterm input model only; do not mix `EventStream` with `read/poll`
- one state writer only; external input, timers, and network updates become actions into a reducer
- no blocking network or filesystem work in render code
- terminal capability enable/disable must be centralized in a guard that also covers failure paths
- shutdown must coordinate child tasks explicitly rather than relying on process drop behavior
- version rollback is the rollback story for bundled users; renderer fallback is not

## Alternatives Considered

### Alternative 1: Keep OpenTUI as a bundled runtime fallback
- **Pros:** Lowers the immediate confidence threshold for the first ratatui release; creates an apparent escape hatch if ratatui launch fails.
- **Cons:** Preserves the same known risky runtime path in the shipped product; expands testing, packaging, support, and diagnostics complexity; can hide ratatui defects behind an unreliable fallback story.
- **Why not chosen:** A runtime fallback that shares the same known failure mode is not a real mitigation. Version rollback is safer and simpler.

### Alternative 2: Stay on OpenTUI plus source launcher workaround
- **Pros:** Lowest short-term implementation cost; avoids building a second renderer immediately.
- **Cons:** Does not solve bundled/offline/distribution risk; keeps AX Code dependent on Bun/OpenTUI runtime behavior for rendering; leaves a known product risk on the main path.
- **Why not chosen:** It does not remove the release-path risk that motivated the migration.

### Alternative 3: Full-parity big-bang rewrite in `v4.1.0`
- **Pros:** Simple narrative; avoids a temporary migration window.
- **Cons:** Unrealistic for the current TUI size and test surface; moves launch, sync, diagnostics, packaging, and parity risk at the same time.
- **Why not chosen:** Too much release risk for one minor version.

## Consequences

### Positive

- Bundled/release builds no longer ship the known OpenTUI runtime path.
- Support messaging becomes simpler: ratatui is the release path, rollback is a version concern.
- The migration is forced to use explicit contracts, fixtures, and release gates instead of relying on fallback optimism.
- The Rust client can be designed around stable terminal best practices from the start.

### Negative

- `v4.1.0` quality pressure is higher because there is no bundled runtime fallback.
- OpenTUI may still exist temporarily in source/dev, which means a short migration window with dual-renderer maintenance.
- Some functionality must be explicitly deferred from `v4.1.0` to keep the ratatui release scope realistic.

### Risks

- Ratatui may not reach release quality in time for `v4.1.0`.
  Mitigation: keep `v4.1.0` scope narrow, phase-gated, and tied to explicit go/no-go criteria.
- The Rust client may duplicate too much existing bootstrap and state orchestration.
  Mitigation: allow additive server-owned projection contracts where duplication would be fragile.
- Terminal lifecycle bugs could leave raw mode or capture modes enabled on failure.
  Mitigation: isolate terminal setup/cleanup in a guard module and test cleanup paths.
- Temporary OpenTUI escape hatches may linger too long.
  Mitigation: track migration-close criteria explicitly in the PRD and remove them after stability proof.

## Related

- [PRD: AX Code v4.1.0 - ratatui TUI Migration](../archive/prd/v4.1.0-ratatui-migration.md)
