# Nine-step review: cli-cmd-account

## Step 1 Scope and entry points

The reviewed unit is `packages/ax-code/src/cli/cmd/account.ts`. It exports two display helpers at lines 20–34, five leaf command modules at lines 185–239, and the `console` command aggregator at lines 241–268. The command is reachable from the product CLI: `packages/ax-code/src/cli/boot.ts:8` imports `ConsoleCommand`, and `packages/ax-code/src/cli/boot.ts:60-106` includes it in the yargs registration list. `docs/module-quality-audit/modules/cli-cmd-account/MODULE-AUDIT.md:5-18` identifies the same slug, root, reviewer, verifier, and baseline.

## Step 2 Inputs and trust boundaries

The only positional external inputs are the required server URL for `login` (`packages/ax-code/src/cli/cmd/account.ts:185-197`) and the optional email for `logout` (`packages/ax-code/src/cli/cmd/account.ts:200-212`). Device login prints the verification URL and user code before attempting to launch a browser at lines 68–70. The CLI never reads or prints access or refresh tokens; token transport and persistence stay in `packages/ax-code/src/account/index.ts:397-430`, while `packages/ax-code/src/account/repo.ts:11-45` encrypts stored token values and avoids logging their contents.

## Step 3 Login and polling correctness

`packages/ax-code/src/cli/cmd/account.ts:43-62` derives an absolute deadline, sleeps no longer than the remaining lifetime, returns `PollExpired` at both deadline checks, retries pending responses, and adds five seconds after a slow-down response. The result switch at lines 75–94 handles every member of the union declared in `packages/ax-code/src/account/schema.ts:88-122`. Upstream durations are converted from seconds to milliseconds in `packages/ax-code/src/account/index.ts:64-88`, and `durationToMillis` is therefore intentionally an identity at lines 450–452. A request already in flight is not aborted at the deadline, which is a bounded robustness consideration rather than evidence of an accepted finding in this review.

## Step 4 Account and organization state transitions

Logout handles the empty store, exact-email lookup, cancellation, and selected-account removal in `packages/ax-code/src/cli/cmd/account.ts:97-127`. Switching preserves both identifiers in each choice and passes the selected account/org pair to `Account.use` at lines 135–159; the repository commits those identifiers together in `packages/ax-code/src/account/repo.ts:98-106` and exposes that operation at lines 148–150. Organization listing uses the same two-key active predicate at `packages/ax-code/src/cli/cmd/account.ts:36-39` and lines 161–174, avoiding a false active marker when different accounts contain similarly named organizations.

## Step 5 Resource and latency behavior

Polling is timer-driven rather than a tight loop (`packages/ax-code/src/cli/cmd/account.ts:41-58`), and the delay grows on server slow-down signals. Menu construction and organization rendering are linear in the returned account/org collection at lines 114–120 and 141–149. The service fetches organizations for accounts concurrently with `Promise.allSettled` in `packages/ax-code/src/account/index.ts:336-345`, isolates a failed account, and returns only fulfilled groups. No unbounded collection, duplicate network fan-out, or synchronous blocking operation was found in the CLI layer.

## Step 6 Layering and command composition

The file confines itself to prompt orchestration and formatting: yargs typing is supplied by the identity helper in `packages/ax-code/src/cli/cmd/cmd.ts:1-7`, terminal output goes through `UI` in `packages/ax-code/src/cli/cmd/account.ts:9-34`, and account data operations go through `Account` at lines 66, 98, 109, 125, 136, 157, 162, 166, and 177. HTTP decoding and persistence remain owned by `packages/ax-code/src/account/index.ts:235-452`, while database transactions remain in `packages/ax-code/src/account/repo.ts:74-106`. The `ConsoleCommand` builder at account.ts:241-267 composes the five leaf commands without duplicating their handlers.

## Step 7 Failure paths and code hygiene

Prompt cancellation is normalized to `undefined` by `packages/ax-code/src/cli/cmd/account.ts:11-14`, and both interactive mutations return before changing state when cancelled at lines 122–125 and 154–157. Service or repository errors are allowed to propagate to the CLI boundary, where `packages/ax-code/src/cli/boot.ts:258-269` formats the failure and sets a nonzero exit status. Browser-launch rejection is intentionally contained at account.ts:7; login retains a manual URL fallback because it prints the URL first, although `open` can still emit an optimistic success message at lines 176–183. Imports, helpers, and all exported commands have observed uses, and no TODO marker or unreachable branch was found.

## Step 8 Test evidence and findings disposition

The focused test `packages/ax-code/test/cli/account.test.ts:6-25` checks account URLs, active labels, ANSI handling, and organization rows. Service coverage validates grouped organizations at `packages/ax-code/test/account/service.test.ts:40-83` and all OAuth polling tags at lines 327–377; repository coverage validates removal and selected-org state at `packages/ax-code/test/account/repo.test.ts:105-156`. The interactive handlers, cancellation branches, deadline timing, and browser failure message are not directly exercised, so they remain explicit coverage gaps. No file exists under this unit's `findings/` path, and the register in `docs/module-quality-audit/modules/cli-cmd-account/MODULE-AUDIT.md:67-71` contains no accepted item; consequently there is no Critical item requiring a `reverify.md` artifact.

## Step 9 Verification and conclusion

The focused command `AX_TEST_FILES=test/cli/account.test.ts pnpm exec vitest run`, executed from `packages/ax-code`, passed one file and all three tests. `pnpm --dir packages/ax-code run typecheck` also exited successfully. These checks exercise the directly imported presentation surface and compile the broader command/service boundary. With no accepted Critical finding and the noted non-blocking coverage gaps recorded above, the primary review for `cli-cmd-account` is complete.
