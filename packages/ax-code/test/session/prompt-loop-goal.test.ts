import { describe, expect, test } from "vitest"
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
        budgetWrapUp: "sent",
      },
      {
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "ignore", budgetWrapUp: "sent" })
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
      budgetWrapUp: "none",
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal auto-continuation")
    expect(result.budgetWrapUp).toBe("none")
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
      budgetWrapUp: "none",
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal budget-limit wrap-up")
    expect(result.budgetWrapUp).toBe("sent")
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
      budgetWrapUp: "sent", // stale from a prior goal in this session
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.budgetWrapUp).toBe("none")
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
      budgetWrapUp: "none",
    })

    expect(result.action).toBe("continue")
    if (result.action !== "continue") throw new Error("expected continuation")
    expect(result.event).toBe("goal auto-continuation")
    expect(result.text).toContain("finish refactor")
    expect(result.text).toContain("continuation 4")
  })

  test("ignores a concluded budget-limited goal without publishing an error", () => {
    const published: unknown[] = []

    const result = handlePromptLoopGoalContinuation(
      {
        sessionID: SessionID.descending(),
        goal: {
          objective: "wrap up refactor",
          status: "budget_limited",
          tokenBudget: 100,
          tokensUsed: 120,
          timeUsedSeconds: 9,
        },
        continuations: 0,
        budgetWrapUp: "concluded",
      },
      {
        publishError(input) {
          published.push(input)
        },
      },
    )

    expect(result).toEqual({ action: "ignore", budgetWrapUp: "concluded" })
    expect(published).toEqual([])
  })

  test("publishes an error and stops after the budget wrap-up turn has been sent", () => {
    const published: { message: string }[] = []

    const result = handlePromptLoopGoalContinuation(
      {
        sessionID: SessionID.descending(),
        goal: {
          objective: "wrap up refactor",
          status: "budget_limited",
          tokenBudget: 100,
          tokensUsed: 120,
          timeUsedSeconds: 9,
        },
        continuations: 2,
        budgetWrapUp: "sent",
      },
      {
        publishError(input) {
          published.push({ message: input.message })
        },
      },
    )

    expect(result).toEqual({ action: "stop", reason: "stalled", budgetWrapUp: "sent" })
    expect(published).toHaveLength(1)
    expect(published[0]?.message).toContain("token budget")
  })
})
