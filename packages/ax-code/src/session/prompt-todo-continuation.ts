import { Locale } from "@/util/locale"

const MAX_STAGNANT_TODO_RETRIES = 2
const TODO_DEADLINE_MIN_STEP_BUFFER = 3
const TODO_DEADLINE_MAX_STEP_BUFFER = 8
const TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD = 50_000

export type PromptTodo = {
  content: string
  status: string
  priority: string
}

type PendingTodoContinuationDecision =
  | {
      action: "stop_step_limit"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }
  | {
      action: "stop_retry_budget"
      reason: "stalled"
      message: string
    }
  | {
      action: "continue"
      todoRetries: number
      lastPendingTodoSignature: string
      stagnantTodoRetries: number
      stagnant: boolean
      maxStagnantAttempts: number
      includeReportClosureGuidance: boolean
    }

export function pendingTodoSignature(todos: PromptTodo[]) {
  return todos.map((todo) => `${todo.status}\u0000${todo.priority}\u0000${todo.content}`).join("\u0001")
}

// Progress signature for stagnation tracking: content-only and order-insensitive.
// Status/priority flips (pending->in_progress->pending) and list reordering do
// NOT count as progress -- only completing a todo (removing it from the pending
// set) or taking on genuinely new work changes this signature. The
// status-sensitive pendingTodoSignature above stays for convergence-nudge
// dedup, where a status change legitimately warrants a fresh nudge.
export function pendingTodoProgressSignature(todos: Array<Pick<PromptTodo, "content">>) {
  return todos
    .map((todo) => todo.content)
    .sort()
    .join("\u0001")
}

function todoDeadlineStepBuffer(pendingTodoCount: number) {
  return Math.min(TODO_DEADLINE_MAX_STEP_BUFFER, Math.max(TODO_DEADLINE_MIN_STEP_BUFFER, pendingTodoCount + 2))
}

function hasReportStyleTodo(todos: Array<Pick<PromptTodo, "content">>) {
  return todos.some((todo) => /\b(report|reports|bug|bugs)\b|ax-internal\/bugs/i.test(todo.content))
}

export function todoContextConvergenceDecision(input: {
  pendingTodos: Array<Pick<PromptTodo, "content">>
  inputTokens?: number
}) {
  const inputTokens = input.inputTokens ?? 0
  return {
    converge:
      input.pendingTodos.length > 0 &&
      hasReportStyleTodo(input.pendingTodos) &&
      inputTokens >= TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD,
    threshold: TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD,
  }
}

export function todoDeadlineConvergenceDecision(input: {
  modelFinished: boolean
  pendingTodos: Array<Pick<PromptTodo, "content">>
  remainingAgentSteps: number
}) {
  const buffer = todoDeadlineStepBuffer(input.pendingTodos.length)
  const converge =
    !input.modelFinished &&
    input.pendingTodos.length > 0 &&
    Number.isFinite(input.remainingAgentSteps) &&
    input.remainingAgentSteps > 0 &&
    input.remainingAgentSteps <= buffer

  return {
    converge,
    buffer,
    includeReportClosureGuidance: converge && hasReportStyleTodo(input.pendingTodos),
  }
}

export function pendingTodoContinuationDecision(input: {
  isLastStep: boolean
  todoRetries: number
  maxTodoRetries: number
  pendingTodos: PromptTodo[]
  lastPendingTodoSignature: string | undefined
  stagnantTodoRetries: number
}): PendingTodoContinuationDecision {
  if (input.isLastStep) {
    return {
      action: "stop_step_limit",
      reason: "step_limit",
      errorCode: "STEP_LIMIT",
      message:
        `Autonomous mode reached the agent step limit with ${Locale.pluralize(
          input.pendingTodos.length,
          "{} unfinished todo",
          "{} unfinished todos",
        )}. ` +
        `No further todo auto-continuation was scheduled because the maximum-step reminder may disable tools. ` +
        `Increase the agent/session step budget or resume the session to finish the remaining work.`,
    }
  }

  // Progress = the pending-content set changed since the last continuation
  // (a todo completed, or genuinely new work appeared). On progress the retry
  // and stagnation budgets refresh, so long legitimate runs are never starved;
  // without progress both accumulate — across continuation boundaries too,
  // since the caller no longer resets them — so a model oscillating todo
  // statuses or reordering the list cannot evade the caps.
  const signature = pendingTodoProgressSignature(input.pendingTodos)
  const progressed = input.lastPendingTodoSignature !== undefined && signature !== input.lastPendingTodoSignature
  const todoRetries = progressed ? 0 : input.todoRetries

  if (todoRetries >= input.maxTodoRetries) {
    return {
      action: "stop_retry_budget",
      reason: "stalled",
      message:
        `Autonomous mode stopped because ${Locale.pluralize(
          input.pendingTodos.length,
          "{} todo",
          "{} todos",
        )} remained unfinished after ${Locale.pluralize(
          input.maxTodoRetries,
          "{} auto-continuation attempt",
          "{} auto-continuation attempts",
        )} without progress. ` + `The session is stopped, but the remaining todos are not complete.`,
    }
  }

  const stagnantTodoRetries =
    input.lastPendingTodoSignature !== undefined && !progressed ? input.stagnantTodoRetries + 1 : 0

  return {
    action: "continue",
    todoRetries: todoRetries + 1,
    lastPendingTodoSignature: signature,
    stagnantTodoRetries,
    stagnant: stagnantTodoRetries >= MAX_STAGNANT_TODO_RETRIES,
    maxStagnantAttempts: MAX_STAGNANT_TODO_RETRIES,
    includeReportClosureGuidance: hasReportStyleTodo(input.pendingTodos),
  }
}
