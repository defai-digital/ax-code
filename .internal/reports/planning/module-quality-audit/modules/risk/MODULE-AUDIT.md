# MODULE-AUDIT: risk

| Field | Value |
|-------|-------|
| Unit slug | `risk` |
| Scope | `packages/ax-code/src/risk` |
| Wave / effort | Wave 1 / M |
| Risk tags | security |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Fix owner | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `a5481bf7f92e7465` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W1-08 |
| Source files / LOC | 1 / 565 |

## 1. Scope and map

### Purpose and ownership
Unit `risk` owns `packages/ax-code/src/risk`. Risk profile: security.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/risk/score.ts` | 565 | 19 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `Risk@packages/ax-code/src/risk/score.ts:15` | public/internal | scanned |
| `Level@packages/ax-code/src/risk/score.ts:16` | public/internal | scanned |
| `ValidationState@packages/ax-code/src/risk/score.ts:17` | public/internal | scanned |
| `DiffState@packages/ax-code/src/risk/score.ts:18` | public/internal | scanned |
| `SemanticRisk@packages/ax-code/src/risk/score.ts:19` | public/internal | scanned |
| `Readiness@packages/ax-code/src/risk/score.ts:20` | public/internal | scanned |
| `Signals@packages/ax-code/src/risk/score.ts:22` | public/internal | scanned |
| `NormalizedSignals@packages/ax-code/src/risk/score.ts:45` | public/internal | scanned |
| `Assessment@packages/ax-code/src/risk/score.ts:64` | public/internal | scanned |
| `Factor@packages/ax-code/src/risk/score.ts:77` | public/internal | scanned |
| `SessionDiffJsonDecodeResult@packages/ax-code/src/risk/score.ts:84` | public/internal | scanned |
| `decodeSessionDiffValue@packages/ax-code/src/risk/score.ts:88` | public/internal | scanned |
| `decodeSessionDiffJson@packages/ax-code/src/risk/score.ts:93` | public/internal | scanned |
| `assess@packages/ax-code/src/risk/score.ts:235` | public/internal | scanned |
| `fromSession@packages/ax-code/src/risk/score.ts:395` | public/internal | scanned |

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

- io packages/ax-code/src/risk/score.ts:1
- secret packages/ax-code/src/risk/score.ts:104
- secret packages/ax-code/src/risk/score.ts:105
- secret packages/ax-code/src/risk/score.ts:106
- secret packages/ax-code/src/risk/score.ts:107
- io packages/ax-code/src/risk/score.ts:224
- secret packages/ax-code/src/risk/score.ts:373

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (19 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 1; total LOC: 565
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/risk`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 19

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
| Static deep extract | ok | fingerprint `a5481bf7f92e7465` |
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
| Reviewer | ax-code-glm | 2026-08-11 | Deep extract 1 files / 565 LOC / fp a5481bf7f92e7465 |
| Fix owner | ax-code-glm | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | codex-sol | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
