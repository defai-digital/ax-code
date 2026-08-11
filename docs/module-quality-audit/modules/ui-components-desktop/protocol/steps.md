## Step 1 Scope and Public Surface

The `ui-components-desktop` review covers `/Users/akiralam/code/ax-code/desktop/packages/ui/src/components/desktop`. The audit identifies that scope and the two candidates at `docs/module-quality-audit/modules/ui-components-desktop/MODULE-AUDIT.md:5-17`. The public surface is `DesktopHostSwitcherDialog` at `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:248`, `DesktopHostSwitcherButton` at `DesktopHostSwitcher.tsx:1186`, `DesktopHostSwitcherInline` at `DesktopHostSwitcher.tsx:1423`, and `OpenInAppButton` at `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:72`.

## Step 2 Trust Boundaries and Sensitive Data

Host input is normalized to HTTP(S), with credentials, query text, and fragments removed before use at `desktop/packages/ui/src/lib/desktopHosts.ts:41-53`; display values additionally redact credential-bearing and sensitive-query URLs at `desktopHosts.ts:59-85`. The switcher applies normalization before probing or navigation at `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:432-435` and redacts labels in errors at `DesktopHostSwitcher.tsx:517-519`. Open-in-app actions are restricted to a desktop shell on the local desktop origin at `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:86-105`, with the IPC helper repeating that boundary check at `desktop/packages/ui/src/lib/desktop.ts:663-690`.

## Step 3 State and Failure Paths

Configuration refresh loads hosts, SSH definitions, and SSH status together and restores safe empty state on failure at `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:334-360`. Probe results use a monotonically increasing request id so an older completion cannot overwrite a newer result at `DesktopHostSwitcher.tsx:363-391`. SSH switching checks an existing ready tunnel, otherwise connects, polls with a 90-second deadline, updates modal status, and suppresses stale completions through a switch token at `DesktopHostSwitcher.tsx:432-525`. The open-in-app primary action falls back from the app-specific command to the generic path opener at `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:108-118`.

## Step 4 Concurrency and Performance

Bulk host probing is parallelized with `Promise.all` at `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:369-380`, while stale-response guards prevent racing state writes. SSH status refresh runs every 1.5 seconds only while the dialog is open and the document is visible at `DesktopHostSwitcher.tsx:415-430`. The shared scheduler refuses overlapping executions and cancels future state work during cleanup at `desktop/packages/ui/src/lib/singleFlightInterval.ts:13-35`; the header-level probe uses that scheduler at a slower 10-second cadence at `DesktopHostSwitcher.tsx:1267-1320`.

## Step 5 Design and Ownership

The components own interaction state and composition, while URL validation/IPC remains in `desktop/packages/ui/src/lib/desktopHosts.ts:159-225` and SSH parsing/IPC remains in `desktop/packages/ui/src/lib/desktopSsh.ts:337-400`. Installed-app discovery and selection persistence are centralized in `desktop/packages/ui/src/stores/useOpenInAppsStore.ts:103-339`, leaving `OpenInAppButton` to render and dispatch actions. Its concrete consumer is the desktop header at `desktop/packages/ui/src/components/layout/Header.tsx:1758`. A repository reference search found no consumer outside `DesktopHostSwitcher.tsx` for its three exported switcher components, which is a maintainability observation rather than evidence of a runtime fault.

## Step 6 Code Health and Cleanup Semantics

Dialog closure resets editing, add-form, switch, and error state at `desktop/packages/ui/src/components/desktop/DesktopHostSwitcher.tsx:394-408`. SSH cancellation invalidates the active token before issuing a best-effort disconnect at `DesktopHostSwitcher.tsx:659-677`, so a late polling result cannot navigate. The image fallback in `OpenInAppButton` converts a failed icon to a deterministic label initial at `desktop/packages/ui/src/components/desktop/OpenInAppButton.tsx:37-65`, and clipboard fallback removes its temporary textarea before returning at `desktop/packages/ui/src/lib/clipboard.ts:15-36`. No TODO or FIXME marker was found in either candidate.

## Step 7 Test Evidence and Gaps

The host helper suite verifies credential/query stripping, display redaction, local-origin capture, compatibility statuses, and blocking decisions at `desktop/packages/ui/src/lib/desktopHosts.test.ts:32-100`. The open-in-app store suite exercises platform metadata, supported app discovery, stale-response revision protection, forced refresh, and retry behavior at `desktop/packages/ui/src/stores/useOpenInAppsStore.test.ts:79-216`. The focused Vitest run passed 2 files and 10 tests, and the UI package `tsc --noEmit` check passed. No test directly renders `DesktopHostSwitcherDialog` or `OpenInAppButton`; component interaction and cancellation remain the main coverage gap.

## Step 8 Finding Review

The unit register contains no accepted finding at `docs/module-quality-audit/modules/ui-components-desktop/MODULE-AUDIT.md:52-56`, and the unit's `findings/` directory contains no files. Independent inspection of navigation normalization, local-origin gating, stale async work, modal cancellation, IPC fallbacks, and redaction found no Critical item requiring a second-pass re-verification document. The unreferenced switcher exports and lack of component-render tests are residual maintenance and coverage risks, not demonstrated production defects.

## Step 9 Exit Verification

Verification used `pnpm --dir desktop/packages/ui exec vitest run src/lib/desktopHosts.test.ts src/stores/useOpenInAppsStore.test.ts` and `pnpm --dir desktop/packages/ui run type-check`; both exited successfully. The exercised expectations include probe status behavior at `desktop/packages/ui/src/lib/desktopHosts.test.ts:76-100` and refresh sequencing at `desktop/packages/ui/src/stores/useOpenInAppsStore.test.ts:125-216`. Protocol output is confined to the requested `ui-components-desktop` unit, with reviewer `codex-sol` and independent verifier `ax-code-glm` matching `docs/module-quality-audit/modules/ui-components-desktop/MODULE-AUDIT.md:12-16`.
