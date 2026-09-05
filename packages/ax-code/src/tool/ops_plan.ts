import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_plan.txt"
import { Instance } from "@/project/instance"
import { OperationPlanID } from "@/operation/id"
import { OperationPlan } from "@/operation/query"
import { appendPlanJournal } from "./ops-shared"
import { OpsExec } from "./ops-exec"

// Opens an OperationPlan for an infrastructure change (PRD-2026-09-04-cloud-operations-mode).
// The canonical JSON (fixed key order → stable sha256) is what the later
// ops_approve ask pins: approving a plan approves exactly that hash.

export const OpsPlanTool = Tool.define("ops_plan", {
  description: DESCRIPTION,
  parameters: z.object({
    kind: z.string().min(1).describe('Plan kind, e.g. "terraform", "vyos-firewall", "aws-cli"'),
    target: z.string().min(1).describe("What the change targets: provider/account/region or a network device"),
    intent: z.string().min(1).describe("One-line human-reviewable description of the intended change"),
    apply_command: z.string().min(1).describe("Exact mutation command that ops_apply is authorized to execute"),
    snapshot_command: z
      .string()
      .min(1)
      .optional()
      .describe("Exact read-only command ops_apply may run before and after the mutation"),
    cwd: z.string().min(1).optional().describe("Exact working directory for the mutation and snapshot commands"),
    steps: z
      .array(
        z.object({
          description: z.string().min(1),
          effect: z.string().min(1).describe("What this step does to external state"),
          reversibility: z.enum(["reversible", "hard", "irreversible"]),
          blast_radius: z.enum(["low", "med", "high"]),
        }),
      )
      .min(1)
      .describe("Ordered change steps with effect, reversibility, and blast radius"),
    diff_artifact_ref: z.string().optional().describe("Reference to the machine-checkable diff/plan artifact"),
  }),
  async execute(params, ctx) {
    if (params.snapshot_command) OpsExec.assertReadOnly(params.snapshot_command)
    await ctx.ask({
      permission: "ops_plan",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const projectID = Instance.project.id
    // Key order is fixed so JSON.stringify is stable and the canonical hash
    // is reproducible across processes.
    const canonical = {
      kind: params.kind,
      target: params.target,
      intent: params.intent,
      steps: params.steps,
      apply_command: params.apply_command,
      snapshot_command: params.snapshot_command ?? null,
      cwd: params.cwd ?? null,
      diff_artifact_ref: params.diff_artifact_ref ?? null,
    }
    const planID = OperationPlanID.ascending()
    const canonicalHash = OperationPlan.create({
      id: planID,
      projectID,
      kind: params.kind,
      canonical,
      originSessionID: ctx.sessionID,
    })
    appendPlanJournal({
      plan: OperationPlan.get(planID)!,
      projectID,
      actor: "agent",
      status: "planned",
      payload: { intent: params.intent, step_count: params.steps.length },
      sessionID: ctx.sessionID,
    })

    const output = JSON.stringify({ plan_id: planID, canonical_hash: canonicalHash }, null, 2)
    return {
      title: `ops_plan ${params.kind} → ${params.target}`,
      output,
      metadata: { plan_id: planID, canonical_hash: canonicalHash },
    }
  },
})
