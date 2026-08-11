# MODULE-AUDIT: crate-bench

| Field | Value |
|-------|-------|
| Unit slug | `crate-bench` |
| Scope | `crates/ax-code-bench` |
| Resolved root | `crates/ax-code-bench` |
| XL filter | no |
| Wave / effort | Wave 9 / S |
| Risk tags | quality |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `6a6a711feb1d8614` |
| Protocol marker | pending dual-agent 9-step |
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

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6a6a711feb1d8614` |
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
