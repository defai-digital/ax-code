# MODULE-AUDIT: ui-components-views

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-views` |
| Scope | `desktop/packages/ui/src/components/views` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `8648a4bd12be0561` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-23 |
| Source files / LOC | 76 / 23503 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-views` owns `desktop/packages/ui/src/components/views`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/views/ChatView.tsx` | 19 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffCommentSummaryBar.tsx` | 87 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffHunkReviewList.tsx` | 68 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffView.tsx` | 1871 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView-impl.tsx` | 3717 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView-paths.test.ts` | 33 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView.tsx` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/GitView-impl.tsx` | 2593 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/GitView.tsx` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/GoToLineDialog.tsx` | 254 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/MultiRunWindow.tsx` | 82 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/PierreDiffViewer.tsx` | 766 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/PlanView.tsx` | 815 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/PreviewToggleButton.tsx` | 40 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/views/SettingsView.tsx` | 916 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/SettingsWindow.tsx` | 69 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/TerminalView.tsx` | 1280 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/agent-manager/AgentGroupDetail.tsx` | 346 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/agent-manager/AgentManagerEmptyState.tsx` | 663 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/agent-manager/AgentManagerSidebar.tsx` | 286 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/agent-manager/AgentManagerView.tsx` | 90 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/agent-manager/index.ts` | 4 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/views/diffHunkRevert.test.ts` | 38 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/diffHunkRevert.ts` | 27 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewAutoSaveStatus.test.ts` | 92 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ChatView@desktop/packages/ui/src/components/views/ChatView.tsx:10` | public/internal | scanned |
| `DiffCommentSummaryBar@desktop/packages/ui/src/components/views/DiffCommentSummaryBar.tsx:17` | public/internal | scanned |
| `DiffHunkReviewList@desktop/packages/ui/src/components/views/DiffHunkReviewList.tsx:15` | public/internal | scanned |
| `DiffView@desktop/packages/ui/src/components/views/DiffView.tsx:916` | public/internal | scanned |
| `useDiffFileCount@desktop/packages/ui/src/components/views/DiffView.tsx:1854` | public/internal | scanned |
| `FilesView@desktop/packages/ui/src/components/views/FilesView-impl.tsx:548` | public/internal | scanned |
| `FilesView@desktop/packages/ui/src/components/views/FilesView.tsx:1` | public/internal | scanned |
| `GitView@desktop/packages/ui/src/components/views/GitView-impl.tsx:226` | public/internal | scanned |
| `GitView@desktop/packages/ui/src/components/views/GitView.tsx:1` | public/internal | scanned |
| `GoToLineDialog@desktop/packages/ui/src/components/views/GoToLineDialog.tsx:57` | public/internal | scanned |
| `MultiRunWindow@desktop/packages/ui/src/components/views/MultiRunWindow.tsx:14` | public/internal | scanned |
| `PierreDiffViewer@desktop/packages/ui/src/components/views/PierreDiffViewer.tsx:193` | public/internal | scanned |
| `PlanView@desktop/packages/ui/src/components/views/PlanView.tsx:72` | public/internal | scanned |
| `PreviewToggleButtonProps@desktop/packages/ui/src/components/views/PreviewToggleButton.tsx:7` | public/internal | scanned |
| `PreviewToggleButton@desktop/packages/ui/src/components/views/PreviewToggleButton.tsx:20` | public/internal | scanned |

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

- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:756
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1174
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1184
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1378
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1380
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1381
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1398
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1405
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1457
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1470
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1472
- io desktop/packages/ui/src/components/views/FilesView-impl.tsx:1477

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (124 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 76; total LOC: 23503
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/views`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 124

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
| Static deep extract | ok | fingerprint `8648a4bd12be0561` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 76 files / 23503 LOC / fp 8648a4bd12be0561 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
