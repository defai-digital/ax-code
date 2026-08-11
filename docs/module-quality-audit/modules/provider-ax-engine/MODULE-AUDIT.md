# MODULE-AUDIT: provider-ax-engine

| Field | Value |
|-------|-------|
| Unit slug | `provider-ax-engine` |
| Scope | `packages/ax-code/src/provider/ax-engine` |
| Resolved root | `packages/ax-code/src/provider/ax-engine` |
| XL filter | no |
| Wave / effort | Wave 5 / L |
| Risk tags | hot-path |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | codex-sol |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `7b8fda0396a9494e` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 20 / 4483 |
| Inventory ID | W5-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/ax-engine/catalog.ts` | 256 | 9 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/connection.ts` | 164 | 12 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/constants.ts` | 196 | 38 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/delete.ts` | 193 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/dependency.ts` | 139 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/download-job.ts` | 180 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/download-progress.ts` | 182 | 13 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/hf-cache.ts` | 147 | 7 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/index.ts` | 19 | 0 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/install.ts` | 316 | 9 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/lifecycle.ts` | 123 | 6 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/model-cache.ts` | 868 | 22 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/model-card.ts` | 137 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/paths.ts` | 38 | 18 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/platform.ts` | 168 | 12 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/prepare.ts` | 113 | 4 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/provider-loader.ts` | 359 | 3 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/python.ts` | 66 | 2 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/server.ts` | 657 | 12 | 0 | 0 |
| `packages/ax-code/src/provider/ax-engine/status.ts` | 162 | 12 | 0 | 0 |

### Exports (sample)
- `AxEngineModelFitState@packages/ax-code/src/provider/ax-engine/catalog.ts:17`
- `AxEngineModelFitState@packages/ax-code/src/provider/ax-engine/catalog.ts:28`
- `AxEngineModelFit@packages/ax-code/src/provider/ax-engine/catalog.ts:30`
- `AxEngineModelCatalogEntry@packages/ax-code/src/provider/ax-engine/catalog.ts:39`
- `AxEngineCatalogMeta@packages/ax-code/src/provider/ax-engine/catalog.ts:56`
- `AxEngineModelsResponse@packages/ax-code/src/provider/ax-engine/catalog.ts:63`
- `selectCurrentAxEngineModelJobs@packages/ax-code/src/provider/ax-engine/catalog.ts:78`
- `evaluateAxEngineModelFit@packages/ax-code/src/provider/ax-engine/catalog.ts:87`
- `getAxEngineModelsCatalog@packages/ax-code/src/provider/ax-engine/catalog.ts:193`
- `AX_ENGINE_CONNECTION_MODES@packages/ax-code/src/provider/ax-engine/connection.ts:5`
- `AxEngineConnectMode@packages/ax-code/src/provider/ax-engine/connection.ts:6`
- `AxEngineConnectionOptions@packages/ax-code/src/provider/ax-engine/connection.ts:8`
- `normalizeAxEngineEndpointBaseURL@packages/ax-code/src/provider/ax-engine/connection.ts:24`
- `resolveAxEngineConnectMode@packages/ax-code/src/provider/ax-engine/connection.ts:50`
- `resolveAxEngineAttachBaseURL@packages/ax-code/src/provider/ax-engine/connection.ts:58`
- `axEngineEndpointsMayAlias@packages/ax-code/src/provider/ax-engine/connection.ts:80`
- `axEngineManagedProviderConfig@packages/ax-code/src/provider/ax-engine/connection.ts:91`
- `axEngineAttachProviderConfig@packages/ax-code/src/provider/ax-engine/connection.ts:106`
- `AxEngineConnectionProbe@packages/ax-code/src/provider/ax-engine/connection.ts:120`
- `probeAxEngineConnection@packages/ax-code/src/provider/ax-engine/connection.ts:126`

### Tests
- `packages/ax-code/test/cli/providers.test.ts`
- `packages/ax-code/test/cli/tui/c-dialog-provider-auth-errors.test.ts`
- `packages/ax-code/test/cli/tui/dialog-provider-options.test.ts`
- `packages/ax-code/test/debug-engine/debug-engine.test.ts`
- `packages/ax-code/test/debug-engine/diagnostic-correlation.test.ts`
- `packages/ax-code/test/debug-engine/incremental.test.ts`
- `packages/ax-code/test/debug-engine/language-scan.test.ts`
- `packages/ax-code/test/debug-engine/native-scan.test.ts`
- `packages/ax-code/test/debug-engine/pattern-memory.test.ts`
- `packages/ax-code/test/debug-engine/phase2-3.test.ts`
- `packages/ax-code/test/debug-engine/prewarm-lsp.test.ts`
- `packages/ax-code/test/debug-engine/query.test.ts`
- `packages/ax-code/test/debug-engine/runtime-debug.test.ts`
- `packages/ax-code/test/debug-engine/scanner-utils.test.ts`
- `packages/ax-code/test/debug-engine/verify-after-fix.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (195) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 20 source files; exports≈217
Step 2: Threat: secrets=7 files, processRisk=2 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: hot-path unit — checked unbounded patterns in read files
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for packages/ax-code/src/provider/ax-engine
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
| Static extract | ok fp `7b8fda0396a9494e` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=20 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
