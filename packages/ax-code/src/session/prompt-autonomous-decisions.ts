import type { AutonomousCompletionGate } from "@/control-plane/autonomous-completion-gate"

const EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode received an empty model turn: the provider returned finish=other with zero input, ` +
  `output, and reasoning tokens. The session is stopped, but the work should not be treated as complete.`

function emptyModelTurnIncompleteMessage(cause: string | undefined): string {
  const trimmed = cause?.trim()
  if (!trimmed) return EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE
  return `${EMPTY_MODEL_TURN_INCOMPLETE_MESSAGE} Underlying provider error: ${trimmed}`
}

const TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE =
  `Autonomous mode received a truncated model turn: the provider returned finish=length before the model ` +
  `could complete its response. The session is stopped, but the work should not be treated as complete.`

type ModelTurnTokens = {
  input?: number
  output?: number
  reasoning?: number
}

const UNFINISHED_MODEL_TURN_FINISH_REASONS = new Set(["tool-calls", "unknown", "length"])

export function modelTurnFinished(finish: string | undefined): boolean {
  return finish !== undefined && !UNFINISHED_MODEL_TURN_FINISH_REASONS.has(finish)
}

export function isEmptyModelTurn(input: { finish: string | undefined; tokens: ModelTurnTokens }): boolean {
  return (
    input.finish === "other" &&
    (input.tokens.input ?? 0) === 0 &&
    (input.tokens.output ?? 0) === 0 &&
    (input.tokens.reasoning ?? 0) === 0
  )
}

export function isTruncatedModelTurn(input: { finish: string | undefined }): boolean {
  return input.finish === "length"
}

type EmptyModelTurnDecision =
  | {
      action: "ignore"
      emptyModelTurnRetries: number
    }
  | {
      action: "recover"
      emptyModelTurnRetries: number
      todoRetries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "stalled"
      errorCode: "EMPTY_MODEL_TURN"
      message: string
    }

type TruncatedModelTurnDecision =
  | {
      action: "ignore"
      truncatedModelTurnRetries: number
    }
  | {
      action: "recover"
      truncatedModelTurnRetries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "stalled"
      errorCode: "TRUNCATED_MODEL_TURN"
      message: string
    }

type GoalForContinuationDecision = {
  objective: string
  status: string
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
}

type GoalContinuationDecision =
  | { action: "ignore" }
  | {
      action: "continue_active"
      objective: string
      continuation: number
    }
  | {
      action: "continue_budget_wrapup"
      objective: string
      tokensUsed: number
      tokenBudget: number
      timeUsedSeconds: number
    }
  | {
      action: "stop_budget_limit"
      reason: "stalled"
      message: string
    }

type CompletionGateRetryDecision =
  | {
      action: "continue"
      signature: string
      retries: number
      attempt: number
    }
  | {
      action: "stop"
      reason: "step_limit" | "stalled"
      errorCode: "STEP_LIMIT" | "COMPLETION_GATE_BLOCKED"
      attempts: number
      message: string
    }

type CompletionGateEventReason = "none" | Extract<AutonomousCompletionGate.Decision, { status: "blocked" }>["reason"]
type EmptySubagentResultGateDecision = Extract<
  AutonomousCompletionGate.Decision,
  { status: "blocked"; reason: "empty_subagent_result" }
>

type GlobalStepLimitDecision =
  | { action: "ignore" }
  | {
      action: "continue"
      continuation: number
    }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }

type TotalStepLimitDecision =
  | { action: "ignore" }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "TOTAL_STEP_LIMIT"
      message: string
    }

type AgentStepLimitContinuationDecision =
  | { action: "ignore" }
  | {
      action: "continue"
      continuation: number
    }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }

function nextContinuation(input: { continuations: number; maxContinuations: number }): number | undefined {
  return input.continuations < input.maxContinuations ? nextDecisionCount(input.continuations) : undefined
}

function nextAutonomousContinuation(input: {
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): number | undefined {
  if (!input.autonomous) return undefined
  return nextContinuation(input)
}

function retryBudgetExhausted(input: { attempts: number; maxAttempts: number }): boolean {
  return !(input.attempts < input.maxAttempts)
}

function normalizedDecisionCount(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

function nextDecisionCount(value: number) {
  return normalizedDecisionCount(value) + 1
}

export function formatDecisionCount(value: number) {
  return Number.isFinite(value) ? String(value) : "an invalid number of"
}

export function globalStepLimitDecision(input: {
  step: number
  stepLimit: number
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): GlobalStepLimitDecision {
  if (input.step < input.stepLimit) return { action: "ignore" }

  const continuation = nextAutonomousContinuation(input)
  if (continuation !== undefined) {
    return {
      action: "continue",
      continuation,
    }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "STEP_LIMIT",
    message:
      `Agent reached maximum step limit (${formatDecisionCount(input.stepLimit)} steps${
        input.continuations > 0 ? ` after ${formatDecisionCount(input.continuations)} auto-continuations` : ""
      }). ` +
      `To increase, set "session.max_steps" in ax-code.json. ` +
      `Try breaking the task into smaller parts or increase the limit for complex autonomous tasks.`,
  }
}

// The cumulative ceiling across ALL continuations. Unlike the per-continuation
// step limit, `totalSteps` is never reset by continueAutonomousLoop, so this
// bound applies equally to plain autonomous continuations, active goals (which
// have no continuation cap), and Super-Long runs (which lift the continuation
// cap). There is deliberately no "continue" branch: hitting this limit always
// stops the loop.
export function totalStepLimitDecision(input: {
  totalSteps: number
  totalStepLimit: number
  continuations: number
}): TotalStepLimitDecision {
  if (!Number.isFinite(input.totalStepLimit) || input.totalSteps < input.totalStepLimit) {
    return { action: "ignore" }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "TOTAL_STEP_LIMIT",
    message:
      `Session reached the cumulative step ceiling (${formatDecisionCount(input.totalStepLimit)} total steps` +
      `${input.continuations > 0 ? ` across ${formatDecisionCount(input.continuations)} auto-continuations` : ""}). ` +
      `This ceiling bounds every autonomous run, including active goals and Super-Long mode. ` +
      `To raise it, set "session.max_total_steps" in ax-code.json. ` +
      `The session is stopped; remaining work should not be treated as complete.`,
  }
}

export function agentStepLimitContinuationDecision(input: {
  step: number
  maxSteps: number
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): AgentStepLimitContinuationDecision {
  if (!Number.isFinite(input.maxSteps) || input.step < input.maxSteps) {
    return { action: "ignore" }
  }

  if (!input.autonomous) return { action: "ignore" }

  const continuation = nextContinuation(input)
  if (continuation !== undefined) {
    return {
      action: "continue",
      continuation,
    }
  }

  // When step > maxSteps the agent is definitively past its limit — stop.
  // When step === maxSteps and maxContinuations === 0 (no continuation budget
  // was ever configured), return ignore so the LLM can complete its last
  // permitted step; pendingTodoContinuationDecision will emit the "unfinished
  // todo" error with isLastStep=true and break the loop cleanly.
  // When step === maxSteps and a continuation budget existed but is now
  // exhausted (maxContinuations > 0), stop immediately.
  if (input.step === input.maxSteps && input.maxContinuations === 0) {
    return { action: "ignore" }
  }

  return {
    action: "stop",
    reason: "step_limit",
    errorCode: "STEP_LIMIT",
    message:
      `Agent reached the per-agent step limit (${formatDecisionCount(input.maxSteps)} steps) ` +
      `and the continuation budget is exhausted ` +
      `(${formatDecisionCount(input.continuations)} continuations used). ` +
      `To increase, set the agent's step limit or raise session.max_continuations.`,
  }
}

