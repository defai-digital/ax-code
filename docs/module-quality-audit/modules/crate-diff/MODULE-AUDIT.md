# MODULE-AUDIT: crate-diff

| Field | Value |
|-------|-------|
| Unit slug | `crate-diff` |
| Scope | `crates/ax-code-diff` |
| Resolved root | `crates/ax-code-diff` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `79cb75558b80f2b3` |
| Protocol marker | agent-protocol.json complete |
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

Step 1: Mapped 4 source files; exports≈0
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for crates/ax-code-diff
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
| Static extract | ok fp `79cb75558b80f2b3` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=4 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
