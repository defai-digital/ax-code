# MODULE-AUDIT: session-prompt-processor

| Field | Value |
|-------|-------|
| Unit slug | `session-prompt-processor` |
| Scope | `packages/ax-code/src/session (prompt/processor)` |
| Resolved root | `packages/ax-code/src/session` |
| XL filter | yes |
| Wave / effort | Wave 2 / L |
| Risk tags | hot-path, correctness |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `046510f0ca8a215f632e99fa92aa0633d684cbb9` |
| Analysis fingerprint | `dd428f964265ebb9` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 79 / 12486 |
| Inventory ID | W2-01a |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/llm-impl.ts` | 1048 | 19 | 0 | 0 |
| `packages/ax-code/src/session/llm.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/session/processor-impl.ts` | 1301 | 4 | 0 | 0 |
| `packages/ax-code/src/session/processor.ts` | 2 | 0 | 0 | 0 |
| `packages/ax-code/src/session/prompt-agent-model-info.ts` | 75 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-assistant-response.ts` | 53 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-autonomous-continuations.ts` | 283 | 16 | 0 | 0 |
| `packages/ax-code/src/session/prompt-autonomous-decisions.ts` | 730 | 24 | 0 | 0 |
| `packages/ax-code/src/session/prompt-autonomous-ledger.ts` | 57 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-cache.ts` | 14 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-code-graph.ts` | 84 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-execution.ts` | 100 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-parts.ts` | 36 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-selection.ts` | 57 | 3 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-setup.ts` | 101 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-template.ts` | 73 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command-workflow.ts` | 200 | 5 | 0 | 0 |
| `packages/ax-code/src/session/prompt-command.ts` | 33 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-file-attachment.ts` | 291 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-file-reference.ts` | 27 | 2 | 0 | 0 |
| `packages/ax-code/src/session/prompt-goal-arguments.ts` | 56 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-goal-command.ts` | 131 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-goal-usage.ts` | 22 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-helpers.ts` | 31 | 0 | 0 | 0 |
| `packages/ax-code/src/session/prompt-impl.ts` | 1548 | 15 | 0 | 0 |
| `packages/ax-code/src/session/prompt-input.ts` | 71 | 8 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-agent-step-limit.ts` | 84 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-compaction.ts` | 234 | 5 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-completion-gate-retry.ts` | 93 | 1 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-completion-gate.ts` | 51 | 1 | 0 | 0 |

### Exports (sample)
- `LLM@packages/ax-code/src/session/llm-impl.ts:44`
- `StreamInput@packages/ax-code/src/session/llm-impl.ts:66`
- `StreamOutput@packages/ax-code/src/session/llm-impl.ts:82`
- `lastStreamError@packages/ax-code/src/session/llm-impl.ts:93`
- `repairedToolName@packages/ax-code/src/session/llm-impl.ts:97`
- `stream@packages/ax-code/src/session/llm-impl.ts:109`
- `SuperLongPacingReservation@packages/ax-code/src/session/llm-impl.ts:492`
- `isCliProviderID@packages/ax-code/src/session/llm-impl.ts:618`
- `streamIdleTimeoutMs@packages/ax-code/src/session/llm-impl.ts:632`
- `attachStreamIdleWatchdog@packages/ax-code/src/session/llm-impl.ts:643`
- `clearPacingState@packages/ax-code/src/session/llm-impl.ts:967`
- `pacingKeyForTest@packages/ax-code/src/session/llm-impl.ts:972`
- `getPacingStateForTest@packages/ax-code/src/session/llm-impl.ts:978`
- `setPacingStateForTest@packages/ax-code/src/session/llm-impl.ts:984`
- `applySuperLongPacingForTest@packages/ax-code/src/session/llm-impl.ts:991`
- `attachSuperLongPacingReservationForTest@packages/ax-code/src/session/llm-impl.ts:995`
- `hasToolCalls@packages/ax-code/src/session/llm-impl.ts:1005`
- `extractLastUserTask@packages/ax-code/src/session/llm-impl.ts:1016`
- `extractTouchedFiles@packages/ax-code/src/session/llm-impl.ts:1031`
- `SessionProcessor@packages/ax-code/src/session/processor-impl.ts:38`

### Tests
- `packages/ax-code/test/acp/agent-prompt.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/github-agent-prompts.test.ts`
- `packages/ax-code/test/cli/prompt-view-model.test.ts`
- `packages/ax-code/test/cli/session-clear-project.test.ts`
- `packages/ax-code/test/cli/tui/h-session-undo-redo-revert-error.test.ts`
- `packages/ax-code/test/cli/tui/prompt-autocomplete-offsets.test.ts`
- `packages/ax-code/test/cli/tui/prompt-filepath.test.ts`
- `packages/ax-code/test/cli/tui/prompt-frecency.test.ts`
- `packages/ax-code/test/cli/tui/prompt-helpers.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (244) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| AUDIT-session-prompt-processor-001 | stability | Critical | prior/new | verified-fixed |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `dd428f964265ebb9` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=27 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