export function completionGateEventState(input: {
  gate: AutonomousCompletionGate.Decision
  todoRetries: number
  maxTodoRetries: number
  completionGateRetries: number
  maxCompletionGateRetries: number
}): {
  reason: CompletionGateEventReason
  message: string
  retryCount: number
  maxRetries: number
} {
  if (input.gate.status !== "blocked") {
    return {
      reason: "none",
      message: "Completion gate passed.",
      retryCount: normalizedDecisionCount(input.completionGateRetries),
      maxRetries: normalizedDecisionCount(input.maxCompletionGateRetries),
    }
  }

  const useTodoRetries = input.gate.reason === "unfinished_todos"
  const retryCount = useTodoRetries ? input.todoRetries : input.completionGateRetries
  const maxRetries = useTodoRetries ? input.maxTodoRetries : input.maxCompletionGateRetries
  return {
    reason: input.gate.reason,
    message: input.gate.message,
    retryCount: normalizedDecisionCount(retryCount),
    maxRetries: normalizedDecisionCount(maxRetries),
  }
}

export function completionGateRetryDecision(input: {
  gate: EmptySubagentResultGateDecision
  previousSignature: string | undefined
  retries: number
  maxRetries: number
  isLastStep: boolean
}): CompletionGateRetryDecision {
  const signatureChanged = input.gate.signature !== input.previousSignature
  const retries = signatureChanged ? 0 : input.retries

  if (input.isLastStep || retryBudgetExhausted({ attempts: retries, maxAttempts: input.maxRetries })) {
    return {
      action: "stop",
      reason: input.isLastStep ? "step_limit" : "stalled",
      errorCode: input.isLastStep ? "STEP_LIMIT" : "COMPLETION_GATE_BLOCKED",
      attempts: normalizedDecisionCount(retries),
      message:
        `Autonomous mode stopped because the control-plane completion gate found incomplete subagent evidence. ` +
        `${input.gate.message} ` +
        `The session is stopped, but the task should not be treated as complete.`,
    }
  }

  const nextRetries = nextDecisionCount(retries)
  return {
    action: "continue",
    signature: input.gate.signature,
    retries: nextRetries,
    attempt: nextRetries,
  }
}

