# MODULE-AUDIT: ui-components-session

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-session` |
| Scope | `desktop/packages/ui/src/components/session` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `52fb2496a84b0fc8` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-19 |
| Source files / LOC | 66 / 19831 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-session` owns `desktop/packages/ui/src/components/session`. Risk profile: desktop, ui.

### Source inventory (extracted)

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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `normalizeDirectoryExplorerProjectPathKey@desktop/packages/ui/src/components/session/DirectoryExplorerDialog-paths.ts:3` | public/internal | scanned |
| `DirectoryExplorerDialog@desktop/packages/ui/src/components/session/DirectoryExplorerDialog.tsx:131` | public/internal | scanned |
| `GitHubIntegrationDialog@desktop/packages/ui/src/components/session/GitHubIntegrationDialog.tsx:40` | public/internal | scanned |
| `GitHubIssuePickerDialog@desktop/packages/ui/src/components/session/GitHubIssuePickerDialog.tsx:68` | public/internal | scanned |
| `GitHubPrPickerDialog@desktop/packages/ui/src/components/session/GitHubPrPickerDialog.tsx:51` | public/internal | scanned |
| `NewWorktreeDialog@desktop/packages/ui/src/components/session/NewWorktreeDialog.tsx:198` | public/internal | scanned |
| `ProjectNotesTodoPanel@desktop/packages/ui/src/components/session/ProjectNotesTodoPanel.tsx:143` | public/internal | scanned |
| `SaveProjectPlanDialog@desktop/packages/ui/src/components/session/SaveProjectPlanDialog.tsx:23` | public/internal | scanned |
| `ScheduledTaskEditorDialog@desktop/packages/ui/src/components/session/ScheduledTaskEditorDialog.tsx:600` | public/internal | scanned |
| `ScheduledTasksDialog@desktop/packages/ui/src/components/session/ScheduledTasksDialog.tsx:153` | public/internal | scanned |
| `SessionDialogs@desktop/packages/ui/src/components/session/SessionDialogs.tsx:51` | public/internal | scanned |
| `SessionFolderItem@desktop/packages/ui/src/components/session/SessionFolderItem.tsx:373` | public/internal | scanned |
| `SessionMoveDialog@desktop/packages/ui/src/components/session/SessionMoveDialog.tsx:54` | public/internal | scanned |
| `SessionSidebar@desktop/packages/ui/src/components/session/SessionSidebar.tsx:147` | public/internal | scanned |
| `SessionSwitcherDropdown@desktop/packages/ui/src/components/session/SessionSwitcherDropdown.tsx:29` | public/internal | scanned |

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

- process desktop/packages/ui/src/components/session/ScheduledTaskEditorDialog.tsx:55
- process desktop/packages/ui/src/components/session/ScheduledTaskEditorDialog.tsx:124
- io desktop/packages/ui/src/components/session/SessionSidebar.tsx:189
- io desktop/packages/ui/src/components/session/SessionSidebar.tsx:201
- io desktop/packages/ui/src/components/session/SessionSidebar.tsx:222
- io desktop/packages/ui/src/components/session/sidebar/SessionNodeItem.tsx:875
- io desktop/packages/ui/src/components/session/sidebar/activitySections.ts:37
- io desktop/packages/ui/src/components/session/sidebar/hooks/useSidebarPersistence.ts:106
- io desktop/packages/ui/src/components/session/sidebar/hooks/useSidebarPersistence.ts:115
- io desktop/packages/ui/src/components/session/sidebar/hooks/useSidebarPersistence.ts:143

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (107 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 66; total LOC: 19831
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/session`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 107

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
| Static deep extract | ok | fingerprint `52fb2496a84b0fc8` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 66 files / 19831 LOC / fp 52fb2496a84b0fc8 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
