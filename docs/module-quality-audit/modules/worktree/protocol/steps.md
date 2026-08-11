# Protocol steps — worktree

Unit slug: `worktree`
Reviewer: ax-code-glm
Model: zai-coding-plan/glm-5.2[1m]
Baseline commit: 8a38b90b950855545c6b2479220274357904f111

Primary source under review: `packages/ax-code/src/worktree/index-impl.ts` (938 lines, the
entire implementation). `packages/ax-code/src/worktree/index.ts` is a one-line re-export of
that namespace and contributes no logic. Supporting files cross-read for evidence:
`packages/ax-code/src/util/git.ts`, `packages/ax-code/src/util/process.ts`,
`packages/ax-code/test/worktree/worktree.test.ts`, `packages/ax-code/test/project/worktree-remove.test.ts`.

## Step 1 Inventory and boundaries

The `worktree` unit is a single TypeScript namespace (`Worktree`, `index-impl.ts:18`) that
manages git worktree lifecycles for arena/isolation sandboxes. Its public surface is 27
exports: input schemas (`CreateInput` `index-impl.ts:61`, `RemoveInput` `index-impl.ts:85`,
`ResetInput` `index-impl.ts:95`), typed errors (`NotGitError`, `CreateFailedError`,
`NameGenerationFailedError`, `StartCommandFailedError`, `RemoveFailedError`,
`ResetFailedError`), and operations (`list` `index-impl.ts:333`, `create` `index-impl.ts:618`,
`createReady` `index-impl.ts:634`, `remove` `index-impl.ts:647`, `reset` `index-impl.ts:795`,
`runStartScripts` `index-impl.ts:405`, `makeWorktreeInfo` `index-impl.ts:475`,
`createFromInfo` `index-impl.ts:487`, `cancelPendingStartScripts` `index-impl.ts:467`).
Inbound dependencies are narrow: `Global`, `Instance`, `InstanceBootstrap`, `Project`,
`Process`, `git`, `fn`, `Log`, `GlobalBus`, `BusEvent`, `NamedError`. No outbound coupling
to tool/session/server layers — the module is a leaf service consumed by project + isolation.
The module owns filesystem layout under `Global.Path.data/worktree/<projectID>/`
(`index-impl.ts:480`).

## Step 2 Failure and boundary model

