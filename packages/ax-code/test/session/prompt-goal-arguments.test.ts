import { describe, expect, test } from "vitest"
import { parseGoalArguments } from "../../src/session/prompt/prompt-goal-arguments"

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

  test("status is a view alias rather than a goal objective", () => {
    expect(parseGoalArguments("status")).toEqual({ action: "view" })
    expect(parseGoalArguments(" Status ")).toEqual({ action: "view" })
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

  test("a budget flag with no objective errors instead of silently showing the view", () => {
    for (const raw of ["--budget 500", "--budget=500", "--BUDGET 500"]) {
      const decision = parseGoalArguments(raw)
      expect(decision.action).toBe("error")
      if (decision.action !== "error") throw new Error("expected error")
      expect(decision.message).toContain("--budget requires a goal objective")
    }
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

  test("a budget flag with an empty value errors instead of creating an unbudgeted goal", () => {
    // "--budget=" / "--budget= fix the bug" have no value token, so the
    // strict budget pattern does not match and they used to fall through to
    // goal creation with the raw flag text as the objective and no budget.
    for (const raw of ["--budget=", "--budget= fix the bug", "--token-budget=  do it", "--budget"]) {
      const decision = parseGoalArguments(raw)
      expect(decision.action).toBe("error")
      if (decision.action !== "error") throw new Error(`expected error for ${raw}`)
      expect(decision.message).toContain("--budget")
    }
  })

  test("--time-budget accepts seconds, minutes, and hours", () => {
    expect(parseGoalArguments("--time-budget 900 fix the bug")).toEqual({
      action: "create",
      timeBudgetSeconds: 900,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--time-budget 30m fix the bug")).toEqual({
      action: "create",
      timeBudgetSeconds: 1800,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--time-budget=2h fix the bug")).toEqual({
      action: "create",
      timeBudgetSeconds: 7200,
      objective: "fix the bug",
    })
  })

  test("--budget and --time-budget combine in either order", () => {
    expect(parseGoalArguments("--budget 500 --time-budget 30m fix the bug")).toEqual({
      action: "create",
      tokenBudget: 500,
      timeBudgetSeconds: 1800,
      objective: "fix the bug",
    })
    expect(parseGoalArguments("--time-budget 30m --budget 500 fix the bug")).toEqual({
      action: "create",
      tokenBudget: 500,
      timeBudgetSeconds: 1800,
      objective: "fix the bug",
    })
  })

  test("malformed, empty, and duplicate --time-budget values error explicitly", () => {
    for (const raw of [
      "--time-budget soon fix the bug",
      "--time-budget -5 fix the bug",
      "--time-budget=",
      "--time-budget",
    ]) {
      const decision = parseGoalArguments(raw)
      expect(decision.action).toBe("error")
      if (decision.action !== "error") throw new Error(`expected error for ${raw}`)
      expect(decision.message).toContain("--time-budget")
    }
    const duplicate = parseGoalArguments("--time-budget 10m --time-budget 20m fix the bug")
    expect(duplicate.action).toBe("error")
  })

  test("a time budget without an objective errors instead of creating a goal", () => {
    const decision = parseGoalArguments("--time-budget 30m")
    expect(decision.action).toBe("error")
    if (decision.action !== "error") throw new Error("expected error")
    expect(decision.message).toContain("--time-budget requires a goal objective")
  })
})
