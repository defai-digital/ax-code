# MODULE-AUDIT: ui-stores

| Field | Value |
|-------|-------|
| Unit slug | `ui-stores` |
| Scope | `desktop/packages/ui/src/stores` |
| Resolved root | `desktop/packages/ui/src/stores` |
| XL filter | no |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `5fefa00cdc847667d3ba3d38509a751498ee4180` |
| Analysis fingerprint | `3e4ba8d674b7f3cb` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 97 / 24046 |
| Inventory ID | W8-07 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/stores/globalSessions.ts` | 118 | 4 | 0 | 0 |
| `desktop/packages/ui/src/stores/messageQueueStore.test.ts` | 32 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/messageQueueStore.ts` | 180 | 3 | 0 | 0 |
| `desktop/packages/ui/src/stores/permissionStore.test.ts` | 119 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/permissionStore.ts` | 436 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/types/selectionTypes.ts` | 10 | 2 | 0 | 0 |
| `desktop/packages/ui/src/stores/types/sessionTypes.ts` | 78 | 10 | 0 | 0 |
| `desktop/packages/ui/src/stores/useActiveNowStore.ts` | 47 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useAgentGroupsStore.ts` | 365 | 5 | 0 | 0 |
| `desktop/packages/ui/src/stores/useAgentsStore.test.ts` | 164 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useAgentsStore.ts` | 642 | 11 | 0 | 0 |
| `desktop/packages/ui/src/stores/useAttentionStore.ts` | 19 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useCommandsStore.test.ts` | 121 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useCommandsStore.ts` | 506 | 7 | 0 | 0 |
| `desktop/packages/ui/src/stores/useConfigStore-impl.ts` | 1962 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useConfigStore.ts` | 2 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSshStore.test.ts` | 150 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSshStore.ts` | 259 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSurfaceStore.test.ts` | 32 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSurfaceStore.ts` | 50 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDirectoryStore.test.ts` | 179 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDirectoryStore.ts` | 419 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useExecutionModeStore.test.ts` | 116 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useExecutionModeStore.ts` | 202 | 2 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFeatureFlagsStore.ts` | 12 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFileSearchStore.test.ts` | 224 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFileSearchStore.ts` | 249 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFilesViewTabsStore.test.ts` | 29 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFilesViewTabsStore.ts` | 443 | 2 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFilesViewTabsStore.windows.test.ts` | 51 | 0 | 0 | 0 |

### Exports (sample)
- `GlobalSessionRecord@desktop/packages/ui/src/stores/globalSessions.ts:4`
- `readNextCursor@desktop/packages/ui/src/stores/globalSessions.ts:40`
- `isMissingGlobalSessionsEndpointError@desktop/packages/ui/src/stores/globalSessions.ts:44`
- `listGlobalSessionPages@desktop/packages/ui/src/stores/globalSessions.ts:60`
- `QueuedMessage@desktop/packages/ui/src/stores/messageQueueStore.ts:7`
- `MESSAGE_QUEUE_MAX_PER_SESSION@desktop/packages/ui/src/stores/messageQueueStore.ts:41`
- `useMessageQueueStore@desktop/packages/ui/src/stores/messageQueueStore.ts:43`
- `usePermissionStore@desktop/packages/ui/src/stores/permissionStore.ts:231`
- `SessionModelSelection@desktop/packages/ui/src/stores/types/selectionTypes.ts:1`
- `LastUsedProviderSelection@desktop/packages/ui/src/stores/types/selectionTypes.ts:6`
- `SessionWorktreeAttachment@desktop/packages/ui/src/stores/types/sessionTypes.ts:1`
- `AttachedFile@desktop/packages/ui/src/stores/types/sessionTypes.ts:13`
- `EditPermissionMode@desktop/packages/ui/src/stores/types/sessionTypes.ts:28`
- `SessionContextUsage@desktop/packages/ui/src/stores/types/sessionTypes.ts:30`
- `DEFAULT_MESSAGE_LIMIT@desktop/packages/ui/src/stores/types/sessionTypes.ts:43`
- `MEMORY_CONSTANTS@desktop/packages/ui/src/stores/types/sessionTypes.ts:45`
- `getMessageLimit@desktop/packages/ui/src/stores/types/sessionTypes.ts:51`
- `getBackgroundTrimLimit@desktop/packages/ui/src/stores/types/sessionTypes.ts:56`
- `MEMORY_LIMITS@desktop/packages/ui/src/stores/types/sessionTypes.ts:58`
- `getMemoryLimits@desktop/packages/ui/src/stores/types/sessionTypes.ts:68`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (209) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

**Pending dual-agent PRD §6 steps 3–7** (correctness, performance, design, dead-code, tests). Static map above is Wave-0/extract only — not full sign-off.

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `3e4ba8d674b7f3cb` |
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
