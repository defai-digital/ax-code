import { describe, expect, test } from "vitest"
import { parseGoalArguments } from "../../src/session/prompt-goal-arguments"

describe("parseGoalArguments", () => {
  test("empty or whitespace-only input views the current goal", () => {
    expect(parseGoalArguments("")).toEqual({ action: "view" })
    expect(parseGoalArguments("   ")).toEqual({ action: "view" })
  })

  test("control keywords are recognized case-insensitively", () => {
    expect(parseGoalArguments("pause")).toEqual({ action: "pause" })
    expect(parseGoalArguments("PAUSE")).toEqual({ action: "pause" })
    expect(parseGoalArguments(" Resume ")).toEqual({ action: "resume" })
    expect(parseGoalArguments("CLEAR")).toEqual({ action: "clear" })
  })

  test("a keyword embedded in a longer phrase is treated as an objective", () => {
    expect(parseGoalArguments("pause the deployment")).toEqual({
      action: "create",
      objective: "pause the deployment",
    })
    expect(parseGoalArguments("resume work on the parser")).toEqual({
      action: "create",
      objective: "resume work on the parser",
    })
  })

  test("plain text becomes the objective", () => {
    expect(parseGoalArguments("finish the migration")).toEqual({
      action: "create",
      objective: "finish the migration",
    })
  })

  test("--budget and --token-budget set a numeric budget plus objective", () => {
    expect(parseGoalArguments("--budget 500 fix the bug")).toEqual({
      action: "create",
      tokenBudget: 500,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--token-budget 1200 ship the feature")).toEqual({
      action: "create",
      tokenBudget: 1200,
      objective: "ship the feature",
    })
    expect(parseGoalArguments("--budget=500 fix the bug")).toEqual({
      action: "create",
      tokenBudget: 500,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--token-budget=1200 ship the feature")).toEqual({
      action: "create",
      tokenBudget: 1200,
      objective: "ship the feature",
    })
  })

  test("the budget flag is case-insensitive, matching the control keywords", () => {
    expect(parseGoalArguments("--BUDGET 500 fix the bug")).toEqual({
      action: "create",
      tokenBudget: 500,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--Token-Budget 750 do it")).toEqual({
      action: "create",
      tokenBudget: 750,
      objective: "do it",
    })
  })

  test("extra whitespace around the budget and objective is normalized", () => {
    expect(parseGoalArguments("  --budget   500   do the thing  ")).toEqual({
      action: "create",
      tokenBudget: 500,
      objective: "do the thing",
    })
  })

  test("a budget flag with no objective falls back to view", () => {
    expect(parseGoalArguments("--budget 500")).toEqual({ action: "view" })
    expect(parseGoalArguments("--budget=500")).toEqual({ action: "view" })
    expect(parseGoalArguments("--BUDGET 500")).toEqual({ action: "view" })
  })

  test("negative, decimal, and non-numeric budgets error instead of leaking into the objective", () => {
    // Previously these fell through to goal creation with the raw
    // "--budget -5 ..." text as the objective and NO budget set.
    for (const raw of ["--budget -5 fix the bug", "--budget 5.5 fix the bug", "--budget lots fix the bug"]) {
      const decision = parseGoalArguments(raw)
      expect(decision.action).toBe("error")
      if (decision.action !== "error") throw new Error("expected error")
      expect(decision.message).toContain("Invalid --budget value")
    }
  })
})
