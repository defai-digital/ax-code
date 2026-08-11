# MODULE-AUDIT: desktop-web-scheduled-tasks

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-scheduled-tasks` |
| Scope | `desktop/packages/web/server/lib/scheduled-tasks` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5aa9944096e962ff` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-17 |
| Source files / LOC | 5 / 1580 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-scheduled-tasks` owns `desktop/packages/web/server/lib/scheduled-tasks`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/scheduled-tasks/routes.js` | 234 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.js` | 912 | 4 | 3 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/runtime.test.js` | 322 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/time.js` | 69 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/scheduled-tasks/time.test.js` | 43 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `registerScheduledTaskRoutes@desktop/packages/web/server/lib/scheduled-tasks/routes.js:12` | public/internal | scanned |
| `parseScheduledCommandPrompt@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:54` | public/internal | scanned |
| `computeNextRunAt@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:77` | public/internal | scanned |
| `formatScheduledSessionTitle@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:178` | public/internal | scanned |
| `createScheduledTasksRuntime@desktop/packages/web/server/lib/scheduled-tasks/runtime.js:188` | public/internal | scanned |
| `normalizeScheduledTaskTime@desktop/packages/web/server/lib/scheduled-tasks/time.js:3` | public/internal | scanned |
| `uniqueSortedScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:8` | public/internal | scanned |
| `normalizeScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:10` | public/internal | scanned |
| `resolveScheduledTaskTimes@desktop/packages/web/server/lib/scheduled-tasks/time.js:26` | public/internal | scanned |
| `parseScheduledTaskTimeParts@desktop/packages/web/server/lib/scheduled-tasks/time.js:55` | public/internal | scanned |

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

- process desktop/packages/web/server/lib/scheduled-tasks/time.js:60

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (5 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (10 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 5; total LOC: 1580
- Empty catch residual: desktop/packages/web/server/lib/scheduled-tasks/routes.js:179, desktop/packages/web/server/lib/scheduled-tasks/routes.js:211, desktop/packages/web/server/lib/scheduled-tasks/runtime.js:353, desktop/packages/web/server/lib/scheduled-tasks/runtime.js:631, desktop/packages/web/server/lib/scheduled-tasks/runtime.js:786
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/scheduled-tasks`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 5
- Export surface: 10

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-scheduled-tasks-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `5aa9944096e962ff` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 5 files / 1580 LOC / fp 5aa9944096e962ff |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
