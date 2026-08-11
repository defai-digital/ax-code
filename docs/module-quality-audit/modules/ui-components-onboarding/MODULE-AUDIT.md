# MODULE-AUDIT: ui-components-onboarding

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-onboarding` |
| Scope | `desktop/packages/ui/src/components/onboarding` |
| Resolved root | `desktop/packages/ui/src/components/onboarding` |
| XL filter | no |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | implementer |
| Independent verifier | ax-code-glm |
| Baseline commit | `054002dd73198d659d505539f080200bdbc66bc8` |
| Analysis fingerprint | `72c40c4e5bf077e5` |
| Protocol marker | agent-protocol.json complete |
| Source files / LOC | 15 / 2069 |
| Inventory ID | W8-03-15 |

## 1. Scope and map

### Source inventory

| File | LOC | Exports | Empty catches | TODOs |
|------|----:|--------:|--------------:|------:|
| `desktop/packages/ui/src/components/onboarding/ChooserScreen.tsx` | 472 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/DesktopConnectionRecovery.tsx` | 110 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/LocalSetupScreen.tsx` | 421 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/OnboardingScreen.tsx` | 80 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/RecoveryScreen.tsx` | 85 | 1 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/RemoteConnectionForm.tsx` | 309 | 2 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts` | 191 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts` | 118 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.test.ts` | 45 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts` | 26 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/installCommands.test.ts` | 58 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/installCommands.ts` | 98 | 9 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/onboardingTimers.test.ts` | 36 | 0 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/onboardingTimers.ts` | 18 | 3 | 0 | 0 |
| `desktop/packages/ui/src/components/onboarding/types.ts` | 2 | 1 | 0 | 0 |

### Exports (sample)
- `ChooserScreen@desktop/packages/ui/src/components/onboarding/ChooserScreen.tsx:77`
- `DesktopConnectionRecoveryProps@desktop/packages/ui/src/components/onboarding/DesktopConnectionRecovery.tsx:11`
- `DesktopConnectionRecovery@desktop/packages/ui/src/components/onboarding/DesktopConnectionRecovery.tsx:30`
- `LocalSetupScreen@desktop/packages/ui/src/components/onboarding/LocalSetupScreen.tsx:78`
- `OnboardingScreenMode@desktop/packages/ui/src/components/onboarding/OnboardingScreen.tsx:7`
- `OnboardingScreen@desktop/packages/ui/src/components/onboarding/OnboardingScreen.tsx:26`
- `RecoveryScreen@desktop/packages/ui/src/components/onboarding/RecoveryScreen.tsx:23`
- `RemoteConnectionFormProps@desktop/packages/ui/src/components/onboarding/RemoteConnectionForm.tsx:17`
- `RemoteConnectionForm@desktop/packages/ui/src/components/onboarding/RemoteConnectionForm.tsx:54`
- `RecoveryVariant@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:3`
- `DesktopRecoveryConfig@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:10`
- `getDesktopRecoveryConfig@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:32`
- `RecoveryPrimaryAction@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:3`
- `RecoveryNextStep@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:5`
- `resolveRecoveryNextStep@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:7`
- `AX_CODE_INSTALL_DOCS_URL@desktop/packages/ui/src/components/onboarding/installCommands.ts:4`
- `MACOS_INSTALL_COMMAND@desktop/packages/ui/src/components/onboarding/installCommands.ts:14`
- `LINUX_INSTALL_COMMAND@desktop/packages/ui/src/components/onboarding/installCommands.ts:16`
- `WINDOWS_INSTALL_COMMAND@desktop/packages/ui/src/components/onboarding/installCommands.ts:19`
- `InstallCommandHighlight@desktop/packages/ui/src/components/onboarding/installCommands.ts:22`

### Tests
- none auto-matched

## 2. Threat and failure model

| Asset | Boundary | Notes |
|-------|----------|-------|
| Module contract | public exports (28) | static map |
| Silent failure | empty catch (0) | per-site disposition in findings |
| Secrets/process/IO | risk tags desktop,ui | hotspot scan |

## 3–7. Protocol steps 3–7

Step 1: Mapped 15 source files; exports≈29
Step 2: Threat: secrets=2 files, processRisk=0 files, emptyCatch=0
Step 3: Correctness: read control flow for public surfaces; findings=none
Step 4: Performance: not hot-path; spot-checked
Step 5: Design: ownership vs ARCHITECTURE/PROJECT_BOUNDARIES for desktop/packages/ui/src/components/onboarding
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
| Static extract | ok fp `72c40c4e5bf077e5` |
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
| Reviewer | implementer | 2026-08-11 | filesRead=15 |
| Independent verifier | ax-code-glm | 2026-08-11 | dual-agent |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
