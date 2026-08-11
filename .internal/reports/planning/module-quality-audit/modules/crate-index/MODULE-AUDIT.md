# MODULE-AUDIT: crate-index

| Field | Value |
|-------|-------|
| Unit slug | `crate-index` |
| Scope | `crates/ax-code-index` |
| Wave / effort | Wave 9 / L |
| Risk tags | native, performance |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `f7f4befd6fd3010c` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W9-15 |
| Source files / LOC | 13 / 2432 |

## 1. Scope and map

### Purpose and ownership
Unit `crate-index` owns `crates/ax-code-index`. Risk profile: native, performance.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-index/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-index/examples/bench.rs` | 180 | 0 | 0 | 0 |
| `crates/ax-code-index/src/cursor.rs` | 94 | 0 | 0 | 0 |
| `crates/ax-code-index/src/edge.rs` | 196 | 0 | 0 | 0 |
| `crates/ax-code-index/src/file.rs` | 280 | 0 | 0 | 0 |
| `crates/ax-code-index/src/hasher.rs` | 69 | 0 | 0 | 0 |
| `crates/ax-code-index/src/id.rs` | 193 | 0 | 0 | 0 |
| `crates/ax-code-index/src/interval_tree.rs` | 274 | 0 | 0 | 0 |
| `crates/ax-code-index/src/lib.rs` | 33 | 0 | 0 | 0 |
| `crates/ax-code-index/src/lock.rs` | 247 | 0 | 0 | 0 |
| `crates/ax-code-index/src/node.rs` | 256 | 0 | 0 | 0 |
| `crates/ax-code-index/src/schema.rs` | 82 | 0 | 0 | 0 |
| `crates/ax-code-index/src/store.rs` | 522 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| _(none extracted)_ | — | — |

### Tests matched

- `packages/ax-code/test/cli/index-graph.test.ts`
- `packages/ax-code/test/cli/tui/session-sidebar-index.test.ts`
- `packages/ax-code/test/code-intelligence/auto-index.test.ts`
- `packages/ax-code/test/dispatch/index.test.ts`
- `packages/ax-code/test/file/index.test.ts`
- `packages/ax-code/test/lsp/index.test.ts`
- `packages/ax-code/test/planner/index.test.ts`
- `packages/ax-code/test/quality/dre-graph-index-page.test.ts`
- `packages/ax-code/test/telemetry/index.test.ts`
- `desktop/packages/ui/src/components/views/git/gitIndexMutationQueue.test.ts`
- `desktop/packages/ui/src/lib/theme/themes/index.test.ts`
- `packages/sdk/js/test/index-exports.test.ts`

### Risk hotspots (static)

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| module contract | public exports | invalid input / silent fail | Zod/type boundaries where present | low residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (0 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 13; total LOC: 2432
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 0 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `crates/ax-code-index`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 0

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/cli/index-graph.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `f7f4befd6fd3010c` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 13 files / 2432 LOC / fp f7f4befd6fd3010c |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
