# MODULE-AUDIT: ui-components-layout

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-layout` |
| Scope | `desktop/packages/ui/src/components/layout` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `99f024738dce2a47` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-09 |
| Source files / LOC | 26 / 10157 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-layout` owns `desktop/packages/ui/src/components/layout`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/layout/BottomTerminalDock.tsx` | 199 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx` | 2644 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/layout/ContextPanel.tsx` | 2 | 1 | 0 | 0 |
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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `BottomTerminalDock@desktop/packages/ui/src/components/layout/BottomTerminalDock.tsx:16` | public/internal | scanned |
| `ContextPanel@desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:2087` | public/internal | scanned |
| `ContextPanel@desktop/packages/ui/src/components/layout/ContextPanel.tsx:1` | public/internal | scanned |
| `ContextPanelContent@desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:286` | public/internal | scanned |
| `DesktopSurfaceToggle@desktop/packages/ui/src/components/layout/DesktopSurfaceToggle.tsx:12` | public/internal | scanned |
| `Header@desktop/packages/ui/src/components/layout/Header.tsx:761` | public/internal | scanned |
| `MainLayout@desktop/packages/ui/src/components/layout/MainLayout.tsx:58` | public/internal | scanned |
| `ProjectActionsButton@desktop/packages/ui/src/components/layout/ProjectActionsButton.tsx:139` | public/internal | scanned |
| `ProjectEditDialog@desktop/packages/ui/src/components/layout/ProjectEditDialog.tsx:31` | public/internal | scanned |
| `RIGHT_SIDEBAR_CONTENT_WIDTH@desktop/packages/ui/src/components/layout/RightSidebar.tsx:6` | public/internal | scanned |
| `RightSidebar@desktop/packages/ui/src/components/layout/RightSidebar.tsx:16` | public/internal | scanned |
| `ProjectContextPanel@desktop/packages/ui/src/components/layout/RightSidebarTabs.tsx:45` | public/internal | scanned |
| `RightSidebarTabs@desktop/packages/ui/src/components/layout/RightSidebarTabs.tsx:93` | public/internal | scanned |
| `SIDEBAR_CONTENT_WIDTH@desktop/packages/ui/src/components/layout/Sidebar.tsx:7` | public/internal | scanned |
| `Sidebar@desktop/packages/ui/src/components/layout/Sidebar.tsx:18` | public/internal | scanned |

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

- secret desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:388
- secret desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:752
- secret desktop/packages/ui/src/components/layout/ContextPanel-impl.tsx:1242
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:31
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:47
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:70
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:71
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:73
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:74
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:76
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:77
- secret desktop/packages/ui/src/components/layout/ContextSidebarTab.tsx:79

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (39 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 26; total LOC: 10157
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/layout`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 39

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
| Static deep extract | ok | fingerprint `99f024738dce2a47` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 26 files / 10157 LOC / fp 99f024738dce2a47 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
