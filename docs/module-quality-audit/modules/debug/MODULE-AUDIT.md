# MODULE-AUDIT: debug

| Field | Value |
|-------|-------|
| Unit slug | `debug` |
| Scope | `packages/ax-code/src/debug` |
| Resolved root | `packages/ax-code/src/debug` |
| XL filter | no |
| Wave / effort | Wave 5 / S |
| Risk tags | quality |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `96d519412c50da39` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 1 / 394 |
| Inventory ID | W5-17 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/debug/diagnostic-log.ts` | 394 | 10 | 0 | 0 |

### Exports (sample)
- `DiagnosticLog@packages/ax-code/src/debug/diagnostic-log.ts:65`
- `enabled@packages/ax-code/src/debug/diagnostic-log.ts:66`
- `dir@packages/ax-code/src/debug/diagnostic-log.ts:70`
- `configure@packages/ax-code/src/debug/diagnostic-log.ts:74`
- `record@packages/ax-code/src/debug/diagnostic-log.ts:127`
- `flush@packages/ax-code/src/debug/diagnostic-log.ts:157`
- `recordProcess@packages/ax-code/src/debug/diagnostic-log.ts:161`
- `installProcessDiagnostics@packages/ax-code/src/debug/diagnostic-log.ts:181`
- `redactReplayEvent@packages/ax-code/src/debug/diagnostic-log.ts:199`
- `redactForLog@packages/ax-code/src/debug/diagnostic-log.ts:256`

### Tests
- `packages/ax-code/test/cli/debug-agent.test.ts`
- `packages/ax-code/test/cli/debug-explain.test.ts`
- `packages/ax-code/test/cli/debug-perf.test.ts`
- `packages/ax-code/test/cli/debug-replay.test.ts`
- `packages/ax-code/test/cli/mcp-debug.test.ts`
- `packages/ax-code/test/debug/diagnostic-log.test.ts`
- `packages/ax-code/test/debug-engine/debug-engine.test.ts`
- `packages/ax-code/test/debug-engine/diagnostic-correlation.test.ts`
- `packages/ax-code/test/debug-engine/incremental.test.ts`
- `packages/ax-code/test/debug-engine/language-scan.test.ts`
- `packages/ax-code/test/debug-engine/native-scan.test.ts`
- `packages/ax-code/test/debug-engine/pattern-memory.test.ts`
- `packages/ax-code/test/debug-engine/phase2-3.test.ts`
- `packages/ax-code/test/debug-engine/prewarm-lsp.test.ts`
- `packages/ax-code/test/debug-engine/query.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (10) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags quality | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 1 source files; exports≈10
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/debug
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
| Static extract | ok fp `96d519412c50da39` |
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
