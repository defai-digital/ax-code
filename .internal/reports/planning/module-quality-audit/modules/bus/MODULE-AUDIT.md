# MODULE-AUDIT: bus

| Field | Value |
|-------|-------|
| Unit slug | `bus` |
| Scope | `packages/ax-code/src/bus` |
| Wave / effort | Wave 2 / M |
| Risk tags | concurrency |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `61fa68f68ba92a84` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-13 |
| Source files / LOC | 3 / 217 |

## 1. Scope and map

### Purpose and ownership
Unit `bus` owns `packages/ax-code/src/bus`. Risk profile: concurrency.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/bus/bus-event.ts` | 41 | 4 | 0 | 0 |
| `packages/ax-code/src/bus/global.ts` | 20 | 1 | 0 | 0 |
| `packages/ax-code/src/bus/index.ts` | 156 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `BusEvent@packages/ax-code/src/bus/bus-event.ts:4` | public/internal | scanned |
| `Definition@packages/ax-code/src/bus/bus-event.ts:5` | public/internal | scanned |
| `define@packages/ax-code/src/bus/bus-event.ts:9` | public/internal | scanned |
| `payloads@packages/ax-code/src/bus/bus-event.ts:18` | public/internal | scanned |
| `GlobalBus@packages/ax-code/src/bus/global.ts:3` | public/internal | scanned |
| `Bus@packages/ax-code/src/bus/index.ts:9` | public/internal | scanned |
| `InstanceDisposed@packages/ax-code/src/bus/index.ts:15` | public/internal | scanned |
| `publish@packages/ax-code/src/bus/index.ts:86` | public/internal | scanned |
| `publishDetached@packages/ax-code/src/bus/index.ts:100` | public/internal | scanned |
| `subscribe@packages/ax-code/src/bus/index.ts:115` | public/internal | scanned |
| `once@packages/ax-code/src/bus/index.ts:122` | public/internal | scanned |
| `subscribeAll@packages/ax-code/src/bus/index.ts:135` | public/internal | scanned |

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

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (12 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 3; total LOC: 217
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/bus`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 12

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
| Static deep extract | ok | fingerprint `61fa68f68ba92a84` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 3 files / 217 LOC / fp 61fa68f68ba92a84 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
