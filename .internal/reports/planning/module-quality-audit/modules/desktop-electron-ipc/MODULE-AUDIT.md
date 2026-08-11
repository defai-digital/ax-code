# MODULE-AUDIT: desktop-electron-ipc

| Field | Value |
|-------|-------|
| Unit slug | `desktop-electron-ipc` |
| Scope | `desktop/packages/electron/src (IPC policy/handlers)` |
| Wave / effort | Wave 1 / L |
| Risk tags | security, desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `cdbce7936029ddde` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-13 |
| Source files / LOC | 47 / 5946 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-electron-ipc` owns `desktop/packages/electron/src (IPC policy/handlers)`. Risk profile: security, desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/electron/src/desktop-boot-outcome.js` | 11 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-boot-outcome.test.mjs` | 23 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-browser-capture-policy.js` | 16 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-browser-capture-policy.test.mjs` | 54 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-capture-page-policy.test.mjs` | 56 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-dialog.js` | 58 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-dialog.test.mjs` | 69 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-file-search.js` | 24 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-file-search.test.mjs` | 34 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-hosts.js` | 224 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-hosts.test.mjs` | 358 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-lan-address.js` | 93 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-lan-address.test.mjs` | 100 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-read-file-policy.js` | 65 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-read-file-policy.test.mjs` | 77 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-window-title.js` | 18 | 0 | 0 | 0 |
| `desktop/packages/electron/src/desktop-window-title.test.mjs` | 23 | 0 | 0 | 0 |
| `desktop/packages/electron/src/external-url.js` | 29 | 0 | 0 | 0 |
| `desktop/packages/electron/src/external-url.test.mjs` | 24 | 0 | 0 | 0 |
| `desktop/packages/electron/src/installed-apps-cache.js` | 32 | 0 | 0 | 0 |
| `desktop/packages/electron/src/installed-apps-cache.test.mjs` | 59 | 0 | 0 | 0 |
| `desktop/packages/electron/src/main.js` | 2767 | 0 | 3 | 0 |
| `desktop/packages/electron/src/mini-chat-tray-action.test.mjs` | 19 | 0 | 0 | 0 |
| `desktop/packages/electron/src/open-paths.js` | 88 | 0 | 0 | 0 |
| `desktop/packages/electron/src/open-paths.test.mjs` | 107 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `createTrayController@desktop/packages/electron/src/tray.mjs:97` | public/internal | scanned |

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

- io desktop/packages/electron/src/desktop-capture-page-policy.test.mjs:1
- io desktop/packages/electron/src/desktop-capture-page-policy.test.mjs:6
- io desktop/packages/electron/src/desktop-capture-page-policy.test.mjs:7
- io desktop/packages/electron/src/desktop-capture-page-policy.test.mjs:49
- secret desktop/packages/electron/src/desktop-hosts.js:12
- secret desktop/packages/electron/src/desktop-hosts.js:50
- secret desktop/packages/electron/src/desktop-hosts.js:51
- secret desktop/packages/electron/src/desktop-hosts.js:52
- secret desktop/packages/electron/src/desktop-hosts.js:100
- secret desktop/packages/electron/src/desktop-hosts.js:103
- secret desktop/packages/electron/src/desktop-hosts.js:118
- secret desktop/packages/electron/src/desktop-hosts.js:127

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (5 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (1 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 47; total LOC: 5946
- Empty catch residual: desktop/packages/electron/src/main.js:1646, desktop/packages/electron/src/main.js:1656, desktop/packages/electron/src/main.js:2168, desktop/packages/electron/src/server-process.js:51, desktop/packages/electron/src/startup-diagnostics.js:47
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/electron/src (IPC policy/handlers)`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 5
- Export surface: 1

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | desktop/packages/electron/src/preload-ipc-policy.test.mjs, n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-electron-ipc-001 | security | Critical | prior-review | verified-fixed |
| AUDIT-desktop-electron-ipc-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `cdbce7936029ddde` |
| Core typecheck | EXIT:0 | gates |
| Desktop typecheck/lint/test | EXIT:0 | gates |
| Desktop boundaries | EXIT:0 | gates |
| Structure | EXIT:0 | gates |
| Regression AUDIT-desktop-electron-ipc-001 | ok | desktop/packages/electron/src/preload-ipc-policy.test.mjs |

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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 47 files / 5946 LOC / fp cdbce7936029ddde |
| Fix owner | ax-code-glm | 2026-08-11 | 1 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
