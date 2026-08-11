# MODULE-AUDIT: native

| Field | Value |
|-------|-------|
| Unit slug | `native` |
| Scope | `packages/ax-code/src/native` |
| Resolved root | `packages/ax-code/src/native` |
| XL filter | no |
| Wave / effort | Wave 3 / M |
| Risk tags | native, stability |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `9545076be4e6cbef` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 88 |
| Inventory ID | W3-12 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/native/addon.ts` | 88 | 6 | 0 | 0 |

### Exports (sample)
- `formatNativeAddonLoadError@packages/ax-code/src/native/addon.ts:43`
- `NativeAddon@packages/ax-code/src/native/addon.ts:67`
- `fs@packages/ax-code/src/native/addon.ts:69`
- `diff@packages/ax-code/src/native/addon.ts:74`
- `index@packages/ax-code/src/native/addon.ts:79`
- `parser@packages/ax-code/src/native/addon.ts:84`

### Tests
- `packages/ax-code/test/code-intelligence/native-store.test.ts`
- `packages/ax-code/test/code-intelligence/query-native-dispatch.test.ts`
- `packages/ax-code/test/debug-engine/native-scan.test.ts`
- `packages/ax-code/test/native/addon.test.ts`
- `packages/ax-code/test/perf/native.test.ts`
- `packages/ax-code/test/util/native-json.test.ts`
- `packages/ax-code/test/visual/native.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (6) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags native,stability | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 1 source files; exports≈6
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/native
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
| Static extract | ok fp `9545076be4e6cbef` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=1 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
