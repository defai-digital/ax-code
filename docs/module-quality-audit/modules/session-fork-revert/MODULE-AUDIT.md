# MODULE-AUDIT: session-fork-revert

| Field | Value |
|-------|-------|
| Unit slug | `session-fork-revert` |
| Scope | `packages/ax-code/src/session (fork/revert/rollback)` |
| Resolved root | `packages/ax-code/src/session` |
| XL filter | yes |
| Wave / effort | Wave 2 / M |
| Risk tags | correctness, persistence |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `06fce53738b59a56` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 5 / 1096 |
| Inventory ID | W2-01e |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/session/branch.ts` | 229 | 25 | 0 | 0 |
| `packages/ax-code/src/session/compare.ts` | 329 | 20 | 0 | 0 |
| `packages/ax-code/src/session/move.ts` | 168 | 10 | 0 | 0 |
| `packages/ax-code/src/session/revert.ts` | 163 | 6 | 0 | 0 |
| `packages/ax-code/src/session/rollback.ts` | 207 | 16 | 0 | 0 |

### Exports (sample)
- `SessionBranchRank@packages/ax-code/src/session/branch.ts:11`
- `SessionInfo@packages/ax-code/src/session/branch.ts:12`
- `SessionInfo@packages/ax-code/src/session/branch.ts:20`
- `RiskFactor@packages/ax-code/src/session/branch.ts:22`
- `RiskFactor@packages/ax-code/src/session/branch.ts:28`
- `RiskSignals@packages/ax-code/src/session/branch.ts:33`
- `RiskSignals@packages/ax-code/src/session/branch.ts:51`
- `RiskAssessment@packages/ax-code/src/session/branch.ts:53`
- `RiskAssessment@packages/ax-code/src/session/branch.ts:69`
- `ScorePart@packages/ax-code/src/session/branch.ts:71`
- `ScorePart@packages/ax-code/src/session/branch.ts:77`
- `Scorecard@packages/ax-code/src/session/branch.ts:79`
- `Scorecard@packages/ax-code/src/session/branch.ts:87`
- `Route@packages/ax-code/src/session/branch.ts:89`
- `Route@packages/ax-code/src/session/branch.ts:94`
- `View@packages/ax-code/src/session/branch.ts:96`
- `View@packages/ax-code/src/session/branch.ts:107`
- `Item@packages/ax-code/src/session/branch.ts:109`
- `Item@packages/ax-code/src/session/branch.ts:124`
- `Detail@packages/ax-code/src/session/branch.ts:126`

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
| Module contract | public exports (77) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags correctness,persistence | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `06fce53738b59a56` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=12 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
