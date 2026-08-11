# MODULE-AUDIT: crate-parser

| Field | Value |
|-------|-------|
| Unit slug | `crate-parser` |
| Scope | `crates/ax-code-parser` |
| Resolved root | `crates/ax-code-parser` |
| XL filter | no |
| Wave / effort | Wave 9 / L |
| Risk tags | native |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `eb295bcd0ade51d1` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 908 |
| Inventory ID | W9-18 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `crates/ax-code-parser/build.rs` | 6 | 0 | 0 | 0 |
| `crates/ax-code-parser/src/lib.rs` | 902 | 1 | 0 | 0 |

### Exports (sample)
- `greet@crates/ax-code-parser/src/lib.rs:615`

### Tests
- `packages/ax-code/test/provider/cli/parser.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1) | static map |
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
| Static extract | ok fp `eb295bcd0ade51d1` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=4 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
