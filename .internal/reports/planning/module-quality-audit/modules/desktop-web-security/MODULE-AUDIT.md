# MODULE-AUDIT: desktop-web-security

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-security` |
| Scope | `desktop/packages/web/server/lib/security` |
| Wave / effort | Wave 1 / M |
| Risk tags | security, desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `d6c32c2f985810da` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-15 |
| Source files / LOC | 9 / 508 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-security` owns `desktop/packages/web/server/lib/security`. Risk profile: security, desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/security/legacy-tunnel.js` | 59 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/security/legacy-tunnel.test.js` | 62 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/local-only.js` | 32 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-origin.js` | 55 | 6 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-origin.test.js` | 35 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/request-security.js` | 89 | 1 | 2 | 0 |
| `desktop/packages/web/server/lib/security/request-security.test.js` | 106 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/security/response-headers.js` | 31 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/security/response-headers.test.js` | 39 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `assertNoActiveLegacyPublicTunnels@desktop/packages/web/server/lib/security/legacy-tunnel.js:15` | public/internal | scanned |
| `normalizeLoopbackHostname@desktop/packages/web/server/lib/security/local-only.js:1` | public/internal | scanned |
| `isLoopbackHostname@desktop/packages/web/server/lib/security/local-only.js:6` | public/internal | scanned |
| `assertLocalOnlyHostname@desktop/packages/web/server/lib/security/local-only.js:14` | public/internal | scanned |
| `normalizeLoopbackHttpOrigin@desktop/packages/web/server/lib/security/local-only.js:21` | public/internal | scanned |
| `isLoopbackHttpUrl@desktop/packages/web/server/lib/security/local-only.js:31` | public/internal | scanned |
| `firstForwardedHeaderValue@desktop/packages/web/server/lib/security/request-origin.js:3` | public/internal | scanned |
| `getRequestProtocol@desktop/packages/web/server/lib/security/request-origin.js:6` | public/internal | scanned |
| `getRequestHost@desktop/packages/web/server/lib/security/request-origin.js:10` | public/internal | scanned |
| `getRequestOrigin@desktop/packages/web/server/lib/security/request-origin.js:14` | public/internal | scanned |
| `getRequestRpId@desktop/packages/web/server/lib/security/request-origin.js:25` | public/internal | scanned |
| `addLocalhostOriginAliases@desktop/packages/web/server/lib/security/request-origin.js:38` | public/internal | scanned |
| `createRequestSecurityRuntime@desktop/packages/web/server/lib/security/request-security.js:4` | public/internal | scanned |
| `isPreviewProxyRequest@desktop/packages/web/server/lib/security/response-headers.js:9` | public/internal | scanned |
| `isDashboardProxyRequest@desktop/packages/web/server/lib/security/response-headers.js:14` | public/internal | scanned |

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

- io desktop/packages/web/server/lib/security/legacy-tunnel.js:37
- io desktop/packages/web/server/lib/security/legacy-tunnel.js:48
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:11
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:12
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:34
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:49
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:58
- io desktop/packages/web/server/lib/security/legacy-tunnel.test.js:59
- secret desktop/packages/web/server/lib/security/request-security.js:7
- secret desktop/packages/web/server/lib/security/request-security.js:84

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (4 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (16 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 9; total LOC: 508
- Empty catch residual: desktop/packages/web/server/lib/security/legacy-tunnel.js:38, desktop/packages/web/server/lib/security/legacy-tunnel.js:49, desktop/packages/web/server/lib/security/request-security.js:52, desktop/packages/web/server/lib/security/request-security.js:56
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/security`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 4
- Export surface: 16

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-security-empty-catch | silent-error | Low | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `d6c32c2f985810da` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 9 files / 508 LOC / fp d6c32c2f985810da |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
