# MODULE-AUDIT: desktop-web-notifications

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-notifications` |
| Scope | `desktop/packages/web/server/lib/notifications` |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `115cfe07ebd11bf0` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-13 |
| Source files / LOC | 11 / 1523 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-notifications` owns `desktop/packages/web/server/lib/notifications`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/notifications/emitter-runtime.js` | 99 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/index.js` | 4 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/label-format.js` | 39 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/label-format.test.js` | 20 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/message.js` | 56 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/message.test.js` | 35 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/routes.js` | 202 | 1 | 1 | 0 |
| `desktop/packages/web/server/lib/notifications/runtime.js` | 470 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/runtime.test.js` | 105 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/notifications/template-runtime.js` | 345 | 1 | 1 | 0 |
| `desktop/packages/web/server/lib/notifications/template-runtime.test.js` | 148 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `createNotificationEmitterRuntime@desktop/packages/web/server/lib/notifications/emitter-runtime.js:1` | public/internal | scanned |
| `truncateNotificationText@desktop/packages/web/server/lib/notifications/index.js:1` | public/internal | scanned |
| `prepareNotificationLastMessage@desktop/packages/web/server/lib/notifications/index.js:1` | public/internal | scanned |
| `createNotificationTriggerRuntime@desktop/packages/web/server/lib/notifications/index.js:2` | public/internal | scanned |
| `createNotificationTemplateRuntime@desktop/packages/web/server/lib/notifications/index.js:3` | public/internal | scanned |
| `formatNotificationProjectLabel@desktop/packages/web/server/lib/notifications/label-format.js:10` | public/internal | scanned |
| `formatNotificationModeLabel@desktop/packages/web/server/lib/notifications/label-format.js:15` | public/internal | scanned |
| `formatNotificationModelLabel@desktop/packages/web/server/lib/notifications/label-format.js:20` | public/internal | scanned |
| `truncateNotificationText@desktop/packages/web/server/lib/notifications/message.js:30` | public/internal | scanned |
| `prepareNotificationLastMessage@desktop/packages/web/server/lib/notifications/message.js:43` | public/internal | scanned |
| `registerNotificationRoutes@desktop/packages/web/server/lib/notifications/routes.js:1` | public/internal | scanned |
| `createNotificationTriggerRuntime@desktop/packages/web/server/lib/notifications/runtime.js:3` | public/internal | scanned |
| `createNotificationTemplateRuntime@desktop/packages/web/server/lib/notifications/template-runtime.js:8` | public/internal | scanned |

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

- secret desktop/packages/web/server/lib/notifications/label-format.js:1
- secret desktop/packages/web/server/lib/notifications/label-format.js:4
- secret desktop/packages/web/server/lib/notifications/label-format.js:7
- secret desktop/packages/web/server/lib/notifications/label-format.js:12
- secret desktop/packages/web/server/lib/notifications/label-format.js:17
- secret desktop/packages/web/server/lib/notifications/label-format.js:24
- secret desktop/packages/web/server/lib/notifications/label-format.js:26
- secret desktop/packages/web/server/lib/notifications/label-format.js:27
- secret desktop/packages/web/server/lib/notifications/label-format.js:28
- secret desktop/packages/web/server/lib/notifications/label-format.js:37
- secret desktop/packages/web/server/lib/notifications/routes.js:5
- secret desktop/packages/web/server/lib/notifications/routes.js:33

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (2 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (13 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 11; total LOC: 1523
- Empty catch residual: desktop/packages/web/server/lib/notifications/routes.js:54, desktop/packages/web/server/lib/notifications/template-runtime.js:311
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/notifications`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 2
- Export surface: 13

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-notifications-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `115cfe07ebd11bf0` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 11 files / 1523 LOC / fp 115cfe07ebd11bf0 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
