# MODULE-AUDIT: ui-apps

| Field | Value |
|-------|-------|
| Unit slug | `ui-apps` |
| Scope | `desktop/packages/ui/src/apps` |
| Resolved root | `desktop/packages/ui/src/apps` |
| XL filter | no |
| Wave / effort | Wave 8 / M |
| Risk tags | desktop |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `cab6c0089e3b7b3410f050bc9d824c06a3c3a814` |
| Analysis fingerprint | `598fc6bee0218cd9` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 6 / 527 |
| Inventory ID | W8-02 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/apps/AppEffects.tsx` | 71 | 2 | 0 | 0 |
| `desktop/packages/ui/src/apps/ElectronMiniChatApp.tsx` | 290 | 1 | 0 | 0 |
| `desktop/packages/ui/src/apps/miniChatPresence.test.ts` | 51 | 0 | 0 | 0 |
| `desktop/packages/ui/src/apps/miniChatPresence.ts` | 25 | 3 | 0 | 0 |
| `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx` | 58 | 1 | 0 | 0 |
| `desktop/packages/ui/src/apps/useAppFontEffects.ts` | 32 | 1 | 0 | 0 |

### Exports (sample)
- `SyncRuntimeEffects@desktop/packages/ui/src/apps/AppEffects.tsx:53`
- `SyncAppEffects@desktop/packages/ui/src/apps/AppEffects.tsx:60`
- `ElectronMiniChatApp@desktop/packages/ui/src/apps/ElectronMiniChatApp.tsx:245`
- `MINI_CHAT_PRESENCE_CHANNEL@desktop/packages/ui/src/apps/miniChatPresence.ts:1`
- `MiniChatPresenceMessage@desktop/packages/ui/src/apps/miniChatPresence.ts:3`
- `isMiniChatPresenceMessage@desktop/packages/ui/src/apps/miniChatPresence.ts:10`
- `renderElectronMiniChatApp@desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:36`
- `useAppFontEffects@desktop/packages/ui/src/apps/useAppFontEffects.ts:6`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (8) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop | hotspot scan |

## 3–7. Protocol steps 3–7

Completed by dual-agent; see agent-protocol.json

## 8. Finding register

| Finding | Category | Severity | Origin | Status |
|---------|----------|----------|--------|--------|
| _none accepted_ | — | — | — | — |

## 9. Verification and exit

| Item | Result |
|------|--------|
| Static extract | ok fp `598fc6bee0218cd9` |
| Dual-agent protocol | complete |
| Critical independent verify | ax-code-glm |

### Exit checklist
- [x] Full 9-step protocol by dual-agent/implementer
- [x] Map with unit-scoped files (XL filters applied when configured)
- [x] Findings ledger consistent with findings/ files
- [x] Sign-off roles complete

### Sign-off

| Role | Name | Date | Evidence |
|------|------|------|----------|
| Reviewer | codex-sol | 2026-08-11 | filesRead=22 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
