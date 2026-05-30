import { describe, expect, test } from "bun:test"
import {
  agentStepLimitContinuationDecision,
  completionGateEventState,
  completionGateRetryDecision,
  emptyModelTurnDecision,
  globalStepLimitDecision,
  goalContinuationDecision,
  isEmptyModelTurn,
  modelTurnFinished,
} from "../../src/session/prompt-autonomous-decisions"

function unfinishedTodosGate() {
  return {
    status: "blocked" as const,
    reason: "unfinished_todos" as const,
    signature: "todos:one",
    message: "todos are unfinished",
    pendingTodos: [],
  }
}

function emptySubagentGate(signature = "empty-subagent:one") {
  return {
    status: "blocked" as const,
    reason: "empty_subagent_result" as const,
    signature,
    message: "empty subagent result",
    emptyResult: {},
  }
}

describe("autonomous continuation decisions", () => {
  test("classifies model turn finish reasons", () => {
    expect(modelTurnFinished(undefined)).toBe(false)
    expect(modelTurnFinished("tool-calls")).toBe(false)
    expect(modelTurnFinished("unknown")).toBe(false)
    expect(modelTurnFinished("stop")).toBe(true)
    expect(modelTurnFinished("other")).toBe(true)
  })

  test("detects empty model turns from finish reason and zero token usage", () => {
    expect(isEmptyModelTurn({ finish: "other", tokens: {} })).toBe(true)
    expect(isEmptyModelTurn({ finish: "other", tokens: { input: 1 } })).toBe(false)
    expect(isEmptyModelTurn({ finish: "stop", tokens: {} })).toBe(false)
  })

  test("ignores global step limit before the configured boundary", () => {
    expect(
      globalStepLimitDecision({
        step: 9,
        stepLimit: 10,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
  })

  test("continues autonomous sessions at the global step limit while continuation budget remains", () => {
    expect(
      globalStepLimitDecision({
        step: 10,
        stepLimit: 10,
        autonomous: true,
        continuations: 1,
        maxContinuations: 3,
      }),
    ).toEqual({
      action: "continue",
      continuation: 2,
    })
  })

  test("normalizes fractional continuation counters before auto-continuing", () => {
    expect(
      globalStepLimitDecision({
        step: 10,
        stepLimit: 10,
        autonomous: true,
        continuations: 1.8,
        maxContinuations: 3,
      }),
    ).toEqual({
      action: "continue",
      continuation: 2,
    })
  })

  test("stops at the global step limit after continuation budget is exhausted", () => {
    const decision = globalStepLimitDecision({
      step: 10,
      stepLimit: 10,
      autonomous: true,
      continuations: 3,
      maxContinuations: 3,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "step_limit",
      errorCode: "STEP_LIMIT",
    })
    expect(decision.message).toContain("10 steps")
    expect(decision.message).toContain("after 3 auto-continuations")
  })

  test("treats non-comparable continuation limits as exhausted", () => {
    const globalDecision = globalStepLimitDecision({
      step: 10,
      stepLimit: 10,
      autonomous: true,
      continuations: 0,
      maxContinuations: Number.NaN,
    })
    expect(globalDecision.action).toBe("stop")

    const goalDecision = goalContinuationDecision({
      goal: {
        objective: "finish refactor",
        status: "active",
        tokensUsed: 10,
        timeUsedSeconds: 2,
      },
      continuations: 0,
      maxContinuations: Number.NaN,
      budgetLimitContinuationSent: false,
    })
    expect(goalDecision.action).toBe("continue_active")
  })

  test("formats non-comparable global step limit values in stop messages", () => {
    const decision = globalStepLimitDecision({
      step: 10,
      stepLimit: Number.NaN,
      autonomous: true,
      continuations: Number.NaN,
      maxContinuations: 0,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop")
    expect(decision.message).toContain("an invalid number of steps")
    expect(decision.message).not.toContain("NaN")
  })

  test("stops non-autonomous sessions at the global step limit", () => {
    const decision = globalStepLimitDecision({
      step: 10,
      stepLimit: 10,
      autonomous: false,
      continuations: 0,
      maxContinuations: 3,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop")
    expect(decision.message).toContain("session.max_steps")
  })

  test("continues autonomous sessions at a finite agent step limit while continuation budget remains", () => {
    expect(
      agentStepLimitContinuationDecision({
        step: 5,
        maxSteps: 5,
        autonomous: true,
        continuations: 1,
        maxContinuations: 3,
      }),
    ).toEqual({
      action: "continue",
      continuation: 2,
    })
  })

  test("ignores agent step continuation when boundary or mode conditions are not met", () => {
    expect(
      agentStepLimitContinuationDecision({
        step: 4,
        maxSteps: 5,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
    expect(
      agentStepLimitContinuationDecision({
        step: 5,
        maxSteps: 5,
        autonomous: false,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
    expect(
      agentStepLimitContinuationDecision({
        step: 5,
        maxSteps: Infinity,
        autonomous: true,
        continuations: 0,
        maxContinuations: 3,
      }),
    ).toEqual({ action: "ignore" })
  })

  test("stops with step_limit error when autonomous continuation budget is exhausted at agent step limit", () => {
    const decision = agentStepLimitContinuationDecision({
      step: 5,
      maxSteps: 5,
      autonomous: true,
      continuations: 3,
      maxContinuations: 3,
    })
    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision.reason).toBe("step_limit")
    expect(decision.errorCode).toBe("STEP_LIMIT")
    expect(decision.message).toContain("5 steps")
    expect(decision.message).toContain("3 continuations")
  })

  test("continues active goals indefinitely regardless of continuation count", () => {
    expect(
      goalContinuationDecision({
        goal: {
          objective: "finish refactor",
          status: "active",
          tokensUsed: 10,
          timeUsedSeconds: 2,
        },
        continuations: 1,
        maxContinuations: 3,
        budgetLimitContinuationSent: false,
      }),
    ).toEqual({
      action: "continue_active",
      objective: "finish refactor",
      continuation: 2,
    })

    expect(
      goalContinuationDecision({
        goal: {
          objective: "finish refactor",
          status: "active",
          tokensUsed: 10,
          timeUsedSeconds: 2,
        },
        continuations: 3,
        maxContinuations: 3,
        budgetLimitContinuationSent: false,
      }),
    ).toEqual({
      action: "continue_active",
      objective: "finish refactor",
      continuation: 4,
    })
  })

  test("schedules one budget-limited goal wrap-up when budget data exists", () => {
    expect(
      goalContinuationDecision({
        goal: {
          objective: "finish refactor",
          status: "budget_limited",
          tokenBudget: 100,
          tokensUsed: 120,
          timeUsedSeconds: 9,
        },
        continuations: 0,
        maxContinuations: 3,
        budgetLimitContinuationSent: false,
      }),
    ).toEqual({
      action: "continue_budget_wrapup",
      objective: "finish refactor",
      tokensUsed: 120,
      tokenBudget: 100,
      timeUsedSeconds: 9,
    })
  })

  test("ignores missing goals and already-sent budget wrap-ups", () => {
    const goal = {
      objective: "finish refactor",
      status: "budget_limited",
      tokenBudget: 100,
      tokensUsed: 120,
      timeUsedSeconds: 9,
    }

    expect(
      goalContinuationDecision({
        goal: undefined,
        continuations: 0,
        maxContinuations: 3,
        budgetLimitContinuationSent: false,
      }),
    ).toEqual({ action: "ignore" })
    expect(
      goalContinuationDecision({
        goal,
        continuations: 0,
        maxContinuations: 3,
        budgetLimitContinuationSent: true,
      }),
    ).toEqual({ action: "ignore" })
  })

  test("formats non-comparable budget goal continuation counts in stop messages", () => {
    const decision = goalContinuationDecision({
      goal: {
        objective: "finish refactor",
        status: "budget_limited",
        tokenBudget: 100,
        tokensUsed: 120,
        timeUsedSeconds: 9,
      },
      continuations: Number.NaN,
      maxContinuations: 3,
      budgetLimitContinuationSent: false,
    })

    expect(decision.action).toBe("stop_budget_limit")
    if (decision.action !== "stop_budget_limit") throw new Error("expected stop_budget_limit")
    expect(decision.message).toContain("an invalid number of auto-continuation(s)")
    expect(decision.message).not.toContain("NaN")
  })

  test("uses todo retries for unfinished-todo completion gate events", () => {
    expect(
      completionGateEventState({
        gate: unfinishedTodosGate(),
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: 1,
        maxCompletionGateRetries: 2,
      }),
    ).toEqual({
      reason: "unfinished_todos",
      message: "todos are unfinished",
      retryCount: 4,
      maxRetries: 10,
    })
  })

  test("uses completion-gate retries for non-todo gate events", () => {
    expect(
      completionGateEventState({
        gate: emptySubagentGate(),
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: 1,
        maxCompletionGateRetries: 2,
      }),
    ).toEqual({
      reason: "empty_subagent_result",
      message: "empty subagent result",
      retryCount: 1,
      maxRetries: 2,
    })
    expect(
      completionGateEventState({
        gate: { status: "allow" },
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: 1,
        maxCompletionGateRetries: 2,
      }),
    ).toEqual({
      reason: "none",
      message: "Completion gate passed.",
      retryCount: 1,
      maxRetries: 2,
    })
  })

  test("normalizes invalid completion-gate event retry counts", () => {
    expect(
      completionGateEventState({
        gate: unfinishedTodosGate(),
        todoRetries: Number.NaN,
        maxTodoRetries: Number.NaN,
        completionGateRetries: Number.NaN,
        maxCompletionGateRetries: Number.NaN,
      }),
    ).toMatchObject({
      retryCount: 0,
      maxRetries: 0,
    })
    expect(
      completionGateEventState({
        gate: { status: "allow" },
        todoRetries: 4,
        maxTodoRetries: 10,
        completionGateRetries: Number.NaN,
        maxCompletionGateRetries: Number.NaN,
      }),
    ).toMatchObject({
      retryCount: 0,
      maxRetries: 0,
    })
  })

  test("resets completion-gate retries when the blocked signature changes", () => {
    expect(
      completionGateRetryDecision({
        gate: emptySubagentGate("new"),
        previousSignature: "old",
        retries: 2,
        maxRetries: 2,
        isLastStep: false,
      }),
    ).toEqual({
      action: "continue",
      signature: "new",
      retries: 1,
      attempt: 1,
    })
  })

  test("normalizes fractional completion-gate retry counters before retrying", () => {
    expect(
      completionGateRetryDecision({
        gate: emptySubagentGate("same"),
        previousSignature: "same",
        retries: 1.8,
        maxRetries: 3,
        isLastStep: false,
      }),
    ).toEqual({
      action: "continue",
      signature: "same",
      retries: 2,
      attempt: 2,
    })
  })

  test("stops completion-gate recovery at step limit before retrying", () => {
    const decision = completionGateRetryDecision({
      gate: emptySubagentGate("same"),
      previousSignature: "same",
      retries: 0,
      maxRetries: 2,
      isLastStep: true,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "step_limit",
      errorCode: "STEP_LIMIT",
      attempts: 0,
    })
    expect(decision.message).toContain("completion gate")
    expect(decision.message).toContain("empty subagent result")
  })

  test("stops completion-gate recovery when retry budget is exhausted", () => {
    const decision = completionGateRetryDecision({
      gate: emptySubagentGate("same"),
      previousSignature: "same",
      retries: 2,
      maxRetries: 2,
      isLastStep: false,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "stalled",
      errorCode: "COMPLETION_GATE_BLOCKED",
      attempts: 2,
    })
  })

  test("stops completion-gate recovery when retry budget is non-comparable", () => {
    const decision = completionGateRetryDecision({
      gate: emptySubagentGate("same"),
      previousSignature: "same",
      retries: 0,
      maxRetries: Number.NaN,
      isLastStep: false,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision.reason).toBe("stalled")
    expect(decision.errorCode).toBe("COMPLETION_GATE_BLOCKED")
    expect(decision.attempts).toBe(0)
  })

  test("normalizes invalid completion-gate retry attempts in stop decisions", () => {
    const decision = completionGateRetryDecision({
      gate: emptySubagentGate("same"),
      previousSignature: "same",
      retries: Number.NaN,
      maxRetries: 2,
      isLastStep: false,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision.attempts).toBe(0)
  })

  test("resets empty-model-turn retries when the turn is not empty", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: false,
        emptyModelTurnRetries: 1,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 4,
      }),
    ).toEqual({
      action: "ignore",
      emptyModelTurnRetries: 0,
    })
  })

  test("recovers from the first empty model turn and advances only the empty-model-turn counter", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: true,
        emptyModelTurnRetries: 0,
        maxEmptyModelTurnRetries: 1,
        todoRetries: 2,
      }),
    ).toEqual({
      action: "recover",
      emptyModelTurnRetries: 1,
      todoRetries: 2,
      attempt: 1,
    })
  })

  test("normalizes fractional empty-model-turn counters before retrying without touching todoRetries", () => {
    expect(
      emptyModelTurnDecision({
        emptyModelTurn: true,
        emptyModelTurnRetries: 0.8,
        maxEmptyModelTurnRetries: 2,
        todoRetries: 2.8,
      }),
    ).toEqual({
      action: "recover",
      emptyModelTurnRetries: 1,
      todoRetries: 2.8,
      attempt: 1,
    })
  })

  test("stops after the empty model turn retry budget is exhausted", () => {
    const decision = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 1,
      maxEmptyModelTurnRetries: 1,
      todoRetries: 3,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "stalled",
      errorCode: "EMPTY_MODEL_TURN",
    })
    expect(decision.message).toContain("empty model turn")
    expect(decision.message).toContain("should not be treated as complete")
  })

  test("stops empty-model-turn recovery when retry budget is non-comparable", () => {
    const decision = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 0,
      maxEmptyModelTurnRetries: Number.NaN,
      todoRetries: 3,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision.errorCode).toBe("EMPTY_MODEL_TURN")
  })
})
