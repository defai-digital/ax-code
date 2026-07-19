import { describe, expect, test } from "vitest"
import {
  pendingTodoContinuationDecision,
  pendingTodoProgressSignature,
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
        pendingTodos: [finishTaskTodo, { status: "in_progress", priority: "medium", content: "verify task" }],
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

  test("resets retry and stagnation budgets when the pending todo content set changes", () => {
    const decision = pendingTodoContinuationDecision(
      pendingTodoDecisionInput({
        todoRetries: 2,
        lastPendingTodoSignature: pendingTodoProgressSignature([{ content: "some completed task" }]),
        stagnantTodoRetries: 2,
      }),
    )

    expect(decision).toEqual({
      action: "continue",
      todoRetries: 1,
      lastPendingTodoSignature: pendingTodoProgressSignature([finishTaskTodo]),
      stagnantTodoRetries: 0,
      stagnant: false,
      maxStagnantAttempts: 2,
      includeReportClosureGuidance: false,
    })
  })

  test("increments stagnant retries when the pending todo content set is unchanged", () => {
    const pendingTodos = [{ status: "pending", priority: "high", content: "finish task" }]
    const signature = pendingTodoProgressSignature(pendingTodos)

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

  test("status and priority flips do not count as progress", () => {
    const previous = pendingTodoProgressSignature([finishTaskTodo])
    const decision = pendingTodoContinuationDecision(
      pendingTodoDecisionInput({
        todoRetries: 2,
        pendingTodos: [{ status: "in_progress", priority: "low", content: "finish task" }],
        lastPendingTodoSignature: previous,
        stagnantTodoRetries: 1,
      }),
    )

    expect(decision).toMatchObject({
      action: "continue",
      todoRetries: 3,
      stagnantTodoRetries: 2,
      stagnant: true,
    })
  })

  test("reordering todos does not count as progress", () => {
    const todoA = { status: "pending", priority: "high", content: "task a" }
    const todoB = { status: "pending", priority: "high", content: "task b" }
    expect(pendingTodoProgressSignature([todoA, todoB])).toBe(pendingTodoProgressSignature([todoB, todoA]))
  })

  test("oscillating todo state exhausts the retry budget instead of resetting it", () => {
    // Simulate a model flipping one todo pending->in_progress->pending forever.
    let todoRetries = 0
    let stagnantTodoRetries = 0
    let lastPendingTodoSignature: string | undefined
    let stopped = false
    for (let turn = 0; turn < 20; turn += 1) {
      const status = turn % 2 === 0 ? "pending" : "in_progress"
      const decision = pendingTodoContinuationDecision(
        pendingTodoDecisionInput({
          todoRetries,
          maxTodoRetries: 10,
          pendingTodos: [{ status, priority: "high", content: "finish task" }],
          lastPendingTodoSignature,
          stagnantTodoRetries,
        }),
      )
      if (decision.action === "stop_retry_budget") {
        stopped = true
        break
      }
      if (decision.action !== "continue") throw new Error(`unexpected action: ${decision.action}`)
      todoRetries = decision.todoRetries
      stagnantTodoRetries = decision.stagnantTodoRetries
      lastPendingTodoSignature = decision.lastPendingTodoSignature
    }
    expect(stopped).toBe(true)
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
