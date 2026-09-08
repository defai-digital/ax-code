import { describe, expect, test } from "vitest"
import { pendingCompactionDecision } from "../../src/session/prompt-loop-decisions"

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
