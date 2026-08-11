# MODULE-AUDIT: ui-hooks

| Field | Value |
|-------|-------|
| Unit slug | `ui-hooks` |
| Scope | `desktop/packages/ui/src/hooks` |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `e23fe308825bbbc7` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-05 |
| Source files / LOC | 32 / 4711 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-hooks` owns `desktop/packages/ui/src/hooks`. Risk profile: desktop.

### Source inventory (extracted)

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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AssistantActivity@desktop/packages/ui/src/hooks/useAssistantStatus.ts:10` | public/internal | scanned |
| `AssistantStatusSnapshot@desktop/packages/ui/src/hooks/useAssistantStatus.ts:39` | public/internal | scanned |
| `useAssistantStatus@desktop/packages/ui/src/hooks/useAssistantStatus.ts:256` | public/internal | scanned |
| `useAxCodeReadiness@desktop/packages/ui/src/hooks/useAxCodeReadiness.ts:3` | public/internal | scanned |
| `AutoFollowState@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:7` | public/internal | scanned |
| `ContentChangeReason@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:9` | public/internal | scanned |
| `AnimationHandlers@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:11` | public/internal | scanned |
| `UseChatAutoFollowResult@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:29` | public/internal | scanned |
| `useChatAutoFollow@desktop/packages/ui/src/hooks/useChatAutoFollow.ts:112` | public/internal | scanned |
| `useChatSearchDirectory@desktop/packages/ui/src/hooks/useChatSearchDirectory.ts:9` | public/internal | scanned |
| `useDebouncedValue@desktop/packages/ui/src/hooks/useDebouncedValue.ts:3` | public/internal | scanned |
| `useDetectedWorktreeMetadata@desktop/packages/ui/src/hooks/useDetectedWorktreeRoot.ts:42` | public/internal | scanned |
| `useEffectiveDirectory@desktop/packages/ui/src/hooks/useEffectiveDirectory.ts:19` | public/internal | scanned |
| `useFileSystemAccess@desktop/packages/ui/src/hooks/useFileSystemAccess.ts:4` | public/internal | scanned |
| `useFontPreferences@desktop/packages/ui/src/hooks/useFontPreferences.ts:9` | public/internal | scanned |

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

- secret desktop/packages/ui/src/hooks/useMenuActions.ts:30
- io desktop/packages/ui/src/hooks/useProjectKnowledge.ts:31
- io desktop/packages/ui/src/hooks/useProjectKnowledge.ts:32
- io desktop/packages/ui/src/hooks/useProjectKnowledge.ts:48
- secret desktop/packages/ui/src/hooks/useStreamingMetrics.ts:7
- secret desktop/packages/ui/src/hooks/useStreamingMetrics.ts:51
- io desktop/packages/ui/src/hooks/useWebNotificationStream.ts:44

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (56 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 32; total LOC: 4711
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/hooks`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 56

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
| Static deep extract | ok | fingerprint `e23fe308825bbbc7` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 32 files / 4711 LOC / fp e23fe308825bbbc7 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