Three classes of external hazard: (a) git subprocess failures — handled via the retrying
`git()` helper in `util/git.ts:48-56` for lock-contention and explicit exitCode checks at
every call site; (b) filesystem races (TOCTOU) during name allocation — mitigated by the
atomic `fs.mkdir(directory, { recursive: false })` reservation in `candidate()`
(`index-impl.ts:368-373`) with EEXIST retry; (c) DB write failure after git side-effects —
handled by the rollback cascade in `createFromInfo` (`index-impl.ts:497-525`): git worktree
remove, branch -D, then `fs.rm`. No secrets flow through this module; inputs are project
ids, directory paths, and user-supplied start commands. User-supplied start commands are
deliberately shell-executed (`runStartCommand` `index-impl.ts:381-386`) — this is by design
(the caller's own config), and the `StartPoint` zod refine (`index-impl.ts:79`) blocks
option-injection into the `git worktree add` argv.

## Step 3 Correctness of control flow

Traced each public entry point end to end. `create` (`index-impl.ts:618`) defers bootstrap
via `setTimeout(0)` tracked in `startScriptTimers` (`index-impl.ts:460`) so
`cancelPendingStartScripts` (`index-impl.ts:467`) can abort a create that is removed before
the tick fires — covered by the test at `worktree.test.ts:213` ("removing one worktree does
not cancel another pending bootstrap"). `createReady` (`index-impl.ts:634`) awaits the
bootstrap and on failure calls `remove` to roll back (`index-impl.ts:638-644`), validated by
`worktree.test.ts:142`. `remove` (`index-impl.ts:647`) re-lists after a failed `git worktree
remove` and treats an already-gone entry as success (`index-impl.ts:748-758`), and splits
directory-cleanup vs branch-deletion errors so a branch delete still runs even when the dir
rm throws (`index-impl.ts:766-790`) — covered by `worktree-remove.test.ts:148`. One minor
rough edge: `reset` calls `cancelPendingStartScripts(input.directory)` at `index-impl.ts:800`
on the raw caller path and again at `index-impl.ts:892` with the git-reported `worktreePath`;
because `startScriptTimers` is keyed by the creation-time `info.directory`, the first cancel
can be a no-op when paths differ in form. Severity LOW — the bootstrap timer fires on the
next tick, so the exposure window is sub-millisecond and `reset` re-queues start scripts at
`index-impl.ts:934` regardless.

## Step 4 Resource and performance handling

All git invocations go through the pooled `git()`/`Process.run` helpers which drain stdout
and stderr as Buffers and destroy pipes after exit (`util/process.ts:160-168`), so no fd leak
on background children. `list()` (`index-impl.ts:333`) fans out sandbox canonicalization via
`Promise.all` rather than serial awaits — appropriate for the typical single-digit sandbox
count. The deferred-bootstrap timers all call `timer.unref()` (`index-impl.ts:453`,
`index-impl.ts:629`) so a pending start script cannot keep the event loop alive after
shutdown. `prune()` (`index-impl.ts:264`) fans out `Promise.all` over a small parsed failure
list and each branch is bounded by a path-containment check (`target.startsWith(base + sep)`,
`index-impl.ts:270`) before any `fs.rm`. No unbounded growth: `startScriptTimers` entries are
released both on fire (`index-impl.ts:444`) and on cancel (`index-impl.ts:419`).

## Step 5 Design cohesion and ownership

The namespace groups four distinct concerns behind one boundary: name allocation
(`candidate`, `slug`, `randomName`), git plumbing (`worktreeBranchMap`, `sweep`, `prune`),
lifecycle orchestration (`create`/`createReady`/`remove`/`reset`), and start-script
scheduling (`queueStartScripts`, `runStartScripts`, timer bookkeeping). This is cohesive for
a 938-line leaf service — every helper is consumed by the lifecycle operations, and there is
no second unrelated responsibility. The split of `create` (deferred, fire-and-track) vs
`createReady` (synchronous, throws on failure) is a deliberate API choice matching two caller
profiles (interactive arena vs gated bootstrap), not duplication. The porcelain parser in
`worktreeBranchMap` (`index-impl.ts:298-331`) and the inline parser duplicated inside
`remove`'s `locate` (`index-impl.ts:659-684`) and `reset` (`index-impl.ts:816-828`) parse the
same `git worktree list --porcelain` format three times — a candidate for extraction, but
each call site needs slightly different shapes (branch stripping vs raw branch), so merging
is optional polish rather than required.

## Step 6 Defensive code and error handling

The module is deliberately defensive about partial-state cleanup. Beyond the create-time
rollback, `prepareCreate` (`index-impl.ts:604-616`) wraps `createFromInfo` so that any throw
still `fs.rm`s the preallocated directory. `sweep` (`index-impl.ts:276`) is a two-pass clean:
on first failure it parses git's `warning: failed to remove <path>` lines via `failed()`
(`index-impl.ts:249-262`), prunes exactly those entries, and retries. Swallowed catches are
narrow and intentional: `fs.realpath(abs).catch(() => abs)` (`index-impl.ts:289`) falls back
to the input path when realpath fails on a not-yet-existing target, and `fs.rm(target,
{recursive, force}).catch(() => undefined)` (`index-impl.ts:271`) inside `prune` is
best-effort because the follow-up `git clean -ffdx` retry (`index-impl.ts:284`) re-surfaces
any genuinely un-removable path. The `stop` helper (`index-impl.ts:699-702`) ignores the
fsmonitor-stop exit code — acceptable since a missing daemon is the normal case. None of
these hide a real correctness gap.

## Step 7 Test coverage of the unit

Three test files exercise this module. `worktree.test.ts` (10 cases) covers: orphan
directory cleanup on git failure (`:35`), DB-failure rollback (`:50`), inaccessible-target
remove surfacing EACCES (`:75`), start-command failure propagation (`:96`), createReady
end-to-end with tracked file + start marker (`:119`), createReady rollback on start failure
(`:142`), startPoint option-injection rejection (`:169`), and reset cancellation of pending
bootstrap (`:185`). `worktree-remove.test.ts` covers the regression where `git worktree
remove` exits non-zero after detaching (`:42`), sandbox-record retention on hard remove
failure (`:97`), branch deletion surviving directory-cleanup failure (`:148`), fsmonitor
stop before removal (`:183`, windows/linux gated), and bootstrap independence across
worktrees (`:213`). Coverage is strong on the failure/rollback paths that matter most. Gaps:
no test for `reset`'s remote-HEAD resolution branch (`index-impl.ts:859-865`) or the
multi-remote fallback, and no test for the `sweep`/`prune` two-pass clean beyond the happy
path.

## Step 8 Findings ledger

No Critical or High severity findings. The pre-existing `findings/` directory for this unit
does not exist and the MODULE-AUDIT register shows `_none accepted_`. LOW observations
recorded for traceability, none blocking: (L1) `reset` issues two `cancelPendingStartScripts`
calls with different key forms (`index-impl.ts:800` vs `:892`) — harmless given next-tick
fire; (L2) `canonical` lowercases on darwin (`index-impl.ts:291`) assuming case-insensitive
APFS, which is correct for the default volume but would over-merge on a case-sensitive macOS
volume — acceptable heuristic; (L3) the porcelain parser is triplicated (`:298`, `:659`,
`:816`) — optional DRY extraction only. All LOW — no reverify gate triggered.

## Step 9 Verification and exit

Static-extract fingerprint `9df34adad83e9a83` from MODULE-AUDIT matches the two-file, 941-LOC
inventory I reconciled by hand (939 + 2). The 9-step protocol is now complete for the
`worktree` unit as primary reviewer (ax-code-glm). Because no Critical findings were raised
either in the existing ledger or by this pass, no `reverify.md` second-pass is required to
open the gate. Recommended verification for an implementer touching this module:
`pnpm --dir packages/ax-code run test:unit` scoped to the worktree files, plus
`pnpm --dir packages/ax-code run typecheck`. Independent verifier (codex-sol) sign-off still
pending per the dual-agent gate in MODULE-AUDIT §9.
