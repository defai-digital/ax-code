# MODULE-AUDIT: crate-bench

| Field | Value |
|-------|-------|
| Unit slug | `crate-bench` |
| Scope | `crates/ax-code-bench` |
| Resolved root | `crates/ax-code-bench` |
| XL filter | no |
| Wave / effort | Wave 9 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `6a6a711feb1d8614` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 748 |
| Inventory ID | W9-21 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-bench/src/bench_diff.rs` | 209 | 0 | 0 | 0 |
| `crates/ax-code-bench/src/bench_fs.rs` | 259 | 0 | 0 | 0 |
| `crates/ax-code-bench/src/bench_index.rs` | 280 | 0 | 0 | 0 |

### Exports (sample)
- none

### Tests
- `packages/ax-code/test/script/bench-scripts.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| `AUDIT-crate-bench-001` | correctness | Medium | new | deferred |
| `AUDIT-crate-bench-002` | correctness | Low | new | deferred |
| `AUDIT-crate-bench-003` | quality | Low | new | deferred |

Deferred items have owner, rationale, mitigation, and expiry 2026-09-11 in `findings/AUDIT-crate-bench-00N.md`.

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6a6a711feb1d8614` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=10 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
