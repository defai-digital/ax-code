# Review Protocol Steps — `tool-orchestration`

- **Unit slug:** `tool-orchestration`
- **Reviewer:** ax-code-glm (model: `zai-coding-plan/glm-5.2[1m]`)
- **Independent verifier (other lane):** codex-sol
- **Baseline commit:** `94e95c161c7deb8e055d8806a5f285e516285715`
- **Date:** 2026-08-11

Primary sources read in full:

- `packages/ax-code/src/tool/arena-implement.ts` (691 lines)
- `packages/ax-code/src/tool/arena.ts` (571 lines)
- `packages/ax-code/src/tool/council.ts` (441 lines)
- `packages/ax-code/src/tool/task.ts` (457 lines)
- `packages/ax-code/src/tool/task_parallel.ts` (411 lines)

---

## Step 1 Scope and inventory

The `tool-orchestration` unit covers the five multi-agent / subagent orchestration tools under `packages/ax-code/src/tool/`. Two families:

1. **Ensemble fan-out tools** — `arena.ts` (`ArenaTool`, defined at `arena.ts:215`) and `council.ts` (`CouncilTool`, defined at `council.ts:239`). Both read project config (`Config.getFresh()` at `arena.ts:228`, `council.ts:255`), run a `Budget.check` gate (`arena.ts:313`, `council.ts:276`), resolve members via `EnsembleShared.resolveMembers` (`arena.ts:340`, `council.ts:297`), then fan out per-member LLM calls and aggregate with pure mode modules (`Arena.rankArenaCandidates` at `arena.ts:482`, `Council.aggregateCouncil` at `council.ts:350`).

2. **Subagent spawning tools** — `task.ts` (`TaskTool` at `task.ts:95`) runs a single nested subagent session; `task_parallel.ts` (`TaskParallelTool` at `task_parallel.ts:275`) runs up to `MAX_PARALLEL = 8` (`task_parallel.ts:21`) concurrent subagents behind a `WriteIsolation.evaluateParallelAgents` gate (`task_parallel.ts:331`). `arena-implement.ts` is the worktree-isolated implement-arena backend (`runImplementArena` at `arena-implement.ts:631`, `runImplementContestant` at `arena-implement.ts:368`).

All five files share a common spine: `Session.create` with deny-listed nested permissions, `SessionPrompt.prompt` wrapped in `withTimeout`, and abort-signal cancellation of the child processor. Export surface is small (12 exports total per the static map), dominated by `arena-implement.ts` which exposes 8 helpers.

## Step 2 Failure model and abort propagation

The dominant failure dimension for this unit is concurrency + abort cleanup, correctly flagged as the risk tag.

- **Abort propagation is consistent across the unit.** `task.ts` wires two abort listeners (`markAborted` at `task.ts:124`, `cancelSubagent` at `task.ts:132`) and removes them via `defer` (`task.ts:143`, `:145`). `task_parallel.ts:160` does the same per task. `arena-implement.ts` passes `input.abort` into `SessionPrompt.prompt` (`arena-implement.ts:462`) and also calls `throwIfAborted` (`arena-implement.ts:293`) at every await boundary inside `runVerification`.
- **Session teardown asymmetry.** On genuine abort, `task.ts:338` removes the orphaned child session and rethrows; on operational failure it deliberately _preserves_ the session so `task_id` can be resumed (`task.ts:345-354`, well-documented). `task_parallel.ts:259` mirrors this. `arena-implement.ts` on abort removes both the worktree and the contestant session (`arena-implement.ts:569-589`), but on non-abort error it preserves the worktree and snapshots a partial patch (`arena-implement.ts:590-603`) and surfaces `sessionID` in the result (`arena-implement.ts:617`). This asymmetry is intentional and consistent in spirit, but the abort branch at `arena-implement.ts:569` is the only path that nulls `worktree`/`contestantSessionID` — if `Worktree.remove` throws it is swallowed (`arena-implement.ts:573-579`) and the local stays set, which is fine because the function is about to return anyway.
- **Verification mutation defense.** `runImplementContestant` captures `verifiedFingerprint` before running verification (`arena-implement.ts:522`), then re-snapshots after (`arena-implement.ts:523-530`) and emits `verificationMutation` if the fingerprint drifted (`arena-implement.ts:531-534`). This is a genuine, non-trivial guard against verify commands that edit the tree.

