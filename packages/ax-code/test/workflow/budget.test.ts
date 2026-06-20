import { describe, expect, test } from "vitest"
import {
  WorkflowBudgetExceededError,
  addWorkflowBudgetUsage,
  evaluateWorkflowChildBudget,
  evaluateWorkflowBudget,
  normalizeWorkflowBudgetUsage,
  reserveWorkflowBudget,
} from "../../src/workflow"

const budget = {
  maxTotalTokens: 1000,
  maxInputTokensPerChild: 500,
  maxOutputTokensPerChild: 250,
  maxWallTimeMs: 10_000,
  maxConcurrentAgents: 3,
  maxTotalAgents: 5,
  maxToolCalls: 20,
  maxRetries: 1,
}

describe("workflow budget helpers", () => {
  test("normalizes partial usage deltas", () => {
    expect(normalizeWorkflowBudgetUsage({ totalTokens: 10 })).toEqual({
      totalTokens: 10,
      inputTokens: 0,
      outputTokens: 0,
      toolCalls: 0,
      childAgents: 0,
      retries: 0,
      estimatedCostUsd: 0,
    })
  })

  test("adds usage counters deterministically", () => {
    expect(
      addWorkflowBudgetUsage(
        { totalTokens: 100, inputTokens: 70, outputTokens: 30, toolCalls: 2 },
        { totalTokens: 50, inputTokens: 25, outputTokens: 25, childAgents: 1 },
      ),
    ).toMatchObject({
      totalTokens: 150,
      inputTokens: 95,
      outputTokens: 55,
      toolCalls: 2,
      childAgents: 1,
    })
  })

  test("reports warnings before hard budget failures", () => {
    const warning = evaluateWorkflowBudget({
      budget,
      usage: { totalTokens: 850, toolCalls: 10 },
    })
    expect(warning.status).toBe("warning")
    expect(warning.warnings.some((item) => item.includes("total tokens"))).toBe(true)
    expect(warning.exceeded).toEqual([])
  })

  test("throws when a reservation would exceed a hard budget", () => {
    expect(() =>
      reserveWorkflowBudget({
        budget,
        current: { totalTokens: 900 },
        reserve: { totalTokens: 200 },
      }),
    ).toThrow(WorkflowBudgetExceededError)
  })

  test("evaluates child-level token, tool, and wall-time caps", () => {
    const evaluation = evaluateWorkflowChildBudget({
      budgetSlice: {
        maxTotalTokens: 1000,
        maxInputTokensPerChild: 500,
        maxOutputTokensPerChild: 250,
        maxWallTimeMs: 1000,
        maxToolCalls: 4,
      },
      usage: {
        totalTokens: 760,
        inputTokens: 510,
        outputTokens: 250,
        toolCalls: 5,
      },
      elapsedMs: 1200,
    })

    expect(evaluation.status).toBe("exceeded")
    expect(evaluation.exceeded).toEqual([
      "child input tokens 510/500",
      "child tool calls 5/4",
      "child wall time 1200/1000",
    ])
    expect(evaluation.warnings).toContain("child output tokens 250/250")
  })
})
