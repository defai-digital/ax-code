import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { publishPromptFailure } from "./prompt-loop-failure"
import { pendingTodoContinuationDecision, type PromptTodo } from "./prompt-todo-continuation"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopTodoContinuationTransition =
  | {
      action: "continue"
      todoRetries: number
      lastPendingTodoSignature: string
      stagnantTodoRetries: number
      text: string
    }
  | {
      action: "stop"
      reason: "step_limit" | "stalled"
    }

type PromptLoopTodoContinuationDeps = {
  info?: (message: string, fields: Record<string, unknown>) => void
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishFailure?: typeof publishPromptFailure
}

export async function handlePromptLoopTodoContinuation(
  input: {
    sessionID: SessionID
    assistant: MessageV2.Assistant
    isLastStep: boolean
    todoRetries: number
    maxTodoRetries: number
    pendingTodos: PromptTodo[]
    lastPendingTodoSignature: string | undefined
    stagnantTodoRetries: number
    maxSteps: number
  },
  deps: PromptLoopTodoContinuationDeps = {},
): Promise<PromptLoopTodoContinuationTransition> {
  const decision = pendingTodoContinuationDecision({
    isLastStep: input.isLastStep,
    todoRetries: input.todoRetries,
    maxTodoRetries: input.maxTodoRetries,
    pendingTodos: input.pendingTodos,
    lastPendingTodoSignature: input.lastPendingTodoSignature,
    stagnantTodoRetries: input.stagnantTodoRetries,
  })

  if (decision.action === "stop_step_limit") {
    ;(deps.warn ?? log.warn)("autonomous todo continuation stopped at agent step limit", {
      command: "session.prompt.loop",
      status: "stopped",
      errorCode: decision.errorCode,
      sessionID: input.sessionID,
      pendingCount: input.pendingTodos.length,
      attempts: input.todoRetries,
      maxAttempts: input.maxTodoRetries,
      maxSteps: input.maxSteps,
    })
    await (deps.publishFailure ?? publishPromptFailure)({
      sessionID: input.sessionID,
      assistant: input.assistant,
      message: decision.message,
    })
    return { action: "stop", reason: decision.reason }
  }

  if (decision.action === "stop_retry_budget") {
    ;(deps.warn ?? log.warn)("autonomous todo continuation stopped after retry budget", {
      command: "session.prompt.loop",
      status: "stopped",
      sessionID: input.sessionID,
      pendingCount: input.pendingTodos.length,
      attempts: input.todoRetries,
      maxAttempts: input.maxTodoRetries,
    })
    await (deps.publishFailure ?? publishPromptFailure)({
      sessionID: input.sessionID,
      assistant: input.assistant,
      message: decision.message,
    })
    return { action: "stop", reason: decision.reason }
  }

  if (decision.stagnant) {
    ;(deps.warn ?? log.warn)("autonomous todo continuation is stagnant", {
      command: "session.prompt.loop",
      status: "retry",
      sessionID: input.sessionID,
      pendingCount: input.pendingTodos.length,
      attempts: decision.todoRetries,
      stagnantAttempts: decision.stagnantTodoRetries,
      maxStagnantAttempts: decision.maxStagnantAttempts,
    })
  }

  ;(deps.info ?? log.info)("autonomous todo continuation", {
    command: "session.prompt.loop",
    status: "ok",
    sessionID: input.sessionID,
    pendingCount: input.pendingTodos.length,
    attempt: decision.todoRetries,
    maxAttempts: input.maxTodoRetries,
    stagnantAttempts: decision.stagnantTodoRetries,
  })

  return {
    action: "continue",
    todoRetries: decision.todoRetries,
    lastPendingTodoSignature: decision.lastPendingTodoSignature,
    stagnantTodoRetries: decision.stagnantTodoRetries,
    text: AutonomousContinuationPrompt.todoContinuation({
      pendingTodos: input.pendingTodos,
      attempt: decision.todoRetries,
      maxAttempts: input.maxTodoRetries,
      includeReportClosureGuidance: decision.includeReportClosureGuidance,
      stagnantTodoRetries: decision.stagnant ? decision.stagnantTodoRetries : undefined,
    }),
  }
}
