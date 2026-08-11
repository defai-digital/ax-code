# Review protocol: ui-components-providers

## Step 1 Scope and entry points

The audited unit is the single exported `ThemeProvider` declared at `desktop/packages/ui/src/components/providers/ThemeProvider.tsx:9`; the inventory independently records the same sole export at `docs/module-quality-audit/modules/ui-components-providers/MODULE-AUDIT.md:24-29`. Its two production consumers are the main renderer at `desktop/packages/ui/src/main.tsx:93-104` and mini-chat at `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:44-56`, so both application roots were included in the review.

## Step 2 Attack surface and failure boundaries

The provider accepts only React children (`desktop/packages/ui/src/components/providers/ThemeProvider.tsx:5-7`) and selects three numeric appearance preferences plus two store actions (`desktop/packages/ui/src/components/providers/ThemeProvider.tsx:10-14`). Its only side effect is local CSS custom-property mutation through the store actions and `applyCornerRadius`; the latter writes five fixed property names on `document.documentElement` (`desktop/packages/ui/src/lib/cornerRadius.ts:32-38`). There is no user text interpolation, network request, credential access, subprocess, or persistence write in this boundary.

## Step 3 State-to-DOM correctness

`useLayoutEffect` applies typography, padding, and radius before paint and lists every selected value/action in its dependency array (`desktop/packages/ui/src/components/providers/ThemeProvider.tsx:16-20`). Store setters clamp font and padding to 50–200 before applying them (`desktop/packages/ui/src/stores/useUIStore-impl.ts:1696-1701` and `:1721-1726`); radius normalization rejects non-finite values and clamps to 0–32 (`desktop/packages/ui/src/lib/cornerRadius.ts:13-16`). Persisted `fontSize`, `padding`, and `cornerRadius` are all retained (`desktop/packages/ui/src/stores/useUIStore-impl.ts:2372-2378`), so hydration changes trigger the subscribed provider and reapply the restored values.

## Step 4 Rendering and performance

The component renders a fragment without adding layout nodes (`desktop/packages/ui/src/components/providers/ThemeProvider.tsx:22`) and subscribes with individual selectors (`:10-14`), avoiding rerenders for unrelated store fields. Each relevant change reruns all three idempotent appliers (`:16-20`); font and padding setters also apply immediately (`desktop/packages/ui/src/stores/useUIStore-impl.ts:1696-1701` and `:1721-1726`), so those paths can perform a bounded duplicate DOM update. Given the small fixed property sets—padding writes at most five properties (`desktop/packages/ui/src/stores/useUIStore-impl.ts:1777-1786`)—this is minor overhead rather than a release-blocking defect.

## Step 5 Ownership and composition

The provider acts as the adapter between the persisted UI store and document-level design tokens: the store exposes `applyTypography` and `applyPadding` (`desktop/packages/ui/src/stores/useUIStore-impl.ts:748-757`), while radius token calculation remains in `desktop/packages/ui/src/lib/cornerRadius.ts:18-29`. Both roots place it inside `ThemeSystemProvider` and outside application content (`desktop/packages/ui/src/main.tsx:95-103`; `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:46-54`). This composition keeps appearance synchronization at the root and avoids distributing global DOM mutations among leaf components.

## Step 6 Maintainability and dead code

All three imports are exercised: React owns the layout effect/fragment, `useUIStore` supplies five selectors, and `applyCornerRadius` is called at `desktop/packages/ui/src/components/providers/ThemeProvider.tsx:1-3,9-22`. The sole prop is consumed, and both production entry points import the export (`desktop/packages/ui/src/main.tsx:8`; `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:7`). The implementation has no branching error suppression, placeholder comments, or unreachable fallback; repeated application is safe because the target mutations use `setProperty`/`removeProperty` (`desktop/packages/ui/src/stores/useUIStore-impl.ts:1741-1755`).

## Step 7 Test evidence and gaps

Radius normalization, scaling defaults, and all five DOM writes have direct assertions in `desktop/packages/ui/src/lib/cornerRadius.test.ts:11-37`. No test under `desktop/packages/ui` references `ThemeProvider`, `applyTypography`, or `applyPadding`; therefore mount timing and reaction to store hydration are not directly regression-tested. The audit's suggested files are backend provider tests rather than UI-provider coverage: `packages/ax-code/test/cli/providers.test.ts:32-50` tests CLI login providers, and `packages/ax-code/test/provider/cloud-api-providers.test.ts:9-27` tests cloud model providers. This is a coverage gap, not evidence of incorrect runtime behavior.

## Step 8 Finding disposition

The unit ledger currently records no accepted finding (`docs/module-quality-audit/modules/ui-components-providers/MODULE-AUDIT.md:47-51`), and the findings directory contains no evidence files. The independent review found no Critical, High, or Medium issue. The bounded duplicate style application and missing provider lifecycle test from Steps 4 and 7 are low-risk maintenance observations; neither demonstrates a user-visible failure, so no new finding artifact is warranted.

## Step 9 Verification and exit

The package defines `type-check` as `tsc --noEmit` and its test runner in `desktop/packages/ui/package.json:14-19`. On 2026-08-11, `pnpm --dir desktop/packages/ui run type-check` exited 0, and `pnpm --dir desktop/packages/ui run test -- src/lib/cornerRadius.test.ts` exited 0 with 226 files and 1,411 tests passing. These checks exercise the typed integration and the available UI suite; combined with the two root composition reads at `desktop/packages/ui/src/main.tsx:93-104` and `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:44-56`, the reviewer considers `ui-components-providers` complete with no Critical re-verification file required.
