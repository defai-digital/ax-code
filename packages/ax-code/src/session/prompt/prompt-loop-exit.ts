import { Log } from "../../util/log"
import type { MessageV2 } from "../message-v2"
import { assistantLoopExitDecision } from "./prompt-loop-decisions"
import type { SessionID } from "../schema"

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
    lastUserCreatedAt?: number
    lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish"> & { time?: Pick<MessageV2.Assistant["time"], "created"> }
    hasPendingSubtask: boolean
    hasPendingAutonomousWork?: boolean
    /**
     * A steering correction was accepted for this generation but has not been
     * written yet. Ending the run here would reject it with
     * `generation_ended_before_application` even though the user sent it
     * while the run was live, so the loop runs one more iteration: the top of
     * the loop drains the correction into a durable user message and the model
     * answers it. Bounded by the same ceilings as any other user turn.
     */
    hasPendingSteering?: boolean
  },
  deps: PromptLoopAssistantExitDeps = {},
): PromptLoopAssistantExitResult {
  const decision = assistantLoopExitDecision(input)
  if (decision.action !== "continue" && input.hasPendingSteering) {
    ;(deps.info ?? log.info)("extending loop for pending steering", {
      command: "session.prompt.loop",
      status: "ok",
      sessionID: input.sessionID,
    })
    return { action: "continue" }
  }
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
