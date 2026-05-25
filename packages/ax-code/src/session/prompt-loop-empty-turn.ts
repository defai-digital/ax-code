import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { emptyModelTurnDecision } from "./prompt-autonomous-decisions"
import { publishPromptFailure } from "./prompt-loop-failure"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopEmptyTurnTransition =
  | {
      action: "ignore"
      emptyModelTurnRetries: number
      todoRetries: number
    }
  | {
      action: "recover"
      emptyModelTurnRetries: number
      todoRetries: number
      text: string
    }
  | {
      action: "stop"
      reason: "stalled"
      emptyModelTurnRetries: number
      todoRetries: number
    }

type PromptLoopEmptyTurnDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishFailure?: typeof publishPromptFailure
}

export async function handlePromptLoopEmptyTurn(
  input: {
    sessionID: SessionID
    assistant: MessageV2.Assistant
    emptyModelTurn: boolean
    emptyModelTurnRetries: number
    maxEmptyModelTurnRetries: number
    todoRetries: number
    pendingCount: number
  },
  deps: PromptLoopEmptyTurnDeps = {},
): Promise<PromptLoopEmptyTurnTransition> {
  const decision = emptyModelTurnDecision({
    emptyModelTurn: input.emptyModelTurn,
    emptyModelTurnRetries: input.emptyModelTurnRetries,
    maxEmptyModelTurnRetries: input.maxEmptyModelTurnRetries,
    todoRetries: input.todoRetries,
  })

  if (decision.action === "stop") {
    ;(deps.warn ?? log.warn)("autonomous stopped after repeated empty model turn", {
      command: "session.prompt.loop",
      status: "stopped",
      errorCode: decision.errorCode,
      sessionID: input.sessionID,
      attempts: input.emptyModelTurnRetries,
      maxAttempts: input.maxEmptyModelTurnRetries,
      pendingCount: input.pendingCount,
    })
    await (deps.publishFailure ?? publishPromptFailure)({
      sessionID: input.sessionID,
      assistant: input.assistant,
      message: decision.message,
    })
    return {
      action: "stop",
      reason: decision.reason,
      emptyModelTurnRetries: input.emptyModelTurnRetries,
      todoRetries: input.todoRetries,
    }
  }

  if (decision.action === "recover") {
    ;(deps.warn ?? log.warn)("autonomous empty model turn recovery", {
      command: "session.prompt.loop",
      status: "retry",
      errorCode: "EMPTY_MODEL_TURN",
      sessionID: input.sessionID,
      attempt: decision.attempt,
      maxAttempts: input.maxEmptyModelTurnRetries,
      pendingCount: input.pendingCount,
    })
    return {
      action: "recover",
      emptyModelTurnRetries: decision.emptyModelTurnRetries,
      todoRetries: decision.todoRetries,
      text: AutonomousContinuationPrompt.emptyModelTurnRecovery({
        attempt: decision.attempt,
        maxAttempts: input.maxEmptyModelTurnRetries,
      }),
    }
  }

  return {
    action: "ignore",
    emptyModelTurnRetries: decision.emptyModelTurnRetries,
    todoRetries: input.todoRetries,
  }
}
