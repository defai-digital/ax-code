import { goalPlanningContext } from "./goal-planning-context"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { GoalPlan } from "./goal-plan"
import { GoalPlanWriter } from "./goal-plan-writer"
import type { GoalContextPart } from "./goal-planning-context"
import { SessionGoal } from "./goal"
import type { SessionID } from "./schema"
import type { ModelID, ProviderID } from "../provider/schema"

export namespace GoalPlanOrchestration {
  const log = Log.create({ service: "session.goal-plan-orchestration" })

  export type Prepared = {
    goal: SessionGoal.Info
    path: string
    reused: boolean
    revision?: { previousPath: string; changes: string[] }
  }

  export async function prepare(input: {
    sessionID: SessionID
    goal: SessionGoal.Info
    model?: { providerID: ProviderID; modelID: ModelID }
    variant?: string
    abort?: AbortSignal
    contextParts?: readonly GoalContextPart[]
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
      variant: input.variant,
      abort: input.abort,
      contextParts: input.contextParts,
    })
    input.abort?.throwIfAborted()
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
    timeBudgetSeconds?: number
    replace?: boolean
    model?: { providerID: ProviderID; modelID: ModelID }
    variant?: string
    abort?: AbortSignal
    contextParts?: readonly GoalContextPart[]
  }): Promise<Prepared> {
    const reserved = await SessionGoal.create({
      sessionID: input.sessionID,
      objective: input.objective,
      tokenBudget: input.tokenBudget,
      timeBudgetSeconds: input.timeBudgetSeconds,
      replace: input.replace,
      status: "paused",
    })
    try {
      const prepared = await prepare({
        sessionID: input.sessionID,
        goal: reserved,
        model: input.model,
        variant: input.variant,
        abort: input.abort,
        contextParts: input.contextParts,
      })
      input.abort?.throwIfAborted()
      const goal = await SessionGoal.setStatus({
        sessionID: input.sessionID,
        status: "active",
        expected: { created: reserved.time.created, status: "paused", updated: reserved.time.updated },
      })
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
    variant?: string
    abort?: AbortSignal
    contextParts?: readonly GoalContextPart[]
  }): Promise<Prepared> {
    input.abort?.throwIfAborted()
    const existing = await SessionGoal.get(input.sessionID)
    if (!existing) throw new Error("No goal is set for this session")
    if (existing.tokenBudget !== undefined && existing.tokensUsed >= existing.tokenBudget)
      throw new Error("Cannot resume a budget-limited goal without increasing the token budget")
    const stored = GoalPlan.storedDigest(input.sessionID, existing.time.created)
    const result = GoalPlan.read(input.sessionID, existing.time.created)
    if (result.status === "found" && stored === GoalPlan.digestOf(result.contract)) {
      input.abort?.throwIfAborted()
      const goal =
        existing.status === "active"
          ? existing
          : await SessionGoal.setStatus({
              sessionID: input.sessionID,
              status: "active",
              expected: { created: existing.time.created, status: existing.status, updated: existing.time.updated },
            })
      return {
        goal,
        path: GoalPlan.pathFor(input.sessionID, existing.time.created),
        reused: true,
      }
    }
    if (stored) {
      throw new GoalPlan.Error(
        "invalid",
        "Cannot resume the goal: its frozen goal contract is missing, invalid, or no longer matches the stored digest. " +
          "Restore the original goal plan, or clear and recreate the goal.",
      )
    }
    const prepared = await prepare({
      sessionID: input.sessionID,
      goal: existing,
      model: input.model,
      variant: input.variant,
      abort: input.abort,
      contextParts: input.contextParts,
    })
    input.abort?.throwIfAborted()
    const goal = await SessionGoal.setStatus({
      sessionID: input.sessionID,
      status: "active",
      expected: { created: existing.time.created, status: existing.status, updated: existing.time.updated },
    })
    return { ...prepared, goal }
  }

  export async function revisionTarget(sessionID: SessionID, correction: string) {
    const existing = await SessionGoal.get(sessionID)
    if (!existing) throw new Error("No goal is set for this session")
    if (
      existing.status === "complete" ||
      existing.status === "budget_limited" ||
      (existing.tokenBudget !== undefined && existing.tokensUsed >= existing.tokenBudget)
    ) {
      throw new Error("Start a new goal to revise completed work or increase an exhausted budget")
    }
    const previous = GoalPlan.read(sessionID, existing.time.created)
    if (previous.status !== "found" || !GoalPlan.hasValidContract(sessionID, existing.time.created))
      throw new Error("Restore the frozen goal contract before revising it")
    if (!correction.trim()) throw new Error("Describe the user correction after /goal revise")
    const objective = `${existing.objective}\nUser correction: ${correction.trim()}`
    if (Buffer.byteLength(objective, "utf8") > 16 * 1024)
      throw new Error("The revised objective exceeds 16 KiB; start a new goal with a consolidated objective")
    return { existing, previous: previous.contract, objective }
  }

  /** Explicit user command only. Prepare first, then atomically switch identity. */
  export async function revise(input: {
    sessionID: SessionID
    correction: string
    expectedCreated?: number
    model?: { providerID: ProviderID; modelID: ModelID }
    variant?: string
    abort?: AbortSignal
    contextParts?: readonly GoalContextPart[]
  }): Promise<Prepared> {
    const { Session } = await import(".")
    const { existing, previous, objective } = await revisionTarget(input.sessionID, input.correction)
    if (input.expectedCreated !== undefined && existing.time.created !== input.expectedCreated)
      throw new Error("The goal changed before revision; the replacement was preserved")
    const correction = input.correction.trim()
    const paused = await SessionGoal.setStatus({
      sessionID: input.sessionID,
      status: "paused",
      expected: { created: existing.time.created, status: existing.status, updated: existing.time.updated },
    })
    const created = SessionGoal.reserveCreated(existing.time.created)
    let written: Awaited<ReturnType<typeof GoalPlan.write>>
    try {
      const markdown = await GoalPlanWriter.write({
        ...input,
        objective,
        context:
          goalPlanningContext(await Session.messages({ sessionID: input.sessionID }), input.contextParts) +
          `\nPrevious frozen contract (preserve requirements unless the explicit correction changes them):\n${GoalPlan.render(previous)}`,
      })
      input.abort?.throwIfAborted()
      written = await GoalPlan.write(input.sessionID, created, markdown)
      await GoalPlan.recordRevision({
        sessionID: input.sessionID,
        previousCreated: existing.time.created,
        created,
        reason: correction,
        previousDigest: GoalPlan.digestOf(previous),
        digest: GoalPlan.digestOf(written.contract),
      })
      input.abort?.throwIfAborted()
    } catch (error) {
      if (existing.status === "blocked")
        await SessionGoal.setStatus({
          sessionID: input.sessionID,
          status: "blocked",
          expected: { created: paused.time.created, status: paused.status, updated: paused.time.updated },
        }).catch(() => undefined)
      throw error
    }
    const installed = await SessionGoal.installRevision({
      sessionID: input.sessionID,
      expected: { created: paused.time.created, status: paused.status, updated: paused.time.updated },
      created,
      objective,
    })
    const goal = await SessionGoal.setStatus({
      sessionID: input.sessionID,
      status: "active",
      expected: { created, status: "paused", updated: installed.time.updated },
    })
    const changes = [
      ...previous.acceptance
        .filter((old) => !written.contract.acceptance.some((next) => next.id === old.id && next.text === old.text))
        .map((old) => `Replaced/removed ${old.id}: ${old.text}`),
      ...written.contract.acceptance
        .filter((next) => !previous.acceptance.some((old) => old.id === next.id && old.text === next.text))
        .map((next) => `New ${next.id}: ${next.text}`),
    ]
    return {
      goal,
      path: written.path,
      reused: false,
      revision: { previousPath: GoalPlan.pathFor(input.sessionID, existing.time.created), changes },
    }
  }

  export function implementerPrompt(input: { objective: string; path: string }) {
    return (
      `Goal set: ${input.objective}\n\n` +
      `A structured plan for this goal is the source of truth for "done":\n${input.path}\n\n` +
      `Read it first. Seed todos from its acceptance criteria. Work the task checklist in order and ` +
      `check items off in the plan file as you complete them. Before calling update_goal with status ` +
      `"complete", run the verification plan and supply acceptanceEvidence for every AC id. ` +
      `For an assurance contract, execute every required check using verify_project with its goalCheck id; ordinary shell runs and prose cannot replace these receipts. ` +
      `Work until the goal is complete, blocked, paused, cleared, or budget-limited.`
    )
  }

  export function resumePrompt(input: { objective: string; path: string }) {
    return (
      `Goal resumed: ${input.objective}\n\n` +
      `Read the current frozen plan at ${input.path} before continuing. Reconcile newer user corrections with historical summaries, recheck changed source and environment facts, and keep unverified findings explicit. ` +
      `Work toward this goal until it is complete, blocked, paused, cleared, or budget-limited.`
    )
  }
}
