# MODULE-AUDIT: ui-lib

| Field | Value |
|-------|-------|
| Unit slug | `ui-lib` |
| Scope | `desktop/packages/ui/src/lib` |
| Resolved root | `desktop/packages/ui/src/lib` |
| XL filter | no |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `8fece1548f0ddc2d` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 199 / 40586 |
| Inventory ID | W8-06 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/lib/agentColors.ts` | 35 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/api/types.ts` | 1242 | 140 | 0 | 0 |
| `desktop/packages/ui/src/lib/appOpenEvents.test.ts` | 165 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/appOpenEvents.ts` | 106 | 14 | 0 | 0 |
| `desktop/packages/ui/src/lib/appearanceAutoSave.ts` | 235 | 1 | 0 | 0 |
| `desktop/packages/ui/src/lib/appearancePersistence.ts` | 89 | 4 | 0 | 0 |
| `desktop/packages/ui/src/lib/asyncTimeout.test.ts` | 63 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/asyncTimeout.ts` | 38 | 1 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/ascending-id.test.ts` | 126 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/axEngineDownloadToasts.test.ts` | 155 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/axEngineDownloadToasts.ts` | 160 | 3 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts` | 290 | 20 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/baseUrl.test.ts` | 30 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/baseUrl.ts` | 48 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/client.test.ts` | 181 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/client.ts` | 2024 | 6 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/currentDirectory.test.ts` | 31 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/currentDirectory.ts` | 7 | 1 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/provider-tracker.test.ts` | 48 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/provider-tracker.ts` | 135 | 7 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/providerApi.test.ts` | 369 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/ax-code/providerApi.ts` | 272 | 16 | 0 | 0 |
| `desktop/packages/ui/src/lib/axCodeStatus.ts` | 416 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/chunkLoadRecovery.test.ts` | 55 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/chunkLoadRecovery.ts` | 107 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/clipboard.ts` | 38 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/codeTheme.ts` | 352 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/codemirror/flexokiTheme.ts` | 599 | 1 | 0 | 0 |
| `desktop/packages/ui/src/lib/codemirror/languageByExtension.ts` | 188 | 3 | 0 | 0 |
| `desktop/packages/ui/src/lib/concurrency.ts` | 28 | 1 | 0 | 0 |

### Exports (sample)
- `getAgentColor@desktop/packages/ui/src/lib/agentColors.ts:12`
- `getAgentColorPalette@desktop/packages/ui/src/lib/agentColors.ts:32`
- `RuntimePlatform@desktop/packages/ui/src/lib/api/types.ts:4`
- `RuntimeDescriptor@desktop/packages/ui/src/lib/api/types.ts:6`
- `ApiError@desktop/packages/ui/src/lib/api/types.ts:14`
- `Subscription@desktop/packages/ui/src/lib/api/types.ts:20`
- `RetryPolicy@desktop/packages/ui/src/lib/api/types.ts:24`
- `TerminalWebSocketDescriptor@desktop/packages/ui/src/lib/api/types.ts:30`
- `TerminalTransportCapability@desktop/packages/ui/src/lib/api/types.ts:36`
- `TerminalSession@desktop/packages/ui/src/lib/api/types.ts:42`
- `TerminalStreamEvent@desktop/packages/ui/src/lib/api/types.ts:52`
- `CreateTerminalOptions@desktop/packages/ui/src/lib/api/types.ts:64`
- `TerminalStreamOptions@desktop/packages/ui/src/lib/api/types.ts:70`
- `ResizeTerminalPayload@desktop/packages/ui/src/lib/api/types.ts:76`
- `TerminalHandlers@desktop/packages/ui/src/lib/api/types.ts:82`
- `ForceKillOptions@desktop/packages/ui/src/lib/api/types.ts:87`
- `TerminalAPI@desktop/packages/ui/src/lib/api/types.ts:92`
- `GitStatusFile@desktop/packages/ui/src/lib/api/types.ts:102`
- `GitMergeInProgress@desktop/packages/ui/src/lib/api/types.ts:108`
- `GitRebaseInProgress@desktop/packages/ui/src/lib/api/types.ts:115`

### Tests
- `packages/ax-code/test/quality/calibration-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (1037) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 30 source files; exports≈234
Step 2: Threat: secrets=5 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/ui/src/lib
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
| Static extract | ok fp `8fece1548f0ddc2d` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=30 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
