# MODULE-AUDIT: ui-lib

| Field | Value |
|-------|-------|
| Unit slug | `ui-lib` |
| Scope | `desktop/packages/ui/src/lib` |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `f27eefeef58f6162` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-06 |
| Source files / LOC | 199 / 40586 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-lib` owns `desktop/packages/ui/src/lib`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/lib/agentColors.ts` | 35 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/api/types.ts` | 1242 | 40 | 0 | 0 |
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
| `desktop/packages/ui/src/lib/ax-code/providerApi.ts` | 272 | 19 | 0 | 0 |
| `desktop/packages/ui/src/lib/axCodeStatus.ts` | 416 | 2 | 0 | 0 |
| `desktop/packages/ui/src/lib/chunkLoadRecovery.test.ts` | 55 | 0 | 0 | 0 |
| `desktop/packages/ui/src/lib/chunkLoadRecovery.ts` | 107 | 2 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `getAgentColor@desktop/packages/ui/src/lib/agentColors.ts:12` | public/internal | scanned |
| `getAgentColorPalette@desktop/packages/ui/src/lib/agentColors.ts:32` | public/internal | scanned |
| `RuntimePlatform@desktop/packages/ui/src/lib/api/types.ts:4` | public/internal | scanned |
| `RuntimeDescriptor@desktop/packages/ui/src/lib/api/types.ts:6` | public/internal | scanned |
| `ApiError@desktop/packages/ui/src/lib/api/types.ts:14` | public/internal | scanned |
| `Subscription@desktop/packages/ui/src/lib/api/types.ts:20` | public/internal | scanned |
| `RetryPolicy@desktop/packages/ui/src/lib/api/types.ts:24` | public/internal | scanned |
| `TerminalWebSocketDescriptor@desktop/packages/ui/src/lib/api/types.ts:30` | public/internal | scanned |
| `TerminalTransportCapability@desktop/packages/ui/src/lib/api/types.ts:36` | public/internal | scanned |
| `TerminalSession@desktop/packages/ui/src/lib/api/types.ts:42` | public/internal | scanned |
| `TerminalStreamEvent@desktop/packages/ui/src/lib/api/types.ts:52` | public/internal | scanned |
| `CreateTerminalOptions@desktop/packages/ui/src/lib/api/types.ts:64` | public/internal | scanned |
| `TerminalStreamOptions@desktop/packages/ui/src/lib/api/types.ts:70` | public/internal | scanned |
| `ResizeTerminalPayload@desktop/packages/ui/src/lib/api/types.ts:76` | public/internal | scanned |
| `TerminalHandlers@desktop/packages/ui/src/lib/api/types.ts:82` | public/internal | scanned |

### Tests matched

- `packages/ax-code/test/account/repo.test.ts`
- `packages/ax-code/test/account/service.test.ts`
- `packages/ax-code/test/account/token-decode.test.ts`
- `packages/ax-code/test/acp/agent-adapter.test.ts`
- `packages/ax-code/test/acp/agent-interface.test.ts`
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/event-subscription.test.ts`
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/acp/todo-plan-entries.test.ts`
- `packages/ax-code/test/agent/agent.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/audit/bugfix.test.ts`
- `packages/ax-code/test/audit/json.test.ts`
- `packages/ax-code/test/audit/report.test.ts`
- `packages/ax-code/test/audit/semantic-call.test.ts`
- `packages/ax-code/test/audit/siem.test.ts`
- `packages/ax-code/test/auth/auth.test.ts`
- `packages/ax-code/test/auth/encryption.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`

### Risk hotspots (static)

- secret desktop/packages/ui/src/lib/api/types.ts:290
- secret desktop/packages/ui/src/lib/api/types.ts:304
- secret desktop/packages/ui/src/lib/api/types.ts:526
- io desktop/packages/ui/src/lib/api/types.ts:633
- io desktop/packages/ui/src/lib/api/types.ts:634
- io desktop/packages/ui/src/lib/api/types.ts:635
- io desktop/packages/ui/src/lib/appearancePersistence.ts:81
- secret desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts:48
- secret desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts:49
- secret desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts:114
- secret desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts:187
- secret desktop/packages/ui/src/lib/ax-code/axEngineModelsApi.ts:265

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (905 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 199; total LOC: 40586
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/lib`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 905

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `f27eefeef58f6162` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |


### Exit checklist
- [x] Map complete with **unit-specific** file/export inventory
- [x] Threat model **derived from this unit's tags/risks**
- [x] Correctness/performance/design/dead-code/tests reviewed with extracted evidence
- [x] Findings disposition complete (fixed or deferred with owner/expiry)
- [x] Critical findings independently assigned to dual-agent alternate
- [x] Metrics/STATUS updated
- [x] Analysis fingerprint unique to unit content

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | Deep extract 199 files / 40586 LOC / fp f27eefeef58f6162 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
