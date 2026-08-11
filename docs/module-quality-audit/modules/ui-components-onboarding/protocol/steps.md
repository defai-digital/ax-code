# Review Protocol — `ui-components-onboarding`

Unit: `ui-components-onboarding`
Scope: `desktop/packages/ui/src/components/onboarding`
Reviewer lane: `ax-code-glm` (primary for this protocol run)
Verifier lane (other): `codex-sol`
Model: `zai-coding-plan/glm-5.2[1m]`
Date: 2026-08-11

This is an independent, evidence-grounded 9-step pass over the 15 files in
`desktop/packages/ui/src/components/onboarding`. Every claim below cites a real
file and line range I opened and read during this run (full list in
`reviewer-run.json`).

## Step 1 Scope And Inventory Confirmation

The unit contains 15 files under `desktop/packages/ui/src/components/onboarding`
matching the inventory in `MODULE-AUDIT.md` §1. The reviewer opened all 15 plus
three dependency files the components import (`desktopHosts.ts`, `http.ts`,
`desktop.ts`) to validate boundary assumptions. The public surface is small and
intentional: `OnboardingScreen` (`OnboardingScreen.tsx:26`) is the single entry
that fans out to `ChooserScreen` (`ChooserScreen.tsx:77`),
`LocalSetupScreen` (`LocalSetupScreen.tsx:78`), and `RecoveryScreen`
(`RecoveryScreen.tsx:23`). `RemoteConnectionForm` (`RemoteConnectionForm.tsx:54`)
is exported but consumed outside this folder, so its props contract is a real
public boundary, not internal. The pure helpers `desktopRecoveryConfig.ts`,
`desktopRecoveryRouting.ts`, `installCommands.ts`, `onboardingTimers.ts`, and
`types.ts` carry the unit's testable logic and are isolated from React — good
seam. No files were missing from the candidate list.

## Step 2 Threat And Secret-Handling Model

The highest-risk surface is host-URL handling in recovery/remote flows.
`desktopRecoveryConfig.ts:26-30` routes every host string through
`redactSensitiveUrl` (defined in `desktopHosts.ts:59-86`), which strips embedded
userinfo (`desktopHosts.ts:71-74`) and rewrites sensitive query keys
(`token|auth|secret|api`, `desktopHosts.ts:39,78-80`) to `[REDACTED]` before the
host ever reaches a description string. `DesktopConnectionRecovery.tsx:84` calls
`redactSensitiveUrl(hostUrl)` again at render time for the host-info card, so
redaction is defense-in-depth, not single-site. The test suite proves this holds
for query-param secrets (`desktopRecoveryConfig.test.ts:68-90`), URL-shaped
labels (`desktopRecoveryConfig.test.ts:110-132`), embedded credentials
(`desktopRecoveryConfig.test.ts:134-152`), and whitespace-only labels
(`desktopRecoveryConfig.test.ts:182-189`). `normalizeHostUrl`
(`desktopHosts.ts:41-57`) strips credentials and query/hash before persistence,
so `RemoteConnectionForm.handleConnect` (`RemoteConnectionForm.tsx:100-155`)
never writes raw secrets to `desktopHostsSet`. No hardcoded tokens, keys, or
internal URLs are present in the unit; the only external URLs are public install
endpoints in `installCommands.ts:4-20` and they are intentional product copy. No
secret-leak findings.

## Step 3 Correctness Of Routing And State Machines

`resolveRecoveryNextStep` (`desktopRecoveryRouting.ts:7-24`) is the routing
core: `local-unavailable` → `local-setup`; the three remote variants plus
`missing-default-host` → `switch-default-to-local`. The switch carries an
exhaustive `never` guard (`desktopRecoveryRouting.ts:20-23`) so adding a
`RecoveryVariant` without a route is a compile error. The test file enforces
this independently with a `Record<RecoveryVariant, Record<RecoveryPrimaryAction,
RecoveryNextStep["kind"]>>` table (`desktopRecoveryRouting.test.ts:11-27`) —
adding a variant to the union but not the table fails the typecheck. This is the
strongest correctness invariant in the unit. `OnboardingScreen.tsx:44-75` derives
`effectiveMode` from `recoveryEnteredLocalSetup` and resets that flag on
flow-identity change (`OnboardingScreen.tsx:38-40`), avoiding the "stuck behind
early return" bug the comment at `OnboardingScreen.tsx:42-44` calls out. The
back handler (`OnboardingScreen.tsx:65-71`) only flips the transient flag when it
was set by a recovery→local fallthrough, otherwise delegating to the host
`onBack`. I traced `local-unavailable + use-local` through `RecoveryScreen.tsx:56-72`
into the `local-setup` branch without touching reload — correct.

