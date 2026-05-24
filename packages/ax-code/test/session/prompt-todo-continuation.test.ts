import { describe, expect, test } from "bun:test"
import {
  pendingTodoContinuationDecision,
  pendingTodoSignature,
  todoContextConvergenceDecision,
  todoDeadlineConvergenceDecision,
} from "../../src/session/prompt-todo-continuation"

const finishTaskTodo = { status: "pending", priority: "high", content: "finish task" }

function pendingTodoDecisionInput(
  overrides: Partial<Parameters<typeof pendingTodoContinuationDecision>[0]> = {},
): Parameters<typeof pendingTodoContinuationDecision>[0] {
  return {
    isLastStep: false,
    todoRetries: 1,
    maxTodoRetries: 3,
    pendingTodos: [finishTaskTodo],
    lastPendingTodoSignature: undefined,
    stagnantTodoRetries: 0,
    ...overrides,
  }
}

describe("session prompt todo continuation helpers", () => {
  test("builds stable signatures from status, priority, and content", () => {
    expect(
      pendingTodoSignature([
        { status: "pending", priority: "high", content: "write report" },
        { status: "in_progress", priority: "medium", content: "verify fix" },
      ]),
    ).toBe("pending\u0000high\u0000write report\u0001in_progress\u0000medium\u0000verify fix")
  })

  test("converges report-style todos at the context threshold", () => {
    const pendingTodos = [{ content: "write .internal/bugs report" }]

    expect(todoContextConvergenceDecision({ pendingTodos, inputTokens: 49_999 }).converge).toBe(false)
    expect(todoContextConvergenceDecision({ pendingTodos, inputTokens: 50_000 })).toEqual({
      converge: true,
      threshold: 50_000,
    })
    expect(
      todoContextConvergenceDecision({
        pendingTodos: [{ content: "implement parser" }],
        inputTokens: 50_000,
      }).converge,
    ).toBe(false)
    expect(
      todoContextConvergenceDecision({
        pendingTodos: [{ content: "triage BUG queue" }],
        inputTokens: 50_000,
      }).converge,
    ).toBe(true)
  })

  test("converges pending todos before the agent step deadline", () => {
    const pendingTodos = [{ content: "write .internal/bugs report" }]

    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: false,
        pendingTodos,
        remainingAgentSteps: 3,
      }),
    ).toEqual({
      converge: true,
      buffer: 3,
      includeReportClosureGuidance: true,
    })

    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: true,
        pendingTodos,
        remainingAgentSteps: 3,
      }).converge,
    ).toBe(false)
    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: false,
        pendingTodos: [],
        remainingAgentSteps: 3,
      }).converge,
    ).toBe(false)
    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: false,
        pendingTodos,
        remainingAgentSteps: Infinity,
      }).converge,
    ).toBe(false)
    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: false,
        pendingTodos: Array.from({ length: 4 }, (_, index) => ({ content: `todo ${index}` })),
        remainingAgentSteps: 6,
      }).buffer,
    ).toBe(6)
    expect(
      todoDeadlineConvergenceDecision({
        modelFinished: false,
        pendingTodos: Array.from({ length: 20 }, (_, index) => ({ content: `todo ${index}` })),
        remainingAgentSteps: 8,
      }).buffer,
    ).toBe(8)
  })

  test("stops continuation at the agent step limit before mutating retry state", () => {
    const decision = pendingTodoContinuationDecision(
      pendingTodoDecisionInput({
        isLastStep: true,
        lastPendingTodoSignature: "previous",
        stagnantTodoRetries: 1,
      }),
    )

    expect(decision).toMatchObject({
      action: "stop_step_limit",
      reason: "step_limit",
      errorCode: "STEP_LIMIT",
    })
    if (decision.action !== "stop_step_limit") throw new Error("expected stop_step_limit")
    expect(decision.message).toContain("agent step limit")
    expect(decision.message).toContain("1 unfinished todo")
  })

  test("stops continuation when the retry budget is exhausted", () => {
    const decision = pendingTodoContinuationDecision(
      pendingTodoDecisionInput({
        todoRetries: 3,
        pendingTodos: [
          finishTaskTodo,
          { status: "in_progress", priority: "medium", content: "verify task" },
        ],
      }),
    )

    expect(decision).toMatchObject({
      action: "stop_retry_budget",
      reason: "stalled",
    })
    if (decision.action !== "stop_retry_budget") throw new Error("expected stop_retry_budget")
    expect(decision.message).toContain("2 todos")
    expect(decision.message).toContain("3 auto-continuation attempts")
    expect(decision.message).toContain("remaining todos are not complete")
  })

  test("increments continuation attempts and resets stagnation when pending todos change", () => {
    const decision = pendingTodoContinuationDecision(
      pendingTodoDecisionInput({
        lastPendingTodoSignature: "old",
        stagnantTodoRetries: 2,
      }),
    )

    expect(decision).toEqual({
      action: "continue",
      todoRetries: 2,
      lastPendingTodoSignature: "pending\u0000high\u0000finish task",
      stagnantTodoRetries: 0,
      stagnant: false,
      maxStagnantAttempts: 2,
      includeReportClosureGuidance: false,
    })
  })

  test("increments stagnant retries when the pending todo signature is unchanged", () => {
    const pendingTodos = [{ status: "pending", priority: "high", content: "finish task" }]
    const signature = pendingTodoSignature(pendingTodos)

    expect(
      pendingTodoContinuationDecision(
        pendingTodoDecisionInput({
          pendingTodos,
          lastPendingTodoSignature: signature,
          stagnantTodoRetries: 1,
        }),
      ),
    ).toEqual({
      action: "continue",
      todoRetries: 2,
      lastPendingTodoSignature: signature,
      stagnantTodoRetries: 2,
      stagnant: true,
      maxStagnantAttempts: 2,
      includeReportClosureGuidance: false,
    })
  })

  test("includes report closure guidance state in continuation decisions", () => {
    expect(
      pendingTodoContinuationDecision(
        pendingTodoDecisionInput({
          pendingTodos: [{ status: "pending", priority: "high", content: "write .internal/bugs report" }],
        }),
      ),
    ).toMatchObject({
      action: "continue",
      includeReportClosureGuidance: true,
    })
  })
})
