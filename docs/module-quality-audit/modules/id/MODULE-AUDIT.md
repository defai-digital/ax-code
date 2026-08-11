# MODULE-AUDIT: id

| Field | Value |
|-------|-------|
| Unit slug | `id` |
| Scope | `packages/ax-code/src/id` |
| Resolved root | `packages/ax-code/src/id` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `ff3dc8ac14a29c04` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 2 / 165 |
| Inventory ID | W4-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/id/branded.ts` | 46 | 3 | 0 | 0 |
| `packages/ax-code/src/id/id.ts` | 119 | 7 | 0 | 0 |

### Exports (sample)
- `BrandedIdentifier@packages/ax-code/src/id/branded.ts:7`
- `defineBrandedIdentifier@packages/ax-code/src/id/branded.ts:11`
- `defineBrandedString@packages/ax-code/src/id/branded.ts:34`
- `Identifier@packages/ax-code/src/id/id.ts:5`
- `Prefix@packages/ax-code/src/id/id.ts:34`
- `schema@packages/ax-code/src/id/id.ts:36`
- `ascending@packages/ax-code/src/id/id.ts:46`
- `descending@packages/ax-code/src/id/id.ts:50`
- `create@packages/ax-code/src/id/id.ts:83`
- `timestamp@packages/ax-code/src/id/id.ts:105`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (10) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ff3dc8ac14a29c04` |
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
| Reviewer | codex-sol | 2026-08-11 | filesRead=17 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
