# Protocol Steps — ui-components-update

Reviewer: ax-code-glm (model `zai-coding-plan/glm-5.2[1m]`)
Unit: `ui-components-update`
Resolved root: `desktop/packages/ui/src/components/update`
Verifier lane: codex-sol
Date: 2026-08-11

This is a real, independent 9-step review of the three source files in scope for
`ui-components-update`. Every claim below is anchored to a concrete `file:line`
that was read during this pass.

## Step 1 Scope and inventory confirmation

The unit contains exactly three files, all under
`desktop/packages/ui/src/components/update/`:

- `AxCodeUpdateToast.tsx` (210 lines) — the React component that owns polling,
  event handling, the upgrade POST, and toast side effects.
- `axCodeUpdateDedup.ts` (91 lines) — pure decision/coercion helpers extracted
  out of the component so they can be tested without a DOM.
- `__tests__/axCodeUpdateDedup.test.ts` (225 lines) — vitest suite for the pure
  helpers.

The component is mounted from `desktop/packages/ui/src/App.tsx:214` (inside
`EmbeddedSessionChatContent`, which only renders when the `ocPanel=session-chat`
query param is present per `App.tsx:145`) and `App.tsx:965` (main layout). These
two contexts are mutually exclusive at runtime, so this is not a double-mount
hazard — but it is the reason the dedup/seen-set logic in the component must be
idempotent across instances, which it is (see Step 4).

## Step 2 Public surface and contract

The dedup module exports seven symbols (`AxCodeUpdateToast.tsx:9-15` imports
four of them plus the `AxCodeUpgradeStatusLike` type). The component itself
exports a single `AxCodeUpdateToast` React.FC (`AxCodeUpdateToast.tsx:24`).

The contract is deliberately narrow: the pure module answers "should we show
this toast / what version is this?", and the component is the sole owner of
side effects (`toast.*`, `getSafeStorage`, `fetch`, `window.addEventListener`).
The module header at `axCodeUpdateDedup.ts:1-11` documents this boundary
explicitly and marks the helpers as exposed-for-testing rather than stable
consumer surface. This is a clean split.

## Step 3 Correctness of the polling and event-driven control flow

The main effect (`AxCodeUpdateToast.tsx:100-207`) does three jobs: poll
`upgrade-status` on a schedule, listen for `openchamber:ax-code-update-available`
custom events (`:201`), and reconcile both through the same
`showUpdateAvailableToast` path (`:101-135`).

Cancellation is handled correctly: a `cancelled` flag (`:142`) is set in the
cleanup function (`:203`) and is checked after every `await`
(`:172` inside `checkForUpdate`) so that a response arriving after unmount does
not call `showUpdateAvailableToast`. All `setTimeout` handles — both the initial
delay (`:195-199`) and every retry (`:186-190`) — are pushed into the
`timeoutIds` array and cleared together on teardown (`:204`), so no retry fires
after unmount. This is correct.

## Step 4 Dedup decision correctness

`shouldShowAxCodeUpdateToast` (`axCodeUpdateDedup.ts:30-35`) short-circuits on
empty version, then on membership in `seenVersions`, then on equality with
`dismissedVersion`. The ordering matters: the seen-set guards intra-session
re-notification from both the polling path and the custom-event path, while the
dismissed-version check honors a persistent user choice across reloads.

Version normalization is consistent. Both server-facing coercions
(`resolveAxCodeUpdateVersion` at `:45-50` and `resolveAxCodeUpgradeStatusVersion`
at `:65-70`) call `.trim()`, and the dismiss handler at `:130` stores the same
already-trimmed `version` it received. So literal equality (`:33`, `:49`) is
safe: a server reporting `"  1.16.0  "` will not bypass a prior dismissal of
`"1.16.0"`. Non-string payloads are rejected at `:48` and `:68`, which the
inline docstring at `:42-44` explains is required precisely because downstream
compares by literal equality. The 28 unit tests in
`axCodeUpdateDedup.test.ts:10-80` exercise every branch of this logic,
including the "seen set blocks even when dismissed differs" case at `:71-79`.

## Step 5 Robustness of network error handling

`checkForUpdate` (`:167-193`) reads `AxCodeUpgradeStatusLike` from the server
and, on any throw, schedules a retry using `CHECK_RETRY_DELAYS_MS[attempt]`
(`:21`, values `[10_000, 60_000]`). After attempt index 2 the lookup returns
`undefined` and polling stops (`:185`). The `response.json().catch(() => null)`
guards at `:66` and `:171` defensively swallow JSON-parse failures into a null
payload that the resolvers then reject — good.