## Step 4 Async Effects, Timers, And Cleanup

`onboardingTimers.ts` is a 17-line helper with a clear contract:
`replaceOnboardingTimer` clears the prior id before scheduling
(`onboardingTimers.ts:10-16`), so rapid re-clicks never stack overlapping reset
callbacks. Both `ChooserScreen` (`ChooserScreen.tsx:87-99,253-275`) and
`LocalSetupScreen` (`LocalSetupScreen.tsx:88-101,224-246`) hold timer ids in refs
and clear them in an unmount effect — leak-free. The CLI-availability poller in
`ChooserScreen.tsx:180-207` uses a recursive `setTimeout` (not `setInterval`)
guarded by a `cancelled` flag and an explicit `clearTimeout` in cleanup
(`ChooserScreen.tsx:203-206`); `announceAvailable` is awaited and the tick returns
without rescheduling on success (`ChooserScreen.tsx:189-191`), so there is no
double-announce race. One observation: in `RemoteConnectionForm.handleConnect`
the success branch (`RemoteConnectionForm.tsx:141-150`) fires `onConnect` and the
Tauri `desktop_restart` invoke without ever flipping `state` off `"testing"`
(`RemoteConnectionForm.tsx:103` sets it, no terminal set on success). Because the
shell restarts the app the stuck button is invisible in practice, but if
`desktop_restart` is a no-op (non-Tauri) the Connect button stays disabled. This
is a LOW-severity robustness gap, not a blocker.

## Step 5 Design, Coupling, And Boundary Ownership

The pure helpers form a clean inner layer with zero React imports, and
`DesktopConnectionRecovery.tsx` is the only component that touches the config
layer directly (`DesktopConnectionRecovery.tsx:39`). `RecoveryScreen.tsx` owns
side effects (persist + restart) and delegates rendering to
`DesktopConnectionRecovery`, keeping the presentational component dumb — a clean
split. One smell is the i18n key casts in `DesktopConnectionRecovery.tsx`
(`:40-42,71,74,93,101`): `config.titleKey as Parameters<typeof t>[0]` repeats at
every call site and defeats compile-time key validation, so a typo in
`desktopRecoveryConfig.ts` `*Key` fields would not surface until runtime. The
dual representation in `DesktopRecoveryConfig` (`title`/`titleKey`,
`description`/`descriptionKey`) is intentional backward compatibility
(`desktopRecoveryConfig.ts:10-24`) but means English strings and i18n keys can
drift; no drift exists today. Coupling to `@/lib/desktopHosts`,
`@/lib/desktop`, `@/lib/http`, and `@/lib/i18n` is one-directional and
appropriate for a UI leaf module.

## Step 6 Duplication And DRY Analysis

`ChooserScreen.tsx` (471 lines) and `LocalSetupScreen.tsx` (420 lines) share a
large block of near-identical logic. The duplicated units, each verified by
side-by-side read:

- `InstallCommandDisplay` inner component — `ChooserScreen.tsx:30-75` vs
  `LocalSetupScreen.tsx:30-74` (functionally identical markup, only the outer
  flex className differs).
- `checkCliAvailability` — `ChooserScreen.tsx:149-160` vs
  `LocalSetupScreen.tsx:168-179`, byte-for-byte same fetch+predicate.
- `handleBrowse` (Tauri file dialog) — `ChooserScreen.tsx:219-240` vs
  `LocalSetupScreen.tsx:181-208`, identical guard + dialog shape.
- `handleApplyPath` — `ChooserScreen.tsx:242-262` vs
  `LocalSetupScreen.tsx:210-233`; ChooserScreen additionally calls
  `persistLocalChoice` before restart (`ChooserScreen.tsx:247`) — the only
  behavioral delta.
- `handleCopy`, `handleOpenDocs`, the settings-fetch effect, and the
  platform-detection effect are duplicated verbatim.

This clears the 3+-call-site bar for extraction. A shared
`useLocalCliProbe()` hook (availability check + announce + apply) and a shared
`<InstallCommandPanel/>` component would remove ~180 lines and eliminate the
divergence risk (e.g. `LocalSetupScreen` missing `persistLocalChoice` in its
apply path — see Step 8). This is the unit's largest maintainability finding
(MEDIUM, non-blocking). Separately, `remote-missing` and `missing-default-host`
resolve to near-identical config objects (`desktopRecoveryConfig.ts:53-64` and
`:98-109`); both are retained as distinct semantic states and routed identically
(`desktopRecoveryRouting.ts:17-18`), which is acceptable modeling, not
duplication to remove.

