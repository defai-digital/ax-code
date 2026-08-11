# MODULE-AUDIT: crate-diff

| Field | Value |
|-------|-------|
| Unit slug | `crate-diff` |
| Scope | `crates/ax-code-diff` |
| Resolved root | `crates/ax-code-diff` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native |
| Status | REVIEWING |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `79cb75558b80f2b3` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 4 / 1359 |
| Inventory ID | W9-17 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-diff/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-diff/examples/bench.rs` | 154 | 0 | 0 | 0 |
| `crates/ax-code-diff/src/helpers.rs` | 576 | 0 | 0 | 0 |
| `crates/ax-code-diff/src/lib.rs` | 623 | 0 | 0 | 0 |

### Exports (sample)
- none

### Tests
- `packages/ax-code/test/cli/tui/k-diff-viewer-lcs-budget.test.ts`
- `packages/ax-code/test/quality/pr-diff.test.ts`
- `packages/ax-code/test/session/diff-recovery.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `79cb75558b80f2b3` |
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