No empty catches exist (confirmed by the static map: 0 across all five files). All catch sites either rethrow, log via `log.warn`, or `.catch(() => undefined)` on best-effort cleanup where swallowing is the correct behavior (e.g. `ModeMemory.record*` at `arena.ts:391`, `council.ts:409`).

## Step 3 Correctness of control flow

- **`arena.ts` plan-mode concurrency is unbounded.** Plan proposals run via raw `Promise.all(members.map(...))` at `arena.ts:429` with no concurrency cap. Implement mode, by contrast, uses `FanOut.run({ concurrency: 2, ... })` at `arena-implement.ts:648`. Council also uses raw `Promise.all` at `council.ts:329` and again per debate round at `council.ts:370`. Member counts are bounded (arena `HARD_MAX = 5` at `arena.ts:32`; council `HARD_MAX_MEMBERS = 6` at `council.ts:27`), so this is not a live exhaustion bug, but it is a structural inconsistency: the unit has a `FanOut` primitive and only the implement path uses it.
- **Single-member `FanOut` wrapping.** `arena.ts:106` and `council.ts:122` both call `FanOut.run` with a one-element `members` array and then index `[0]` with a non-null assertion (`arena.ts:146` `return result!`, `council.ts:159` `fanOutResult?.result`). The assertion is currently safe because `FanOut.run` returns one result per member, but the pattern layers a manual retry loop (`arena.ts:170-193`, `council.ts:119-210`) on top of `FanOut`'s own timeout, which double-wraps execution. A direct `withTimeout(generateObject(...))` would express the same intent more plainly.
- **`task.ts` finalize re-assigns `result`.** When the primary turn returns empty text with no error, `task.ts:277` sets `finalizeAttempted = true` and re-invokes `SessionPrompt.prompt` inside an inner `try` (`task.ts:280-306`). On success the outer `result` binding (`task.ts:241`) is reassigned; on failure `finalizeError` is captured and the original empty `result` survives, so `task.ts:393` reads the correct binding either way. Control flow is correct.
- **`riskScore` heuristic conflates size with risk.** `arena-implement.ts:537` computes `Math.min(20, Math.max(1, Math.round(snapshot.linesChanged / 20)))`. A 400-line mechanical rename scores 20 (max); a 10-line concurrency bug scores 1 (min). The no-patch branch hard-codes 20 (`arena-implement.ts:537` ternary else). Functionally correct, but downstream `Arena.rank` consumers should not treat this as a calibrated risk signal.

## Step 4 Performance and resource behavior

- **Worktree I/O serialization.** Implement arena caps parallel contestants at 2 (`arena-implement.ts:647`, comment "reduce disk/memory pressure from parallel worktree operations"). `linkPrimaryNodeModules` (`arena-implement.ts:90`) symlinks the primary `node_modules` into each contestant worktree to avoid re-installs — guarded by `git check-ignore` (`arena-implement.ts:105`) so it only links when `node_modules` is git-ignored, and refuses to clobber an existing destination (`arena-implement.ts:99-103`).
- **`snapshotContestantPatch` issues 4-7 git calls per snapshot.** After committing it runs `diff --stat`, `diff --numstat`, `diff --name-only` in parallel (`arena-implement.ts:262-266`) plus ancestry check (`arena-implement.ts:235`). Each contestant snapshots up to twice (pre- and post-verification, `arena-implement.ts:512` and `:524`), so a 5-contestant arena with verification issues ~40-70 git subprocess invocations. Acceptable for an offline arena; not on a hot path.
- **Timeout layering.** `IMPLEMENT_TIMEOUT_MS = 12 * 60 * 1000` (`arena-implement.ts:31`), `VERIFY_TIMEOUT_MS = 5 * 60 * 1000` (`arena-implement.ts:32`). The outer `FanOut` budget is `IMPLEMENT_TIMEOUT_MS + 60_000` (`arena-implement.ts:651`) so the FanOut does not fire before an in-flight contestant's own `withTimeout` (`arena-implement.ts:489`). Subagent tools use `SUBAGENT_TIMEOUT_MS = 10 * 60 * 1000` (`task.ts:24`, `task_parallel.ts:22`) and `SUBAGENT_FINALIZE_TIMEOUT_MS = 2 * 60 * 1000` (`task.ts:25`, `task_parallel.ts:23`). Layering is coherent.
- **Verification runs via login shell.** `runVerification` executes `["bash", "-lc", cmd]` on non-Windows (`arena-implement.ts:325`). The `-l` flag sources the user's shell profile, which can add startup latency and side effects; `Env.sanitize()` (`arena-implement.ts:329`) is applied. Commands originate from the project's own `VerificationPolicy.resolvePreferredCommands` (`arena-implement.ts:308`), i.e. trusted local config, so there is no external injection surface.

