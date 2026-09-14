import { GoalPlan } from "./goal-plan"
import { GoalCheckVerification } from "./goal-check-verification"
import type { MessageV2 } from "./message-v2"
import type { SessionGoal } from "./goal"
import { Instance } from "../project/instance"
import { currentSourceState } from "../quality/source-state"

export async function goalCheckpoint(
  goal: SessionGoal.Info,
  messages: readonly MessageV2.WithParts[],
): Promise<{ path?: string; nextStep?: string; context?: string } | undefined> {
  const guidance = GoalPlan.continuationGuidance(goal.sessionID, goal.time.created)
  const plan = GoalPlan.read(goal.sessionID, goal.time.created)
  if (
    plan.status !== "found" ||
    !plan.contract.assurance ||
    !GoalPlan.hasValidContract(goal.sessionID, goal.time.created)
  )
    return guidance
  const source = await currentSourceState(
    Instance.worktree,
    Instance.project.vcs ?? "",
    plan.contract.assurance.sourcePaths,
  ).catch(() => ({ available: false, commit: null, dirtyDigest: null }))
  const checks = GoalCheckVerification.inspect({
    assurance: plan.contract.assurance,
    sessionID: goal.sessionID,
    created: goal.time.created,
    digest: GoalPlan.digestOf(plan.contract),
    cwd: Instance.worktree,
    source,
    messages,
  })
  return {
    ...guidance,
    context: [
      guidance?.context,
      "Executed check status (current observation):",
      ...(source.available ? [] : ["Source fingerprint unavailable; receipt freshness is unverified."]),
      ...checks.map((check) => `${check.id}: ${check.status} - ${check.detail}`),
      "Run missing, failed or stale checks after resolving their cause. Current passed checks need no repeat unless their source or external target changed.",
    ].join("\n"),
  }
}
