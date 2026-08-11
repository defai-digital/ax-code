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
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
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

Step 1: Mapped 2 source files; exports≈10
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/id
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
| Reviewer | implementer | 2026-08-11 | filesRead=2 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
