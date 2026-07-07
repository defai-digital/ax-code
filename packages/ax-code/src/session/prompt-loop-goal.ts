import { Session } from "."
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { goalContinuationDecision, type GoalBudgetWrapUp } from "./prompt-autonomous-decisions"
import type { SessionID } from "./schema"

type GoalContinuationInfo = {
  objective: string
  status: string
  tokenBudget?: number
  tokensUsed: number
  timeUsedSeconds: number
}

type PromptLoopGoalTransition =
  | { action: "ignore"; budgetWrapUp: GoalBudgetWrapUp }
  | {
      action: "continue"
      event: "goal auto-continuation" | "goal budget-limit wrap-up"
      text: string
      budgetWrapUp: GoalBudgetWrapUp
    }
  | { action: "stop"; reason: "stalled"; budgetWrapUp: GoalBudgetWrapUp }

type PromptLoopGoalDeps = {
  publishError?: (input: { sessionID: SessionID; message: string }) => void
}

export function handlePromptLoopGoalContinuation(
  input: {
    sessionID: SessionID
    goal: GoalContinuationInfo | undefined
    continuations: number
    budgetWrapUp: GoalBudgetWrapUp
  },
  deps: PromptLoopGoalDeps = {},
): PromptLoopGoalTransition {
  const decision = goalContinuationDecision({
    goal: input.goal,
    continuations: input.continuations,
    budgetWrapUp: input.budgetWrapUp,
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
      // so clear any stale wrap-up state from a previous goal in this session.
      budgetWrapUp: "none",
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
      budgetWrapUp: "sent",
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
      budgetWrapUp: input.budgetWrapUp,
    }
  }

  return { action: "ignore", budgetWrapUp: input.budgetWrapUp }
}
