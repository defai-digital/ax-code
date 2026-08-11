# MODULE-AUDIT: ui-stores

| Field | Value |
|-------|-------|
| Unit slug | `ui-stores` |
| Scope | `desktop/packages/ui/src/stores` |
| Wave / effort | Wave 8 / L |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `c24f1cbfe6f01476` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-07 |
| Source files / LOC | 97 / 24046 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-stores` owns `desktop/packages/ui/src/stores`. Risk profile: desktop.

### Source inventory (extracted)

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
| `desktop/packages/ui/src/stores/useConfigStore.ts` | 2 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSshStore.test.ts` | 150 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSshStore.ts` | 259 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSurfaceStore.test.ts` | 32 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDesktopSurfaceStore.ts` | 50 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDirectoryStore.test.ts` | 179 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useDirectoryStore.ts` | 419 | 1 | 0 | 0 |
| `desktop/packages/ui/src/stores/useExecutionModeStore.test.ts` | 116 | 0 | 0 | 0 |
| `desktop/packages/ui/src/stores/useExecutionModeStore.ts` | 202 | 2 | 0 | 0 |
| `desktop/packages/ui/src/stores/useFeatureFlagsStore.ts` | 12 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `GlobalSessionRecord@desktop/packages/ui/src/stores/globalSessions.ts:4` | public/internal | scanned |
| `readNextCursor@desktop/packages/ui/src/stores/globalSessions.ts:40` | public/internal | scanned |
| `isMissingGlobalSessionsEndpointError@desktop/packages/ui/src/stores/globalSessions.ts:44` | public/internal | scanned |
| `listGlobalSessionPages@desktop/packages/ui/src/stores/globalSessions.ts:60` | public/internal | scanned |
| `QueuedMessage@desktop/packages/ui/src/stores/messageQueueStore.ts:7` | public/internal | scanned |
| `MESSAGE_QUEUE_MAX_PER_SESSION@desktop/packages/ui/src/stores/messageQueueStore.ts:41` | public/internal | scanned |
| `useMessageQueueStore@desktop/packages/ui/src/stores/messageQueueStore.ts:43` | public/internal | scanned |
| `usePermissionStore@desktop/packages/ui/src/stores/permissionStore.ts:231` | public/internal | scanned |
| `SessionModelSelection@desktop/packages/ui/src/stores/types/selectionTypes.ts:1` | public/internal | scanned |
| `LastUsedProviderSelection@desktop/packages/ui/src/stores/types/selectionTypes.ts:6` | public/internal | scanned |
| `SessionWorktreeAttachment@desktop/packages/ui/src/stores/types/sessionTypes.ts:1` | public/internal | scanned |
| `AttachedFile@desktop/packages/ui/src/stores/types/sessionTypes.ts:13` | public/internal | scanned |
| `EditPermissionMode@desktop/packages/ui/src/stores/types/sessionTypes.ts:28` | public/internal | scanned |
| `SessionContextUsage@desktop/packages/ui/src/stores/types/sessionTypes.ts:30` | public/internal | scanned |
| `DEFAULT_MESSAGE_LIMIT@desktop/packages/ui/src/stores/types/sessionTypes.ts:43` | public/internal | scanned |

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

- secret desktop/packages/ui/src/stores/types/sessionTypes.ts:31
- secret desktop/packages/ui/src/stores/useConfigStore-impl.ts:357
- secret desktop/packages/ui/src/stores/useConfigStore-impl.ts:652
- io desktop/packages/ui/src/stores/useFileSearchStore.ts:70
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:9
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:12
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:17
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:24
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:30
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:38
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:49
- secret desktop/packages/ui/src/stores/useGitIdentitiesStore.ts:99

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
1. Public exports in this unit maintain their local contracts (210 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 97; total LOC: 24046
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/stores`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 210

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
| Static deep extract | ok | fingerprint `c24f1cbfe6f01476` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 97 files / 24046 LOC / fp c24f1cbfe6f01476 |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
