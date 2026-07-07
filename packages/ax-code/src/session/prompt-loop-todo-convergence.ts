import { Log } from "../util/log"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import {
  pendingTodoSignature,
  todoContextConvergenceDecision,
  todoDeadlineConvergenceDecision,
  type PromptTodo,
} from "./prompt-todo-continuation"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopTodoConvergenceTransition =
  | {
      action: "ignore"
      lastTodoContextSignature: string | undefined
      lastTodoDeadlineSignature: string | undefined
    }
  | {
      action: "continue"
      text: string
      lastTodoContextSignature: string | undefined
      lastTodoDeadlineSignature: string | undefined
    }

type PromptLoopTodoConvergenceDeps = {
  info?: (message: string, fields: Record<string, unknown>) => void
}

export function handlePromptLoopTodoConvergence(
  input: {
    sessionID: SessionID
    pendingTodos: PromptTodo[]
    inputTokens?: number
    modelFinished: boolean
    remainingAgentSteps: number
    maxSteps: number
    lastTodoContextSignature: string | undefined
    lastTodoDeadlineSignature: string | undefined
  },
  deps: PromptLoopTodoConvergenceDeps = {},
): PromptLoopTodoConvergenceTransition {
  const contextConvergence = todoContextConvergenceDecision({
    pendingTodos: input.pendingTodos,
    inputTokens: input.inputTokens,
  })
  if (!input.modelFinished && contextConvergence.converge) {
    const signature = pendingTodoSignature(input.pendingTodos)
    const finalAgentStep = Number.isFinite(input.remainingAgentSteps) && input.remainingAgentSteps <= 1
    if (signature !== input.lastTodoContextSignature || finalAgentStep) {
      ;(deps.info ?? log.info)("autonomous todo context convergence", {
        command: "session.prompt.loop",
        status: "ok",
        sessionID: input.sessionID,
        pendingCount: input.pendingTodos.length,
        inputTokens: input.inputTokens ?? 0,
        threshold: contextConvergence.threshold,
      })
      return {
        action: "continue",
        text: AutonomousContinuationPrompt.contextConvergence({ pendingTodos: input.pendingTodos }),
        lastTodoContextSignature: signature,
        lastTodoDeadlineSignature: input.lastTodoDeadlineSignature,
      }
    }
  }

  const deadlineConvergence = todoDeadlineConvergenceDecision({
    modelFinished: input.modelFinished,
    pendingTodos: input.pendingTodos,
    remainingAgentSteps: input.remainingAgentSteps,
  })
  if (deadlineConvergence.converge) {
    const signature = pendingTodoSignature(input.pendingTodos)
    if (signature !== input.lastTodoDeadlineSignature) {
      ;(deps.info ?? log.info)("autonomous todo deadline convergence", {
        command: "session.prompt.loop",
        status: "ok",
        sessionID: input.sessionID,
        pendingCount: input.pendingTodos.length,
        remainingAgentSteps: input.remainingAgentSteps,
        maxSteps: input.maxSteps,
      })
      return {
        action: "continue",
        text: AutonomousContinuationPrompt.deadlineConvergence({
          remainingAgentSteps: input.remainingAgentSteps,
          pendingTodos: input.pendingTodos,
          includeReportClosureGuidance: deadlineConvergence.includeReportClosureGuidance,
        }),
        lastTodoContextSignature: input.lastTodoContextSignature,
        lastTodoDeadlineSignature: signature,
      }
    }
  }

  return {
    action: "ignore",
    lastTodoContextSignature: input.lastTodoContextSignature,
    lastTodoDeadlineSignature: input.lastTodoDeadlineSignature,
  }
}