Two observations worth recording (not Critical):

1. Neither fetch has a timeout or `AbortController`. The upgrade POST at
   `:58-65` and the status GET at `:169` will hang for as long as the network
   stack allows. Because these target a local server this is low impact, but a
   wedged local process would leave the "upgrading…" toast
   (`UPGRADE_TOAST_ID`, `:50-55`) spinning with `duration: Infinity` until the
   tab is closed.
2. When all retries are exhausted polling simply stops (`:185`); there is no
   user-visible signal or log that the update check gave up. For an
   update-notification surface that is acceptable, but it is a silent failure
   mode.

## Step 6 Design — separation of pure logic from effects

The extraction is the strongest part of this unit. `axCodeUpdateDedup.ts`
contains zero imports and zero side effects; every function is a pure coercion
or boolean decision. `AxCodeUpdateToast.tsx` concentrates every side effect.
This is what made the 28-case test suite possible without mocking React, the
DOM, storage, or fetch. The `AxCodeUpgradeStatusLike` interface
(`:52-58`) is a permissive mirror of the server payload (all fields optional /
nullable), which is the right shape for an untrusted JSON response consumed at
`:171`.

## Step 7 Hygiene — constants, dependencies, naming

Timing values are named module-level constants rather than inline magic numbers
(`INITIAL_CHECK_DELAY_MS` at `:20`, `CHECK_RETRY_DELAYS_MS` at `:21`). The three
toast IDs are named string constants (`:17-19`) so the dismiss calls scattered
through the file (`:33`, `:38`, `:49`, `:76`, `:106`, `:131`) stay consistent.
Storage key `UPDATE_TOAST_DISMISSED_VERSION_KEY` (`:22`) is also a constant.

Imports are all in-repo (`@/components/...`, `@/stores/...`, `@/lib/...`) and
resolve to real modules — `getSafeStorage` from
`desktop/packages/ui/src/stores/utils/safeStorage.ts` returns a Storage impl
that falls back to an in-memory map when `window.localStorage` is unavailable
or throws, so the dismiss persistence degrades gracefully in non-browser test
contexts. No unused imports were observed.

## Step 8 Test coverage assessment

The pure helpers are exhaustively covered: `shouldShowAxCodeUpdateToast`
(`axCodeUpdateDedup.test.ts:10-80`), `resolveAxCodeUpdateVersion`
(`:82-114`), `resolveAxCodeUpgradeStatusVersion` (`:116-178`), and
`resolveAxCodeIncompatibility` (`:180-224`) each have happy-path, null-input,
wrong-type, and trim cases.

The gap is the component itself. `AxCodeUpdateToast.tsx` is 210 lines of
non-trivial orchestration — the retry schedule, the `cancelled` guard, the
event-listener wiring, the upgrade POST success/failure branches
(`:57-98`), and the incompatibility dedup via `warnedIncompatibleVersionRef`
(`:148-151`) — and none of it is exercised by any test in this directory.
`getSafeStorage` returning null, the `showAxCodeUpdateNotifications=false`
early return (`:105-108`), and the retry-stops-after-undefined behavior at
`:184-185` are all untested branches. This is the single biggest quality lift
available for the unit.

## Step 9 Findings, severity, and exit

No Critical or High severity issues were found. The `findings/` directory is
empty and this review did not introduce any Critical item, so no
`reverify.md` second-pass gate is triggered for `ui-components-update`.

Two non-blocking observations are recorded for the module owner:

- **Test gap (the larger one):** add component-level tests for
  `AxCodeUpdateToast.tsx`, at minimum covering the retry schedule, the
  unmount-cancellation contract, and the `showAxCodeUpdateNotifications=false`
  dismissal path. The pure-helper suite proves the dedup decisions; the effect
  that consumes them is currently trusted on read.
- **Fetch timeout (the smaller one):** consider an `AbortController`/timeout on
  the upgrade POST (`:58-65`) so a wedged local server cannot leave the
  `UPGRADE_TOAST_ID` spinner at `duration: Infinity` forever.

This unit is structurally sound. The pure/effect boundary is well drawn, the
happy paths are correct, and the cancellation logic is right. The follow-ups
are coverage and robustness hardening, not correctness defects.
