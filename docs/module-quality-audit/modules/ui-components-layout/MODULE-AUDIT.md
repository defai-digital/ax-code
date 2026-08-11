# MODULE-AUDIT: ui-components-layout

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-layout` |
| Scope | `desktop/packages/ui/src/components/layout` |
| Resolved root | `desktop/packages/ui/src/components/layout` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | ax-code-glm |
| Independent verifier | codex-sol |
| Baseline commit | `994f9287e497666e104644eccea299595a35b39a` |
| Analysis fingerprint | `3116d32b177f57ad` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 26 / 10157 |
| Inventory ID | W8-03-09 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/layout/BottomTerminalDock.tsx` | 199 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx` | 2644 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ContextPanel.tsx` | 2 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx` | 662 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/DesktopSurfaceToggle.tsx` | 73 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/Header.tsx` | 1985 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/MainLayout.tsx` | 536 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ProjectActionsButton.tsx` | 976 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ProjectEditDialog.tsx` | 454 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/RightSidebar.tsx` | 193 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/RightSidebarTabs.tsx` | 148 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/Sidebar.tsx` | 204 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/SidebarFilesTree.tsx` | 1093 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/SplitPaneLayout.tsx` | 165 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ThemeModeToggle.tsx` | 104 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/context-panel-source.test.ts` | 39 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelPathLabels.test.ts` | 30 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelPathLabels.ts` | 17 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelPreview.test.ts` | 71 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelPreview.ts` | 54 | 6 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelTabs.test.ts` | 151 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/contextPanelTabs.ts` | 104 | 8 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/desktopBrowserEvents.test.ts` | 117 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/desktopBrowserEvents.ts` | 91 | 6 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/loopback-source.test.ts` | 21 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/project-actions-terminal-source.test.ts` | 24 | 0 | 0 | 0 |

### Exports (sample)
- `BottomTerminalDock@desktop/packages/ui/src/components/layout/BottomTerminalDock.tsx:16`
- `ContextPanel@desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:2087`
- `ContextPanelContent@desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:286`
- `DesktopSurfaceToggle@desktop/packages/ui/src/components/layout/DesktopSurfaceToggle.tsx:12`
- `Header@desktop/packages/ui/src/components/layout/Header.tsx:761`
- `MainLayout@desktop/packages/ui/src/components/layout/MainLayout.tsx:58`
- `ProjectActionsButton@desktop/packages/ui/src/components/layout/ProjectActionsButton.tsx:139`
- `ProjectEditDialog@desktop/packages/ui/src/components/layout/ProjectEditDialog.tsx:31`
- `RIGHT_SIDEBAR_CONTENT_WIDTH@desktop/packages/ui/src/components/layout/RightSidebar.tsx:6`
- `RightSidebar@desktop/packages/ui/src/components/layout/RightSidebar.tsx:16`
- `ProjectContextPanel@desktop/packages/ui/src/components/layout/RightSidebarTabs.tsx:45`
- `RightSidebarTabs@desktop/packages/ui/src/components/layout/RightSidebarTabs.tsx:93`
- `SIDEBAR_CONTENT_WIDTH@desktop/packages/ui/src/components/layout/Sidebar.tsx:7`
- `Sidebar@desktop/packages/ui/src/components/layout/Sidebar.tsx:18`
- `SidebarFilesTree@desktop/packages/ui/src/components/layout/SidebarFilesTree.tsx:311`
- `SplitPaneLayout@desktop/packages/ui/src/components/layout/SplitPaneLayout.tsx:25`
- `ThemeModeToggle@desktop/packages/ui/src/components/layout/ThemeModeToggle.tsx:46`
- `getContextPanelRelativePathLabel@desktop/packages/ui/src/components/layout/contextPanelPathLabels.ts:3`
- `PreviewConsoleEvent@desktop/packages/ui/src/components/layout/contextPanelPreview.ts:1`
- `PreviewConsoleFilter@desktop/packages/ui/src/components/layout/contextPanelPreview.ts:9`

### Tests
- `packages/ax-code/test/cli/tui/footer-layout.test.ts`
- `packages/ax-code/test/cli/tui/session-layout.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (38) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3116d32b177f57ad` |
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
| Reviewer | ax-code-glm | 2026-08-11 | filesRead=27 |
| Independent verifier | codex-sol | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
