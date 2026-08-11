# MODULE-AUDIT: ui-components-session

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-session` |
| Scope | `desktop/packages/ui/src/components/session` |
| Resolved root | `desktop/packages/ui/src/components/session` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `20f1bcc59f6344c4` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 66 / 19831 |
| Inventory ID | W8-03-19 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/session/DirectoryExplorerDialog-paths.test.ts` | 21 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/DirectoryExplorerDialog-paths.ts` | 6 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/DirectoryExplorerDialog.tsx` | 803 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/GitHubIntegrationDialog.tsx` | 675 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/GitHubIssuePickerDialog.tsx` | 799 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/GitHubPrPickerDialog.tsx` | 531 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/NewWorktreeDialog.tsx` | 2163 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/ProjectNotesTodoPanel.tsx` | 1023 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SaveProjectPlanDialog.test.tsx` | 43 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SaveProjectPlanDialog.tsx` | 87 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/ScheduledTaskEditorDialog.tsx` | 1640 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/ScheduledTasksDialog.relativeTime.test.ts` | 86 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/ScheduledTasksDialog.tsx` | 660 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SessionDialogs.tsx` | 830 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SessionFolderItem.tsx` | 376 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SessionMoveDialog.tsx` | 271 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SessionSidebar.tsx` | 1666 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/SessionSwitcherDropdown.tsx` | 389 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/session/TodoSendDialog.tsx` | 250 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIntegrationListLoad.test.ts` | 48 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIntegrationListLoad.ts` | 26 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIssueDetailLoad.test.ts` | 48 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIssueDetailLoad.ts` | 26 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIssueListLoad.test.ts` | 63 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubIssueListLoad.ts` | 28 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubPrAttachLoad.test.ts` | 48 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubPrAttachLoad.ts` | 26 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubPrListLoad.test.ts` | 53 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubPrListLoad.ts` | 28 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/session/githubSourceRepoOption.test.ts` | 32 | 0 | 0 | 0 |

### Exports (sample)
- `normalizeDirectoryExplorerProjectPathKey@desktop/packages/ui/src/components/session/DirectoryExplorerDialog-paths.ts:3`
- `DirectoryExplorerDialog@desktop/packages/ui/src/components/session/DirectoryExplorerDialog.tsx:131`
- `GitHubIntegrationDialog@desktop/packages/ui/src/components/session/GitHubIntegrationDialog.tsx:40`
- `GitHubIssuePickerDialog@desktop/packages/ui/src/components/session/GitHubIssuePickerDialog.tsx:68`
- `GitHubPrPickerDialog@desktop/packages/ui/src/components/session/GitHubPrPickerDialog.tsx:51`
- `NewWorktreeDialog@desktop/packages/ui/src/components/session/NewWorktreeDialog.tsx:198`
- `ProjectNotesTodoPanel@desktop/packages/ui/src/components/session/ProjectNotesTodoPanel.tsx:143`
- `SaveProjectPlanDialog@desktop/packages/ui/src/components/session/SaveProjectPlanDialog.tsx:23`
- `ScheduledTaskEditorDialog@desktop/packages/ui/src/components/session/ScheduledTaskEditorDialog.tsx:600`
- `ScheduledTasksDialog@desktop/packages/ui/src/components/session/ScheduledTasksDialog.tsx:153`
- `SessionDialogs@desktop/packages/ui/src/components/session/SessionDialogs.tsx:51`
- `SessionFolderItem@desktop/packages/ui/src/components/session/SessionFolderItem.tsx:373`
- `SessionMoveDialog@desktop/packages/ui/src/components/session/SessionMoveDialog.tsx:54`
- `SessionSidebar@desktop/packages/ui/src/components/session/SessionSidebar.tsx:147`
- `SessionSwitcherDropdown@desktop/packages/ui/src/components/session/SessionSwitcherDropdown.tsx:29`
- `TodoSendExecution@desktop/packages/ui/src/components/session/TodoSendDialog.tsx:16`
- `TodoSendDialog@desktop/packages/ui/src/components/session/TodoSendDialog.tsx:88`
- `GitHubIntegrationListLoadResult@desktop/packages/ui/src/components/session/githubIntegrationListLoad.ts:1`
- `loadCurrentGitHubIntegrationList@desktop/packages/ui/src/components/session/githubIntegrationListLoad.ts:6`
- `GitHubIssueDetailLoadResult@desktop/packages/ui/src/components/session/githubIssueDetailLoad.ts:1`

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
| Module contract | public exports (107) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `20f1bcc59f6344c4` |
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
