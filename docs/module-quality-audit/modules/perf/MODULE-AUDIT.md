# MODULE-AUDIT: perf

| Field | Value |
|-------|-------|
| Unit slug | `perf` |
| Scope | `packages/ax-code/src/perf` |
| Resolved root | `packages/ax-code/src/perf` |
| XL filter | no |
| Wave / effort | Wave 5 / M |
| Risk tags | performance |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `af45f12d6bc18352` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 186 |
| Inventory ID | W5-18 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/perf/native.ts` | 186 | 11 | 0 | 0 |

### Exports (sample)
- `NativePerfSnapshot@packages/ax-code/src/perf/native.ts:18`
- `NativePerf@packages/ax-code/src/perf/native.ts:75`
- `enabled@packages/ax-code/src/perf/native.ts:76`
- `run@packages/ax-code/src/perf/native.ts:80`
- `runAsync@packages/ax-code/src/perf/native.ts:97`
- `snapshot@packages/ax-code/src/perf/native.ts:112`
- `render@packages/ax-code/src/perf/native.ts:142`
- `flush@packages/ax-code/src/perf/native.ts:163`
- `install@packages/ax-code/src/perf/native.ts:169`
- `enable@packages/ax-code/src/perf/native.ts:177`
- `reset@packages/ax-code/src/perf/native.ts:182`

### Tests
- `packages/ax-code/test/cli/debug-perf.test.ts`
- `packages/ax-code/test/lsp/perf-sampler.test.ts`
- `packages/ax-code/test/perf/gate.test.ts`
- `packages/ax-code/test/perf/native.test.ts`
- `packages/ax-code/test/perf/report.test.ts`
- `packages/ax-code/test/perf/route-indicator-map.test.ts`
- `packages/ax-code/test/perf/sidebar-activity-recent.test.ts`
- `packages/ax-code/test/perf/sidebar-rollback-points.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (11) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags performance | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 1 source files; exports≈11
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: hot-path unit — checked unbounded patterns in read files
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/perf
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
| Static extract | ok fp `af45f12d6bc18352` |
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
