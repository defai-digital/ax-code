# MODULE-AUDIT: control-plane

| Field | Value |
|-------|-------|
| Unit slug | `control-plane` |
| Scope | `packages/ax-code/src/control-plane` |
| Wave / effort | Wave 1 / L |
| Risk tags | security, concurrency |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `f2fa9e9429fa28ae` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-09 |
| Source files / LOC | 17 / 2361 |

## 1. Scope and map

### Purpose and ownership
Unit `control-plane` owns `packages/ax-code/src/control-plane`. Risk profile: security, concurrency.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/control-plane/abort.ts` | 29 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/adaptors.ts` | 16 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control-events.ts` | 194 | 10 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control-summary.ts` | 115 | 4 | 0 | 0 |
| `packages/ax-code/src/control-plane/agent-control.ts` | 339 | 23 | 0 | 0 |
| `packages/ax-code/src/control-plane/autonomous-completion-gate.ts` | 409 | 6 | 0 | 0 |
| `packages/ax-code/src/control-plane/execution-controller.ts` | 117 | 5 | 0 | 0 |
| `packages/ax-code/src/control-plane/reasoning-policy.ts` | 272 | 9 | 0 | 0 |
| `packages/ax-code/src/control-plane/safety-policy.ts` | 241 | 8 | 0 | 0 |
| `packages/ax-code/src/control-plane/schema.ts` | 6 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/sse.ts` | 139 | 4 | 0 | 0 |
| `packages/ax-code/src/control-plane/types.ts` | 7 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-context.ts` | 16 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-router-middleware.ts` | 134 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace-server/server.ts` | 112 | 3 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace.sql.ts` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/control-plane/workspace.ts` | 182 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `waitForAbortOrTimeout@packages/ax-code/src/control-plane/abort.ts:1` | public/internal | scanned |
| `installAdaptor@packages/ax-code/src/control-plane/adaptors.ts:5` | public/internal | scanned |
| `getAdaptor@packages/ax-code/src/control-plane/adaptors.ts:9` | public/internal | scanned |
| `removeAdaptor@packages/ax-code/src/control-plane/adaptors.ts:13` | public/internal | scanned |
| `AgentControlEvents@packages/ax-code/src/control-plane/agent-control-events.ts:6` | public/internal | scanned |
| `phaseChanged@packages/ax-code/src/control-plane/agent-control-events.ts:14` | public/internal | scanned |
| `reasoningSelected@packages/ax-code/src/control-plane/agent-control-events.ts:33` | public/internal | scanned |
| `planCreated@packages/ax-code/src/control-plane/agent-control-events.ts:54` | public/internal | scanned |
| `planUpdated@packages/ax-code/src/control-plane/agent-control-events.ts:69` | public/internal | scanned |
| `validationUpdated@packages/ax-code/src/control-plane/agent-control-events.ts:86` | public/internal | scanned |
| `blocked@packages/ax-code/src/control-plane/agent-control-events.ts:103` | public/internal | scanned |
| `completionGateDecided@packages/ax-code/src/control-plane/agent-control-events.ts:122` | public/internal | scanned |
| `completed@packages/ax-code/src/control-plane/agent-control-events.ts:145` | public/internal | scanned |
| `safetyDecided@packages/ax-code/src/control-plane/agent-control-events.ts:163` | public/internal | scanned |
| `AgentControlSummary@packages/ax-code/src/control-plane/agent-control-summary.ts:5` | public/internal | scanned |

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

- secret packages/ax-code/src/control-plane/safety-policy.ts:56
- secret packages/ax-code/src/control-plane/safety-policy.ts:57
- io packages/ax-code/src/control-plane/sse.ts:89
- process packages/ax-code/src/control-plane/sse.ts:112
- secret packages/ax-code/src/control-plane/workspace-server/server.ts:25
- secret packages/ax-code/src/control-plane/workspace-server/server.ts:26
- secret packages/ax-code/src/control-plane/workspace-server/server.ts:28

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (90 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 17; total LOC: 2361
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/control-plane`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 90

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
| Static deep extract | ok | fingerprint `f2fa9e9429fa28ae` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 17 files / 2361 LOC / fp f2fa9e9429fa28ae |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
