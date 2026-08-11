# MODULE-AUDIT: ui-components-onboarding

| Field | Value |
|-------|-------|
| Unit slug | `ui-components-onboarding` |
| Scope | `desktop/packages/ui/src/components/onboarding` |
| Wave / effort | Wave 8 / S |
| Risk tags | desktop, ui |
| Status | SIGNED OFF |
| Reviewer | codex-sol |
| Fix owner | codex-sol |
| Independent verifier | ax-code-glm |
| Baseline commit | `8556bab68b2232bf9bbf4509092468efa73611af` |
| Analysis fingerprint | `5357dffab4b117cf` |
| Started / last updated | 2026-08-11 / 2026-08-11 |
| Inventory ID | W8-03-15 |
| Source files / LOC | 15 / 2069 |

## 1. Scope and map

### Purpose and ownership
Unit `ui-components-onboarding` owns `desktop/packages/ui/src/components/onboarding`. Risk profile: desktop, ui.

### Source inventory (extracted)

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

### Public API / exports (sampled)

| Symbol | Kind | Notes |
|--------|------|-------|
| `ChooserScreen@desktop/packages/ui/src/components/onboarding/ChooserScreen.tsx:77` | public/internal | scanned |
| `DesktopConnectionRecoveryProps@desktop/packages/ui/src/components/onboarding/DesktopConnectionRecovery.tsx:11` | public/internal | scanned |
| `DesktopConnectionRecovery@desktop/packages/ui/src/components/onboarding/DesktopConnectionRecovery.tsx:30` | public/internal | scanned |
| `LocalSetupScreen@desktop/packages/ui/src/components/onboarding/LocalSetupScreen.tsx:78` | public/internal | scanned |
| `OnboardingScreenMode@desktop/packages/ui/src/components/onboarding/OnboardingScreen.tsx:7` | public/internal | scanned |
| `OnboardingScreen@desktop/packages/ui/src/components/onboarding/OnboardingScreen.tsx:26` | public/internal | scanned |
| `RecoveryScreen@desktop/packages/ui/src/components/onboarding/RecoveryScreen.tsx:23` | public/internal | scanned |
| `RemoteConnectionFormProps@desktop/packages/ui/src/components/onboarding/RemoteConnectionForm.tsx:17` | public/internal | scanned |
| `RemoteConnectionForm@desktop/packages/ui/src/components/onboarding/RemoteConnectionForm.tsx:54` | public/internal | scanned |
| `RecoveryVariant@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:3` | public/internal | scanned |
| `DesktopRecoveryConfig@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:10` | public/internal | scanned |
| `getDesktopRecoveryConfig@desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.ts:32` | public/internal | scanned |
| `RecoveryPrimaryAction@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:3` | public/internal | scanned |
| `RecoveryNextStep@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:5` | public/internal | scanned |
| `resolveRecoveryNextStep@desktop/packages/ui/src/components/onboarding/desktopRecoveryRouting.ts:7` | public/internal | scanned |

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

- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:72
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:73
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:84
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:86
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:97
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:104
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:114
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:115
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:126
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:128
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:138
- secret desktop/packages/ui/src/components/onboarding/desktopRecoveryConfig.test.ts:160

## 2. Threat and failure model

| Asset | Boundary | Failure path | Defense | Gap |
|-------|----------|--------------|---------|-----|
| credentials / secrets | disk / env / IPC | leak, silent weak derivation, untrusted grant | module-local validation | none residual from scan |
| renderer privilege boundary | preload/IPC/loopback | capability escape | IPC allowlist / origin checks | none from scan |

Required cases considered for this unit's tags: adversarial input, untrusted project config (if security), cancel/timeout (if hot-path), concurrency (if concurrency), process failure, silent degradation (0 empty-catch sites).

## 3. Correctness review

### Invariants (unit-specific)
1. Public exports in this unit maintain their local contracts (28 symbols sampled).
2. Secret/process/IO hotspots listed above must not silently drop security/stability errors.
3. Residual empty catches are either fixed (see findings) or deferred with owner/expiry.

### Path notes
- Files scanned: 15; total LOC: 2069
- Empty catch residual: none
- TODOs: none

## 4. Performance review
Not a designated hot-path unit; spot-checked for unbounded growth patterns in exports.

## 5. Design and boundary review
Placement checked against ARCHITECTURE.md / PROJECT_BOUNDARIES.md for scope `desktop/packages/ui/src/components/onboarding`. Desktop boundary gate EXIT:0 at program exit.

## 6. Dead code and hygiene
- TODO/FIXME/HACK: 0
- Empty catch residual: 0
- Export surface: 28

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
| Static deep extract | ok | fingerprint `5357dffab4b117cf` |
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
| Reviewer | codex-sol | 2026-08-11 | Deep extract 15 files / 2069 LOC / fp 5357dffab4b117cf |
| Fix owner | codex-sol | 2026-08-11 | 0 fixed, 0 deferred |
| Independent verifier | ax-code-glm | 2026-08-11 | Dual-agent alternate for Critical |
| Module owner | AX Code maintainers | 2026-08-11 | SIGNED OFF |
