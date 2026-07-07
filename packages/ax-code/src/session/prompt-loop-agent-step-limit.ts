import { Log } from "../util/log"
import { Session } from "."
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { agentStepLimitContinuationDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type PromptLoopAgentStepLimitTransition =
  | { action: "ignore" }
  | {
      action: "continue"
      text: string
      logExtras: {
        agent: string
        maxSteps: number
      }
    }
  | {
      action: "stop"
      reason: "step_limit"
      errorCode: "STEP_LIMIT"
      message: string
    }

type PromptLoopAgentStepLimitDeps = {
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

export function handlePromptLoopAgentStepLimit(
  input: {
    sessionID: SessionID
    agentName: string
    step: number
    maxSteps: number
    autonomous: boolean
    continuations: number
    maxContinuations: number
  },
  deps: PromptLoopAgentStepLimitDeps = {},
): PromptLoopAgentStepLimitTransition {
  const decision = agentStepLimitContinuationDecision(input)
  if (decision.action === "ignore") return { action: "ignore" }

  if (decision.action === "stop") {
    // Surface the stop like the sibling limit paths (global/total step
    // limits). Without the log and published error this stop was silent —
    // the loop just ended and the user could not distinguish it from a
    // normal completion.
    ;(deps.warn ?? log.warn)("agent step limit reached", {
      command: "session.prompt.loop",
      status: "error",
      errorCode: decision.errorCode,
      sessionID: input.sessionID,
      agent: input.agentName,
      step: input.step,
      maxSteps: input.maxSteps,
      continuations: input.continuations,
    })
    ;(deps.publishError ?? Session.publishError)({
      sessionID: input.sessionID,
      message: decision.message,
    })
    return {
      action: "stop",
      reason: decision.reason,
      errorCode: decision.errorCode,
      message: decision.message,
    }
  }

  return {
    action: "continue",
    text: AutonomousContinuationPrompt.agentStepLimit({
      agentName: input.agentName,
      maxSteps: input.maxSteps,
      continuation: decision.continuation,
      maxContinuations: input.maxContinuations,
    }),
    logExtras: { agent: input.agentName, maxSteps: input.maxSteps },
  }
}
