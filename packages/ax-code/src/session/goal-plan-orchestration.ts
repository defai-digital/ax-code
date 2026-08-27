import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { GoalPlan } from "./goal-plan"
import { GoalPlanWriter } from "./goal-plan-writer"
import { SessionGoal } from "./goal"
import type { SessionID } from "./schema"
import type { ModelID, ProviderID } from "../provider/schema"

export namespace GoalPlanOrchestration {
  const log = Log.create({ service: "session.goal-plan-orchestration" })

  export type Prepared = {
    goal: SessionGoal.Info
    path: string
    reused: boolean
  }

  export async function prepare(input: {
    sessionID: SessionID
    goal: SessionGoal.Info
    model?: { providerID: ProviderID; modelID: ModelID }
  }): Promise<Prepared> {
    if (GoalPlan.hasValidContract(input.sessionID, input.goal.time.created)) {
      return {
        goal: input.goal,
        path: GoalPlan.pathFor(input.sessionID, input.goal.time.created),
        reused: true,
      }
    }

    const markdown = await GoalPlanWriter.write({
      sessionID: input.sessionID,
      objective: input.goal.objective,
      model: input.model,
    })
    const written = await GoalPlan.write(input.sessionID, input.goal.time.created, markdown)
    return {
      goal: input.goal,
      path: written.path,
      reused: false,
    }
  }

  export async function activate(input: {
    sessionID: SessionID
    objective: string
    tokenBudget?: number
    replace?: boolean
    model?: { providerID: ProviderID; modelID: ModelID }
  }): Promise<Prepared> {
    const reserved = await SessionGoal.create({
      sessionID: input.sessionID,
      objective: input.objective,
      tokenBudget: input.tokenBudget,
      replace: input.replace,
      status: "paused",
    })
    try {
      const prepared = await prepare({
        sessionID: input.sessionID,
        goal: reserved,
        model: input.model,
      })
      const goal = await SessionGoal.resume(input.sessionID)
      return { ...prepared, goal }
    } catch (error) {
      log.warn("goal plan writer failed", {
        sessionID: input.sessionID,
        error: toErrorMessage(error),
      })
      throw error
    }
  }

  export async function resumeWithPlan(input: {
    sessionID: SessionID
    model?: { providerID: ProviderID; modelID: ModelID }
  }): Promise<Prepared> {
    const existing = await SessionGoal.get(input.sessionID)
    if (!existing) throw new Error("No goal is set for this session")
    if (GoalPlan.hasValidContract(input.sessionID, existing.time.created)) {
      const goal = existing.status === "active" ? existing : await SessionGoal.resume(input.sessionID)
      return {
        goal,
        path: GoalPlan.pathFor(input.sessionID, existing.time.created),
        reused: true,
      }
    }
    if (existing.status === "budget_limited") {
      // Probe resume eligibility before spending a writer turn.
      await SessionGoal.resume(input.sessionID)
    }
    const prepared = await prepare({
      sessionID: input.sessionID,
      goal: existing,
      model: input.model,
    })
    const current = await SessionGoal.get(input.sessionID)
    const goal = current?.status === "active" ? current : await SessionGoal.resume(input.sessionID)
    return { ...prepared, goal }
  }

  export function implementerPrompt(input: { objective: string; path: string }) {
    return (
      `Goal set: ${input.objective}\n\n` +
      `A structured plan for this goal is the source of truth for "done":\n${input.path}\n\n` +
      `Read it first. Seed todos from its acceptance criteria. Work the task checklist in order and ` +
      `check items off in the plan file as you complete them. Before calling update_goal with status ` +
      `"complete", run the verification plan and supply acceptanceEvidence for every AC id. ` +
      `Work until the goal is complete, blocked, paused, cleared, or budget-limited.`
    )
  }

  export function resumePrompt(input: { objective: string; path: string }) {
    return (
      `Goal resumed: ${input.objective}\n\n` +
      `Continue from the plan at ${input.path}. ` +
      `Work toward this goal until it is complete, blocked, paused, cleared, or budget-limited.`
    )
  }
}
