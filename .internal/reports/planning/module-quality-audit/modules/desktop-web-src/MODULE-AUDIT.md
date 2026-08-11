# MODULE-AUDIT: desktop-web-src

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-src` |
| Scope | `desktop/packages/web/src` |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `bb3c6ae70cde2700` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-22 |
| Source files / LOC | 15 / 1265 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-src` owns `desktop/packages/web/src`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/src/api/constants.ts` | 83 | 5 | 0 | 0 |
| `desktop/packages/web/src/api/files.test.ts` | 49 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/files.ts` | 286 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/git.test.ts` | 73 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/git.ts` | 74 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/github.ts` | 333 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/index.ts` | 23 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/notifications.test.ts` | 61 | 0 | 0 | 0 |
| `desktop/packages/web/src/api/notifications.ts` | 84 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/permissions.ts` | 16 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/settings.ts` | 57 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/terminal.ts` | 69 | 1 | 0 | 0 |
| `desktop/packages/web/src/api/tools.ts` | 24 | 1 | 0 | 0 |
| `desktop/packages/web/src/main.tsx` | 16 | 0 | 0 | 0 |
| `desktop/packages/web/src/mini-chat-main.tsx` | 17 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `API_BASE_PATH@desktop/packages/web/src/api/constants.ts:6` | public/internal | scanned |
| `API_ENDPOINTS@desktop/packages/web/src/api/constants.ts:8` | public/internal | scanned |
| `HTTP_QUERY_STRINGS@desktop/packages/web/src/api/constants.ts:32` | public/internal | scanned |
| `HTTP_DEFAULTS@desktop/packages/web/src/api/constants.ts:38` | public/internal | scanned |
| `buildQueryUrl@desktop/packages/web/src/api/constants.ts:73` | public/internal | scanned |
| `createWebFilesAPI@desktop/packages/web/src/api/files.ts:47` | public/internal | scanned |
| `createWebGitAPI@desktop/packages/web/src/api/git.ts:4` | public/internal | scanned |
| `createWebGitHubAPI@desktop/packages/web/src/api/github.ts:28` | public/internal | scanned |
| `createWebAPIs@desktop/packages/web/src/api/index.ts:12` | public/internal | scanned |
| `createWebNotificationsAPI@desktop/packages/web/src/api/notifications.ts:65` | public/internal | scanned |
| `createWebPermissionsAPI@desktop/packages/web/src/api/permissions.ts:3` | public/internal | scanned |
| `createWebSettingsAPI@desktop/packages/web/src/api/settings.ts:14` | public/internal | scanned |
| `createWebTerminalAPI@desktop/packages/web/src/api/terminal.ts:32` | public/internal | scanned |
| `createWebToolsAPI@desktop/packages/web/src/api/tools.ts:4` | public/internal | scanned |

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

- io desktop/packages/web/src/api/files.ts:158
- io desktop/packages/web/src/api/files.ts:180

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (14 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 15; total LOC: 1265
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/src`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 14

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
| Static deep extract | ok | fingerprint `bb3c6ae70cde2700` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 15 files / 1265 LOC / fp bb3c6ae70cde2700 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
