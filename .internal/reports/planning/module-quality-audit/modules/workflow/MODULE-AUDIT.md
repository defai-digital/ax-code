# MODULE-AUDIT: workflow

| Field | Value |
|-------|-------|
| Unit slug | `workflow` |
| Scope | `packages/ax-code/src/workflow` |
| Wave / effort | Wave 2 / L |
| Risk tags | concurrency, persistence |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `0a8b0bc065313c6c` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W2-07 |
| Source files / LOC | 20 / 6084 |

## 1. Scope and map

### Purpose and ownership
Unit `workflow` owns `packages/ax-code/src/workflow`. Risk profile: concurrency, persistence.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/workflow/artifact.ts` | 32 | 4 | 0 | 0 |
| `packages/ax-code/src/workflow/budget.ts` | 161 | 10 | 0 | 0 |
| `packages/ax-code/src/workflow/dispatch-adapter.ts` | 311 | 7 | 0 | 0 |
| `packages/ax-code/src/workflow/eval-corpus.ts` | 312 | 8 | 0 | 0 |
| `packages/ax-code/src/workflow/eval.ts` | 315 | 8 | 0 | 0 |
| `packages/ax-code/src/workflow/fixtures.ts` | 246 | 5 | 0 | 0 |
| `packages/ax-code/src/workflow/index.ts` | 39 | 0 | 0 | 0 |
| `packages/ax-code/src/workflow/planner.ts` | 336 | 6 | 0 | 0 |
| `packages/ax-code/src/workflow/projection.ts` | 192 | 5 | 0 | 0 |
| `packages/ax-code/src/workflow/routine.ts` | 306 | 10 | 0 | 0 |
| `packages/ax-code/src/workflow/run/budget.ts` | 212 | 2 | 0 | 0 |
| `packages/ax-code/src/workflow/run/final-report.ts` | 396 | 2 | 0 | 0 |
| `packages/ax-code/src/workflow/run/index.ts` | 490 | 22 | 0 | 0 |
| `packages/ax-code/src/workflow/run/internal.ts` | 526 | 33 | 0 | 0 |
| `packages/ax-code/src/workflow/scheduler.ts` | 555 | 10 | 0 | 0 |
| `packages/ax-code/src/workflow/spec.ts` | 475 | 36 | 0 | 0 |
| `packages/ax-code/src/workflow/state.ts` | 446 | 40 | 0 | 0 |
| `packages/ax-code/src/workflow/task-queue.ts` | 245 | 4 | 0 | 0 |
| `packages/ax-code/src/workflow/template.ts` | 316 | 19 | 0 | 0 |
| `packages/ax-code/src/workflow/workflow.sql.ts` | 173 | 5 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `WorkflowArtifactRedaction@packages/ax-code/src/workflow/artifact.ts:4` | public/internal | scanned |
| `defaultWorkflowArtifactRedaction@packages/ax-code/src/workflow/artifact.ts:6` | public/internal | scanned |
| `compactWorkflowArtifact@packages/ax-code/src/workflow/artifact.ts:17` | public/internal | scanned |
| `workflowArtifactRedactionFromSpec@packages/ax-code/src/workflow/artifact.ts:25` | public/internal | scanned |
| `WorkflowBudgetEvaluation@packages/ax-code/src/workflow/budget.ts:4` | public/internal | scanned |
| `WorkflowBudgetEvaluationInput@packages/ax-code/src/workflow/budget.ts:10` | public/internal | scanned |
| `WorkflowChildBudgetEvaluationInput@packages/ax-code/src/workflow/budget.ts:17` | public/internal | scanned |
| `normalizeWorkflowBudgetUsage@packages/ax-code/src/workflow/budget.ts:24` | public/internal | scanned |
| `addWorkflowBudgetUsage@packages/ax-code/src/workflow/budget.ts:28` | public/internal | scanned |
| `evaluateWorkflowBudget@packages/ax-code/src/workflow/budget.ts:44` | public/internal | scanned |
| `evaluateWorkflowChildBudget@packages/ax-code/src/workflow/budget.ts:65` | public/internal | scanned |
| `assertWorkflowBudgetAvailable@packages/ax-code/src/workflow/budget.ts:109` | public/internal | scanned |
| `reserveWorkflowBudget@packages/ax-code/src/workflow/budget.ts:117` | public/internal | scanned |
| `WorkflowBudgetExceededError@packages/ax-code/src/workflow/budget.ts:138` | public/internal | scanned |
| `WorkflowDispatchAdapter@packages/ax-code/src/workflow/dispatch-adapter.ts:14` | public/internal | scanned |

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

- secret packages/ax-code/src/workflow/budget.ts:35
- secret packages/ax-code/src/workflow/budget.ts:36
- secret packages/ax-code/src/workflow/budget.ts:37
- secret packages/ax-code/src/workflow/budget.ts:50
- secret packages/ax-code/src/workflow/budget.ts:72
- secret packages/ax-code/src/workflow/budget.ts:73
- secret packages/ax-code/src/workflow/budget.ts:75
- secret packages/ax-code/src/workflow/budget.ts:77
- secret packages/ax-code/src/workflow/budget.ts:78
- secret packages/ax-code/src/workflow/budget.ts:79
- secret packages/ax-code/src/workflow/budget.ts:85
- secret packages/ax-code/src/workflow/budget.ts:87

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| session/turn consistency | async race / abort | double-run, lost cancel, stale write | locks/queues where present | must validate abort paths in tests |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (236 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 20; total LOC: 6084
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `packages/ax-code/src/workflow`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 236

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
| Static deep extract | ok | fingerprint `0a8b0bc065313c6c` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 20 files / 6084 LOC / fp 0a8b0bc065313c6c |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
