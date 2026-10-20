import { Agent } from "../agent/agent"
import { Permission } from "@/permission"
import { Log } from "@/util/log"
import { Session } from "../session"
import type { SessionID } from "../session/schema"
import { NotFoundError } from "../storage/db"

// Shared boundary pieces for the task / task_parallel tools: the subagent
// list rendered into both tool descriptions, the fan-out gates applied to
// every child session, the nesting-depth guard and the SubagentStop hook.
// Neither tool imports the other; both depend on this module.

const log = Log.create({ service: "task-tool" })

/** Subagents visible to the caller, rendered into the tool description template. */
export async function subagentDescription(template: string, caller: Agent.Info | undefined): Promise<string> {
  const agents = (await Agent.list()).filter((a) => {
    const tier = Agent.resolveTier(a)
    return tier === "subagent" || tier === "specialist"
  })
  // Filter agents by permissions if agent provided
  const accessible = caller
    ? agents.filter((a) => Permission.evaluate("task", a.name, caller.permission).action !== "deny")
    : agents
  return template.replace(
    "{agents}",
    accessible
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((a) => `- ${a.name}: ${a.description ?? "This subagent should only be called manually by the user."}`)
      .join("\n"),
  )
}

// Fan-out requires an EXPLICIT allow for the `task` permission
// (ADR-005 deny-by-default; ADR-057 D2). The LAST rule naming `task`
// decides, regardless of pattern: a scoped allow like
// `task: { general: "allow" }` counts (matching the last task rule
// keeps this gate consistent with Permission.evaluate's last-match
// semantics), wildcard `*` rules in either direction are just rules
// like any other, and no task rule at all means deny-by-default.
export function taskFanOutAllowed(agent: Agent.Info): boolean {
  const rules = agent.permission.filter((rule) => rule.permission === "task")
  return rules.findLast(() => true)?.action === "allow"
}

/** Durable permission ruleset for a subagent child session. */
export function subagentSessionPermissions(input: {
  canFanOut: boolean
  extraDeny?: string[]
  primaryTools?: string[]
  inherited: Permission.Ruleset
}): Permission.Ruleset {
  return [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    ...(input.extraDeny ?? []).map((tool) => ({ permission: tool, pattern: "*", action: "deny" as const })),
    ...(input.canFanOut
      ? []
      : [
          { permission: "task", pattern: "*", action: "deny" as const },
          { permission: "task_parallel", pattern: "*", action: "deny" as const },
        ]),
    ...(input.primaryTools?.map((tool) => ({ permission: tool, pattern: "*", action: "deny" as const })) ?? []),
    ...input.inherited,
  ]
}

/** Per-turn tool gates for a subagent child session. */
export function subagentToolGates(input: {
  constraints: Record<string, boolean>
  canFanOut: boolean
  extraDeny?: string[]
  primaryTools?: string[]
}): Record<string, boolean> {
  return {
    ...input.constraints,
    todowrite: false,
    todoread: false,
    ...Object.fromEntries((input.extraDeny ?? []).map((tool) => [tool, false])),
    // Agents that cannot fan out cannot start background tasks either, so
    // they have nothing to wait on — hide waitfor alongside task.
    ...(input.canFanOut
      ? {}
      : {
          task: false,
          task_parallel: false,
          waitfor: false,
          list_background_tasks: false,
          message_background_task: false,
        }),
    ...Object.fromEntries((input.primaryTools ?? []).map((tool) => [tool, false])),
  }
}

export const MAX_SUBAGENT_DEPTH = 5

/**
 * Reject a spawn once the parent chain reaches the nesting limit. `checkpoint`
 * runs before and after each session lookup so a caller can bail out on abort.
 */
export async function assertSubagentDepth(sessionID: SessionID, checkpoint?: () => void) {
  let depth = 0
  let parent: SessionID | undefined = sessionID
  while (parent) {
    checkpoint?.()
    const current: Awaited<ReturnType<typeof Session.get>> | undefined = await Session.get(parent).catch((e) => {
      if (NotFoundError.isInstance(e)) return undefined
      throw e
    })
    checkpoint?.()
    if (!current?.parentID) return
    depth++
    if (depth >= MAX_SUBAGENT_DEPTH) {
      throw new Error(`Maximum subagent nesting depth (${MAX_SUBAGENT_DEPTH}) exceeded`)
    }
    parent = current.parentID
  }
}

// User lifecycle hooks (SubagentStop) — observational only; hook failures
// never affect the task result.
export async function fireSubagentStop(input: { sessionID: string; agent: string; status: "completed" | "failed" }) {
  try {
    const { LifecycleHooks } = await import("@/hooks/lifecycle")
    await LifecycleHooks.runForWorkspace({
      event: "SubagentStop",
      sessionID: input.sessionID,
      args: { agent: input.agent, status: input.status },
    })
  } catch (error) {
    log.warn("SubagentStop lifecycle hooks failed", { sessionID: input.sessionID, error })
  }
}
