import { describe, expect, test } from "bun:test"
import {
  WorkflowBudgetExceededError,
  addWorkflowBudgetUsage,
  evaluateWorkflowBudget,
  normalizeWorkflowBudgetUsage,
  reserveWorkflowBudget,
} from "../../src/workflow"

const budget = {
  maxTotalTokens: 1000,
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
})
