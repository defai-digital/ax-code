import { describe, expect, test } from "bun:test"
import { handlePromptLoopGoalContinuation } from "../../src/session/prompt-loop-goal"
import { SessionID } from "../../src/session/schema"

describe("prompt loop goal continuation", () => {
  test("ignores missing goals without changing budget wrap-up state", () => {
    const published: unknown[] = []

    const result = handlePromptLoopGoalContinuation(
      {
        sessionID: SessionID.descending(),
        goal: undefined,
        continuations: 0,
        maxContinuations: 3,
        budgetLimitContinuationSent: true,
      },
      {
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "ignore", budgetLimitContinuationSent: true })
    expect(published).toEqual([])
  })

  test("maps active goals to a continuation event and prompt", () => {
    const result = handlePromptLoopGoalContinuation({
      sessionID: SessionID.descending(),
      goal: {
        objective: "finish refactor",
        status: "active",
        tokensUsed: 10,
        timeUsedSeconds: 2,
      },
      continuations: 1,
      maxContinuations: 3,
      budgetLimitContinuationSent: false,
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal auto-continuation")
    expect(result.budgetLimitContinuationSent).toBe(false)
    expect(result.text).toContain("finish refactor")
    expect(result.text).toContain("2/3")
  })

  test("maps budget-limited goals to one wrap-up continuation and marks it sent", () => {
    const result = handlePromptLoopGoalContinuation({
      sessionID: SessionID.descending(),
      goal: {
        objective: "wrap up refactor",
        status: "budget_limited",
        tokenBudget: 100,
        tokensUsed: 120,
        timeUsedSeconds: 9,
      },
      continuations: 0,
      maxContinuations: 3,
      budgetLimitContinuationSent: false,
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal budget-limit wrap-up")
    expect(result.budgetLimitContinuationSent).toBe(true)
    expect(result.text).toContain("wrap up refactor")
    expect(result.text).toContain("Tokens used: 120")
    expect(result.text).toContain("Token budget: 100")
  })

  test("publishes stop errors when continuation limits are exhausted", () => {
    const sessionID = SessionID.descending()
    const published: { sessionID: SessionID; message: string }[] = []

    const result = handlePromptLoopGoalContinuation(
      {
        sessionID,
        goal: {
          objective: "finish refactor",
          status: "active",
          tokensUsed: 10,
          timeUsedSeconds: 2,
        },
        continuations: 3,
        maxContinuations: 3,
        budgetLimitContinuationSent: false,
      },
      {
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "stalled", budgetLimitContinuationSent: false })
    expect(published).toHaveLength(1)
    expect(published[0]?.sessionID).toBe(sessionID)
    expect(published[0]?.message).toContain("Goal remains active")
  })
})