## Step 5 Design, ownership, and boundaries

- **Ownership split is clean.** Tool files are thin orchestration shells; ranking/aggregation/debate live in pure mode modules (`mode/arena`, `mode/council`, `mode/debate`, `mode/budget`, `mode/preflight`, `mode/ensemble-shared`, `mode/memory`). The tools never reach into ranking internals directly — they call `Arena.rankArenaCandidates` / `ImplementArena.rank` / `Council.aggregateCouncil` and render. This is the right boundary.
- **Permission scoping is deliberate and tight.** Each spawner deny-lists the tools that would allow unbounded recursion: `task.ts:196-221` deny-lists `todowrite`/`todoread` and conditionally `task`; `task_parallel.ts:122-152` deny-lists `todowrite`/`todoread`/`task_parallel` and conditionally `task`; `arena-implement.ts:434-442` deny-lists `task`, `task_parallel`, `arena`, `council`, `todowrite`, `question`, `external_directory`. The implement contestant also hard-disables those tools at the prompt layer (`arena-implement.ts:474-486`). Defense in depth.
- **Depth guard.** Both `task.ts:18` (`MAX_DEPTH = 5`) and `task_parallel.ts:20` walk the parent chain (`task.ts:149-162`, `task_parallel.ts:85-100`) to reject runaway nesting. `task_parallel.ts:304` additionally enforces `EnsemblePreflight.assertTaskParallelAllowed` to block `/council` / `/arena` requests from opening parallel digs first — a documented observed failure mode (comment `task_parallel.ts:302-303`).
- **Write isolation.** `task_parallel.ts:331` runs `WriteIsolation.evaluateParallelAgents` and throws if more than one writer is present, serializing write capability. This is the correct primitive for parallel agent safety.

## Step 6 Hygiene, duplication, and dead code

- **Shared helpers duplicated between `task.ts` and `task_parallel.ts`.** `assistantError` (`task.ts:43` / `task_parallel.ts:26`), `assistantErrorMessage` (`task.ts:48` / `task_parallel.ts:31`), `errorDetails` (`task.ts:53` / `task_parallel.ts:36`), `isAbortError` (`task.ts:72` / `task_parallel.ts:49`), and the finalize-on-empty prompt text (`task.ts:296-301` / `task_parallel.ts:201-206`) are near-identical. With only two call sites this sits below the 3+ threshold that would justify extraction; noting it as tech-debt tracking, not an action item.
- **`needsRecoveredResultReview` is `task.ts`-only.** `task.ts:76` flags recovered finalize text that looks incomplete (`recoveredResultNeedsReview`, surfaced in metadata at `task.ts:445`). `task_parallel.ts` performs the same finalize recovery (`task_parallel.ts:189-225`) but does not run the incompleteness heuristic — a recovered parallel-subagent result is returned as `ok: true` (`task_parallel.ts:250-256`) without a review flag. Minor behavioral skew.
- **Member-selection validation is copy-pasted.** `MemberSelectionSchema` + `validateMemberSelections` appears in both `arena.ts:44-64` and `council.ts:43-69` with a comment in each ("Kept local to avoid circular-dependency at module-load time", `arena.ts:43`, `council.ts:42`). The arena variant requires ≥2 distinct providers (`arena.ts:61-63`); the council variant requires every member to use a distinct provider (`council.ts:60-67`). The duplication is intentional to keep the validator shape divergent, so this is acceptable.
- No dead exports detected; `gitError`/`gitText`/`statusPaths` (`arena-implement.ts:44-72`) are file-local helpers all reached by `snapshotContestantPatch` / `inspectImplementArenaBase`.

