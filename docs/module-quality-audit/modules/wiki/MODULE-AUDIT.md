# MODULE-AUDIT: wiki

| Field | Value |
|-------|-------|
| Unit slug | `wiki` |
| Scope | `packages/ax-code/src/wiki` |
| Resolved root | `packages/ax-code/src/wiki` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `eb24d2e2edb1209f` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 3 / 250 |
| Inventory ID | W5-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/wiki/config.ts` | 61 | 3 | 0 | 0 |
| `packages/ax-code/src/wiki/index.ts` | 4 | 0 | 0 | 0 |
| `packages/ax-code/src/wiki/native.ts` | 185 | 3 | 0 | 0 |

### Exports (sample)
- `WikiRuntimeConfig@packages/ax-code/src/wiki/config.ts:5`
- `resolveWikiRuntimeConfig@packages/ax-code/src/wiki/config.ts:35`
- `engineConfig@packages/ax-code/src/wiki/config.ts:49`
- `gitHeadCommit@packages/ax-code/src/wiki/native.ts:100`
- `planNativeWiki@packages/ax-code/src/wiki/native.ts:133`
- `runNativeWiki@packages/ax-code/src/wiki/native.ts:144`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 3 source files; exports≈9
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/wiki
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
| Static extract | ok fp `eb24d2e2edb1209f` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=3 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
