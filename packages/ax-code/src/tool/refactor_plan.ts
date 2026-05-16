import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./refactor_plan.txt"
import { Instance } from "../project/instance"
import { DebugEngine } from "../debug-engine"
import { CodeNodeID } from "../code-intelligence/id"

// Tool wrapper around DebugEngine.planRefactor. Plan-only, never writes
// files — that guarantee comes from the underlying DebugEngine
// implementation, not this wrapper. See PRD §4.2 and ADR-006.

const PLAN_KINDS = ["extract", "rename", "collapse", "move", "inline", "other"] as const

export const RefactorPlanTool = Tool.define("refactor_plan", {
  description: DESCRIPTION,
  parameters: z.object({
    intent: z.string().min(1).describe("Free-text description of the refactor intent"),
    targets: z
      .array(z.string())
      .min(1)
      .describe("CodeNodeID strings from findSymbol identifying the symbols to refactor"),
    kind: z.enum(PLAN_KINDS).optional().describe("Explicit refactor kind; if omitted, classified from intent keywords"),
  }),
  execute: async (args) => {
    const projectID = Instance.project.id
    const plan = await DebugEngine.planRefactor(projectID, {
      intent: args.intent,
      targets: args.targets.map((id) => CodeNodeID.make(id)),
      kind: args.kind,
      scope: "worktree",
    })

    const lines: string[] = []
    lines.push(plan.summary)
    lines.push("")
    lines.push(`## Edits (${plan.edits.length})`)
    for (const e of plan.edits) {
      lines.push(`- **${e.op}** \`${e.target}\` — ${e.detail}`)
    }
    lines.push("")
    lines.push(`Plan id: \`${plan.planId}\` (status: ${plan.status})`)

    return {
      title: `refactor_plan ${plan.kind}`,
      output: lines.join("\n"),
      metadata: {
        planId: plan.planId,
        kind: plan.kind,
        risk: plan.risk,
        editCount: plan.edits.length,
        affectedFileCount: plan.affectedFiles.length,
        plan,
      },
    }
  },
})
