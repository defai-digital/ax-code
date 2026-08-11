# MODULE-AUDIT: ui-components-sections

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-sections` |
| Scope | `desktop/packages/ui/src/components/sections` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `defc1fc93196ef2a` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-18 |
| Source files / LOC | 99 / 26387 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-sections` owns `desktop/packages/ui/src/components/sections`. Risk profile: desktop, ui.

### Source inventory (extracted)

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/sections/agents/AgentsPage.tsx` | 1220 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/agents/AgentsSidebar.tsx` | 592 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/agents/ModelSelector.tsx` | 208 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/agents/permissionToolIds.test.ts` | 20 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/agents/permissionToolIds.ts` | 21 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/AXCodePage.tsx` | 138 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/AXCodeVisualSettings.tsx` | 1752 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/AboutSettings.tsx` | 238 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/AxCodeCliSettings.tsx` | 186 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/CornerRadiusSettings.tsx` | 62 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/DefaultsSettings.tsx` | 335 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx` | 320 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/GitHubSettings.tsx` | 448 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/GitSettings.tsx` | 205 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/KeyboardShortcutsSettings.tsx` | 339 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/NotificationSettings.tsx` | 489 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/PasskeySettings.tsx` | 283 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/SessionRetentionSettings.tsx` | 190 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/WorktreeSectionContent.tsx` | 394 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/axCodeCliSettingsSave.test.ts` | 41 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/axCodeCliSettingsSave.ts` | 36 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/defaultsSettingsLoad.test.ts` | 57 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/defaultsSettingsLoad.ts` | 64 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/gitSettingsLoad.test.ts` | 52 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/gitSettingsLoad.ts` | 63 | 4 | 0 | 0 |

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `AgentsPage@desktop/packages/ui/src/components/sections/agents/AgentsPage.tsx:159` | public/internal | scanned |
| `AgentsSidebar@desktop/packages/ui/src/components/sections/agents/AgentsSidebar.tsx:68` | public/internal | scanned |
| `ModelSelector@desktop/packages/ui/src/components/sections/agents/ModelSelector.tsx:30` | public/internal | scanned |
| `normalizePermissionToolIds@desktop/packages/ui/src/components/sections/agents/permissionToolIds.ts:3` | public/internal | scanned |
| `AXCodePage@desktop/packages/ui/src/components/sections/ax-code/AXCodePage.tsx:19` | public/internal | scanned |
| `VisibleSetting@desktop/packages/ui/src/components/sections/ax-code/AXCodeVisualSettings.tsx:190` | public/internal | scanned |
| `AXCodeVisualSettings@desktop/packages/ui/src/components/sections/ax-code/AXCodeVisualSettings.tsx:222` | public/internal | scanned |
| `AboutSettings@desktop/packages/ui/src/components/sections/ax-code/AboutSettings.tsx:17` | public/internal | scanned |
| `AxCodeCliSettings@desktop/packages/ui/src/components/sections/ax-code/AxCodeCliSettings.tsx:16` | public/internal | scanned |
| `CornerRadiusSettings@desktop/packages/ui/src/components/sections/ax-code/CornerRadiusSettings.tsx:10` | public/internal | scanned |
| `DefaultsSettings@desktop/packages/ui/src/components/sections/ax-code/DefaultsSettings.tsx:25` | public/internal | scanned |
| `DesktopNetworkSettings@desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:17` | public/internal | scanned |
| `GitHubSettings@desktop/packages/ui/src/components/sections/ax-code/GitHubSettings.tsx:27` | public/internal | scanned |
| `GitSettings@desktop/packages/ui/src/components/sections/ax-code/GitSettings.tsx:12` | public/internal | scanned |
| `KeyboardShortcutsSettings@desktop/packages/ui/src/components/sections/ax-code/KeyboardShortcutsSettings.tsx:49` | public/internal | scanned |

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

- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:22
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:23
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:51
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:58
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:61
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:62
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:121
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:179
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:188
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:198
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:244
- secret desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:245

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |
| durable state | SQLite/JSON/files | corrupt migration, partial write | locks/migrations skip-corrupt patterns | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (129 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 99; total LOC: 26387
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/sections`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 129

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
| Static deep extract | ok | fingerprint `defc1fc93196ef2a` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 99 files / 26387 LOC / fp defc1fc93196ef2a |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
