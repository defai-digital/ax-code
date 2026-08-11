import { describe, expect, test } from "vitest"
import {
  agentStepLimitContinuationDecision,
  completionGateEventState,
  completionGateRetryDecision,
  effectiveContinuationCap,
  effectiveTotalStepLimit,
  goalLongRunActive,
  emptyModelTurnDecision,
  globalStepLimitDecision,
  goalContinuationDecision,
  isEmptyModelTurn,
  isTruncatedModelTurn,
  isReadOnlyExplorationTurn,
  modelTurnFinished,
  readOnlyExplorationDecision,
  resolveTurnToolChoice,
  shouldRestoreForcedTextOnlyTurn,
  toolOnlyTurnDecision,
  totalStepLimitDecision,
  truncatedModelTurnDecision,
  hasSuccessfulGoalCompleteTool,
  goalCompleteForceTextDecision,
} from "../../src/session/prompt-autonomous-decisions"
import { AX_ENGINE_READ_ONLY_TURN_FORCE, AX_ENGINE_READ_ONLY_TURN_NUDGE } from "../../src/session/prompt-loop-config"

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
  test("effectiveContinuationCap lifts the ordinary cap for active goals and Super-Long", () => {
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: undefined })).toBe(3)
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: "paused" })).toBe(3)
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: "complete" })).toBe(3)
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: "blocked" })).toBe(3)
    expect(
      effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: "budget_limited" }),
    ).toBe(3)
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: false, goalStatus: "active" })).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: true, goalStatus: undefined })).toBe(
      Number.POSITIVE_INFINITY,
    )
    expect(effectiveContinuationCap({ maxContinuations: 3, superLongActive: true, goalStatus: "active" })).toBe(
      Number.POSITIVE_INFINITY,
    )
    // Explicit zero still means "no step-limit continuations" unless a lift applies.
    expect(effectiveContinuationCap({ maxContinuations: 0, superLongActive: false })).toBe(0)
  })

  test("classifies model turn finish reasons", () => {
    expect(modelTurnFinished(undefined)).toBe(false)
    expect(modelTurnFinished("tool-calls")).toBe(false)
    expect(modelTurnFinished("unknown")).toBe(false)
    expect(modelTurnFinished("length")).toBe(false)
    expect(modelTurnFinished("stop")).toBe(true)
    expect(modelTurnFinished("other")).toBe(true)
  })

  test("detects empty model turns from finish reason and zero token usage", () => {
    expect(isEmptyModelTurn({ finish: "other", tokens: {} })).toBe(true)
    expect(isEmptyModelTurn({ finish: "other", tokens: { input: 1 } })).toBe(false)
    expect(isEmptyModelTurn({ finish: "stop", tokens: {} })).toBe(false)
  })

  test("detects truncated model turns from length finish reason", () => {
    expect(isTruncatedModelTurn({ finish: "length" })).toBe(true)
    expect(isTruncatedModelTurn({ finish: "stop" })).toBe(false)
    expect(isTruncatedModelTurn({ finish: undefined })).toBe(false)
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
      budgetWrapUp: "none",
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

  test("runs a 1-step agent's only step instead of livelocking under infinite continuation caps", () => {
    // Super-Long / active goals lift maxContinuations to Infinity. Continuing
    // at step===maxSteps===1 would reset the counter without calling the model.
    expect(
      agentStepLimitContinuationDecision({
        step: 1,
        maxSteps: 1,
        autonomous: true,
        continuations: 0,
        maxContinuations: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ action: "ignore" })
    expect(
      agentStepLimitContinuationDecision({
        step: 1,
        maxSteps: 1,
        autonomous: true,
        continuations: 0,
        maxContinuations: 0,
      }),
    ).toEqual({ action: "ignore" })
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
        budgetWrapUp: "none",
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
        budgetWrapUp: "none",
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
        budgetWrapUp: "none",
      }),
    ).toEqual({
      action: "continue_budget_wrapup",
      objective: "finish refactor",
      tokensUsed: 120,
      tokenBudget: 100,
      timeUsedSeconds: 9,
    })
  })

  test("ignores missing goals", () => {
    expect(
      goalContinuationDecision({
        goal: undefined,
        continuations: 0,
        budgetWrapUp: "none",
      }),
    ).toEqual({ action: "ignore" })
  })

  test("ignores a budget-limited goal whose wrap-up concluded in an earlier run", () => {
    // The wrap-up ran in a previous prompt() invocation (seeded "concluded"
    // from the durable status). A fresh user prompt in the same session must
    // not re-fire the wrap-up turn or the budget-stop error.
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
        budgetWrapUp: "concluded",
      }),
    ).toEqual({ action: "ignore" })
  })

  test("stops explicitly once the budget wrap-up turn has been sent", () => {
    const decision = goalContinuationDecision({
      goal: {
        objective: "finish refactor",
        status: "budget_limited",
        tokenBudget: 100,
        tokensUsed: 120,
        timeUsedSeconds: 9,
      },
      continuations: 0,
      budgetWrapUp: "sent",
    })

    expect(decision).toMatchObject({ action: "stop_budget_limit", reason: "stalled" })
    if (decision.action !== "stop_budget_limit") throw new Error("expected stop_budget_limit")
    expect(decision.message).toContain('Goal "finish refactor" reached its token budget')
    expect(decision.message).toContain("120 of 100 tokens used")
    expect(decision.message).toContain("wrap-up turn has already run")
  })

  test("budget stop works without a recorded token budget", () => {
    const decision = goalContinuationDecision({
      goal: {
        objective: "finish refactor",
        status: "budget_limited",
        tokensUsed: 120,
        timeUsedSeconds: 9,
      },
      continuations: 0,
      budgetWrapUp: "sent",
    })

    expect(decision).toMatchObject({ action: "stop_budget_limit" })
    if (decision.action !== "stop_budget_limit") throw new Error("expected stop_budget_limit")
    expect(decision.message).not.toContain("undefined")
  })

  test("issues the budget wrap-up even when continuations has exceeded maxContinuations", () => {
    // A long-running active goal deliberately runs past maxContinuations, so by
    // the time it exhausts its token budget `continuations` is already over the
    // cap. The single guaranteed wrap-up turn (bounded by budgetWrapUp)
    // must still fire instead of being denied as "continuation limit reached".
    const decision = goalContinuationDecision({
      goal: {
        objective: "finish refactor",
        status: "budget_limited",
        tokenBudget: 100,
        tokensUsed: 120,
        timeUsedSeconds: 9,
      },
      continuations: 25,
      budgetWrapUp: "none",
    })

    expect(decision).toEqual({
      action: "continue_budget_wrapup",
      objective: "finish refactor",
      tokensUsed: 120,
      tokenBudget: 100,
      timeUsedSeconds: 9,
    })
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

  test("appends the underlying provider cause to the empty model turn diagnostic", () => {
    const decision = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 1,
      maxEmptyModelTurnRetries: 1,
      todoRetries: 3,
      cause: "AI_APICallError: 429 rate_limit_exceeded",
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision.message).toContain("should not be treated as complete")
    expect(decision.message).toContain("Underlying provider error: AI_APICallError: 429 rate_limit_exceeded")
  })

  test("omits the cause clause when no provider error was captured", () => {
    const withBlankCause = emptyModelTurnDecision({
      emptyModelTurn: true,
      emptyModelTurnRetries: 1,
      maxEmptyModelTurnRetries: 1,
      todoRetries: 3,
      cause: "   ",
    })

    expect(withBlankCause.action).toBe("stop")
    if (withBlankCause.action !== "stop") throw new Error("expected stop decision")
    expect(withBlankCause.message).not.toContain("Underlying provider error")
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

  test("recovers from the first truncated model turn", () => {
    expect(
      truncatedModelTurnDecision({
        truncatedModelTurn: true,
        truncatedModelTurnRetries: 0,
        maxTruncatedModelTurnRetries: 1,
      }),
    ).toEqual({
      action: "recover",
      truncatedModelTurnRetries: 1,
      attempt: 1,
    })
  })

  test("resets truncated model turn retries when the turn is not truncated", () => {
    expect(
      truncatedModelTurnDecision({
        truncatedModelTurn: false,
        truncatedModelTurnRetries: 1,
        maxTruncatedModelTurnRetries: 1,
      }),
    ).toEqual({
      action: "ignore",
      truncatedModelTurnRetries: 0,
    })
  })

  test("stops after the truncated model turn retry budget is exhausted", () => {
    const decision = truncatedModelTurnDecision({
      truncatedModelTurn: true,
      truncatedModelTurnRetries: 1,
      maxTruncatedModelTurnRetries: 1,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "stalled",
      errorCode: "TRUNCATED_MODEL_TURN",
    })
    expect(decision.message).toContain("truncated model turn")
    expect(decision.message).toContain("should not be treated as complete")
  })

  test("stops immediately when a truncation retry repeats stale provider output", () => {
    const decision = truncatedModelTurnDecision({
      truncatedModelTurn: true,
      truncatedModelTurnRetries: 1,
      maxTruncatedModelTurnRetries: 3,
      repeatedOutput: true,
    })

    expect(decision.action).toBe("stop")
    if (decision.action !== "stop") throw new Error("expected stop decision")
    expect(decision).toMatchObject({
      action: "stop",
      reason: "stalled",
      errorCode: "REPEATED_TRUNCATED_MODEL_TURN",
    })
    expect(decision.message).toContain("repeated the same substantial output")
    expect(decision.message).toContain("restart its runtime")
  })
})

describe("effective total step limit", () => {
  const ceilings = {
    maxTotalSteps: 2000,
    maxTotalStepsSuperLong: 20_000,
    maxTotalStepsGoal: 20_000,
  }

  test("plain autonomous runs use the ordinary cumulative ceiling", () => {
    expect(effectiveTotalStepLimit({ superLongActive: false, goalLongRun: false, ...ceilings })).toBe(2000)
  })

  test("goal runs select the long-run ceiling, not the plain-autonomous one", () => {
    expect(effectiveTotalStepLimit({ superLongActive: false, goalLongRun: true, ...ceilings })).toBe(20_000)
  })

  test("Super-Long wins over a goal run (its ceiling pairs with the durable counter)", () => {
    expect(
      effectiveTotalStepLimit({
        superLongActive: true,
        goalLongRun: true,
        ...ceilings,
        maxTotalStepsSuperLong: 30_000,
      }),
    ).toBe(30_000)
  })
})

describe("goal long-run detection for ceiling selection", () => {
  test("active goals are long runs", () => {
    expect(goalLongRunActive({ goalStatus: "active", budgetWrapUp: "none" })).toBe(true)
  })

  test("the in-run budget wrap-up phase stays a long run so the wrap-up turn is not step-limit-stopped", () => {
    // Status flipped this run, wrap-up continuation not yet injected.
    expect(goalLongRunActive({ goalStatus: "budget_limited", budgetWrapUp: "none" })).toBe(true)
    // Wrap-up continuation injected, wrap-up turn currently running.
    expect(goalLongRunActive({ goalStatus: "budget_limited", budgetWrapUp: "sent" })).toBe(true)
  })

  test("a concluded budget-limited goal is inert — later prompts are ordinary runs", () => {
    expect(goalLongRunActive({ goalStatus: "budget_limited", budgetWrapUp: "concluded" })).toBe(false)
  })

  test("paused, terminal, and missing goals are not long runs", () => {
    expect(goalLongRunActive({ goalStatus: "paused", budgetWrapUp: "none" })).toBe(false)
    expect(goalLongRunActive({ goalStatus: "complete", budgetWrapUp: "none" })).toBe(false)
    expect(goalLongRunActive({ goalStatus: "blocked", budgetWrapUp: "none" })).toBe(false)
    expect(goalLongRunActive({ goalStatus: undefined, budgetWrapUp: "none" })).toBe(false)
  })
})

describe("total step limit decision", () => {
  test("ignores while cumulative steps remain under the ceiling", () => {
    expect(totalStepLimitDecision({ totalSteps: 1999, totalStepLimit: 2000, continuations: 12 })).toEqual({
      action: "ignore",
    })
  })

  test("stops at the ceiling with no continue branch, regardless of continuations", () => {
    const decision = totalStepLimitDecision({ totalSteps: 2000, totalStepLimit: 2000, continuations: 57 })
    expect(decision).toMatchObject({
      action: "stop",
      reason: "step_limit",
      errorCode: "TOTAL_STEP_LIMIT",
    })
    if (decision.action !== "stop") throw new Error("expected stop")
    expect(decision.message).toContain("cumulative step ceiling")
    expect(decision.message).toContain("2000 total steps")
    expect(decision.message).toContain("57 auto-continuations")
    expect(decision.message).toContain("session.max_total_steps")
    expect(decision.message).toContain("should not be treated as complete")
  })

  test("ignores non-finite ceilings instead of stopping immediately", () => {
    expect(
      totalStepLimitDecision({ totalSteps: 10_000, totalStepLimit: Number.POSITIVE_INFINITY, continuations: 3 }),
    ).toEqual({ action: "ignore" })
    expect(totalStepLimitDecision({ totalSteps: 10_000, totalStepLimit: Number.NaN, continuations: 3 })).toEqual({
      action: "ignore",
    })
  })

  test("omits the continuation clause on a first-continuation run", () => {
    const decision = totalStepLimitDecision({ totalSteps: 500, totalStepLimit: 500, continuations: 0 })
    if (decision.action !== "stop") throw new Error("expected stop")
    expect(decision.message).not.toContain("auto-continuations")
  })
})

describe("tool-only turn decision", () => {
  const config = {
    nudgeThreshold: 15,
    finalNudgeThreshold: 30,
    maxToolOnlyTurns: 35,
    finalCheckpointHits: 0,
  }

  test("walks a full streak: nudge at 15, final nudge at 30, stop past 35", () => {
    let toolOnlyNudges = 0
    const events: string[] = []
    for (let streak = 1; streak <= 36; streak += 1) {
      const decision = toolOnlyTurnDecision({
        consecutiveToolOnlyTurns: streak,
        toolOnlyNudges,
        ...config,
      })
      if (decision.action === "nudge") {
        events.push(`nudge:${streak}:${decision.final ? "final" : "first"}${decision.forced ? ":forced" : ""}`)
        toolOnlyNudges += 1
      }
      if (decision.action === "stop") {
        events.push(`stop:${streak}`)
        break
      }
    }
    expect(events).toEqual(["nudge:15:first", "nudge:30:final", "stop:36"])
  })

  test("ignores below thresholds and exactly at the hard limit", () => {
    expect(toolOnlyTurnDecision({ consecutiveToolOnlyTurns: 14, toolOnlyNudges: 0, ...config })).toEqual({
      action: "ignore",
    })
    expect(toolOnlyTurnDecision({ consecutiveToolOnlyTurns: 29, toolOnlyNudges: 1, ...config })).toEqual({
      action: "ignore",
    })
    expect(toolOnlyTurnDecision({ consecutiveToolOnlyTurns: 35, toolOnlyNudges: 2, ...config })).toEqual({
      action: "ignore",
    })
  })

  test("stops without a pending nudge when thresholds are misconfigured above the limit", () => {
    // If the final checkpoint is tuned above the hard limit, the stop must
    // still fire rather than waiting forever for the unreachable nudge.
    const decision = toolOnlyTurnDecision({
      consecutiveToolOnlyTurns: 36,
      toolOnlyNudges: 1,
      nudgeThreshold: 15,
      finalNudgeThreshold: 40,
      maxToolOnlyTurns: 35,
      finalCheckpointHits: 0,
    })
    expect(decision).toEqual({ action: "stop" })
  })

  test("late first nudge fires even when the streak jumped past the threshold", () => {
    const decision = toolOnlyTurnDecision({
      consecutiveToolOnlyTurns: 20,
      toolOnlyNudges: 0,
      ...config,
    })
    expect(decision).toEqual({ action: "nudge", final: false, forced: false })
  })

  test("first final checkpoint is advisory, not forced", () => {
    const decision = toolOnlyTurnDecision({
      consecutiveToolOnlyTurns: 30,
      toolOnlyNudges: 1,
      ...config,
    })
    expect(decision).toEqual({ action: "nudge", final: true, forced: false })
  })

  // Regression for #340: a model can reset consecutiveToolOnlyTurns to 0 by
  // producing a single completed-text turn right after the final checkpoint
  // (even a token acknowledgment), then resume a fresh tool-only streak with
  // a full new budget — repeating indefinitely without ever reaching the
  // hard stop, and without ever being forced to produce a real summary.
  test("a second streak reaching the final checkpoint is forced, not advisory", () => {
    const decision = toolOnlyTurnDecision({
      consecutiveToolOnlyTurns: 30,
      toolOnlyNudges: 1,
      ...config,
      finalCheckpointHits: 1, // the first streak already hit the final checkpoint once
    })
    expect(decision).toEqual({ action: "nudge", final: true, forced: true })
  })

  test("first nudge within a later streak is never forced, only the final checkpoint is", () => {
    const decision = toolOnlyTurnDecision({
      consecutiveToolOnlyTurns: 15,
      toolOnlyNudges: 0,
      ...config,
      finalCheckpointHits: 2,
    })
    expect(decision).toEqual({ action: "nudge", final: false, forced: false })
  })
})

describe("local read-only exploration convergence", () => {
  test("classifies inspection tools without a patch as read-only", () => {
    expect(isReadOnlyExplorationTurn([{ type: "tool", tool: "bash" }, { type: "step-finish" }])).toBe(true)
    expect(isReadOnlyExplorationTurn([{ type: "tool", tool: "grep" }])).toBe(true)
  })

  test("does not classify source mutations or non-inspection tools as read-only", () => {
    expect(isReadOnlyExplorationTurn([{ type: "tool", tool: "bash" }, { type: "patch" }])).toBe(false)
    expect(isReadOnlyExplorationTurn([{ type: "tool", tool: "edit" }])).toBe(false)
    expect(isReadOnlyExplorationTurn([{ type: "tool", tool: "question" }])).toBe(false)
    expect(isReadOnlyExplorationTurn([])).toBe(false)
  })

  test("nudges once, then forces synthesis at the shipped ax-engine thresholds", () => {
    const config = {
      nudgeThreshold: AX_ENGINE_READ_ONLY_TURN_NUDGE,
      forceThreshold: AX_ENGINE_READ_ONLY_TURN_FORCE,
    }
    expect(AX_ENGINE_READ_ONLY_TURN_NUDGE).toBe(1)
    expect(AX_ENGINE_READ_ONLY_TURN_FORCE).toBe(2)
    expect(readOnlyExplorationDecision({ consecutiveTurns: 1, nudged: false, ...config })).toEqual({
      action: "nudge",
    })
    expect(readOnlyExplorationDecision({ consecutiveTurns: 2, nudged: true, ...config })).toEqual({
      action: "force_text",
    })
  })
})

describe("goal complete force text (#381)", () => {
  test("detects successful update_goal complete from tool parts", () => {
    expect(
      hasSuccessfulGoalCompleteTool([
        {
          type: "tool",
          tool: "update_goal",
          state: { status: "completed", title: "Completed goal", input: { status: "complete" } },
        },
      ]),
    ).toBe(true)
    expect(
      hasSuccessfulGoalCompleteTool([
        {
          type: "tool",
          tool: "update_goal",
          state: { status: "completed", input: { status: "blocked" }, title: "Blocked goal" },
        },
      ]),
    ).toBe(false)
    expect(hasSuccessfulGoalCompleteTool([{ type: "tool", tool: "bash", state: { status: "completed" } }])).toBe(false)
  })

  test("forces text when goal completed this tool-only turn", () => {
    expect(goalCompleteForceTextDecision({ modelFinished: false, goalCompletedThisTurn: true })).toEqual({
      action: "force_text",
    })
    expect(goalCompleteForceTextDecision({ modelFinished: true, goalCompletedThisTurn: true })).toEqual({
      action: "ignore",
    })
    expect(goalCompleteForceTextDecision({ modelFinished: false, goalCompletedThisTurn: false })).toEqual({
      action: "ignore",
    })
  })
})

describe("resolve turn tool choice", () => {
  test("passes through undefined when neither structured output nor forcing apply", () => {
    expect(resolveTurnToolChoice({ structuredOutputChoice: undefined, forceTextOnlyTurn: false })).toEqual({
      toolChoice: undefined,
      consumedForceTextOnlyTurn: false,
    })
  })

  test("forces none and consumes the flag when only forceTextOnlyTurn is set", () => {
    expect(resolveTurnToolChoice({ structuredOutputChoice: undefined, forceTextOnlyTurn: true })).toEqual({
      toolChoice: "none",
      consumedForceTextOnlyTurn: true,
    })
  })

  test("restores a consumed text-only guard only when the provider turn errors", () => {
    expect(shouldRestoreForcedTextOnlyTurn({ consumed: true, errored: true })).toBe(true)
    expect(shouldRestoreForcedTextOnlyTurn({ consumed: true, errored: false })).toBe(false)
    expect(shouldRestoreForcedTextOnlyTurn({ consumed: false, errored: true })).toBe(false)
  })

  test("structured output required wins when only it is set", () => {
    expect(resolveTurnToolChoice({ structuredOutputChoice: "required", forceTextOnlyTurn: false })).toEqual({
      toolChoice: "required",
      consumedForceTextOnlyTurn: false,
    })
  })

  // Regression for the #340 fix's own gap: structured output must still win
  // (a schema-forced turn cannot skip calling its output tool), but the
  // pending forceTextOnlyTurn must NOT be silently discarded — otherwise a
  // session using structured output could permanently disable the tool-only
  // circuit breaker's forced-turn enforcement.
  test("structured output wins over forcing but leaves the flag pending for a later turn", () => {
    expect(resolveTurnToolChoice({ structuredOutputChoice: "required", forceTextOnlyTurn: true })).toEqual({
      toolChoice: "required",
      consumedForceTextOnlyTurn: false,
    })
  })

  // ADR-051 D3: last finite agent step must disable tools on the wire, not
  // only via max-steps.txt guidance. Do not consume forceTextOnlyTurn.
  test("isLastStep forces none without consuming forceTextOnlyTurn", () => {
    expect(
      resolveTurnToolChoice({ structuredOutputChoice: undefined, forceTextOnlyTurn: false, isLastStep: true }),
    ).toEqual({
      toolChoice: "none",
      consumedForceTextOnlyTurn: false,
    })
  })

  test("structured output still wins over isLastStep", () => {
    expect(
      resolveTurnToolChoice({ structuredOutputChoice: "required", forceTextOnlyTurn: false, isLastStep: true }),
    ).toEqual({
      toolChoice: "required",
      consumedForceTextOnlyTurn: false,
    })
  })
})
