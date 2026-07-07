import { Session } from "."
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { goalContinuationDecision } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

type GoalContinuationInfo = {
  objective: string
  status: string
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
}

type PromptLoopGoalTransition =
  | { action: "ignore"; budgetLimitContinuationSent: boolean }
  | {
      action: "continue"
      event: "goal auto-continuation" | "goal budget-limit wrap-up"
      text: string
      budgetLimitContinuationSent: boolean
    }
  | { action: "stop"; reason: "stalled"; budgetLimitContinuationSent: boolean }

type PromptLoopGoalDeps = {
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

export function handlePromptLoopGoalContinuation(
  input: {
    sessionID: SessionID
    goal: GoalContinuationInfo | undefined
    continuations: number
    budgetLimitContinuationSent: boolean
  },
  deps: PromptLoopGoalDeps = {},
): PromptLoopGoalTransition {
  const decision = goalContinuationDecision({
    goal: input.goal,
    continuations: input.continuations,
    budgetLimitContinuationSent: input.budgetLimitContinuationSent,
  })

  if (decision.action === "continue_active") {
    return {
      action: "continue",
      event: "goal auto-continuation",
      text: AutonomousContinuationPrompt.goal({
        objective: decision.objective,
        continuation: decision.continuation,
      }),
      // An active goal means we're in a fresh budget cycle (new or resumed goal),
      // so clear any stale wrap-up flag from a previous goal in this session.
      budgetLimitContinuationSent: false,
    }
  }

  if (decision.action === "continue_budget_wrapup") {
    return {
      action: "continue",
      event: "goal budget-limit wrap-up",
      text: AutonomousContinuationPrompt.goalBudgetLimit({
        objective: decision.objective,
        tokensUsed: decision.tokensUsed,
        tokenBudget: decision.tokenBudget,
        timeUsedSeconds: decision.timeUsedSeconds,
      }),
      budgetLimitContinuationSent: true,
    }
  }

  if (decision.action === "stop_budget_limit") {
    ;(deps.publishError ?? Session.publishError)({
      sessionID: input.sessionID,
      message: decision.message,
    })
    return {
      action: "stop",
      reason: decision.reason,
      budgetLimitContinuationSent: input.budgetLimitContinuationSent,
    }
  }

  return { action: "ignore", budgetLimitContinuationSent: input.budgetLimitContinuationSent }
}
