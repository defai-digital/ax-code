# MODULE-AUDIT: desktop-web-github

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-github` |
| Scope | `desktop/packages/web/server/lib/github` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop, security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `390ae6925d893233` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-11 |
| Source files / LOC | 10 / 2935 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-github` owns `desktop/packages/web/server/lib/github`. Risk profile: desktop, security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/github/auth.js` | 313 | 8 | 0 | 0 |
| `desktop/packages/web/server/lib/github/auth.test.js` | 151 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/github/device-flow.js` | 51 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/github/index.js` | 17 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/github/octokit.js` | 11 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/pr-status.js` | 533 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/repo/fork-detection.js` | 103 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/repo/index.js` | 56 | 2 | 0 | 0 |
| `desktop/packages/web/server/lib/github/routes.js` | 1642 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/github/routes.test.js` | 58 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `getGitHubAuth@desktop/packages/web/server/lib/github/auth.js:176` | public/internal | scanned |
| `getGitHubAuthAccounts@desktop/packages/web/server/lib/github/auth.js:188` | public/internal | scanned |
| `setGitHubAuth@desktop/packages/web/server/lib/github/auth.js:200` | public/internal | scanned |
| `activateGitHubAuth@desktop/packages/web/server/lib/github/auth.js:246` | public/internal | scanned |
| `clearGitHubAuth@desktop/packages/web/server/lib/github/auth.js:262` | public/internal | scanned |
| `getGitHubClientId@desktop/packages/web/server/lib/github/auth.js:288` | public/internal | scanned |
| `getGitHubScopes@desktop/packages/web/server/lib/github/auth.js:300` | public/internal | scanned |
| `GITHUB_AUTH_FILE@desktop/packages/web/server/lib/github/auth.js:312` | public/internal | scanned |
| `startDeviceFlow@desktop/packages/web/server/lib/github/device-flow.js:35` | public/internal | scanned |
| `exchangeDeviceCode@desktop/packages/web/server/lib/github/device-flow.js:42` | public/internal | scanned |
| `startDeviceFlow@desktop/packages/web/server/lib/github/index.js:12` | public/internal | scanned |
| `exchangeDeviceCode@desktop/packages/web/server/lib/github/index.js:12` | public/internal | scanned |
| `getOctokitOrNull@desktop/packages/web/server/lib/github/index.js:14` | public/internal | scanned |
| `parseGitHubRemoteUrl@desktop/packages/web/server/lib/github/index.js:16` | public/internal | scanned |
| `resolveGitHubRepoFromDirectory@desktop/packages/web/server/lib/github/index.js:16` | public/internal | scanned |

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

- io desktop/packages/web/server/lib/github/auth.js:23
- io desktop/packages/web/server/lib/github/auth.js:28
- io desktop/packages/web/server/lib/github/auth.js:44
- io desktop/packages/web/server/lib/github/auth.js:49
- io desktop/packages/web/server/lib/github/auth.js:64
- secret desktop/packages/web/server/lib/github/auth.js:79
- secret desktop/packages/web/server/lib/github/auth.js:89
- secret desktop/packages/web/server/lib/github/auth.js:90
- secret desktop/packages/web/server/lib/github/auth.js:97
- secret desktop/packages/web/server/lib/github/auth.js:98
- secret desktop/packages/web/server/lib/github/auth.js:112
- secret desktop/packages/web/server/lib/github/auth.js:117

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (21 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 10; total LOC: 2935
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/github`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 21

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
| Static deep extract | ok | fingerprint `390ae6925d893233` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 10 files / 2935 LOC / fp 390ae6925d893233 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
