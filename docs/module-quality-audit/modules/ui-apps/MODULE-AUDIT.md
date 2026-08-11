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
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
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

Step 1: Mapped 6 source files; exports≈8
Step 2: Threat: secrets=0 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/ui/src/apps
Step 6: Hygiene: empty=0; notes: clean
Step 7: Tests: see MODULE-AUDIT matched tests; regressions for verified-fixed findings
Step 8: Findings disposition complete in findings/
Step 9: Verification commands recorded in STATUS gates; protocol marker written

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
| Reviewer | implementer | 2026-08-11 | filesRead=6 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
