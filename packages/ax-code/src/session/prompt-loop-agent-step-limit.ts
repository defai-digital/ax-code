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
