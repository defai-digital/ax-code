# Protocol Steps: dispatch

- Slug: `dispatch`
- Reviewer: `codex-sol`
- Date: `2026-08-11`

## Step 1 Scope and Surface

The `dispatch` unit is implemented by `packages/ax-code/src/dispatch/index.ts`: its public contract comprises the spec, status/result, executor output/function, merge strategy, event sink, options, and `dispatch` declarations at lines 24-117. The implementation then separates wait-for-all batching at lines 147-167, early-termination scheduling at lines 169-277, and one-child execution at lines 290-359. The production consumer in `packages/ax-code/src/workflow/dispatch-adapter.ts:52-70` converts workflow child plans to dispatch specs and passes the workflow concurrency, merge, and parent-cancellation settings through.

## Step 2 Threat and Failure Boundaries

The dispatcher accepts agent names, prompts, constraints, callback functions, executor output, and an `AbortSignal`; it performs no filesystem, process, network, credential, or provider access itself. The executor is explicitly injected and required to honor cancellation (`packages/ax-code/src/dispatch/index.ts:60-67`), while caller callbacks are isolated so a thrown observer cannot terminate work (`packages/ax-code/src/dispatch/index.ts:279-287`). Result logging exposes only counts and the selected strategy, not prompts or child output (`packages/ax-code/src/dispatch/index.ts:134-141`). Callers still own validation of executor-reported file and token metadata because `runOne` copies those values at lines 319-330.

## Step 3 Correctness and Cancellation

The entry point handles an empty request and normalizes non-finite or sub-one concurrency before choosing a strategy (`packages/ax-code/src/dispatch/index.ts:118-132`). The all-path checks parent cancellation before every batch and returns a positionally complete array (`packages/ax-code/src/dispatch/index.ts:154-166`). Early strategies calculate the proper one-or-strict-majority threshold, store results by original index, stop launches after abort, and backfill never-started work (`packages/ax-code/src/dispatch/index.ts:184-215`, `packages/ax-code/src/dispatch/index.ts:218-245`). Per-child timeout and parent abort share a local controller but produce distinct statuses, and timer/listener cleanup occurs in `finally` (`packages/ax-code/src/dispatch/index.ts:295-358`). This depends, as documented, on executors reacting to the provided signal.

## Step 4 Concurrency and Cost

For `all`, only one slice of at most `maxParallel` is materialized into promises at a time (`packages/ax-code/src/dispatch/index.ts:155-164`). For `first-success` and `majority`, `inflight`, `nextIndex`, and the guarded launch loop cap active work without polling (`packages/ax-code/src/dispatch/index.ts:186-190`, `packages/ax-code/src/dispatch/index.ts:218-268`). Final backfill and status summaries are linear in the spec count (`packages/ax-code/src/dispatch/index.ts:212-215`, `packages/ax-code/src/dispatch/index.ts:134-140`). The remaining timers and abort listeners are per active child and are released at lines 353-357, so the implementation has bounded live coordination state proportional to the concurrency limit plus the result array.

## Step 5 Ownership and Interfaces

The narrow `DispatchExecutor` boundary keeps provider/session mechanics outside the unit (`packages/ax-code/src/dispatch/index.ts:50-67`), and `DispatcherEventSink` avoids a direct Bus dependency (`packages/ax-code/src/dispatch/index.ts:82-92`). Workflow-specific policy remains in `packages/ax-code/src/workflow/dispatch-adapter.ts`: direct dispatch is restricted to read-only workflows at lines 30-32 and 184-187, strategy translation occurs at lines 189-193, and workflow child/artifact state is derived from ordered results at lines 72-159. That division gives `dispatch` ownership of scheduling and normalization without coupling it to persistence or workflow authorization.

## Step 6 Error Handling and Hygiene

The unexpected outer `runOne` rejection path logs the agent and converts the error into a complete failed result rather than leaving the scheduler hung (`packages/ax-code/src/dispatch/index.ts:247-267`). Expected executor failures are likewise normalized with zeroed metadata at lines 335-352, and callback failures are logged through `toErrorMessage`; that helper safely handles even values whose string conversion throws (`packages/ax-code/src/util/error-message.ts:1-7`). The reviewed implementation has no placeholder branch or swallowed cleanup failure: timeout cancellation and parent-listener removal are explicit at `packages/ax-code/src/dispatch/index.ts:353-357`.

## Step 7 Test Evidence

The primitive suite checks the concurrency cap, sibling-independent failure, timeout, parent cancellation, callbacks, metadata defaults, invalid `maxParallel`, and duration accounting (`packages/ax-code/test/dispatch/index.test.ts:14-63`, `packages/ax-code/test/dispatch/index.test.ts:65-120`, `packages/ax-code/test/dispatch/index.test.ts:123-231`). Strategy tests cover first success, majority, stable input ordering, pre-aborted parents, resolved-array stability, long-lived parent signals, and event sinks (`packages/ax-code/test/dispatch/merge-strategies.test.ts:27-102`, `packages/ax-code/test/dispatch/merge-strategies.test.ts:130-205`, `packages/ax-code/test/dispatch/merge-strategies.test.ts:209-239`). Workflow integration verifies persisted result metadata and child-state behavior at `packages/ax-code/test/workflow/dispatch-adapter.test.ts:13-74` and `packages/ax-code/test/workflow/dispatch-adapter.test.ts:213-269`. A useful future edge test would cover a parent abort followed by a deliberately delayed executor rejection near its timeout boundary.

## Step 8 Findings Assessment

The existing register records no accepted item (`docs/module-quality-audit/modules/dispatch/MODULE-AUDIT.md:58-63`), and inspection found no finding document under this unit. Re-reading the scheduler transitions, result writes, abort forwarding, and cleanup at `packages/ax-code/src/dispatch/index.ts:177-277` and `packages/ax-code/src/dispatch/index.ts:290-358` did not establish a Critical, High, Medium, or Low defect requiring a new ledger entry. The delayed-rejection case noted above is retained as test hardening because the executor contract at lines 60-67 already requires prompt abort handling.

## Step 9 Verification and Sign-off

`AX_TEST_FILES=test/dispatch/index.test.ts,test/dispatch/merge-strategies.test.ts,test/workflow/dispatch-adapter.test.ts pnpm --dir packages/ax-code exec vitest run` passed all 3 files and 33 tests. `pnpm --dir packages/ax-code run typecheck` also completed successfully. These runs exercise the source entry point at `packages/ax-code/src/dispatch/index.ts:113-145`, both internal schedulers, and the workflow adapter call at `packages/ax-code/src/workflow/dispatch-adapter.ts:58-70`; no Critical item exists, so a separate Critical re-verification artifact is not required.