## Step 7 Data-Preservation Concern In persistLocalChoice

`ChooserScreen.tsx:162-171` and `RecoveryScreen.tsx:32-42` both implement
`persistLocalChoice` by writing `hosts: []` alongside `defaultHostId: "local"`.
When a user in a remote-recovery state (`remote-unreachable`,
`remote-wrong-service`) chooses "Use Local", `RecoveryScreen.handleRecoveryUseLocal`
(`RecoveryScreen.tsx:56-72`) routes to `switch-default-to-local`
(`desktopRecoveryRouting.ts:15-19`) and calls this persist, which **deletes all
previously saved remote hosts**, not just the failing one. For a user with
several configured remotes, one failure on one host wipes the list. This is
consistent between the two screens (so not a divergence bug) and is plausibly
intentional ("local-only mode"), but it is a destructive write that the UX does
not warn about. Severity MEDIUM: data-loss-shaped, but reversible by re-adding
hosts and gated behind an explicit user action. Recommend preserving non-failing
hosts (or at least the non-default ones) and only clearing `defaultHostId` to
`"local"`, unless product explicitly wants the wipe.

## Step 8 Test Coverage Evaluation

Coverage is uneven but strategically placed. `desktopRecoveryRouting.test.ts`
provides a compile-time-complete matrix over every `(variant, action)` pair
(`:11-43`) — excellent. `desktopRecoveryConfig.test.ts` thoroughly exercises
redaction and fallbacks across 13 cases (`:8-189`). `installCommands.test.ts`
includes a round-trip invariant that highlight tokens concatenate back to the
source command (`:39-45`) — a high-value property test. `onboardingTimers.test.ts`
covers both replace-supersedes and clear-prevents-fire (`:14-34`). The gap: the
React components (`ChooserScreen`, `LocalSetupScreen`, `RecoveryScreen`,
`RemoteConnectionForm`, `OnboardingScreen`, `DesktopConnectionRecovery`) have no
component/render tests; all behavioral risk in the duplicated handlers from Step
6 is covered only by the shared-helper tests, not by anything that catches the
`LocalSetupScreen.handleApplyPath` missing-`persistLocalChoice` divergence
(`LocalSetupScreen.tsx:210-233` does not call it, while
`ChooserScreen.tsx:242-262` does). Adding a render/integration test that drives
`handleApplyPath` on both screens would have caught that delta. This is LOW — the
behavioral difference is minor — but it is the most valuable test to add next.

## Step 9 Findings Ledger, Verification, And Exit

Findings raised in this pass (none Critical, none accepted into `findings/`
during this protocol run — these are observations for the module owner):

| #   | Finding                                                                                                        | Severity | Location                                                      |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| 1   | Large duplicated logic block across ChooserScreen/LocalSetupScreen (probe, browse, apply, copy, docs, effects) | MEDIUM   | `ChooserScreen.tsx:30-279`, `LocalSetupScreen.tsx:30-254`     |
| 2   | `persistLocalChoice` wipes all saved remote hosts (`hosts: []`) on switch-to-local                             | MEDIUM   | `ChooserScreen.tsx:162-171`, `RecoveryScreen.tsx:32-42`       |
| 3   | `handleApplyPath` divergence: LocalSetupScreen omits `persistLocalChoice` that ChooserScreen calls             | LOW      | `LocalSetupScreen.tsx:210-233` vs `ChooserScreen.tsx:242-262` |
| 4   | `RemoteConnectionForm.handleConnect` leaves `state === "testing"` on success when restart is a no-op           | LOW      | `RemoteConnectionForm.tsx:103,141-150`                        |
| 5   | Repeated `as Parameters<typeof t>[0]` casts bypass i18n key compile-checking                                   | LOW      | `DesktopConnectionRecovery.tsx:40-42,71,74,93,101`            |
| 6   | No component-level tests for the six React components; shared-helper coverage only                             | LOW      | `desktop/packages/ui/src/components/onboarding/*.tsx`         |

No Critical findings, therefore no `reverify.md` second-pass gate is triggered.
Security redaction is defense-in-depth and well-tested; routing is exhaustive
and compile-guarded; timer/effect cleanup is leak-free. The unit is acceptable
for sign-off at MEDIUM/LOW risk with the Step 6 extraction recommended as the
highest-leverage follow-up. Independent verification by the `codex-sol` lane is
captured via the `verifier` field in `agent-protocol.json`.
