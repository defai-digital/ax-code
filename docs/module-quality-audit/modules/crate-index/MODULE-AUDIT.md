# MODULE-AUDIT: crate-index

| Field | Value |
|-------|-------|
| Unit slug | `crate-index` |
| Scope | `crates/ax-code-index` |
| Resolved root | `crates/ax-code-index` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native, performance |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `3091293e58882ee7` |
| Protocol marker | agent-protocol.json complete |
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

Step 1: Mapped 13 source files; exports≈0
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: hot-path unit — checked unbounded patterns in read files
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for crates/ax-code-index
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3091293e58882ee7` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | implementer | 2026-08-11 | filesRead=13 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
