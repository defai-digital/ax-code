# MODULE-AUDIT: stats

| Field | Value |
|-------|-------|
| Unit slug | `stats` |
| Scope | `packages/ax-code/src/stats` |
| Resolved root | `packages/ax-code/src/stats` |
| XL filter | no |
| Wave / effort | Wave 4 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `3ae11814f6d8f232` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 147 |
| Inventory ID | W4-08 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/stats/breakdown.ts` | 110 | 4 | 0 | 0 |
| `packages/ax-code/src/stats/index.ts` | 3 | 0 | 0 | 0 |
| `packages/ax-code/src/stats/types.ts` | 34 | 4 | 0 | 0 |

### Exports (sample)
- `estimateTokens@packages/ax-code/src/stats/breakdown.ts:11`
- `calculateBreakdown@packages/ax-code/src/stats/breakdown.ts:15`
- `getStatus@packages/ax-code/src/stats/breakdown.ts:44`
- `formatBreakdown@packages/ax-code/src/stats/breakdown.ts:51`
- `TokenUsage@packages/ax-code/src/stats/types.ts:5`
- `ContextBreakdown@packages/ax-code/src/stats/types.ts:13`
- `ContextStatus@packages/ax-code/src/stats/types.ts:23`
- `ContextReport@packages/ax-code/src/stats/types.ts:25`

### Tests
- `packages/ax-code/test/cli/stats.test.ts`
- `packages/ax-code/test/stats/breakdown.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 3 source files; exports≈10
Step 2: Threat: secrets=3 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/stats
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
| Static extract | ok fp `3ae11814f6d8f232` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=3 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
