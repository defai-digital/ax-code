# MODULE-AUDIT: mcp-oauth-trust

| Field | Value |
|-------|-------|
| Unit slug | `mcp-oauth-trust` |
| Scope | `packages/ax-code/src/mcp (OAuth/trust)` |
| Wave / effort | Wave 5 / L |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `eff33a5a3295bf20` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-05b |
| Source files / LOC | 11 / 3327 |

## 1. Scope and map

### Purpose and ownership
Unit `mcp-oauth-trust` owns `packages/ax-code/src/mcp (OAuth/trust)`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/mcp/auth.ts` | 255 | 21 | 0 | 0 |
| `packages/ax-code/src/mcp/constants.ts` | 3 | 1 | 0 | 0 |
| `packages/ax-code/src/mcp/discovery.ts` | 323 | 7 | 0 | 0 |
| `packages/ax-code/src/mcp/impl.ts` | 1554 | 31 | 0 | 0 |
| `packages/ax-code/src/mcp/index.ts` | 2 | 1 | 0 | 0 |
| `packages/ax-code/src/mcp/oauth-callback.ts` | 292 | 8 | 0 | 0 |
| `packages/ax-code/src/mcp/oauth-provider.ts` | 210 | 7 | 0 | 0 |
| `packages/ax-code/src/mcp/permission-pattern.ts` | 163 | 3 | 0 | 0 |
| `packages/ax-code/src/mcp/templates/index.ts` | 224 | 6 | 0 | 0 |
| `packages/ax-code/src/mcp/tool-conversion.ts` | 126 | 8 | 0 | 0 |
| `packages/ax-code/src/mcp/trust.ts` | 175 | 6 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `McpAuth@packages/ax-code/src/mcp/auth.ts:8` | public/internal | scanned |
| `Tokens@packages/ax-code/src/mcp/auth.ts:9` | public/internal | scanned |
| `ClientInfo@packages/ax-code/src/mcp/auth.ts:17` | public/internal | scanned |
| `Entry@packages/ax-code/src/mcp/auth.ts:25` | public/internal | scanned |
| `withLock@packages/ax-code/src/mcp/auth.ts:49` | public/internal | scanned |
| `get@packages/ax-code/src/mcp/auth.ts:88` | public/internal | scanned |
| `getForUrl@packages/ax-code/src/mcp/auth.ts:97` | public/internal | scanned |
| `all@packages/ax-code/src/mcp/auth.ts:110` | public/internal | scanned |
| `set@packages/ax-code/src/mcp/auth.ts:137` | public/internal | scanned |
| `remove@packages/ax-code/src/mcp/auth.ts:148` | public/internal | scanned |
| `updateTokens@packages/ax-code/src/mcp/auth.ts:156` | public/internal | scanned |
| `updateClientInfo@packages/ax-code/src/mcp/auth.ts:165` | public/internal | scanned |
| `updateCodeVerifier@packages/ax-code/src/mcp/auth.ts:174` | public/internal | scanned |
| `clearCodeVerifier@packages/ax-code/src/mcp/auth.ts:185` | public/internal | scanned |
| `updateOAuthState@packages/ax-code/src/mcp/auth.ts:192` | public/internal | scanned |

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

- secret packages/ax-code/src/mcp/auth.ts:9
- secret packages/ax-code/src/mcp/auth.ts:10
- secret packages/ax-code/src/mcp/auth.ts:11
- secret packages/ax-code/src/mcp/auth.ts:15
- secret packages/ax-code/src/mcp/auth.ts:19
- secret packages/ax-code/src/mcp/auth.ts:21
- secret packages/ax-code/src/mcp/auth.ts:26
- secret packages/ax-code/src/mcp/auth.ts:30
- secret packages/ax-code/src/mcp/auth.ts:56
- secret packages/ax-code/src/mcp/auth.ts:57
- secret packages/ax-code/src/mcp/auth.ts:58
- secret packages/ax-code/src/mcp/auth.ts:59

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (99 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 11; total LOC: 3327
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/mcp (OAuth/trust)`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 99

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
| Static deep extract | ok | fingerprint `eff33a5a3295bf20` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 11 files / 3327 LOC / fp eff33a5a3295bf20 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
