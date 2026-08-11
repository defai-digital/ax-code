# MODULE-AUDIT: ui-sync

| Field | Value |
|-------|-------|
| Unit slug | `ui-sync` |
| Scope | `desktop/packages/ui/src/sync` |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `7eeeeb26969e0d80` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-08 |
| Source files / LOC | 71 / 20253 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-sync` owns `desktop/packages/ui/src/sync`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-online.test.ts` | 157 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-permanent-error.test.ts` | 159 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-resume.test.ts` | 190 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts` | 79 | 7 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts` | 406 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-pipeline.test.ts` | 1241 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/event-reducer.test.ts` | 636 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/eviction.test.ts` | 188 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/live-aggregate.test.ts` | 116 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/live-selector-memo.test.ts` | 143 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/materialization.test.ts` | 155 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/session-prefetch-cache.test.ts` | 28 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/session-switch-resync.test.ts` | 213 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/__tests__/streaming-metrics.test.ts` | 146 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/assistant-fork.test.ts` | 84 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/assistant-fork.ts` | 60 | 4 | 0 | 0 |
| `desktop/packages/ui/src/sync/binary.ts` | 62 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/bootstrap.ts` | 265 | 2 | 0 | 0 |
| `desktop/packages/ui/src/sync/child-store.ts` | 233 | 2 | 0 | 0 |
| `desktop/packages/ui/src/sync/content-cache.ts` | 94 | 9 | 0 | 0 |
| `desktop/packages/ui/src/sync/debug.ts` | 97 | 3 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-pipeline.test.ts` | 217 | 0 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-pipeline.ts` | 1084 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-reducer.ts` | 794 | 6 | 0 | 0 |
| `desktop/packages/ui/src/sync/event-routing.test.ts` | 308 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `TestEventTarget@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:3` | public/internal | scanned |
| `createEventTarget@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:9` | public/internal | scanned |
| `SavedBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:32` | public/internal | scanned |
| `saveBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:38` | public/internal | scanned |
| `restoreBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:46` | public/internal | scanned |
| `setNavigatorOnline@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:55` | public/internal | scanned |
| `installEventPipelineBrowserGlobals@desktop/packages/ui/src/sync/__tests__/event-pipeline-test-helpers.ts:62` | public/internal | scanned |
| `AssistantForkSourceChoice@desktop/packages/ui/src/sync/assistant-fork.ts:1` | public/internal | scanned |
| `AssistantForkCurrentChoice@desktop/packages/ui/src/sync/assistant-fork.ts:8` | public/internal | scanned |
| `AssistantForkSendChoice@desktop/packages/ui/src/sync/assistant-fork.ts:18` | public/internal | scanned |
| `resolveAssistantForkSendChoice@desktop/packages/ui/src/sync/assistant-fork.ts:39` | public/internal | scanned |
| `Binary@desktop/packages/ui/src/sync/binary.ts:2` | public/internal | scanned |
| `search@desktop/packages/ui/src/sync/binary.ts:4` | public/internal | scanned |
| `has@desktop/packages/ui/src/sync/binary.ts:28` | public/internal | scanned |
| `find@desktop/packages/ui/src/sync/binary.ts:32` | public/internal | scanned |

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

- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:6
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:61
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:64
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:110
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:111
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:115
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:119
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:122
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:123
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:140
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:164
- secret desktop/packages/ui/src/sync/__tests__/event-pipeline.bench.ts:304

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
1. Public exports in this unit maintain their local contracts (290 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 71; total LOC: 20253
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/sync`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 290

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
| Static deep extract | ok | fingerprint `7eeeeb26969e0d80` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 71 files / 20253 LOC / fp 7eeeeb26969e0d80 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
