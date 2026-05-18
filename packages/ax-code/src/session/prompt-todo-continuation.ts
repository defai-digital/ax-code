export const MAX_STAGNANT_TODO_RETRIES = 2
export const TODO_DEADLINE_MIN_STEP_BUFFER = 3
export const TODO_DEADLINE_MAX_STEP_BUFFER = 8
export const TODO_CONTEXT_CONVERGENCE_INPUT_TOKEN_THRESHOLD = 50_000

export type PromptTodo = {
  content: string
  status: string
  priority: string
}

export type ReportTodoClosureMode = "deadline" | "continuation" | "context"

export type PendingTodoContinuationDecision =
  | {
      action: "stop_step_limit"
      todoRetries: number
      lastPendingTodoSignature: string | undefined
      stagnantTodoRetries: number
    }
  | {
      action: "stop_retry_budget"
      todoRetries: number
      lastPendingTodoSignature: string | undefined
      stagnantTodoRetries: number
    }
  | {
      action: "continue"
      todoRetries: number
      lastPendingTodoSignature: string
      stagnantTodoRetries: number
      stagnant: boolean
    }

export function pendingTodoSignature(todos: PromptTodo[]) {
  return todos.map((todo) => `${todo.status}\u0000${todo.priority}\u0000${todo.content}`).join("\u0001")
}

export function todoDeadlineStepBuffer(pendingTodoCount: number) {
  return Math.min(TODO_DEADLINE_MAX_STEP_BUFFER, Math.max(TODO_DEADLINE_MIN_STEP_BUFFER, pendingTodoCount + 2))
}

export function hasReportStyleTodo(todos: Array<Pick<PromptTodo, "content">>) {
  return todos.some((todo) => /\b(report|reports|bug|bugs)\b|\.internal\/bugs/i.test(todo.content))
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
      todoRetries: input.todoRetries,
      lastPendingTodoSignature: input.lastPendingTodoSignature,
      stagnantTodoRetries: input.stagnantTodoRetries,
    }
  }

  if (input.todoRetries >= input.maxTodoRetries) {
    return {
      action: "stop_retry_budget",
      todoRetries: input.todoRetries,
      lastPendingTodoSignature: input.lastPendingTodoSignature,
      stagnantTodoRetries: input.stagnantTodoRetries,
    }
  }

  const signature = pendingTodoSignature(input.pendingTodos)
  const stagnantTodoRetries = signature === input.lastPendingTodoSignature ? input.stagnantTodoRetries + 1 : 0

  return {
    action: "continue",
    todoRetries: input.todoRetries + 1,
    lastPendingTodoSignature: signature,
    stagnantTodoRetries,
    stagnant: stagnantTodoRetries >= MAX_STAGNANT_TODO_RETRIES,
  }
}

export function reportTodoClosureGuidance(mode: ReportTodoClosureMode) {
  if (mode === "context") {
    return (
      `\nThe context is already large. For report-style todos, write the .internal/bugs report now ` +
      `when there is credible suspected or confirmed evidence. Otherwise cancel that report todo with the ` +
      `concrete reason; do not read more files for broad exploration.`
    )
  }

  if (mode === "deadline") {
    return (
      `\nFor report-style todos, create the required .internal/bugs report now if there is a credible suspected ` +
      `or confirmed issue. If the evidence is not credible enough, cancel that report todo with the concrete ` +
      `reason instead of continuing broad analysis.`
    )
  }

  return (
    `\nFor report-style todos, write the .internal/bugs report now when there is credible suspected or confirmed ` +
    `evidence. Otherwise cancel that report todo with the concrete reason; do not keep doing broad exploration.`
  )
}
