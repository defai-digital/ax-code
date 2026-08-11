# MODULE-AUDIT: session-compaction

| Field | Value |
|-------|-------|
| Unit slug | `session-compaction` |
| Scope | `packages/ax-code/src/session (compaction)` |
| Resolved root | `packages/ax-code/src/session` |
| XL filter | yes |
| Wave / effort | Wave 2 / M |
| Risk tags | hot-path, correctness |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `077558249a7bc853` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 4 / 1090 |
| Inventory ID | W2-01c |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/compaction.ts` | 582 | 9 | 0 | 0 |
| `packages/ax-code/src/session/prompt-loop-compaction.ts` | 234 | 5 | 0 | 0 |
| `packages/ax-code/src/session/prompt-session-summary.ts` | 32 | 1 | 0 | 0 |
| `packages/ax-code/src/session/summary.ts` | 242 | 4 | 0 | 0 |

### Exports (sample)
- `SessionCompaction@packages/ax-code/src/session/compaction.ts:22`
- `TriggerReason@packages/ax-code/src/session/compaction.ts:26`
- `TriggerReason@packages/ax-code/src/session/compaction.ts:27`
- `Event@packages/ax-code/src/session/compaction.ts:29`
- `budget@packages/ax-code/src/session/compaction.ts:57`
- `isOverflow@packages/ax-code/src/session/compaction.ts:91`
- `prune@packages/ax-code/src/session/compaction.ts:148`
- `process@packages/ax-code/src/session/compaction.ts:271`
- `create@packages/ax-code/src/session/compaction.ts:537`
- `hasUnresolvedMedia@packages/ax-code/src/session/prompt-loop-compaction.ts:20`
- `processPendingCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:29`
- `maybeScheduleUsageCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:66`
- `PreflightCompactionResult@packages/ax-code/src/session/prompt-loop-compaction.ts:108`
- `maybeSchedulePreflightCompaction@packages/ax-code/src/session/prompt-loop-compaction.ts:142`
- `scheduleFirstTurnSummary@packages/ax-code/src/session/prompt-session-summary.ts:9`
- `SessionSummary@packages/ax-code/src/session/summary.ts:16`
- `summarize@packages/ax-code/src/session/summary.ts:80`
- `diff@packages/ax-code/src/session/summary.ts:163`
- `computeDiff@packages/ax-code/src/session/summary.ts:215`

### Tests
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/format.test.ts`
- `packages/ax-code/test/cli/session-clear-project.test.ts`
- `packages/ax-code/test/cli/tui/h-session-undo-redo-revert-error.test.ts`
- `packages/ax-code/test/cli/tui/s-dialog-session-list-rename-sdk-error.test.ts`
- `packages/ax-code/test/cli/tui/session-child.test.ts`
- `packages/ax-code/test/cli/tui/session-compaction-notice.test.ts`
- `packages/ax-code/test/cli/tui/session-display-commands.test.ts`
- `packages/ax-code/test/cli/tui/session-display.test.ts`
- `packages/ax-code/test/cli/tui/session-entry-sync.test.ts`
- `packages/ax-code/test/cli/tui/session-first-startup-guard.test.ts`
- `packages/ax-code/test/cli/tui/session-format.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (19) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags hot-path,correctness | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `077558249a7bc853` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=8 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
