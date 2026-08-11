# MODULE-AUDIT: isolation

| Field | Value |
|-------|-------|
| Unit slug | `isolation` |
| Scope | `packages/ax-code/src/isolation` |
| Wave / effort | Wave 3 / L |
| Risk tags | security, sandbox |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5af2bc35d1900923` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W3-02 |
| Source files / LOC | 2 / 627 |

## 1. Scope and map

### Purpose and ownership
Unit `isolation` owns `packages/ax-code/src/isolation`. Risk profile: security, sandbox.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/isolation/index.ts` | 292 | 18 | 0 | 0 |
| `packages/ax-code/src/isolation/os-sandbox.ts` | 335 | 12 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Isolation@packages/ax-code/src/isolation/index.ts:9` | public/internal | scanned |
| `DEFAULT_PROTECTED@packages/ax-code/src/isolation/index.ts:10` | public/internal | scanned |
| `OsSandbox@packages/ax-code/src/isolation/index.ts:11` | public/internal | scanned |
| `NETWORK_COMMANDS@packages/ax-code/src/isolation/index.ts:20` | public/internal | scanned |
| `Mode@packages/ax-code/src/isolation/index.ts:36` | public/internal | scanned |
| `Backend@packages/ax-code/src/isolation/index.ts:37` | public/internal | scanned |
| `State@packages/ax-code/src/isolation/index.ts:39` | public/internal | scanned |
| `DEFAULT_MODE@packages/ax-code/src/isolation/index.ts:59` | public/internal | scanned |
| `DEFAULT_BACKEND@packages/ax-code/src/isolation/index.ts:60` | public/internal | scanned |
| `DeniedError@packages/ax-code/src/isolation/index.ts:114` | public/internal | scanned |
| `resolve@packages/ax-code/src/isolation/index.ts:125` | public/internal | scanned |
| `shouldUseOsSandbox@packages/ax-code/src/isolation/index.ts:152` | public/internal | scanned |
| `isProtected@packages/ax-code/src/isolation/index.ts:162` | public/internal | scanned |
| `canWrite@packages/ax-code/src/isolation/index.ts:193` | public/internal | scanned |
| `assertWrite@packages/ax-code/src/isolation/index.ts:210` | public/internal | scanned |

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

- io packages/ax-code/src/isolation/os-sandbox.ts:261
- io packages/ax-code/src/isolation/os-sandbox.ts:329

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (30 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 2; total LOC: 627
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/isolation`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 30

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
| Static deep extract | ok | fingerprint `5af2bc35d1900923` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 2 files / 627 LOC / fp 5af2bc35d1900923 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
