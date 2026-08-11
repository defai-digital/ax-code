# MODULE-AUDIT: workflow

| Field | Value |
|-------|-------|
| Unit slug | `workflow` |
| Scope | `packages/ax-code/src/workflow` |
| Resolved root | `packages/ax-code/src/workflow` |
| XL filter | no |
| Wave / effort | Wave 2 / L |
| Risk tags | concurrency, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `6ab172d1a7290779` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 20 / 6084 |
| Inventory ID | W2-07 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/workflow/artifact.ts` | 32 | 4 | 0 | 0 |
| `packages/ax-code/src/workflow/budget.ts` | 161 | 10 | 0 | 0 |
| `packages/ax-code/src/workflow/dispatch-adapter.ts` | 311 | 7 | 0 | 0 |
| `packages/ax-code/src/workflow/eval-corpus.ts` | 312 | 13 | 0 | 0 |
| `packages/ax-code/src/workflow/eval.ts` | 315 | 14 | 0 | 0 |
| `packages/ax-code/src/workflow/fixtures.ts` | 246 | 5 | 0 | 0 |
| `packages/ax-code/src/workflow/index.ts` | 39 | 0 | 0 | 0 |
| `packages/ax-code/src/workflow/planner.ts` | 336 | 7 | 0 | 0 |
| `packages/ax-code/src/workflow/projection.ts` | 192 | 9 | 0 | 0 |
| `packages/ax-code/src/workflow/routine.ts` | 306 | 13 | 0 | 0 |
| `packages/ax-code/src/workflow/run/budget.ts` | 212 | 2 | 0 | 0 |
| `packages/ax-code/src/workflow/run/final-report.ts` | 396 | 2 | 0 | 0 |
| `packages/ax-code/src/workflow/run/index.ts` | 490 | 21 | 0 | 0 |
| `packages/ax-code/src/workflow/run/internal.ts` | 526 | 32 | 0 | 0 |
| `packages/ax-code/src/workflow/scheduler.ts` | 555 | 11 | 0 | 0 |
| `packages/ax-code/src/workflow/spec.ts` | 475 | 52 | 0 | 0 |
| `packages/ax-code/src/workflow/state.ts` | 446 | 70 | 0 | 0 |
| `packages/ax-code/src/workflow/task-queue.ts` | 245 | 5 | 0 | 0 |
| `packages/ax-code/src/workflow/template.ts` | 316 | 27 | 0 | 0 |
| `packages/ax-code/src/workflow/workflow.sql.ts` | 173 | 5 | 0 | 0 |

### Exports (sample)
- `WorkflowArtifactRedaction@packages/ax-code/src/workflow/artifact.ts:4`
- `defaultWorkflowArtifactRedaction@packages/ax-code/src/workflow/artifact.ts:6`
- `compactWorkflowArtifact@packages/ax-code/src/workflow/artifact.ts:17`
- `workflowArtifactRedactionFromSpec@packages/ax-code/src/workflow/artifact.ts:25`
- `WorkflowBudgetEvaluation@packages/ax-code/src/workflow/budget.ts:4`
- `WorkflowBudgetEvaluationInput@packages/ax-code/src/workflow/budget.ts:10`
- `WorkflowChildBudgetEvaluationInput@packages/ax-code/src/workflow/budget.ts:17`
- `normalizeWorkflowBudgetUsage@packages/ax-code/src/workflow/budget.ts:24`
- `addWorkflowBudgetUsage@packages/ax-code/src/workflow/budget.ts:28`
- `evaluateWorkflowBudget@packages/ax-code/src/workflow/budget.ts:44`
- `evaluateWorkflowChildBudget@packages/ax-code/src/workflow/budget.ts:65`
- `assertWorkflowBudgetAvailable@packages/ax-code/src/workflow/budget.ts:109`
- `reserveWorkflowBudget@packages/ax-code/src/workflow/budget.ts:117`
- `WorkflowBudgetExceededError@packages/ax-code/src/workflow/budget.ts:138`
- `WorkflowDispatchAdapter@packages/ax-code/src/workflow/dispatch-adapter.ts:14`
- `ExecutePhaseInput@packages/ax-code/src/workflow/dispatch-adapter.ts:15`
- `ExecutePhaseResult@packages/ax-code/src/workflow/dispatch-adapter.ts:25`
- `executePhase@packages/ax-code/src/workflow/dispatch-adapter.ts:30`
- `WorkflowDispatchWritePolicyError@packages/ax-code/src/workflow/dispatch-adapter.ts:163`
- `WorkflowDispatchExecutorMissingError@packages/ax-code/src/workflow/dispatch-adapter.ts:170`

### Tests
- `packages/ax-code/test/cli/tui/session-workflow-status.test.ts`
- `packages/ax-code/test/cli/tui/workflow-dashboard.test.ts`
- `packages/ax-code/test/cli/workflow.test.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/auth.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/cache.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/render.ts`
- `packages/ax-code/test/fixture/workflow/verified-bug-sweep-seeded/src/retry.ts`
- `packages/ax-code/test/script/desktop-release-workflow.test.ts`
- `packages/ax-code/test/server/workflow-routes.test.ts`
- `packages/ax-code/test/session/debug-workflow-prompts.test.ts`
- `packages/ax-code/test/session/prompt-command-workflow.test.ts`
- `packages/ax-code/test/session/workflow-effort-mapping.test.ts`
- `packages/ax-code/test/tool/debug_runtime_workflow.test.ts`
- `packages/ax-code/test/workflow/artifact.test.ts`
- `packages/ax-code/test/workflow/budget.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (309) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags concurrency,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `6ab172d1a7290779` |
| Dual-agent protocol | complete |
| Critical independent verify | codex-sol |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=21 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
