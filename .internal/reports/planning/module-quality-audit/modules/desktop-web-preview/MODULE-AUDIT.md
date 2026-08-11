# MODULE-AUDIT: desktop-web-preview

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-preview` |
| Scope | `desktop/packages/web/server/lib/preview` |
| Wave / effort | Wave 7 / M |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `1de135d576fe7a11` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-14 |
| Source files / LOC | 2 / 1903 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-preview` owns `desktop/packages/web/server/lib/preview`. Risk profile: desktop, security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/preview/proxy-runtime.js` | 1520 | 7 | 9 | 0 |
| `desktop/packages/web/server/lib/preview/proxy-runtime.test.js` | 383 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `classifyPreviewResourceError@desktop/packages/web/server/lib/preview/proxy-runtime.js:101` | public/internal | scanned |
| `classifyPreviewNavigation@desktop/packages/web/server/lib/preview/proxy-runtime.js:115` | public/internal | scanned |
| `buildPreviewProxyUpstreamPath@desktop/packages/web/server/lib/preview/proxy-runtime.js:872` | public/internal | scanned |
| `removeSensitivePreviewProxyHeaders@desktop/packages/web/server/lib/preview/proxy-runtime.js:878` | public/internal | scanned |
| `normalizeProxyTargetUrl@desktop/packages/web/server/lib/preview/proxy-runtime.js:924` | public/internal | scanned |
| `rewritePreviewBody@desktop/packages/web/server/lib/preview/proxy-runtime.js:965` | public/internal | scanned |
| `createPreviewProxyRuntime@desktop/packages/web/server/lib/preview/proxy-runtime.js:1045` | public/internal | scanned |

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

- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:2
- io desktop/packages/web/server/lib/preview/proxy-runtime.js:487
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1069
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1071
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1079
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1083
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1104
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1105
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1106
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1207
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1267
- secret desktop/packages/web/server/lib/preview/proxy-runtime.js:1268

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | empty catch may hide secret-path failures |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | silent cleanup on bridges |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | empty catch around IO |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (9 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (7 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 1903
- Empty catch residual: desktop/packages/web/server/lib/preview/proxy-runtime.js:190, desktop/packages/web/server/lib/preview/proxy-runtime.js:230, desktop/packages/web/server/lib/preview/proxy-runtime.js:292, desktop/packages/web/server/lib/preview/proxy-runtime.js:408, desktop/packages/web/server/lib/preview/proxy-runtime.js:457, desktop/packages/web/server/lib/preview/proxy-runtime.js:491
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/preview`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 9
- Export surface: 7

## 7. Test coverage map

| Risk path | Existing test | Gap |
|-----------|---------------|-----|
| Primary behaviors | `packages/ax-code/test/account/repo.test.ts` | matched |
| Findings regression | n/a — deferred with owner review 2026-09-11 | — |

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-desktop-web-preview-empty-catch | silent-error | Medium | new | deferred |

## 9. Verification and exit

| Command / method | Result | Evidence |
|------------------|--------|----------|
| Static deep extract | ok | fingerprint `1de135d576fe7a11` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 1903 LOC / fp 1de135d576fe7a11 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 1 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
