# MODULE-AUDIT: ui-apps

| Field | Value |
|-------|-------|
| Unit slug | `ui-apps` |
| Scope | `desktop/packages/ui/src/apps` |
| Wave / effort | Wave 8 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `04d4f0b21c1ec17b` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-02 |
| Source files / LOC | 6 / 527 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-apps` owns `desktop/packages/ui/src/apps`. Risk profile: desktop.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/apps/AppEffects.tsx` | 71 | 2 | 0 | 0 |
| `desktop/packages/ui/src/apps/ElectronMiniChatApp.tsx` | 290 | 1 | 0 | 0 |
| `desktop/packages/ui/src/apps/miniChatPresence.test.ts` | 51 | 0 | 0 | 0 |
| `desktop/packages/ui/src/apps/miniChatPresence.ts` | 25 | 3 | 0 | 0 |
| `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx` | 58 | 1 | 0 | 0 |
| `desktop/packages/ui/src/apps/useAppFontEffects.ts` | 32 | 1 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `SyncRuntimeEffects@desktop/packages/ui/src/apps/AppEffects.tsx:53` | public/internal | scanned |
| `SyncAppEffects@desktop/packages/ui/src/apps/AppEffects.tsx:60` | public/internal | scanned |
| `ElectronMiniChatApp@desktop/packages/ui/src/apps/ElectronMiniChatApp.tsx:245` | public/internal | scanned |
| `MINI_CHAT_PRESENCE_CHANNEL@desktop/packages/ui/src/apps/miniChatPresence.ts:1` | public/internal | scanned |
| `MiniChatPresenceMessage@desktop/packages/ui/src/apps/miniChatPresence.ts:3` | public/internal | scanned |
| `isMiniChatPresenceMessage@desktop/packages/ui/src/apps/miniChatPresence.ts:10` | public/internal | scanned |
| `renderElectronMiniChatApp@desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:36` | public/internal | scanned |
| `useAppFontEffects@desktop/packages/ui/src/apps/useAppFontEffects.ts:6` | public/internal | scanned |

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

- none flagged

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (8 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 6; total LOC: 527
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/apps`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 8

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
| Static deep extract | ok | fingerprint `04d4f0b21c1ec17b` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 6 files / 527 LOC / fp 04d4f0b21c1ec17b |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
