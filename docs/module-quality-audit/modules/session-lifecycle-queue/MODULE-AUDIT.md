# MODULE-AUDIT: session-lifecycle-queue

| Field | Value |
|-------|-------|
| Unit slug | `session-lifecycle-queue` |
| Scope | `packages/ax-code/src/session (lifecycle/queue)` |
| Resolved root | `packages/ax-code/src/session` |
| XL filter | yes |
| Wave / effort | Wave 2 / L |
| Risk tags | concurrency, hot-path |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `94e95c161c7deb8e055d8806a5f285e516285715` |
| Analysis fingerprint | `ae6b2a132bfbb86d` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 27 / 4488 |
| Inventory ID | W2-01d |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/cycle-detection.ts` | 46 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-agent-step-limit.ts` | 84 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-compaction.ts` | 234 | 5 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-completion-gate-retry.ts` | 93 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-completion-gate.ts` | 51 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-config.ts` | 63 | 8 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-decisions.ts` | 407 | 10 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-empty-turn.ts` | 105 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-errors.ts` | 298 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-exit.ts` | 44 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-failure.ts` | 57 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-goal.ts` | 85 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-messages.ts` | 132 | 4 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-queue.ts` | 44 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-recording.ts` | 49 | 3 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-result.ts` | 85 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-status.ts` | 39 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-step-limit.ts` | 58 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-todo-continuation.ts` | 124 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-todo-convergence.ts` | 103 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-total-step-limit.ts` | 78 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-truncated-turn.ts` | 131 | 3 | 0 | 0 |
| `packages/ax-code/src/session/prompt-run-state.ts` | 101 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-runtime-policy.ts` | 46 | 4 | 0 | 0 |
| `packages/ax-code/src/session/task-queue-executor-impl.ts` | 1193 | 6 | 0 | 0 |
| `packages/ax-code/src/session/task-queue-executor.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/session/task-queue.ts` | 736 | 39 | 0 | 0 |

### Exports (sample)
- `RingEntry@packages/ax-code/src/session/cycle-detection.ts:3`
- `detectCycle@packages/ax-code/src/session/cycle-detection.ts:18`
- `handlePromptLoopAgentStepLimit@packages/ax-code/src/session/prompt-loop-agent-step-limit.ts:31`
- `hasUnresolvedMedia@packages/ax-code/src/session/prompt-loop-compaction.ts:20`
- `processPendingCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:29`
- `maybeScheduleUsageCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:66`
- `PreflightCompactionResult@packages/ax-code/src/session/prompt-loop-compaction.ts:108`
- `maybeSchedulePreflightCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:142`
- `handlePromptLoopCompletionGateRetry@packages/ax-code/src/session/prompt-loop-completion-gate-retry.ts:34`
- `emitPromptLoopCompletionGateDecision@packages/ax-code/src/session/prompt-loop-completion-gate.ts:12`
- `MAX_EMPTY_MODEL_TURN_RETRIES@packages/ax-code/src/session/prompt-loop-config.ts:4`
- `TOOL_ONLY_TURN_NUDGE@packages/ax-code/src/session/prompt-loop-config.ts:9`
- `MAX_TOOL_ONLY_TURNS@packages/ax-code/src/session/prompt-loop-config.ts:19`
- `TOOL_ONLY_TURN_FINAL_NUDGE@packages/ax-code/src/session/prompt-loop-config.ts:24`
- `AX_ENGINE_READ_ONLY_TURN_NUDGE@packages/ax-code/src/session/prompt-loop-config.ts:30`
- `AX_ENGINE_READ_ONLY_TURN_FORCE@packages/ax-code/src/session/prompt-loop-config.ts:31`
- `MAX_TRUNCATED_MODEL_TURN_RETRIES@packages/ax-code/src/session/prompt-loop-config.ts:38`
- `promptLoopLimits@packages/ax-code/src/session/prompt-loop-config.ts:40`
- `pendingCompactionDecision@packages/ax-code/src/session/prompt-loop-decisions.ts:86`
- `shouldScheduleUsageCompaction@packages/ax-code/src/session/prompt-loop-decisions.ts:103`

### Tests
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/bug-reports/lifecycle-visibility.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/run-lifecycle.test.ts`
- `packages/ax-code/test/cli/session-clear-project.test.ts`
- `packages/ax-code/test/cli/tui/follow-up-queue.test.ts`
- `packages/ax-code/test/cli/tui/h-session-undo-redo-revert-error.test.ts`
- `packages/ax-code/test/cli/tui/lifecycle-crash-handler.test.ts`
- `packages/ax-code/test/cli/tui/lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/m-startup-lifecycle.test.ts`
- `packages/ax-code/test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/session-child.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (102) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags concurrency,hot-path | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `ae6b2a132bfbb86d` |
| Dual-agent protocol | PENDING |
| Critical independent verify | pending |

### Exit checklist
- [ ] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [ ] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | — | — | protocol pending |
| Independent verifier | — | — | pending |
| Module owner | — | — | REVIEWING |
