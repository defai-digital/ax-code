# Review Protocol — ui-components-auth

Unit: `ui-components-auth`  
Reviewer: `codex-sol` (`gpt-5.6-sol-xhigh`)  
Independent verifier: `ax-code-glm`

## Step 1 Scope and entry points

The reviewed unit contains one 585-line source file and one export: `SessionAuthGate` at `desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:136`. It is a real application boundary, not an orphaned component: the main desktop tree wraps `App` at `desktop/packages/ui/src/main.tsx:93-104`, and the Electron mini-chat tree wraps `ElectronMiniChatApp` at `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:44-56`. The gate owns the initial loading view, locked credentials form, retry/rate-limit views, and the final decision to render children at `SessionAuthGate.tsx:453-583`. The inventory and single-file scope agree with `docs/module-quality-audit/modules/ui-components-auth/MODULE-AUDIT.md:20-29`.

## Step 2 Inputs and trust boundaries

The password exists only in React state (`desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:139-147`) and is sent as JSON to `/auth/session` with `credentials: "include"` at lines 43-53; the component never writes the password or session cookie to browser storage. Only the boolean trust-device preference is persisted under `openchamber.uiAuth.trustDevice` at lines 23 and 36-40, then forwarded with password or passkey authentication at lines 316 and 389-390. Server evidence confirms that the value merely selects session TTL when issuing the HttpOnly session: `desktop/packages/web/server/lib/ui-auth/ui-auth.js:496-526` validates the password before using `trustDevice`, while lines 569-575 issue a session only after passkey verification. Registration routes are additionally guarded by `requireAuth` at `desktop/packages/web/server/lib/ax-code/core-routes.js:348-364`.

## Step 3 State and response correctness

The state machine begins at `pending` and distinguishes `authenticated`, `locked`, `error`, and `rate-limited` (`desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:128-150`). `checkStatus` maps successful GETs to authenticated, 401 to locked, 429 to a parsed retry delay, and transport or other statuses to the generic error screen at lines 204-243. Password submission independently maps the same important outcomes at lines 302-360, clears the password on success at line 318, and permits authentication even if optional passkey enrollment is canceled or fails at lines 319-337. Passkey sign-in sets authenticated only after `authenticateWithPasskey` resolves at lines 375-405. The render branches at lines 453-465 keep protected children out of the tree until the state is authenticated; the sole child render is lines 583-584.

## Step 4 Async lifecycle and performance

Initial session status and passkey availability are fetched concurrently with `Promise.all` at `desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:210-213`, so startup adds two bounded requests rather than serial latency. The WebAuthn support effect uses a cancellation flag before post-await state writes and flips it during cleanup at lines 174-202. Passkey work has explicit busy/action state, and every register/auth path clears that state in `finally` at lines 284-294 and 389-404; the user can also cancel the active ceremony through lines 296-300. Post-auth settings synchronization is guarded by `hasResyncedRef` so it runs once per unlocked epoch at lines 252-277. Its callees contain their own fallbacks: `syncDesktopSettings` logs and contains load/apply failures at `desktop/packages/ui/src/lib/persistence.ts:1082-1109`, and appearance initialization catches at lines 1283-1312. There is no polling loop, retained timer, or growing collection in the gate.

## Step 5 Design and ownership

Transport helpers for session GET/POST remain small and local at `desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:22-54`, while WebAuthn protocol work is delegated to `desktop/packages/ui/src/lib/passkeys.ts:75-147`. That helper validates browser support, performs options/verify exchanges, and normalizes passkey status; the gate stays responsible for user-visible orchestration and state. Both top-level consumers place the gate inside the i18n and theme providers (`desktop/packages/ui/src/main.tsx:93-103` and `desktop/packages/ui/src/apps/renderElectronMiniChatApp.tsx:44-54`), matching its calls to `useI18n` and themed components. At 585 lines the component combines shell markup, state transitions, and two authentication methods, so extracting a tested state/response reducer would improve maintainability, but the present boundaries do not establish a layering violation.

## Step 6 Hygiene and accessibility

The superficially quiet catches have explicit fallback behavior: passkey-status failure resets to `defaultPasskeyStatus` at `desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:164-171`, capability detection disables passkeys at lines 181-196, and malformed rate-limit JSON becomes an empty object at lines 227-235. The hard-coded `skipAuth = false` at line 138 leaves several unreachable bypass branches (lines 160-162, 177-179, and 205-207); this is minor scaffolding, not an authorization bypass because no runtime input can turn it on. Accessibility is substantially wired: locked-state focus and selection occur at lines 258-263, the password input connects `aria-invalid` and `aria-describedby` to the error paragraph at lines 501-518 and 572-575, and the icon-only submit has a localized label at lines 520-531. A future component test should also pin focus and accessible naming.

## Step 7 Test coverage and residual risk

The closest direct UI test covers only `fetchPasskeyStatus`: `desktop/packages/ui/src/lib/passkeys.test.ts:10-18` verifies the route, GET method, included credentials, and normalized enabled state. No test imports `SessionAuthGate`, so the 401/429/error render branches, password submission, passkey cancellation/enrollment, resynchronization guard, local-storage preference, focus behavior, and protected-child invariant are not directly regression tested. The server auth test at `desktop/packages/web/server/lib/ui-auth/ui-auth.test.js:34-110` covers password-binding/JWT-secret behavior and reset safety rather than this UI state machine. The broad test list in `docs/module-quality-audit/modules/ui-components-auth/MODULE-AUDIT.md:31-42` is therefore corroborating auth coverage, not component-level proof. This is the main residual quality risk, but the inspected implementation did not substantiate a release-blocking defect.

## Step 8 Finding disposition

The register currently records no accepted issue at `docs/module-quality-audit/modules/ui-components-auth/MODULE-AUDIT.md:56-60`, and there are no files under this unit's `findings/` path. This review found no Critical or High security, correctness, lifecycle, or performance issue to add: protected content is gated until authentication (`desktop/packages/ui/src/components/auth/SessionAuthGate.tsx:453-583`), credentials are submitted with cookies included (lines 25-53), and passkey setup is server-authenticated (`desktop/packages/web/server/lib/ax-code/core-routes.js:348-364`). The direct-test gap and hard-coded bypass scaffolding remain non-blocking follow-up observations. Because there is no Critical record, no `protocol/reverify.md` is created.

## Step 9 Verification and exit

`pnpm --dir desktop/packages/ui test -- src/lib/passkeys.test.ts` completed successfully; the package runner executed the full UI suite and reported 226 files and 1,411 tests passing. `pnpm --dir desktop/packages/ui run type-check` also completed with exit code 0, exercising the script declared at `desktop/packages/ui/package.json:14-20`. I re-read the candidate, its two mount points, passkey client, session/passkey server routes, post-auth persistence, closest tests, and the audit register after the checks. Primary review for `ui-components-auth` is complete with no Critical gate artifact; independent verification remains assigned to `ax-code-glm` by `docs/module-quality-audit/modules/ui-components-auth/MODULE-AUDIT.md:11-16`.
