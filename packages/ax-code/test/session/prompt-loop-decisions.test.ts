import { describe, expect, test } from "vitest"
import {
  assistantLoopExitDecision,
  compactionLoopBreakReason,
  pendingCompactionDecision,
} from "../../src/session/prompt/prompt-loop-decisions"
import { MessageID } from "../../src/session/schema"

describe("session.prompt-loop-decisions.pendingCompactionDecision", () => {
  test("'stop' on a non-overflow (proactive) compaction is escalated as 'error'", () => {
    // Regression for the silent-failure finding: any "stop" from
    // SessionCompaction.process indicates a bail or non-retryable
    // failure and must surface, never report "completed".
    expect(pendingCompactionDecision({ result: "stop" })).toEqual({ type: "break", reason: "error" })
    expect(pendingCompactionDecision({ result: "stop", overflow: false })).toEqual({
      type: "break",
      reason: "error",
    })
    expect(pendingCompactionDecision({ result: "stop", overflow: true })).toEqual({
      type: "break",
      reason: "error",
    })
  })

  test("'continue' does not break the loop", () => {
    expect(pendingCompactionDecision({ result: "continue" })).toEqual({ type: "continue" })
  })

  test("a cancelled compaction stop is aborted, a provider stop stays an error", () => {
    expect(compactionLoopBreakReason({ decision: "error", aborted: true })).toBe("aborted")
    expect(compactionLoopBreakReason({ decision: "completed", aborted: true })).toBe("aborted")
    expect(compactionLoopBreakReason({ decision: "error", aborted: false })).toBe("error")
  })

  test("'busy' schedules a retry until the busy-retry cap and then errors", () => {
    expect(pendingCompactionDecision({ result: "busy", busyRetries: 0 })).toEqual({
      type: "retry",
      delayMs: 250,
    })
    // 40 is the PENDING_COMPACTION_BUSY_RETRY_LIMIT — at the cap the next
    // `busy` breaks with `error`.
    expect(pendingCompactionDecision({ result: "busy", busyRetries: 40 })).toEqual({
      type: "break",
      reason: "error",
    })
  })
})

describe("session.prompt-loop-decisions.assistantLoopExitDecision", () => {
  test("finish=length is unfinished: the loop continues instead of completing", () => {
    // Baseline for supervised truncated-turn recovery: the exit decision never
    // completes on finish=length, so without the recovery path a supervised
    // loop re-called the model with the partial assistant text as the last
    // message and no continuation instruction, bounded only by the generic
    // step ceilings. Recovery must own this turn instead.
    expect(
      assistantLoopExitDecision({
        lastUserID: "msg_1",
        lastAssistant: { id: MessageID.make("msg_2"), finish: "length" },
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "continue" })
  })

  test("an errored finish=length turn still yields to the error retry path", () => {
    expect(
      assistantLoopExitDecision({
        lastUserID: "msg_1",
        lastAssistant: {
          id: MessageID.make("msg_2"),
          finish: "length",
          error: { name: "APIError", data: { message: "boom", isRetryable: false } },
        },
        hasPendingSubtask: false,
      }),
    ).toEqual({ action: "continue" })
  })
})
