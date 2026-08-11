# Nine-step review: session-lifecycle-queue

## Step 1 Scope and runtime map

The review followed the lifecycle from `packages/ax-code/src/session/prompt-impl.ts:222` (loop entry and active-run enqueue) through deferred queue cleanup at `packages/ax-code/src/session/prompt-impl.ts:245-253`, loop-state scanning at `packages/ax-code/src/session/prompt-impl.ts:461-466`, and result resolution at `packages/ax-code/src/session/prompt-impl.ts:1522-1527`. The candidate helpers separate message scanning, compaction, stop gates, recording, queue transfer, and terminal-result delivery. The inventory and risk classification were cross-checked against `docs/module-quality-audit/modules/session-lifecycle-queue/MODULE-AUDIT.md:20-52`.

## Step 2 Failure and abuse boundaries

The principal risks are unbounded autonomous work, retry storms, stale-message delivery, and abandoned durable prompts. Bounds are explicit: compaction busy responses stop after the decision cap in `packages/ax-code/src/session/prompt-loop-decisions.ts:76-100`; global ceilings are derived in `packages/ax-code/src/session/prompt-loop-config.ts:40-60`; repeated provider errors become a user-visible stop in `packages/ax-code/src/session/prompt-loop-errors.ts:200-239`; and tool cycles compare tool/input pairs over a bounded trailing pattern in `packages/ax-code/src/session/cycle-detection.ts:23-44`. No credential parsing, shell execution, or raw secret logging is introduced by these helpers.

## Step 3 Transition correctness

The loop assigns a terminal reason before each reviewed break path, including abort and step-limit exits at `packages/ax-code/src/session/prompt-impl.ts:444-448` and `packages/ax-code/src/session/prompt-impl.ts:589-598`. Assistant completion is accepted only after the assistant is ordered after the latest user and has an actionable finish; timestamp ties deliberately fall back to ID ordering in `packages/ax-code/src/session/prompt-loop-decisions.ts:360-405`. Empty turns and unfinished todos either produce a bounded continuation or persist a failure before stopping (`packages/ax-code/src/session/prompt-loop-empty-turn.ts:55-96`, `packages/ax-code/src/session/prompt-loop-todo-continuation.ts:52-85`). These transitions preserve a concrete end reason rather than silently treating stalls as completion.

## Step 4 Queue and concurrency behavior

Concurrent calls that arrive while a loop is active are atomically enqueued, with cancellation races converted to rejection at `packages/ax-code/src/session/prompt-impl.ts:225-237`. During teardown, `packages/ax-code/src/session/prompt-loop-queue.ts:16-25` cancels only when no callback remains; otherwise it marks the run idle and starts a fresh loop so already-durable user messages are answered even after an error. Resume failure and secondary cancellation failure are both observed and logged at `packages/ax-code/src/session/prompt-loop-queue.ts:25-40`. The call ordering is asserted for both error and completed predecessors in `packages/ax-code/test/session/prompt-loop-queue.test.ts:6-27` and `packages/ax-code/test/session/prompt-loop-queue.test.ts:53-74`.

## Step 5 Boundedness and hot-path cost

Message retrieval avoids full-history reloads after the initial pass: `packages/ax-code/src/session/prompt-loop-messages.ts:110-130` appends only rows after the cached last ID, while `scanLoopMessages` walks newest-to-oldest and exits after finding the current user and finished assistant (`packages/ax-code/src/session/prompt-loop-messages.ts:11-28`). Preflight compaction estimates system, message, and tool-schema tokens once and blocks futile tiny-history compaction at `packages/ax-code/src/session/prompt-loop-compaction.ts:169-212`. Cycle detection is bounded by configured maximum cycle length and the inspected repeat window (`packages/ax-code/src/session/cycle-detection.ts:30-42`). The reviewed retry paths use finite budgets or abort-aware sleep.

## Step 6 State ownership and side effects

Pure policy is concentrated in `packages/ax-code/src/session/prompt-loop-decisions.ts`: provider fallback selection state is computed at lines 314-329 and processor outcomes at lines 332-358, while effectful wrappers publish/log in `packages/ax-code/src/session/prompt-loop-errors.ts:97-239`. Recording owns replay finalization and blast-radius reset in a fixed order at `packages/ax-code/src/session/prompt-loop-recording.ts:28-47`. Terminal failure persistence is centralized in `packages/ax-code/src/session/prompt-loop-failure.ts:27-55`, and result delivery filters stale assistant IDs before resolving a queued callback at `packages/ax-code/src/session/prompt-loop-result.ts:74-80`. This separation makes policy branches injectable and directly testable.

## Step 7 Maintainability and defensive handling

Reviewed exception suppression is narrow and documented. Todo lookup may fail when the instance/database is unavailable, and `packages/ax-code/src/session/prompt-loop-errors.ts:209-215` explicitly degrades only the recovery guidance count. Stop hooks fall back from workspace state to `process.cwd()` and log hook failures without losing the completed turn (`packages/ax-code/src/session/prompt-loop-result.ts:33-53`). Queue teardown logs both resume and cancellation failures (`packages/ax-code/src/session/prompt-loop-queue.ts:25-40`). Constants explain why empty, truncated, read-only, and tool-only thresholds differ at `packages/ax-code/src/session/prompt-loop-config.ts:4-38`; no unexplained TODO/FIXME marker or unreachable empty implementation was found in the candidate set.

## Step 8 Test evidence and finding disposition

Focused tests cover cycle false positives (`packages/ax-code/test/session/cycle-detection.test.ts:11-68`), exact-message result filtering (`packages/ax-code/test/session/prompt-loop-result.test.ts:70-87`), queue resume/cancel ordering (`packages/ax-code/test/session/prompt-loop-queue.test.ts:6-74`), and completion-gate emission before and after model finish (`packages/ax-code/test/session/prompt-loop-completion-gate.test.ts:7-126`). The existing register states that no item was accepted at `docs/module-quality-audit/modules/session-lifecycle-queue/MODULE-AUDIT.md:105-109`, and `findings/` contained no finding files during this review. The independent source pass did not identify a new Critical issue, so no Critical re-verification artifact is warranted.

## Step 9 Verification and exit decision

The exact-file Vitest run completed successfully with 17 files and 82 tests passing. The reviewed behavior includes the session-end event and cleanup order at `packages/ax-code/test/session/prompt-loop-recording.test.ts:19-49`, stale assistant exclusion at `packages/ax-code/test/session/prompt-loop-result.test.ts:70-87`, and durable queued-prompt recovery at `packages/ax-code/test/session/prompt-loop-queue.test.ts:6-27`. On the inspected candidate surface, the session-lifecycle-queue unit has bounded retry/step exits, observable failures, durable queue handoff, and focused regression coverage; reviewer sign-off is therefore supported with no open Critical finding.
