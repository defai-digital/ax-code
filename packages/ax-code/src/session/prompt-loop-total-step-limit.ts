import { Log } from "../util/log"
import { Session } from "."
import { totalStepLimitDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopTotalStepLimitTransition = { action: "ignore" } | { action: "stop"; reason: "step_limit"; message: string }

type PromptLoopTotalStepLimitDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

export function handlePromptLoopTotalStepLimit(
  input: {
    sessionID: SessionID
    totalSteps: number
    totalStepLimit: number
    continuations: number
  },
  deps: PromptLoopTotalStepLimitDeps = {},
): PromptLoopTotalStepLimitTransition {
  const decision = totalStepLimitDecision(input)
  if (decision.action === "ignore") return { action: "ignore" }

  ;(deps.warn ?? log.warn)("cumulative total step limit reached", {
    command: "session.prompt.loop",
    status: "error",
    errorCode: decision.errorCode,
    totalSteps: input.totalSteps,
    totalStepLimit: input.totalStepLimit,
    sessionID: input.sessionID,
    continuations: input.continuations,
  })
  ;(deps.publishError ?? Session.publishError)({
    sessionID: input.sessionID,
    message: decision.message,
  })
  return { action: "stop", reason: decision.reason, message: decision.message }
}
