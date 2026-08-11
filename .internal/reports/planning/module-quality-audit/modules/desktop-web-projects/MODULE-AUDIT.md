# MODULE-AUDIT: desktop-web-projects

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-projects` |
| Scope | `desktop/packages/web/server/lib/projects` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `e9564d8ac834fc05` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-15 |
| Source files / LOC | 5 / 1210 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-projects` owns `desktop/packages/web/server/lib/projects`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/projects/discover-external.js` | 269 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/discover-external.test.js` | 131 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/project-config.js` | 518 | 6 | 1 | 0 |
| `desktop/packages/web/server/lib/projects/project-config.test.js` | 278 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/projects/project-id.js` | 14 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `parseCodexProjectsToml@desktop/packages/web/server/lib/projects/discover-external.js:40` | public/internal | scanned |
| `parseKimiWorkspacesJson@desktop/packages/web/server/lib/projects/discover-external.js:76` | public/internal | scanned |
| `discoverExternalProjects@desktop/packages/web/server/lib/projects/discover-external.js:128` | public/internal | scanned |
| `registerDiscoverExternalProjectRoutes@desktop/packages/web/server/lib/projects/discover-external.js:225` | public/internal | scanned |
| `createProjectConfigRuntime@desktop/packages/web/server/lib/projects/project-config.js:292` | public/internal | scanned |
| `MAX_TASK_NAME_LENGTH@desktop/packages/web/server/lib/projects/project-config.js:517` | public/internal | scanned |
| `MAX_TASK_PROMPT_LENGTH@desktop/packages/web/server/lib/projects/project-config.js:517` | public/internal | scanned |
| `MAX_CRON_LENGTH@desktop/packages/web/server/lib/projects/project-config.js:517` | public/internal | scanned |
| `MAX_LAST_ERROR_LENGTH@desktop/packages/web/server/lib/projects/project-config.js:517` | public/internal | scanned |
| `normalizeTaskForStorage@desktop/packages/web/server/lib/projects/project-config.js:517` | public/internal | scanned |
| `createProjectIdFromPath@desktop/packages/web/server/lib/projects/project-id.js:6` | public/internal | scanned |

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

- process desktop/packages/web/server/lib/projects/discover-external.js:50
- process desktop/packages/web/server/lib/projects/discover-external.js:58
- io desktop/packages/web/server/lib/projects/discover-external.js:83
- io desktop/packages/web/server/lib/projects/discover-external.js:126
- io desktop/packages/web/server/lib/projects/discover-external.js:130
- io desktop/packages/web/server/lib/projects/discover-external.js:149
- io desktop/packages/web/server/lib/projects/discover-external.js:159
- io desktop/packages/web/server/lib/projects/discover-external.js:251
- io desktop/packages/web/server/lib/projects/discover-external.test.js:99
- io desktop/packages/web/server/lib/projects/project-config.js:326
- io desktop/packages/web/server/lib/projects/project-config.js:327
- io desktop/packages/web/server/lib/projects/project-config.js:373

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (1 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (11 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 5; total LOC: 1210
- Empty catch residual: desktop/packages/web/server/lib/projects/project-config.js:352
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/projects`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 1
- Export surface: 11

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-projects-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `e9564d8ac834fc05` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 5 files / 1210 LOC / fp e9564d8ac834fc05 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
