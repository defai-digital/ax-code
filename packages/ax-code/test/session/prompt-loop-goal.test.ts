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
    expect(result.text).toContain("continuation 2")
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

  test("active goal continuation resets stale budget-limit flag from a previous goal", () => {
    const result = handlePromptLoopGoalContinuation({
      sessionID: SessionID.descending(),
      goal: {
        objective: "new goal after previous budget-limited one",
        status: "active",
        tokensUsed: 0,
        timeUsedSeconds: 0,
      },
      continuations: 0,
      maxContinuations: 3,
      budgetLimitContinuationSent: true, // stale from a prior goal in this session
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.budgetLimitContinuationSent).toBe(false)
  })

  test("continues active goals beyond maxContinuations until model marks complete", () => {
    const result = handlePromptLoopGoalContinuation({
      sessionID: SessionID.descending(),
      goal: {
        objective: "finish refactor",
        status: "active",
        tokensUsed: 10,
        timeUsedSeconds: 2,
      },
      continuations: 3,
      maxContinuations: 3,
      budgetLimitContinuationSent: false,
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal auto-continuation")
    expect(result.text).toContain("finish refactor")
    expect(result.text).toContain("continuation 4")
  })
})
