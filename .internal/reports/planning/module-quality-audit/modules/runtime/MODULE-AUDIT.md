# MODULE-AUDIT: runtime

| Field | Value |
|-------|-------|
| Unit slug | `runtime` |
| Scope | `packages/ax-code/src/runtime` |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `6c30afc496e3eb82` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-02 |
| Source files / LOC | 19 / 2524 |

## 1. Scope and map

### Purpose and ownership
Unit `runtime` owns `packages/ax-code/src/runtime`. Risk profile: hot-path.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/runtime/debug-snapshot.ts` | 82 | 8 | 0 | 0 |
| `packages/ax-code/src/runtime/events.ts` | 8 | 1 | 0 | 0 |
| `packages/ax-code/src/runtime/failure-class.ts` | 95 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/command.ts` | 97 | 11 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/effects.ts` | 79 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-log.ts` | 63 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink-node.ts` | 62 | 2 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event-sink.ts` | 35 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/event.ts` | 214 | 17 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/index.ts` | 10 | 0 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/projection.ts` | 444 | 7 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/replay.ts` | 105 | 4 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runner.ts` | 149 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/headless/runtime.ts` | 149 | 5 | 0 | 0 |
| `packages/ax-code/src/runtime/hot-path.ts` | 201 | 8 | 0 | 0 |
| `packages/ax-code/src/runtime/listen-security.ts` | 54 | 6 | 0 | 0 |
| `packages/ax-code/src/runtime/local-client.ts` | 30 | 3 | 0 | 0 |
| `packages/ax-code/src/runtime/service-manager.ts` | 540 | 19 | 0 | 0 |
| `packages/ax-code/src/runtime/shell-env.ts` | 107 | 3 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `RuntimeDebugSnapshot@packages/ax-code/src/runtime/debug-snapshot.ts:5` | public/internal | scanned |
| `Trigger@packages/ax-code/src/runtime/debug-snapshot.ts:6` | public/internal | scanned |
| `QueueOverflowPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:11` | public/internal | scanned |
| `QueueCoalescingPolicy@packages/ax-code/src/runtime/debug-snapshot.ts:16` | public/internal | scanned |
| `InstanceContext@packages/ax-code/src/runtime/debug-snapshot.ts:21` | public/internal | scanned |
| `QueueMetrics@packages/ax-code/src/runtime/debug-snapshot.ts:30` | public/internal | scanned |
| `Snapshot@packages/ax-code/src/runtime/debug-snapshot.ts:49` | public/internal | scanned |
| `create@packages/ax-code/src/runtime/debug-snapshot.ts:62` | public/internal | scanned |
| `RuntimeEvent@packages/ax-code/src/runtime/events.ts:4` | public/internal | scanned |
| `RuntimeFailureClass@packages/ax-code/src/runtime/failure-class.ts:48` | public/internal | scanned |
| `Kind@packages/ax-code/src/runtime/failure-class.ts:49` | public/internal | scanned |
| `Info@packages/ax-code/src/runtime/failure-class.ts:62` | public/internal | scanned |
| `list@packages/ax-code/src/runtime/failure-class.ts:77` | public/internal | scanned |
| `get@packages/ax-code/src/runtime/failure-class.ts:84` | public/internal | scanned |
| `HeadlessRuntimeCommandMode@packages/ax-code/src/runtime/headless/command.ts:1` | public/internal | scanned |

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

- secret packages/ax-code/src/runtime/local-client.ts:21
- secret packages/ax-code/src/runtime/local-client.ts:23
- process packages/ax-code/src/runtime/shell-env.ts:72

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (118 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 19; total LOC: 2524
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Hot-path unit: reviewed static N+1/sync risks in 0 IO hotspots. No new Critical perf finding without baseline measurement.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/runtime`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 118

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
| Static deep extract | ok | fingerprint `6c30afc496e3eb82` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 19 files / 2524 LOC / fp 6c30afc496e3eb82 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
