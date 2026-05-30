import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { agentStepLimitContinuationDecision } from "./prompt-autonomous-decisions"

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

export function handlePromptLoopAgentStepLimit(input: {
  agentName: string
  step: number
  maxSteps: number
  autonomous: boolean
  continuations: number
  maxContinuations: number
}): PromptLoopAgentStepLimitTransition {
  const decision = agentStepLimitContinuationDecision(input)
  if (decision.action === "ignore") return { action: "ignore" }

  if (decision.action === "stop") {
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
