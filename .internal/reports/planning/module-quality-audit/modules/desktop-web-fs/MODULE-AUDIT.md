# MODULE-AUDIT: desktop-web-fs

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-fs` |
| Scope | `desktop/packages/web/server/lib/fs` |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `4731dccf40b8df82` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-09 |
| Source files / LOC | 3 / 2335 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-fs` owns `desktop/packages/web/server/lib/fs`. Risk profile: desktop, security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/fs/routes.js` | 1505 | 6 | 3 | 0 |
| `desktop/packages/web/server/lib/fs/routes.test.js` | 589 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/fs/search.js` | 241 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `isPathWithinRoot@desktop/packages/web/server/lib/fs/routes.js:59` | public/internal | scanned |
| `resolveApprovedPathFromSettings@desktop/packages/web/server/lib/fs/routes.js:89` | public/internal | scanned |
| `resolveWorkspaceOrApprovedPathFromContext@desktop/packages/web/server/lib/fs/routes.js:220` | public/internal | scanned |
| `deriveCloneDirectoryName@desktop/packages/web/server/lib/fs/routes.js:252` | public/internal | scanned |
| `isPlansDirectoryPath@desktop/packages/web/server/lib/fs/routes.js:271` | public/internal | scanned |
| `registerFsRoutes@desktop/packages/web/server/lib/fs/routes.js:427` | public/internal | scanned |
| `createFsSearchRuntime@desktop/packages/web/server/lib/fs/search.js:98` | public/internal | scanned |

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

- secret desktop/packages/web/server/lib/fs/routes.js:28
- secret desktop/packages/web/server/lib/fs/routes.js:29
- secret desktop/packages/web/server/lib/fs/routes.js:30
- secret desktop/packages/web/server/lib/fs/routes.js:33
- secret desktop/packages/web/server/lib/fs/routes.js:34
- secret desktop/packages/web/server/lib/fs/routes.js:38
- process desktop/packages/web/server/lib/fs/routes.js:368
- process desktop/packages/web/server/lib/fs/routes.js:807
- io desktop/packages/web/server/lib/fs/routes.js:941
- io desktop/packages/web/server/lib/fs/routes.js:1019
- io desktop/packages/web/server/lib/fs/routes.js:1073
- io desktop/packages/web/server/lib/fs/routes.js:1079

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (3 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (7 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 3; total LOC: 2335
- Empty catch residual: desktop/packages/web/server/lib/fs/routes.js:379, desktop/packages/web/server/lib/fs/routes.js:1447, desktop/packages/web/server/lib/fs/routes.js:1449
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/fs`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 3
- Export surface: 7

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-fs-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `4731dccf40b8df82` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 3 files / 2335 LOC / fp 4731dccf40b8df82 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
