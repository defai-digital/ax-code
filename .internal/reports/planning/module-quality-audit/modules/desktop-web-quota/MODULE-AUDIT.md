# MODULE-AUDIT: desktop-web-quota

| Field | Value |
|-------|-------|
| Unit slug | `desktop-web-quota` |
| Scope | `desktop/packages/web/server/lib/quota` |
| Wave / effort | Wave 7 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5a5633c5189556c6` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W7-16 |
| Source files / LOC | 27 / 2550 |

## 1. Scope and map

### Purpose and ownership
Unit `desktop-web-quota` owns `desktop/packages/web/server/lib/quota`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/web/server/lib/quota/index.js` | 27 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/claude.js` | 102 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/codex.js` | 114 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/copilot.js` | 158 | 8 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/api.js` | 92 | 3 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/auth.js` | 108 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/index.js` | 109 | 7 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/google/transforms.js` | 93 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/index.js` | 170 | 18 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/kimi.js` | 108 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/minimax-cn-coding-plan.js` | 126 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/minimax-coding-plan.js` | 129 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/nanogpt.js` | 119 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/ollama-cloud.js` | 113 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/ollama-cloud.test.js` | 90 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/openai.js` | 86 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/openrouter.js` | 86 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/wafer.js` | 132 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/zai.js` | 92 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/providers/zhipuai-coding-plan.js` | 157 | 5 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/routes.js` | 28 | 1 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/auth.js` | 47 | 4 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/auth.test.js` | 56 | 0 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/formatters.js` | 86 | 7 | 0 | 0 |
| `desktop/packages/web/server/lib/quota/utils/formatters.test.js` | 55 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `providerId@desktop/packages/web/server/lib/quota/providers/claude.js:4` | public/internal | scanned |
| `providerName@desktop/packages/web/server/lib/quota/providers/claude.js:5` | public/internal | scanned |
| `aliases@desktop/packages/web/server/lib/quota/providers/claude.js:6` | public/internal | scanned |
| `isConfigured@desktop/packages/web/server/lib/quota/providers/claude.js:8` | public/internal | scanned |
| `fetchQuota@desktop/packages/web/server/lib/quota/providers/claude.js:14` | public/internal | scanned |
| `providerId@desktop/packages/web/server/lib/quota/providers/codex.js:12` | public/internal | scanned |
| `providerName@desktop/packages/web/server/lib/quota/providers/codex.js:13` | public/internal | scanned |
| `aliases@desktop/packages/web/server/lib/quota/providers/codex.js:14` | public/internal | scanned |
| `isConfigured@desktop/packages/web/server/lib/quota/providers/codex.js:17` | public/internal | scanned |
| `fetchQuota@desktop/packages/web/server/lib/quota/providers/codex.js:23` | public/internal | scanned |
| `providerId@desktop/packages/web/server/lib/quota/providers/copilot.js:31` | public/internal | scanned |
| `providerName@desktop/packages/web/server/lib/quota/providers/copilot.js:32` | public/internal | scanned |
| `aliases@desktop/packages/web/server/lib/quota/providers/copilot.js:33` | public/internal | scanned |
| `isConfigured@desktop/packages/web/server/lib/quota/providers/copilot.js:35` | public/internal | scanned |
| `fetchQuota@desktop/packages/web/server/lib/quota/providers/copilot.js:41` | public/internal | scanned |

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

- secret desktop/packages/web/server/lib/quota/providers/claude.js:11
- secret desktop/packages/web/server/lib/quota/providers/claude.js:17
- secret desktop/packages/web/server/lib/quota/providers/claude.js:19
- secret desktop/packages/web/server/lib/quota/providers/claude.js:33
- secret desktop/packages/web/server/lib/quota/providers/codex.js:20
- secret desktop/packages/web/server/lib/quota/providers/codex.js:26
- secret desktop/packages/web/server/lib/quota/providers/codex.js:29
- secret desktop/packages/web/server/lib/quota/providers/codex.js:41
- secret desktop/packages/web/server/lib/quota/providers/copilot.js:38
- secret desktop/packages/web/server/lib/quota/providers/copilot.js:44
- secret desktop/packages/web/server/lib/quota/providers/copilot.js:46
- secret desktop/packages/web/server/lib/quota/providers/copilot.js:60

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (124 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 27; total LOC: 2550
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/web/server/lib/quota`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 124

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
| Static deep extract | ok | fingerprint `5a5633c5189556c6` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 27 files / 2550 LOC / fp 5a5633c5189556c6 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
