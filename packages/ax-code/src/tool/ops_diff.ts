import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_diff.txt"
import { Instance } from "@/project/instance"
import { appendPlanJournal, loadPlan } from "./ops-shared"

// Attaches the machine-checkable diff artifact to an OperationPlan. The plan
// canonical hash does not change in v1 — revision supersession is a later
// phase — so a refreshed diff is journaled as a new "planned" entry.

export const OpsDiffTool = Tool.define("ops_diff", {
  description: DESCRIPTION,
  parameters: z.object({
    plan_id: z.string().min(1).describe("OperationPlanID returned by ops_plan"),
    diff_artifact_ref: z
      .string()
      .min(1)
      .describe(
        "Reference to the machine-checkable diff/plan artifact (terraform plan -out, show | compare, dry-run output)",
      ),
    summary: z.string().optional().describe("Short human-readable summary of what the diff shows"),
  }),
  async execute(params, ctx) {
    const plan = loadPlan(params.plan_id)

    await ctx.ask({
      permission: "ops_diff",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const { sequence, entryHash } = appendPlanJournal({
      plan,
      projectID: Instance.project.id,
      actor: "agent",
      status: "planned",
      payload: { diff_artifact_ref: params.diff_artifact_ref, summary: params.summary },
      sessionID: ctx.sessionID,
    })

    const output = JSON.stringify({ plan_id: plan.id, sequence, entry_hash: entryHash }, null, 2)
    return {
      title: `ops_diff #${sequence} on ${plan.id}`,
      output,
      metadata: { plan_id: plan.id, sequence, entry_hash: entryHash },
    }
  },
})