export function goalContinuationDecision(input: {
  goal: GoalForContinuationDecision | undefined
  continuations: number
  maxContinuations: number
  budgetLimitContinuationSent: boolean
}): GoalContinuationDecision {
  if (!input.goal) return { action: "ignore" }

  if (input.goal.status === "active") {
    // Goals run until the model marks them complete or blocked — no continuation cap.
    return {
      action: "continue_active",
      objective: input.goal.objective,
      continuation: normalizedDecisionCount(input.continuations) + 1,
    }
  }

  if (
    input.goal.status === "budget_limited" &&
    input.goal.tokenBudget !== undefined &&
    !input.budgetLimitContinuationSent
  ) {
    // The single budget wrap-up turn is guaranteed once per budget cycle
    // (bounded by budgetLimitContinuationSent), independent of the continuation
    // cap. Active goals deliberately run past maxContinuations, so by the time a
    // long active goal exhausts its budget, `continuations` is almost always
    // already past the cap — gating the wrap-up on it denied the wrap-up turn
    // and surfaced a spurious "continuation limit reached" stop instead.
    return {
      action: "continue_budget_wrapup",
      objective: input.goal.objective,
      tokensUsed: input.goal.tokensUsed,
      tokenBudget: input.goal.tokenBudget,
      timeUsedSeconds: input.goal.timeUsedSeconds,
    }
  }

  return { action: "ignore" }
}

export function emptyModelTurnDecision(input: {
  emptyModelTurn: boolean
  emptyModelTurnRetries: number
  maxEmptyModelTurnRetries: number
  todoRetries: number
  cause?: string
}): EmptyModelTurnDecision {
  if (!input.emptyModelTurn) {
    return {
      action: "ignore",
      emptyModelTurnRetries: 0,
    }
  }

  if (
    retryBudgetExhausted({
      attempts: input.emptyModelTurnRetries,
      maxAttempts: input.maxEmptyModelTurnRetries,
    })
  ) {
    return {
      action: "stop",
      reason: "stalled",
      errorCode: "EMPTY_MODEL_TURN",
      message: emptyModelTurnIncompleteMessage(input.cause),
    }
  }

  const nextEmptyModelTurnRetries = nextDecisionCount(input.emptyModelTurnRetries)
  return {
    action: "recover",
    emptyModelTurnRetries: nextEmptyModelTurnRetries,
    todoRetries: input.todoRetries,
    attempt: nextEmptyModelTurnRetries,
  }
}

export function truncatedModelTurnDecision(input: {
  truncatedModelTurn: boolean
  truncatedModelTurnRetries: number
  maxTruncatedModelTurnRetries: number
}): TruncatedModelTurnDecision {
  if (!input.truncatedModelTurn) {
    return {
      action: "ignore",
      truncatedModelTurnRetries: 0,
    }
  }

  const retries = normalizedDecisionCount(input.truncatedModelTurnRetries)
  if (retryBudgetExhausted({ attempts: retries, maxAttempts: input.maxTruncatedModelTurnRetries })) {
    return {
      action: "stop",
      reason: "stalled",
      errorCode: "TRUNCATED_MODEL_TURN",
      message: TRUNCATED_MODEL_TURN_INCOMPLETE_MESSAGE,
    }
  }

  const nextRetries = nextDecisionCount(retries)
  return {
    action: "recover",
    truncatedModelTurnRetries: nextRetries,
    attempt: nextRetries,
  }
}
