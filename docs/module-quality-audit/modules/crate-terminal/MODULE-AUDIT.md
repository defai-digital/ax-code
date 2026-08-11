# MODULE-AUDIT: crate-terminal

| Field | Value |
|-------|-------|
| Unit slug | `crate-terminal` |
| Scope | `crates/ax-code-terminal` |
| Resolved root | `crates/ax-code-terminal` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native, stability |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `83a62bb627268d97` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 944 |
| Inventory ID | W9-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-terminal/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-terminal/src/lib.rs` | 938 | 0 | 0 | 0 |

### Exports (sample)
- none

### Tests
- `packages/ax-code/test/cli/tui/terminal-cleanup.test.ts`
- `packages/ax-code/test/cli/tui/terminal-suspend.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (0) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native,stability | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 2 source files; exports≈0
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=AUDIT-crate-terminal-001.md
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for crates/ax-code-terminal
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-crate-terminal-001 | stability | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `83a62bb627268d97` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=2 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
