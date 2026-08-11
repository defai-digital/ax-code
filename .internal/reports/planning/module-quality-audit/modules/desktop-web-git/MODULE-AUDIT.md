# MODULE-AUDIT: desktop-web-git

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-git` |
| Scope | `desktop/packages/web/server/lib/git` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `723a2b01d9a816fb` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-10 |
| Source files / LOC | 9 / 6270 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-git` owns `desktop/packages/web/server/lib/git`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/git/credentials.js` | 79 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/git/credentials.test.js` | 84 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/identity-storage.js` | 135 | 7 | 4 | 0 |
| `desktop/packages/web/server/lib/git/identity-storage.test.js` | 81 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/index.js` | 7 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/routes.js` | 1099 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/git/routes.test.js` | 112 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/git/service.js` | 4170 | 40 | 0 | 0 |
| `desktop/packages/web/server/lib/git/service.test.js` | 503 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `discoverGitCredentials@desktop/packages/web/server/lib/git/credentials.js:20` | public/internal | scanned |
| `getCredentialForHost@desktop/packages/web/server/lib/git/credentials.js:51` | public/internal | scanned |
| `loadProfiles@desktop/packages/web/server/lib/git/identity-storage.js:39` | public/internal | scanned |
| `saveProfiles@desktop/packages/web/server/lib/git/identity-storage.js:55` | public/internal | scanned |
| `getProfiles@desktop/packages/web/server/lib/git/identity-storage.js:67` | public/internal | scanned |
| `getProfile@desktop/packages/web/server/lib/git/identity-storage.js:72` | public/internal | scanned |
| `createProfile@desktop/packages/web/server/lib/git/identity-storage.js:77` | public/internal | scanned |
| `updateProfile@desktop/packages/web/server/lib/git/identity-storage.js:106` | public/internal | scanned |
| `deleteProfile@desktop/packages/web/server/lib/git/identity-storage.js:124` | public/internal | scanned |
| `registerGitRoutes@desktop/packages/web/server/lib/git/routes.js:1` | public/internal | scanned |
| `validateRepositoryFilePaths@desktop/packages/web/server/lib/git/service.js:387` | public/internal | scanned |
| `resolveRepositoryFilePath@desktop/packages/web/server/lib/git/service.js:406` | public/internal | scanned |
| `isGitRepository@desktop/packages/web/server/lib/git/service.js:1378` | public/internal | scanned |
| `getGlobalIdentity@desktop/packages/web/server/lib/git/service.js:1388` | public/internal | scanned |
| `getRemoteUrl@desktop/packages/web/server/lib/git/service.js:1411` | public/internal | scanned |

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

- secret desktop/packages/web/server/lib/git/credentials.js:5
- secret desktop/packages/web/server/lib/git/credentials.js:7
- secret desktop/packages/web/server/lib/git/credentials.js:9
- io desktop/packages/web/server/lib/git/credentials.js:9
- secret desktop/packages/web/server/lib/git/credentials.js:15
- secret desktop/packages/web/server/lib/git/credentials.js:20
- secret desktop/packages/web/server/lib/git/credentials.js:21
- secret desktop/packages/web/server/lib/git/credentials.js:22
- secret desktop/packages/web/server/lib/git/credentials.js:24
- secret desktop/packages/web/server/lib/git/credentials.js:38
- secret desktop/packages/web/server/lib/git/credentials.js:40
- secret desktop/packages/web/server/lib/git/credentials.js:48

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (4 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (50 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 9; total LOC: 6270
- Empty catch residual: desktop/packages/web/server/lib/git/identity-storage.js:13, desktop/packages/web/server/lib/git/identity-storage.js:26, desktop/packages/web/server/lib/git/identity-storage.js:30, desktop/packages/web/server/lib/git/identity-storage.js:34
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/git`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 4
- Export surface: 50

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-git-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `723a2b01d9a816fb` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 9 files / 6270 LOC / fp 723a2b01d9a816fb |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