## Step 7 Lifecycle and behavioral consistency

- **`SubagentStop` lifecycle hook is not fired by `task_parallel`.** `task.ts` calls `fireSubagentStop` on both the failure path (`task.ts:366`) and the success/finalize path (`task.ts:431-435`). `task_parallel.ts` has no equivalent — it never imports `@/hooks/lifecycle`. Any user-registered `SubagentStop` hook (e.g. a workspace integration that logs subagent completions) is silently skipped for every parallel subagent. This is the most material behavioral gap in the unit: the two tools present nearly identical semantics to the model but diverge on an observable side effect. (Medium; tracked in the findings register below.)
- **`enableIfDisabled` persists config.** `arena.ts:275-283` writes `modes.arena.enabled = true` to the project `ax-code.json` and re-reads config (`arena.ts:285`). Council has no equivalent flag — it only honors `modes.council.enabled === false` as a hard off (`council.ts:258`). The arena write persists across sessions (the banner at `arena.ts:420` flags this to the user). Acceptable given the schema documents it (`arena.ts:77-82`), but it is a tool-initiated mutation of project config.
- **Debate rounds re-fan all members each round.** `council.ts:370-383` re-runs every member per debate round with `retryOnce: false` (`council.ts:380`) and the anonymous synthesis prepended (`council.ts:377`). `Debate.shouldContinueDebate` (`council.ts:356`, `:387`) gates continuation. Coherent and bounded by `Debate.resolveMaxRounds` (`council.ts:274`).

## Step 8 Findings register

Dispositions from this primary review pass (no prior findings existed in `findings/`):

| #   | Finding                                                                                              | Category               | Severity | Evidence                                                     | Disposition                                                                                |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | `task_parallel` skips `SubagentStop` lifecycle hooks that `task` fires                               | behavioral-consistency | MEDIUM   | `task.ts:30,366,431` vs absent in `task_parallel.ts`         | Accept — recommend adding `fireSubagentStop` calls in `runOneTask` success/failure returns |
| 2   | Plan arena + council use unbounded `Promise.all`; only implement arena uses `FanOut` concurrency cap | design-consistency     | LOW      | `arena.ts:429`, `council.ts:329` vs `arena-implement.ts:648` | Accept — member counts are hard-bounded; note for future `FanOut` adoption                 |
| 3   | Single-member `FanOut` wrap + manual retry in `runProposal`/`runMember`                              | clarity                | LOW      | `arena.ts:106,146,170`, `council.ts:122,159,119`             | Accept — `result!` assertion is currently safe; refactor optional                          |
| 4   | `riskScore` equates patch size with implementation risk                                              | design-observation     | LOW      | `arena-implement.ts:537`                                     | Accept — documented heuristic; not a calibrated signal                                     |
| 5   | Recovered finalize results in `task_parallel` lack the `needsRecoveredResultReview` flag             | behavioral-skew        | LOW      | `task.ts:76,445` vs `task_parallel.ts:189-225`               | Accept — minor; consider porting the heuristic                                             |

No Critical or High severity items were identified. The unit's abort handling, permission scoping, depth guards, write isolation, and verification-mutation defense are sound. The MEDIUM item (#1) is a real observability gap but does not affect correctness of the subagent result itself.

## Step 9 Verification and exit

- **Static extract:** ok, fingerprint `c3f36ccdb6cf21d5` (from `MODULE-AUDIT.md`).
- **Source re-read:** all five primary files read in full this pass; line evidence above is drawn directly from those reads.
- **Findings ledger:** five findings registered (Step 8), none Critical/High, so no `reverify.md` is required for this unit under the gate rules.
- **Independent verifier:** codex-sol (other lane) — this `steps.md` is the primary (ax-code-glm) pass; the verifier lane should confirm the Step 8 dispositions against the same file:line evidence.
- **Exit status:** REVIEWING → ready for verifier sign-off. No code changes were made (read-only review).
