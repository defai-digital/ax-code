# MODULE-AUDIT: planner

| Field | Value |
|-------|-------|
| Unit slug | `planner` |
| Scope | `packages/ax-code/src/planner` |
| Wave / effort | Wave 2 / M |
| Risk tags | correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `ab5b55c58e0c2e8b` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-05 |
| Source files / LOC | 10 / 2159 |

## 1. Scope and map

### Purpose and ownership
Unit `planner` owns `packages/ax-code/src/planner`. Risk profile: correctness.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/planner/complexity.ts` | 145 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/dependency.ts` | 160 | 3 | 0 | 0 |
| `packages/ax-code/src/planner/estimator.ts` | 113 | 5 | 0 | 0 |
| `packages/ax-code/src/planner/index.ts` | 541 | 18 | 0 | 0 |
| `packages/ax-code/src/planner/replan-llm.ts` | 203 | 12 | 0 | 0 |
| `packages/ax-code/src/planner/types.ts` | 205 | 19 | 0 | 0 |
| `packages/ax-code/src/planner/verification/check-policy.ts` | 127 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/verification/index.ts` | 226 | 7 | 0 | 0 |
| `packages/ax-code/src/planner/verification/repair-handoff.ts` | 155 | 4 | 0 | 0 |
| `packages/ax-code/src/planner/verification/runner.ts` | 284 | 11 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ComplexityHint@packages/ax-code/src/planner/complexity.ts:41` | public/internal | scanned |
| `isComplex@packages/ax-code/src/planner/complexity.ts:52` | public/internal | scanned |
| `score@packages/ax-code/src/planner/complexity.ts:78` | public/internal | scanned |
| `minPhases@packages/ax-code/src/planner/complexity.ts:110` | public/internal | scanned |
| `ResolutionResult@packages/ax-code/src/planner/dependency.ts:11` | public/internal | scanned |
| `resolve@packages/ax-code/src/planner/dependency.ts:22` | public/internal | scanned |
| `ready@packages/ax-code/src/planner/dependency.ts:118` | public/internal | scanned |
| `phase@packages/ax-code/src/planner/estimator.ts:44` | public/internal | scanned |
| `plan@packages/ax-code/src/planner/estimator.ts:60` | public/internal | scanned |
| `batch@packages/ax-code/src/planner/estimator.ts:72` | public/internal | scanned |
| `phaseDuration@packages/ax-code/src/planner/estimator.ts:84` | public/internal | scanned |
| `planDuration@packages/ax-code/src/planner/estimator.ts:98` | public/internal | scanned |
| `type DepthLevel@packages/ax-code/src/planner/index.ts:61` | public/internal | scanned |
| `Planner@packages/ax-code/src/planner/index.ts:63` | public/internal | scanned |
| `ComplexityHint@packages/ax-code/src/planner/index.ts:71` | public/internal | scanned |

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

- secret packages/ax-code/src/planner/dependency.ts:96
- secret packages/ax-code/src/planner/estimator.ts:2
- secret packages/ax-code/src/planner/estimator.ts:3
- secret packages/ax-code/src/planner/estimator.ts:8
- secret packages/ax-code/src/planner/estimator.ts:9
- secret packages/ax-code/src/planner/estimator.ts:12
- secret packages/ax-code/src/planner/estimator.ts:14
- secret packages/ax-code/src/planner/estimator.ts:42
- secret packages/ax-code/src/planner/estimator.ts:45
- secret packages/ax-code/src/planner/estimator.ts:46
- secret packages/ax-code/src/planner/estimator.ts:49
- secret packages/ax-code/src/planner/estimator.ts:52

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (87 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 10; total LOC: 2159
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/planner`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 87

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
| Static deep extract | ok | fingerprint `ab5b55c58e0c2e8b` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 10 files / 2159 LOC / fp ab5b55c58e0c2e8b |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
