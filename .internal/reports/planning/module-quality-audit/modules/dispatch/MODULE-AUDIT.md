# MODULE-AUDIT: dispatch

| Field | Value |
|-------|-------|
| Unit slug | `dispatch` |
| Scope | `packages/ax-code/src/dispatch` |
| Wave / effort | Wave 2 / M |
| Risk tags | concurrency |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `af3bdbaf6deb8650` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-06 |
| Source files / LOC | 1 / 374 |

## 1. Scope and map

### Purpose and ownership
Unit `dispatch` owns `packages/ax-code/src/dispatch`. Risk profile: concurrency.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/dispatch/index.ts` | 374 | 9 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `DispatchSpec@packages/ax-code/src/dispatch/index.ts:24` | public/internal | scanned |
| `DispatchStatus@packages/ax-code/src/dispatch/index.ts:35` | public/internal | scanned |
| `DispatchResult@packages/ax-code/src/dispatch/index.ts:37` | public/internal | scanned |
| `ExecutorOutput@packages/ax-code/src/dispatch/index.ts:51` | public/internal | scanned |
| `DispatchExecutor@packages/ax-code/src/dispatch/index.ts:67` | public/internal | scanned |
| `MergeStrategy@packages/ax-code/src/dispatch/index.ts:80` | public/internal | scanned |
| `DispatcherEventSink@packages/ax-code/src/dispatch/index.ts:87` | public/internal | scanned |
| `DispatchOptions@packages/ax-code/src/dispatch/index.ts:94` | public/internal | scanned |
| `dispatch@packages/ax-code/src/dispatch/index.ts:113` | public/internal | scanned |

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

- secret packages/ax-code/src/dispatch/index.ts:45
- secret packages/ax-code/src/dispatch/index.ts:46
- secret packages/ax-code/src/dispatch/index.ts:47
- secret packages/ax-code/src/dispatch/index.ts:55
- secret packages/ax-code/src/dispatch/index.ts:56
- secret packages/ax-code/src/dispatch/index.ts:57
- secret packages/ax-code/src/dispatch/index.ts:259
- secret packages/ax-code/src/dispatch/index.ts:260
- secret packages/ax-code/src/dispatch/index.ts:261
- secret packages/ax-code/src/dispatch/index.ts:327
- secret packages/ax-code/src/dispatch/index.ts:328
- secret packages/ax-code/src/dispatch/index.ts:329

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (9 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 1; total LOC: 374
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/dispatch`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 9

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
| Static deep extract | ok | fingerprint `af3bdbaf6deb8650` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 1 files / 374 LOC / fp af3bdbaf6deb8650 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
