import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { assistantLoopExitDecision } from "./prompt-loop-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopAssistantExitResult = { action: "continue" } | { action: "stop"; reason: "completed" }

type PromptLoopAssistantExitDeps = {
  info?: (message: string, fields: Record<string, unknown>) => void
  warn?: (message: string, fields: Record<string, unknown>) => void
}

export function resolvePromptLoopAssistantExit(
  input: {
    sessionID: SessionID
    lastUserID: string
    lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish">
    hasPendingSubtask: boolean
  },
  deps: PromptLoopAssistantExitDeps = {},
): PromptLoopAssistantExitResult {
  const decision = assistantLoopExitDecision(input)
  if (decision.action === "complete") {
    ;(deps.info ?? log.info)("exiting loop", {
      command: "session.prompt.loop",
      status: "ok",
      sessionID: input.sessionID,
    })
    return { action: "stop", reason: "completed" }
  }
  if (decision.action === "complete_unknown_finish") {
    ;(deps.warn ?? log.warn)(decision.logMessage, {
      command: "session.prompt.loop",
      sessionID: input.sessionID,
    })
    return { action: "stop", reason: "completed" }
  }
  return { action: "continue" }
}
