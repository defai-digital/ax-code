# MODULE-AUDIT: ui-components-ui

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-ui` |
| Scope | `desktop/packages/ui/src/components/ui` |
| Resolved root | `desktop/packages/ui/src/components/ui` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `289d39825ae97e36` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 55 / 8044 |
| Inventory ID | W8-03-21 |

## 1. Scope and map

### Source inventory

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
| `desktop/packages/ui/src/components/ui/JsonTreeView.tsx` | 92 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/JsonTreeViewer.tsx` | 275 | 0 | 0 | 0 |
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
| `desktop/packages/ui/src/components/ui/UpdateDialog.tsx` | 302 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/ViewLoadingSkeleton.tsx` | 19 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/__tests__/scroll-shadow-css.test.ts` | 41 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/aboutVersionRows.ts` | 18 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/ui/asChild.ts` | 16 | 3 | 0 | 0 |

### Exports (sample)
- `AboutDialog@desktop/packages/ui/src/components/ui/AboutDialog.tsx:18`
- `AxCodeIcon@desktop/packages/ui/src/components/ui/AxCodeIcon.tsx:11`
- `AxCodeStatusDialog@desktop/packages/ui/src/components/ui/AxCodeStatusDialog.tsx:8`
- `BlockWidgetDef@desktop/packages/ui/src/components/ui/CodeMirrorEditor.tsx:141`
- `CodeMirrorEditor@desktop/packages/ui/src/components/ui/CodeMirrorEditor.tsx:280`
- `CommandPalette@desktop/packages/ui/src/components/ui/CommandPalette.tsx:63`
- `ConfigUpdateOverlay@desktop/packages/ui/src/components/ui/ConfigUpdateOverlay.tsx:8`
- `useConfirmDialog@desktop/packages/ui/src/components/ui/ConfirmDialog.tsx:28`
- `ContextUsageDisplay@desktop/packages/ui/src/components/ui/ContextUsageDisplay.tsx:24`
- `EmptySurfaceProps@desktop/packages/ui/src/components/ui/EmptySurface.tsx:4`
- `EmptySurface@desktop/packages/ui/src/components/ui/EmptySurface.tsx:21`
- `ErrorBoundary@desktop/packages/ui/src/components/ui/ErrorBoundary.tsx:137`
- `HelpDialog@desktop/packages/ui/src/components/ui/HelpDialog.tsx:31`
- `LazySyntaxHighlighter@desktop/packages/ui/src/components/ui/LazySyntaxHighlighter.tsx:38`
- `DebugPanel@desktop/packages/ui/src/components/ui/MemoryDebugPanel.tsx:97`
- `MemoryDebugPanel@desktop/packages/ui/src/components/ui/MemoryDebugPanel.tsx:398`
- `MobileOverlayPanel@desktop/packages/ui/src/components/ui/MobileOverlayPanel.tsx:31`
- `OverlayScrollbar@desktop/packages/ui/src/components/ui/OverlayScrollbar.tsx:390`
- `ProviderLogo@desktop/packages/ui/src/components/ui/ProviderLogo.tsx:12`
- `ScrollShadowProps@desktop/packages/ui/src/components/ui/ScrollShadow.tsx:3`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (44) | static map |
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
| Static extract | ok fp `289d39825ae97e36` |
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
