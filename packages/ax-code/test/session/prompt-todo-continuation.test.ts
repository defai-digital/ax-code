import { describe, expect, test } from "bun:test"
import {
  TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD,
  hasReportStyleTodo,
  pendingTodoContinuationDecision,
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

  test("stops continuation at the agent step limit before mutating retry state", () => {
    expect(
      pendingTodoContinuationDecision({
        isLastStep: true,
        todoRetries: 1,
        maxTodoRetries: 3,
        pendingTodos: [{ status: "pending", priority: "high", content: "finish task" }],
        lastPendingTodoSignature: "previous",
        stagnantTodoRetries: 1,
      }),
    ).toEqual({
      action: "stop_step_limit",
      todoRetries: 1,
      lastPendingTodoSignature: "previous",
      stagnantTodoRetries: 1,
    })
  })

  test("stops continuation when the retry budget is exhausted", () => {
    expect(
      pendingTodoContinuationDecision({
        isLastStep: false,
        todoRetries: 3,
        maxTodoRetries: 3,
        pendingTodos: [{ status: "pending", priority: "high", content: "finish task" }],
        lastPendingTodoSignature: undefined,
        stagnantTodoRetries: 0,
      }),
    ).toEqual({
      action: "stop_retry_budget",
      todoRetries: 3,
      lastPendingTodoSignature: undefined,
      stagnantTodoRetries: 0,
    })
  })

  test("increments continuation attempts and resets stagnation when pending todos change", () => {
    const decision = pendingTodoContinuationDecision({
      isLastStep: false,
      todoRetries: 1,
      maxTodoRetries: 3,
      pendingTodos: [{ status: "pending", priority: "high", content: "finish task" }],
      lastPendingTodoSignature: "old",
      stagnantTodoRetries: 2,
    })

    expect(decision).toEqual({
      action: "continue",
      todoRetries: 2,
      lastPendingTodoSignature: "pending\u0000high\u0000finish task",
      stagnantTodoRetries: 0,
      stagnant: false,
    })
  })

  test("increments stagnant retries when the pending todo signature is unchanged", () => {
    const pendingTodos = [{ status: "pending", priority: "high", content: "finish task" }]
    const signature = pendingTodoSignature(pendingTodos)

    expect(
      pendingTodoContinuationDecision({
        isLastStep: false,
        todoRetries: 1,
        maxTodoRetries: 3,
        pendingTodos,
        lastPendingTodoSignature: signature,
        stagnantTodoRetries: 1,
      }),
    ).toEqual({
      action: "continue",
      todoRetries: 2,
      lastPendingTodoSignature: signature,
      stagnantTodoRetries: 2,
      stagnant: true,
    })
  })
})
