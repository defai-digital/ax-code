import { expect, test, vi } from "vitest"
import { tool, jsonSchema, type Tool } from "ai"
import { goalBudgetTools, GOAL_BUDGET_TOOL_REJECTION } from "../../src/session/prompt/prompt-goal-budget-tools"

function callable(execute: NonNullable<Tool["execute"]>) {
  return tool({ description: "test", inputSchema: jsonSchema({ type: "object" }), execute })
}

test("wrap-up discards registry, MCP, plugin, batch and child capabilities", () => {
  const execute = vi.fn()
  const tools = Object.fromEntries(
    ["read", "write", "bash", "batch", "task", "mcp_remote", "plugin_tool"].map((name) => [name, callable(execute)]),
  )
  expect(goalBudgetTools(tools)).toEqual({})
  expect(execute).not.toHaveBeenCalled()
  expect(Object.keys(tools)).toHaveLength(7)
})

test("only complete reaches the unchanged goal verification callback", async () => {
  const execute = vi.fn(async () => ({ output: "Verified" }))
  const original = callable(execute)
  const guarded = goalBudgetTools({ update_goal: original }).update_goal
  for (const args of [{ status: "paused" }, { status: "blocked" }, { status: "active" }, {}, null]) {
    await expect(guarded.execute!(args, { toolCallId: "rejected", messages: [] })).rejects.toThrow(
      GOAL_BUDGET_TOOL_REJECTION,
    )
  }
  expect(execute).not.toHaveBeenCalled()
  const args = { status: "complete", acceptanceEvidence: { R01: "current receipt" } }
  await guarded.execute!(args, { toolCallId: "complete", messages: [] })
  expect(execute).toHaveBeenCalledExactlyOnceWith(args, { toolCallId: "complete", messages: [] })
  execute.mockRejectedValueOnce(new Error("Missing current successful receipt"))
  await expect(guarded.execute!(args, { toolCallId: "unverified", messages: [] })).rejects.toThrow(
    "Missing current successful receipt",
  )
  expect(original.execute).toBe(execute)
})

test("terminal structured output is preserved while input callbacks cannot grant extra work", () => {
  const output = callable(vi.fn())
  const goal = { ...callable(vi.fn()), onInputStart: vi.fn(), onInputDelta: vi.fn(), onInputAvailable: vi.fn() }
  const guarded = goalBudgetTools({ update_goal: goal, StructuredOutput: output })
  expect(guarded.StructuredOutput).toBe(output)
  expect(guarded.update_goal.onInputStart).toBeUndefined()
  expect(guarded.update_goal.onInputDelta).toBeUndefined()
  expect(guarded.update_goal.onInputAvailable).toBeUndefined()
})

test("provider-executed terminal tools fail closed", () => {
  for (const name of ["update_goal", "StructuredOutput"]) {
    expect(() =>
      goalBudgetTools({
        [name]: { type: "provider", id: "vendor.remote", args: {}, inputSchema: jsonSchema({ type: "object" }) },
      }),
    ).toThrow("Provider-defined tools")
  }
})

test("completion keeps the original approval policy", () => {
  for (const needsApproval of [true, vi.fn(() => true)]) {
    const original = { ...callable(vi.fn()), needsApproval }
    expect(goalBudgetTools({ update_goal: original }).update_goal.needsApproval).toBe(needsApproval)
  }
})
