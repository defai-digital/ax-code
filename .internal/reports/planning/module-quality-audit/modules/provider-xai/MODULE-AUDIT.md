# MODULE-AUDIT: provider-xai

| Field | Value |
|-------|-------|
| Unit slug | `provider-xai` |
| Scope | `packages/ax-code/src/provider/xai` |
| Wave / effort | Wave 5 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `63a98929fb338f17` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-04 |
| Source files / LOC | 2 / 196 |

## 1. Scope and map

### Purpose and ownership
Unit `provider-xai` owns `packages/ax-code/src/provider/xai`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/provider/xai/auth-plugin.ts` | 120 | 1 | 0 | 0 |
| `packages/ax-code/src/provider/xai/server-tools.ts` | 76 | 3 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `xaiAuthPlugin@packages/ax-code/src/provider/xai/auth-plugin.ts:119` | public/internal | scanned |
| `LiveSearchConfig@packages/ax-code/src/provider/xai/server-tools.ts:32` | public/internal | scanned |
| `supportsLiveSearch@packages/ax-code/src/provider/xai/server-tools.ts:56` | public/internal | scanned |
| `buildSearchParameters@packages/ax-code/src/provider/xai/server-tools.ts:68` | public/internal | scanned |

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

- secret packages/ax-code/src/provider/xai/auth-plugin.ts:4
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:68
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:70
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:80
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:91
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:93
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:94
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:95
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:96
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:99
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:100
- secret packages/ax-code/src/provider/xai/auth-plugin.ts:106

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (4 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 196
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/provider/xai`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 4

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
| Static deep extract | ok | fingerprint `63a98929fb338f17` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 196 LOC / fp 63a98929fb338f17 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
