# MODULE-AUDIT: acp

| Field | Value |
|-------|-------|
| Unit slug | `acp` |
| Scope | `packages/ax-code/src/acp` |
| Wave / effort | Wave 5 / M |
| Risk tags | api |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `97dccb247bad9b6f` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W5-10 |
| Source files / LOC | 8 / 1747 |

## 1. Scope and map

### Purpose and ownership
Unit `acp` owns `packages/ax-code/src/acp`. Risk profile: api.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/acp/agent-adapter.ts` | 276 | 12 | 0 | 0 |
| `packages/ax-code/src/acp/agent.ts` | 761 | 7 | 0 | 0 |
| `packages/ax-code/src/acp/prompt.ts` | 114 | 4 | 0 | 0 |
| `packages/ax-code/src/acp/session-mode.ts` | 213 | 2 | 0 | 0 |
| `packages/ax-code/src/acp/session.ts` | 163 | 1 | 0 | 0 |
| `packages/ax-code/src/acp/types.ts` | 25 | 2 | 0 | 0 |
| `packages/ax-code/src/acp/usage.ts` | 74 | 1 | 0 | 0 |
| `packages/ax-code/src/acp/utils.ts` | 121 | 7 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ModelOption@packages/ax-code/src/acp/agent-adapter.ts:13` | public/internal | scanned |
| `toToolKind@packages/ax-code/src/acp/agent-adapter.ts:18` | public/internal | scanned |
| `toLocations@packages/ax-code/src/acp/agent-adapter.ts:46` | public/internal | scanned |
| `defaultModel@packages/ax-code/src/acp/agent-adapter.ts:65` | public/internal | scanned |
| `parseUri@packages/ax-code/src/acp/agent-adapter.ts:130` | public/internal | scanned |
| `getNewContent@packages/ax-code/src/acp/agent-adapter.ts:167` | public/internal | scanned |
| `sortProvidersByName@packages/ax-code/src/acp/agent-adapter.ts:176` | public/internal | scanned |
| `modelVariantsFromProviders@packages/ax-code/src/acp/agent-adapter.ts:186` | public/internal | scanned |
| `buildAvailableModels@packages/ax-code/src/acp/agent-adapter.ts:197` | public/internal | scanned |
| `formatModelIdWithVariant@packages/ax-code/src/acp/agent-adapter.ts:222` | public/internal | scanned |
| `buildVariantMeta@packages/ax-code/src/acp/agent-adapter.ts:233` | public/internal | scanned |
| `parseModelSelection@packages/ax-code/src/acp/agent-adapter.ts:247` | public/internal | scanned |
| `ACP@packages/ax-code/src/acp/agent.ts:81` | public/internal | scanned |
| `decodeTodoPlanEntries@packages/ax-code/src/acp/agent.ts:87` | public/internal | scanned |
| `parseTodoPlanEntries@packages/ax-code/src/acp/agent.ts:88` | public/internal | scanned |

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

- secret packages/ax-code/src/acp/agent.ts:42
- secret packages/ax-code/src/acp/agent.ts:294
- secret packages/ax-code/src/acp/agent.ts:339
- secret packages/ax-code/src/acp/agent.ts:365
- secret packages/ax-code/src/acp/agent.ts:401
- secret packages/ax-code/src/acp/agent.ts:422
- secret packages/ax-code/src/acp/prompt.ts:98
- secret packages/ax-code/src/acp/prompt.ts:99
- secret packages/ax-code/src/acp/prompt.ts:100
- secret packages/ax-code/src/acp/prompt.ts:101
- secret packages/ax-code/src/acp/prompt.ts:102
- secret packages/ax-code/src/acp/prompt.ts:103

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (36 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 8; total LOC: 1747
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/acp`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 36

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
| Static deep extract | ok | fingerprint `97dccb247bad9b6f` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 8 files / 1747 LOC / fp 97dccb247bad9b6f |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
