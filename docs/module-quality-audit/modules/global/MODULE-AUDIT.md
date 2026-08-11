# MODULE-AUDIT: global

| Field | Value |
|-------|-------|
| Unit slug | `global` |
| Scope | `packages/ax-code/src/global` |
| Resolved root | `packages/ax-code/src/global` |
| XL filter | no |
| Wave / effort | Wave 4 / S |
| Risk tags | config |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `605e68731605c276` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 149 |
| Inventory ID | W4-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/global/index.ts` | 149 | 2 | 0 | 0 |

### Exports (sample)
- `Global@packages/ax-code/src/global/index.ts:37`
- `Path@packages/ax-code/src/global/index.ts:38`

### Tests
- `packages/ax-code/test/global/cache-cleanup.test.ts`
- `packages/ax-code/test/project/migrate-global.test.ts`
- `packages/ax-code/test/server/global-capabilities.test.ts`
- `packages/ax-code/test/server/global-config.test.ts`
- `packages/ax-code/test/server/global-session-list.test.ts`
- `packages/ax-code/test/support/test-globals.d.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (2) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags config | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 1 source files; exports≈2
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/global
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
| Static extract | ok fp `605e68731605c276` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=1 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
