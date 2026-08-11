# MODULE-AUDIT: crate-index

| Field | Value |
|-------|-------|
| Unit slug | `crate-index` |
| Scope | `crates/ax-code-index` |
| Resolved root | `crates/ax-code-index` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native, performance |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `3091293e58882ee7` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 13 / 2432 |
| Inventory ID | W9-15 |

## 1. Scope and map

### Source inventory

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

### Exports (sample)
- none

### Tests
- `packages/ax-code/test/cli/index-graph.test.ts`
- `packages/ax-code/test/cli/tui/session-sidebar-index.test.ts`
- `packages/ax-code/test/code-intelligence/auto-index.test.ts`
- `packages/ax-code/test/dispatch/index.test.ts`
- `packages/ax-code/test/file/index.test.ts`
- `packages/ax-code/test/lsp/index.test.ts`
- `packages/ax-code/test/planner/index.test.ts`
- `packages/ax-code/test/quality/dre-graph-index-page.test.ts`
- `packages/ax-code/test/telemetry/index.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native,performance | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3091293e58882ee7` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
