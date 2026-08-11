# Nine-step review — `cli-cmd-branch`

Reviewer: codex-sol (`gpt-5.6-sol-xhigh`)
Verifier lane: ax-code-glm

## Step 1 Scope and command exposure

The `cli-cmd-branch` unit is implemented by `packages/ax-code/src/cli/cmd/branch.ts`: `BranchCommand` is exported at line 9, declares the required session positional plus `--from` and `--json` at lines 10–16, and is registered in the process-wide command list through `packages/ax-code/src/cli/boot.ts:18` and `packages/ax-code/src/cli/boot.ts:76`. The adjacent `cmd` helper is only a typed identity (`packages/ax-code/src/cli/cmd/cmd.ts:3-6`), so all runtime behavior belongs to the command handler and the services it invokes.

## Step 2 Inputs and trust boundaries

Both identifiers originate as command-line strings. `SessionID.make` and `MessageID.make` are compile-time brands rather than validators (`packages/ax-code/src/id/branded.ts:18-21`), but the session lookup reaches the `SessionID.zod`-wrapped `Session.get` at `packages/ax-code/src/session/index.ts:468-474`, and `Session.fork` validates both ID prefixes at `packages/ax-code/src/session/index.ts:301-305`. The command reads local session state, replay/risk data, and Git worktree state; it neither accepts secrets nor makes a network request. Its externally visible effects are a newly persisted session, snapshot bookkeeping, events emitted by the fork backend, and stdout.

## Step 3 Session resolution and failure control

The handler scopes all work to the resolved current directory through `Instance.provide` at `packages/ax-code/src/cli/cmd/branch.ts:17-20`; the provider establishes project context before calling the supplied function (`packages/ax-code/src/project/instance.ts:196-213`). It resolves the source session before taking a snapshot or creating a fork (`branch.ts:21-26`). Missing sessions are converted into a concise message and exit status 1 by `packages/ax-code/src/cli/cmd/session-required.ts:5-12`, while storage or parsing errors other than `NotFoundError` are rethrown instead of being misreported.

## Step 4 Branch-point semantics

The optional point is passed to `Session.fork` at `packages/ax-code/src/cli/cmd/branch.ts:29-30`. The backend loads messages in chronological order (`packages/ax-code/src/session/index.ts:582-595`) and retains IDs strictly less than the supplied ID (`packages/ax-code/src/session/index.ts:318-322`), which supports replacing the selected message and everything after it. A non-Critical validation gap remains: a well-formed `msg_...` that is absent from, or belongs to a different session than, the source is never checked for membership; its lexical position can silently produce an empty or full-history branch. The CLI has no success-path test for this case.

## Step 5 Snapshot and output behavior

Before forking, the command attempts `Snapshot.track()` and intentionally degrades to `undefined` on any rejection (`packages/ax-code/src/cli/cmd/branch.ts:25-26`). The snapshot implementation serializes operations, skips disabled repositories, and verifies the generated tree and ref (`packages/ax-code/src/snapshot/index.ts:319-363`). JSON mode reports original, branch, risk, snapshot, and branch point at `branch.ts:34-47`; human mode prints the same core IDs plus follow-up commands at `branch.ts:50-66`. Silent snapshot degradation preserves branching availability, although neither output mode explains why a snapshot is absent.

## Step 6 Performance and atomicity

`Risk.fromSession` scans event and diff history (`packages/ax-code/src/risk/score.ts:395-405`), and it is invoked once for the original and once for the new branch at `packages/ax-code/src/cli/cmd/branch.ts:23-32`. The fork itself materializes all source messages and parts in memory, precomputes replacement IDs, and writes them in one database transaction (`packages/ax-code/src/session/index.ts:315-375`); events are published only after commit at lines 377–383. Work is linear in session history, appropriate for an explicit branch operation, with no repeated database write transaction per copied part.

## Step 7 Ownership and maintainability

The CLI file owns argument presentation and terminal/JSON formatting, while `Session.fork` owns persistence, parent-ID remapping, event publication, and goal inheritance (`packages/ax-code/src/session/index.ts:324-401`). This separation keeps transaction policy out of the command. The command also reuses the shared missing-session adapter at `packages/ax-code/src/cli/cmd/session-required.ts:5-12`. The only localized maintainability concern is the broad snapshot suppression at `branch.ts:26`; preserving a diagnostic through logging would make Git failures observable without coupling branch creation to snapshot success.

## Step 8 Tests and finding assessment

The CLI smoke suite verifies that a missing source session exits nonzero without a stack trace at `packages/ax-code/test/cli/smoke.test.ts:268-287`. Backend coverage verifies fork-title safety at `packages/ax-code/test/session/session.test.ts:230-250` and inherited-goal behavior, including a tolerated goal-copy failure, at `packages/ax-code/test/session/goal.test.ts:157-193`. No test invokes a successful `branch`, `branch --json`, or `branch --from`; therefore output shape and message-boundary behavior remain uncovered. `docs/module-quality-audit/modules/cli-cmd-branch/MODULE-AUDIT.md:60-64` contains no accepted finding, and no Critical file exists under this unit's `findings/` directory.

## Step 9 Verification and exit decision

`pnpm --dir packages/ax-code run typecheck` completed with exit code 0. The focused command `AX_TEST_FILES=test/cli/smoke.test.ts,test/session/session.test.ts,test/session/goal.test.ts pnpm --dir packages/ax-code exec vitest run` completed with 3 files and 42 tests passing. These checks cover type integrity, missing-session handling, fork construction, and goal copying, but do not close the success-path CLI coverage gap described in Step 8. No Critical severity item requires a secondary `reverify.md`; the nine-step reviewer record is complete with the `--from` membership issue retained as a non-Critical concern.
