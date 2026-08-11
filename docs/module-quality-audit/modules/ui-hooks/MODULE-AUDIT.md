# MODULE-AUDIT: ui-hooks

| Field | Value |
|-------|-------|
| Unit slug | `ui-hooks` |
| Scope | `desktop/packages/ui/src/hooks` |
| Resolved root | `desktop/packages/ui/src/hooks` |
| XL filter | no |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8a38b90b950855545c6b2479220274357904f111` |
| Analysis fingerprint | `651c613dd386bae3` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 32 / 4711 |
| Inventory ID | W8-05 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/hooks/useAssistantStatus.ts` | 428 | 3 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useAxCodeReadiness.ts` | 16 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useChatAutoFollow.ts` | 723 | 5 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useChatSearchDirectory.ts` | 55 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useDebouncedValue.ts` | 18 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useDetectedWorktreeRoot.ts` | 117 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useEffectiveDirectory.ts` | 52 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useFileSystemAccess.ts` | 51 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useFontPreferences.ts` | 18 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useIsTextTruncated.ts` | 47 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useKeyboardShortcuts.ts` | 599 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useMenuActions.ts` | 368 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useMiniChatKeyboardShortcuts.ts` | 112 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useModelLists.ts` | 60 | 2 | 0 | 0 |
| `desktop/packages/ui/src/hooks/usePlanDetection.ts` | 48 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useProjectKnowledge.ts` | 83 | 3 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useProviderLogo.ts` | 102 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useQueuedMessageAutoSend.test.ts` | 215 | 0 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useQueuedMessageAutoSend.ts` | 216 | 5 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useRouter.ts` | 305 | 3 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useRuntimeAPIs.ts` | 17 | 2 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useSessionActivity.ts` | 71 | 4 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useSessionAutoCleanup.ts` | 233 | 2 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useSessionBadgeState.test.ts` | 96 | 0 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useSessionBadgeState.ts` | 80 | 3 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useSplitPane.ts` | 43 | 2 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useStreamingMetrics.ts` | 65 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useUnifiedSearch.ts` | 121 | 4 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useWebNotificationStream.ts` | 65 | 1 | 0 | 0 |
| `desktop/packages/ui/src/hooks/useWindowControlsOverlayLayout.ts` | 102 | 1 | 0 | 0 |

### Exports (sample)
- `AssistantActivity@desktop/packages/ui/src/hooks/useAssistantStatus.ts:10`
- `AssistantStatusSnapshot@desktop/packages/ui/src/hooks/useAssistantStatus.ts:39`
- `useAssistantStatus@desktop/packages/ui/src/hooks/useAssistantStatus.ts:256`
- `useAxCodeReadiness@desktop/packages/ui/src/hooks/useAxCodeReadiness.ts:3`
- `AutoFollowState@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:7`
- `ContentChangeReason@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:9`
- `AnimationHandlers@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:11`
- `UseChatAutoFollowResult@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:29`
- `useChatAutoFollow@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:112`
- `useChatSearchDirectory@desktop/packages/ui/src/hooks/useChatSearchDirectory.ts:9`
- `useDebouncedValue@desktop/packages/ui/src/hooks/useDebouncedValue.ts:3`
- `useDetectedWorktreeMetadata@desktop/packages/ui/src/hooks/useDetectedWorktreeRoot.ts:42`
- `useEffectiveDirectory@desktop/packages/ui/src/hooks/useEffectiveDirectory.ts:19`
- `useFileSystemAccess@desktop/packages/ui/src/hooks/useFileSystemAccess.ts:4`
- `useFontPreferences@desktop/packages/ui/src/hooks/useFontPreferences.ts:9`
- `useIsTextTruncated@desktop/packages/ui/src/hooks/useIsTextTruncated.ts:5`
- `useKeyboardShortcuts@desktop/packages/ui/src/hooks/useKeyboardShortcuts.ts:18`
- `useMenuActions@desktop/packages/ui/src/hooks/useMenuActions.ts:91`
- `useMiniChatKeyboardShortcuts@desktop/packages/ui/src/hooks/useMiniChatKeyboardShortcuts.ts:17`
- `ModelListItem@desktop/packages/ui/src/hooks/useModelLists.ts:6`

### Tests
- `packages/ax-code/test/hooks/lifecycle.test.ts`
- `packages/ax-code/test/session/prompt-loop-result-stop-hooks.test.ts`

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (56) | static map |
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
| Static extract | ok fp `651c613dd386bae3` |
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
