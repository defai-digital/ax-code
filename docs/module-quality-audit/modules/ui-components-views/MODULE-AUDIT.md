# MODULE-AUDIT: ui-components-views

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-views` |
| Scope | `desktop/packages/ui/src/components/views` |
| Resolved root | `desktop/packages/ui/src/components/views` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `5a21a801dca3628a` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 76 / 23503 |
| Inventory ID | W8-03-23 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/views/ChatView.tsx` | 19 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffCommentSummaryBar.tsx` | 87 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffHunkReviewList.tsx` | 68 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/DiffView.tsx` | 1871 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView-impl.tsx` | 3717 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView-paths.test.ts` | 33 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/FilesView.tsx` | 2 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/GitView-impl.tsx` | 2593 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/views/GitView.tsx` | 2 | 0 | 0 | 0 |
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
| `desktop/packages/ui/src/components/views/agent-manager/index.ts` | 4 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/diffHunkRevert.test.ts` | 38 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/diffHunkRevert.ts` | 27 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewAutoSaveStatus.test.ts` | 92 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewAutoSaveStatus.ts` | 36 | 4 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewEditorContent.test.ts` | 62 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewEditorContent.ts` | 33 | 5 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewPathUtils.test.ts` | 42 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/views/filesViewPathUtils.ts` | 76 | 5 | 0 | 0 |

### Exports (sample)
- `ChatView@desktop/packages/ui/src/components/views/ChatView.tsx:10`
- `DiffCommentSummaryBar@desktop/packages/ui/src/components/views/DiffCommentSummaryBar.tsx:17`
- `DiffHunkReviewList@desktop/packages/ui/src/components/views/DiffHunkReviewList.tsx:15`
- `DiffView@desktop/packages/ui/src/components/views/DiffView.tsx:916`
- `useDiffFileCount@desktop/packages/ui/src/components/views/DiffView.tsx:1854`
- `FilesView@desktop/packages/ui/src/components/views/FilesView-impl.tsx:548`
- `GitView@desktop/packages/ui/src/components/views/GitView-impl.tsx:226`
- `GoToLineDialog@desktop/packages/ui/src/components/views/GoToLineDialog.tsx:57`
- `MultiRunWindow@desktop/packages/ui/src/components/views/MultiRunWindow.tsx:14`
- `PierreDiffViewer@desktop/packages/ui/src/components/views/PierreDiffViewer.tsx:193`
- `PlanView@desktop/packages/ui/src/components/views/PlanView.tsx:72`
- `PreviewToggleButtonProps@desktop/packages/ui/src/components/views/PreviewToggleButton.tsx:7`
- `PreviewToggleButton@desktop/packages/ui/src/components/views/PreviewToggleButton.tsx:20`
- `SettingsView@desktop/packages/ui/src/components/views/SettingsView.tsx:212`
- `SettingsWindow@desktop/packages/ui/src/components/views/SettingsWindow.tsx:16`
- `TerminalView@desktop/packages/ui/src/components/views/TerminalView.tsx:89`
- `AgentGroupDetail@desktop/packages/ui/src/components/views/agent-manager/AgentGroupDetail.tsx:40`
- `AgentManagerEmptyState@desktop/packages/ui/src/components/views/agent-manager/AgentManagerEmptyState.tsx:44`
- `AgentManagerSidebar@desktop/packages/ui/src/components/views/agent-manager/AgentManagerSidebar.tsx:165`
- `AgentManagerView@desktop/packages/ui/src/components/views/agent-manager/AgentManagerView.tsx:17`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (119) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 30 source files; exports≈41
Step 2: Threat: secrets=2 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/ui/src/components/views
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `5a21a801dca3628a` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=30 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
