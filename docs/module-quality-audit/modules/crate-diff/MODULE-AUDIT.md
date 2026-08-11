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
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
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

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `79cb75558b80f2b3` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=12 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
