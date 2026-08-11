# MODULE-AUDIT: ui-components-sections

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-sections` |
| Scope | `desktop/packages/ui/src/components/sections` |
| Resolved root | `desktop/packages/ui/src/components/sections` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | REVIEWING |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `ad9a854c3f8f6cc3ffc48c356a2546d3f23e9945` |
| Analysis fingerprint | `724679934ec0d891` |
| Protocol marker | pending dual-agent 9-step |
| Source files / LOC | 99 / 26387 |
| Inventory ID | W8-03-18 |

## 1. Scope and map

### Source inventory

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
| `desktop/packages/ui/src/components/sections/ax-code/githubDeviceFlowPoll.test.ts` | 67 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/githubDeviceFlowPoll.ts` | 56 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/passkeySettingsLoad.test.ts` | 82 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/passkeySettingsLoad.ts` | 53 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/sections/ax-code/types.ts` | 2 | 1 | 0 | 0 |

### Exports (sample)
- `AgentsPage@desktop/packages/ui/src/components/sections/agents/AgentsPage.tsx:159`
- `AgentsSidebar@desktop/packages/ui/src/components/sections/agents/AgentsSidebar.tsx:68`
- `ModelSelector@desktop/packages/ui/src/components/sections/agents/ModelSelector.tsx:30`
- `normalizePermissionToolIds@desktop/packages/ui/src/components/sections/agents/permissionToolIds.ts:3`
- `AXCodePage@desktop/packages/ui/src/components/sections/ax-code/AXCodePage.tsx:19`
- `VisibleSetting@desktop/packages/ui/src/components/sections/ax-code/AXCodeVisualSettings.tsx:190`
- `AXCodeVisualSettings@desktop/packages/ui/src/components/sections/ax-code/AXCodeVisualSettings.tsx:222`
- `AboutSettings@desktop/packages/ui/src/components/sections/ax-code/AboutSettings.tsx:17`
- `AxCodeCliSettings@desktop/packages/ui/src/components/sections/ax-code/AxCodeCliSettings.tsx:16`
- `CornerRadiusSettings@desktop/packages/ui/src/components/sections/ax-code/CornerRadiusSettings.tsx:10`
- `DefaultsSettings@desktop/packages/ui/src/components/sections/ax-code/DefaultsSettings.tsx:25`
- `DesktopNetworkSettings@desktop/packages/ui/src/components/sections/ax-code/DesktopNetworkSettings.tsx:17`
- `GitHubSettings@desktop/packages/ui/src/components/sections/ax-code/GitHubSettings.tsx:27`
- `GitSettings@desktop/packages/ui/src/components/sections/ax-code/GitSettings.tsx:12`
- `KeyboardShortcutsSettings@desktop/packages/ui/src/components/sections/ax-code/KeyboardShortcutsSettings.tsx:49`
- `NotificationSettings@desktop/packages/ui/src/components/sections/ax-code/NotificationSettings.tsx:38`
- `PasskeySettings@desktop/packages/ui/src/components/sections/ax-code/PasskeySettings.tsx:31`
- `SessionRetentionSettings@desktop/packages/ui/src/components/sections/ax-code/SessionRetentionSettings.tsx:20`
- `WorktreeSectionContentProps@desktop/packages/ui/src/components/sections/ax-code/WorktreeSectionContent.tsx:19`
- `WorktreeSectionContent@desktop/packages/ui/src/components/sections/ax-code/WorktreeSectionContent.tsx:23`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (125) | static map |
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
| Static extract | ok fp `724679934ec0d891` |
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
