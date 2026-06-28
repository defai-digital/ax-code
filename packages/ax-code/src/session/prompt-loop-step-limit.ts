import { Log } from "../util/log"
import { Session } from "."
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { globalStepLimitDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopGlobalStepLimitTransition =
  | { action: "ignore" }
  | { action: "continue_autonomous"; text: string }
  | { action: "stop"; reason: "step_limit"; message: string }

type PromptLoopGlobalStepLimitDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

export function handlePromptLoopGlobalStepLimit(
  input: {
    sessionID: SessionID
    step: number
    stepLimit: number
    autonomous: boolean
    continuations: number
    maxContinuations: number
  },
  deps: PromptLoopGlobalStepLimitDeps = {},
): PromptLoopGlobalStepLimitTransition {
  const decision = globalStepLimitDecision(input)
  if (decision.action === "ignore") return { action: "ignore" }

  if (decision.action === "continue") {
    return {
      action: "continue_autonomous",
      text: AutonomousContinuationPrompt.stepLimit({
        stepLimit: input.stepLimit,
        continuation: decision.continuation,
        maxContinuations: input.maxContinuations,
      }),
    }
  }

  ;(deps.warn ?? log.warn)("global step limit reached", {
    command: "session.prompt.loop",
    status: "error",
    errorCode: decision.errorCode,
    step: input.step,
    sessionID: input.sessionID,
    continuations: input.continuations,
  })
  ;(deps.publishError ?? Session.publishError)({
    sessionID: input.sessionID,
    message: decision.message,
  })
  return { action: "stop", reason: decision.reason, message: decision.message }
}
