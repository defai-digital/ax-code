# MODULE-AUDIT: cli-cmd-tui-session-route

| Field | Value |
|-------|-------|
| Unit slug | `cli-cmd-tui-session-route` |
| Scope | `packages/ax-code/src/cli/cmd/tui routes/session` |
| Resolved root | `packages/ax-code/src/cli/cmd/tui` |
| XL filter | yes |
| Wave / effort | Wave 6 / L |
| Risk tags | cli |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `c71ea50a769e841a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 57 / 11680 |
| Inventory ID | W6-08b |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts` | 164 | 5 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/agent-control-activity.ts` | 47 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-active.ts` | 69 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-pulse.ts` | 75 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts` | 99 | 10 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/capability-catalog.ts` | 144 | 5 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/child.ts` | 24 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/coalesce.ts` | 59 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/compaction-view-model.ts` | 22 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/compare.ts` | 156 | 8 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/context.ts` | 26 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-activity.tsx` | 33 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-branch.tsx` | 87 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-capability-catalog.tsx` | 61 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-compare.tsx` | 105 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-dre-graph.tsx` | 91 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-dre.tsx` | 40 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-fork-from-timeline.tsx` | 97 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-goal.tsx` | 79 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-message.tsx` | 277 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-quality.tsx` | 214 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-rollback.tsx` | 61 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-timeline.tsx` | 70 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dialog-workflow.tsx` | 450 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/display-command-helpers.ts` | 18 | 2 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/display-commands.ts` | 606 | 1 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/display.ts` | 78 | 5 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/dre.ts` | 164 | 13 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/entry-sync.ts` | 42 | 3 | 0 | 0 |
| `packages/ax-code/src/cli/cmd/tui/routes/session/footer-view-model.ts` | 279 | 8 | 0 | 0 |

### Exports (sample)
- `Activity@packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts:6`
- `statusLabel@packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts:17`
- `activityIcon@packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts:80`
- `activityLabel@packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts:107`
- `activityItems@packages/ax-code/src/cli/cmd/tui/routes/session/activity.ts:153`
- `agentControlActivityItems@packages/ax-code/src/cli/cmd/tui/routes/session/agent-control-activity.ts:9`
- `agentControlActivityItem@packages/ax-code/src/cli/cmd/tui/routes/session/agent-control-activity.ts:13`
- `autonomousActiveView@packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-active.ts:20`
- `isLiveAutonomousText@packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-active.ts:37`
- `isAutonomousProducedMessage@packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-active.ts:59`
- `useAutonomousPulse@packages/ax-code/src/cli/cmd/tui/routes/session/autonomous-pulse.ts:60`
- `SessionBranch@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:3`
- `Session@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:4`
- `Item@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:5`
- `Detail@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:6`
- `Entry@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:8`
- `detail@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:17`
- `summary@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:25`
- `entries@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:32`
- `continueEntries@packages/ax-code/src/cli/cmd/tui/routes/session/branch.ts:63`

### Tests
- `packages/ax-code/test/acp/sdk-client-naming.test.ts`
- `packages/ax-code/test/acp/session-list.test.ts`
- `packages/ax-code/test/agent/router.test.ts`
- `packages/ax-code/test/cli/account.test.ts`
- `packages/ax-code/test/cli/acp.test.ts`
- `packages/ax-code/test/cli/agent.test.ts`
- `packages/ax-code/test/cli/audit.test.ts`
- `packages/ax-code/test/cli/boot.test.ts`
- `packages/ax-code/test/cli/bootstrap/windows-console.test.ts`
- `packages/ax-code/test/cli/capability.test.ts`
- `packages/ax-code/test/cli/cmd/tui/component/slash-frecency.test.ts`
- `packages/ax-code/test/cli/cmd/tui/prompt-part.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/autonomous-active.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/coalesce.test.ts`
- `packages/ax-code/test/cli/cmd/tui/routes/session/footer-view-model.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (252) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags cli | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `c71ea50a769e841a` |
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
