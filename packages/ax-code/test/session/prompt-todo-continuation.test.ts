import { describe, expect, test } from "bun:test"
import {
  TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD,
  hasReportStyleTodo,
  pendingTodoSignature,
  reportTodoClosureGuidance,
  todoDeadlineStepBuffer,
} from "../../src/session/prompt-todo-continuation"

describe("session prompt todo continuation helpers", () => {
  test("builds stable signatures from status, priority, and content", () => {
    expect(
      pendingTodoSignature([
        { status: "pending", priority: "high", content: "write report" },
        { status: "in_progress", priority: "medium", content: "verify fix" },
      ]),
    ).toBe("pending\u0000high\u0000write report\u0001in_progress\u0000medium\u0000verify fix")
  })

  test("clamps deadline step buffer around pending todo count", () => {
    expect(todoDeadlineStepBuffer(0)).toBe(3)
    expect(todoDeadlineStepBuffer(1)).toBe(3)
    expect(todoDeadlineStepBuffer(4)).toBe(6)
    expect(todoDeadlineStepBuffer(20)).toBe(8)
  })

  test("detects report-style todo wording", () => {
    expect(hasReportStyleTodo([{ content: "write .internal/bugs report" }])).toBe(true)
    expect(hasReportStyleTodo([{ content: "triage BUG queue" }])).toBe(true)
    expect(hasReportStyleTodo([{ content: "implement the parser" }])).toBe(false)
  })

  test("keeps distinct closure guidance per retry mode", () => {
    expect(reportTodoClosureGuidance("context")).toContain("context is already large")
    expect(reportTodoClosureGuidance("deadline")).toContain("credible suspected")
    expect(reportTodoClosureGuidance("continuation")).toContain("do not keep doing broad exploration")
    expect(TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD).toBe(50_000)
  })
})
