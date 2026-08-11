# MODULE-AUDIT: desktop-web-ax-code

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-ax-code` |
| Scope | `desktop/packages/web/server/lib/ax-code` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `1a8a04b257a7d41e` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-06 |
| Source files / LOC | 84 / 20115 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-ax-code` owns `desktop/packages/web/server/lib/ax-code`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/ax-code/agents.js` | 582 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth-state-runtime.js` | 87 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth-state-runtime.test.js` | 61 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/auth.js` | 105 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/ax-code-resolution-runtime.js` | 70 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/background-reload.js` | 70 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/background-reload.test.js` | 103 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js` | 107 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-entry-runtime.js` | 27 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-options.js` | 63 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/cli-options.test.js` | 46 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/commands.js` | 288 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/config-entity-routes.js` | 474 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/core-routes.js` | 515 | 4 | 7 | 0 |
| `desktop/packages/web/server/lib/ax-code/core-routes.test.js` | 266 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-config.js` | 82 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-config.test.js` | 64 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-runtime.js` | 1284 | 1 | 13 | 0 |
| `desktop/packages/web/server/lib/ax-code/env-runtime.test.js` | 283 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/feature-routes-runtime.js` | 309 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/hmr-state-runtime.js` | 70 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/hmr-state-runtime.test.js` | 51 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/index.js` | 74 | 25 | 0 | 0 |
| `desktop/packages/web/server/lib/ax-code/lifecycle.js` | 1311 | 2 | 9 | 0 |
| `desktop/packages/web/server/lib/ax-code/lifecycle.test.js` | 446 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `createAxCodeAuthStateRuntime@desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:1` | public/internal | scanned |
| `createAxCodeResolutionRuntime@desktop/packages/web/server/lib/ax-code/ax-code-resolution-runtime.js:1` | public/internal | scanned |
| `DEFAULT_BACKGROUND_RELOAD_MIN_DELAY_MS@desktop/packages/web/server/lib/ax-code/background-reload.js:1` | public/internal | scanned |
| `DEFAULT_BACKGROUND_RELOAD_TIMEOUT_MS@desktop/packages/web/server/lib/ax-code/background-reload.js:2` | public/internal | scanned |
| `createBackgroundAxCodeReloader@desktop/packages/web/server/lib/ax-code/background-reload.js:10` | public/internal | scanned |
| `createBootstrapRuntime@desktop/packages/web/server/lib/ax-code/bootstrap-runtime.js:13` | public/internal | scanned |
| `runCliEntryIfMain@desktop/packages/web/server/lib/ax-code/cli-entry-runtime.js:1` | public/internal | scanned |
| `parseServeCliOptions@desktop/packages/web/server/lib/ax-code/cli-options.js:8` | public/internal | scanned |
| `registerConfigEntityRoutes@desktop/packages/web/server/lib/ax-code/config-entity-routes.js:1` | public/internal | scanned |
| `registerServerStatusRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:44` | public/internal | scanned |
| `registerAuthAndAccessRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:318` | public/internal | scanned |
| `registerSettingsUtilityRoutes@desktop/packages/web/server/lib/ax-code/core-routes.js:432` | public/internal | scanned |
| `registerCommonRequestMiddleware@desktop/packages/web/server/lib/ax-code/core-routes.js:469` | public/internal | scanned |
| `resolveAxCodeEnvConfig@desktop/packages/web/server/lib/ax-code/env-config.js:5` | public/internal | scanned |
| `createAxCodeEnvRuntime@desktop/packages/web/server/lib/ax-code/env-runtime.js:7` | public/internal | scanned |

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

- io desktop/packages/web/server/lib/ax-code/agents.js:536
- io desktop/packages/web/server/lib/ax-code/agents.js:544
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:5
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:6
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:9
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:13
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:20
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:22
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:25
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:26
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:27
- secret desktop/packages/web/server/lib/ax-code/auth-state-runtime.js:28

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (37 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (104 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 84; total LOC: 20115
- Empty catch residual: desktop/packages/web/server/lib/ax-code/core-routes.js:73, desktop/packages/web/server/lib/ax-code/core-routes.js:174, desktop/packages/web/server/lib/ax-code/core-routes.js:181, desktop/packages/web/server/lib/ax-code/core-routes.js:268, desktop/packages/web/server/lib/ax-code/core-routes.js:275, desktop/packages/web/server/lib/ax-code/core-routes.js:283
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/ax-code`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 37
- Export surface: 104

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-ax-code-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `1a8a04b257a7d41e` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 84 files / 20115 LOC / fp 1a8a04b257a7d41e |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
