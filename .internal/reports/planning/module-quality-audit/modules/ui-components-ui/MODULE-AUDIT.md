# MODULE-AUDIT: ui-components-ui

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-ui` |
| Scope | `desktop/packages/ui/src/components/ui` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `1db8b984ba38cb79` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-21 |
| Source files / LOC | 55 / 8044 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-ui` owns `desktop/packages/ui/src/components/ui`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/ui/AboutDialog.test.ts` | 19 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/AboutDialog.tsx` | 206 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/AxCodeIcon.tsx` | 14 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/AxCodeStatusDialog.tsx` | 54 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/CodeMirrorEditor.tsx` | 543 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/CommandPalette.tsx` | 635 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ConfigUpdateOverlay.tsx` | 70 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ConfirmDialog.tsx` | 88 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts` | 21 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ContextUsageDisplay.tsx` | 123 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/EmptySurface.tsx` | 51 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ErrorBoundary.tsx` | 161 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/HelpDialog.tsx` | 288 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/JsonTreeView.tsx` | 92 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/JsonTreeViewer.tsx` | 275 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/LazySyntaxHighlighter.tsx` | 43 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/MemoryDebugPanel.formatDuration.test.ts` | 30 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/MemoryDebugPanel.tsx` | 399 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/MobileOverlayPanel.tsx` | 125 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/OverlayScrollbar.tsx` | 391 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ProviderLogo.tsx` | 33 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ScrollShadow.tsx` | 200 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ScrollableOverlay.tsx` | 111 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/SyncStatusIndicator.tsx` | 96 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/UpdateDialog.test.ts` | 60 | 0 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AboutDialog@desktop/packages/ui/src/components/ui/AboutDialog.tsx:18` | public/internal | scanned |
| `AxCodeIcon@desktop/packages/ui/src/components/ui/AxCodeIcon.tsx:11` | public/internal | scanned |
| `AxCodeStatusDialog@desktop/packages/ui/src/components/ui/AxCodeStatusDialog.tsx:8` | public/internal | scanned |
| `BlockWidgetDef@desktop/packages/ui/src/components/ui/CodeMirrorEditor.tsx:141` | public/internal | scanned |
| `CodeMirrorEditor@desktop/packages/ui/src/components/ui/CodeMirrorEditor.tsx:280` | public/internal | scanned |
| `CommandPalette@desktop/packages/ui/src/components/ui/CommandPalette.tsx:63` | public/internal | scanned |
| `ConfigUpdateOverlay@desktop/packages/ui/src/components/ui/ConfigUpdateOverlay.tsx:8` | public/internal | scanned |
| `useConfirmDialog@desktop/packages/ui/src/components/ui/ConfirmDialog.tsx:28` | public/internal | scanned |
| `ContextUsageDisplay@desktop/packages/ui/src/components/ui/ContextUsageDisplay.tsx:24` | public/internal | scanned |
| `EmptySurfaceProps@desktop/packages/ui/src/components/ui/EmptySurface.tsx:4` | public/internal | scanned |
| `EmptySurface@desktop/packages/ui/src/components/ui/EmptySurface.tsx:21` | public/internal | scanned |
| `ErrorBoundary@desktop/packages/ui/src/components/ui/ErrorBoundary.tsx:137` | public/internal | scanned |
| `HelpDialog@desktop/packages/ui/src/components/ui/HelpDialog.tsx:31` | public/internal | scanned |
| `JsonTreeView@desktop/packages/ui/src/components/ui/JsonTreeView.tsx:90` | public/internal | scanned |
| `JsonTreeViewer@desktop/packages/ui/src/components/ui/JsonTreeViewer.tsx:273` | public/internal | scanned |

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

- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:2
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:4
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:6
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:7
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:8
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:9
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:10
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:11
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:15
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:16
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:17
- secret desktop/packages/ui/src/components/ui/ContextUsageDisplay.formatTokens.test.ts:18

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| host process / FS | spawn/shell | escape sandbox, orphan children | permission + isolation layers | OS sandbox opt-in residual |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (71 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 55; total LOC: 8044
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/ui`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 71

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
| Static deep extract | ok | fingerprint `1db8b984ba38cb79` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 55 files / 8044 LOC / fp 1db8b984ba38cb79 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
