import z from "zod"
import { NamedError } from "@ax-code/util/error"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_approve.txt"
import { Instance } from "@/project/instance"
import { Database, and, eq, gte, isNull } from "@/storage/db"
import { OperationPlanID, OperationTokenID } from "@/operation/id"
import { OperationTokenTable } from "@/operation/operation.sql"
import { OperationPlan, OperationToken } from "@/operation/query"
import { appendPlanJournal, loadPlan, OperationPlanCanonical } from "./ops-shared"
import { Permission } from "@/permission"

// Human approval gate for an OperationPlan (PRD-2026-09-04-cloud-operations-mode).
// The ask uses the "ops_approve" permission, which is INTERACTIVE_ONLY: no
// wildcard allow rule and no autonomous auto-approval can bypass it, and no
// durable "always" grant is offered. On allow, a single-use, TTL-bound,
// plan-bound approval token is issued and returned exactly once.

export const AlreadyApprovedError = NamedError.create(
  "OpsAlreadyApprovedError",
  z.object({ planID: z.string(), message: z.string() }),
)

const TTL_DEFAULT_MINUTES = 10
const TTL_MAX_MINUTES = 60

/** True when the plan has an unconsumed, unexpired approval token. */
function hasLiveToken(planID: OperationPlanID): boolean {
  return (
    Database.use((db) =>
      db
        .select({ id: OperationTokenTable.id })
        .from(OperationTokenTable)
        .where(
          and(
            eq(OperationTokenTable.plan_id, planID),
            isNull(OperationTokenTable.consumed_at),
            gte(OperationTokenTable.expires_at, Date.now()),
          ),
        )
        .limit(1)
        .all(),
    ).length > 0
  )
}

export const OpsApproveTool = Tool.define("ops_approve", {
  description: DESCRIPTION,
  parameters: z.object({
    plan_id: z.string().min(1).describe("OperationPlanID returned by ops_plan"),
    ttl_minutes: z
      .number()
      .int()
      .min(1)
      .max(TTL_MAX_MINUTES)
      .default(TTL_DEFAULT_MINUTES)
      .describe(`Token lifetime in minutes (default ${TTL_DEFAULT_MINUTES}, max ${TTL_MAX_MINUTES})`),
  }),
  async execute(params, ctx) {
    const projectID = Instance.project.id
    const plan = loadPlan(params.plan_id, projectID)
    const canonical = OperationPlanCanonical.parse(plan.canonical_json)

    if (plan.status === "approved" && hasLiveToken(plan.id)) {
      throw new AlreadyApprovedError({
        planID: plan.id,
        message:
          "Plan is already approved with a live token. Use the previously issued token via ops_apply, " +
          "or wait for it to expire before requesting a new approval.",
      })
    }

    try {
      // No `always` patterns: approval is per call, mirroring bash_destructive.
      await ctx.ask({
        permission: "ops_approve",
        patterns: [plan.id],
        always: [],
        metadata: {
          tool: "ops_approve",
          kind: plan.kind,
          canonical_hash: plan.canonical_hash,
          apply_command: canonical.apply_command,
          snapshot_command: canonical.snapshot_command,
          cwd: canonical.cwd,
        },
      })
    } catch (error) {
      if (
        !(error instanceof Permission.DeniedError) &&
        !(error instanceof Permission.RejectedError) &&
        !(error instanceof Permission.CorrectedError)
      ) {
        throw error
      }
      OperationPlan.transition(plan.id, "rejected")
      appendPlanJournal({
        plan,
        projectID,
        actor: "user",
        status: "rejected",
        payload: { canonical_hash: plan.canonical_hash },
        sessionID: ctx.sessionID,
      })
      throw error
    }

    OperationPlan.transition(plan.id, "approved")
    appendPlanJournal({
      plan,
      projectID,
      actor: "user",
      status: "approved",
      payload: { canonical_hash: plan.canonical_hash, ttl_minutes: params.ttl_minutes },
      sessionID: ctx.sessionID,
    })

    const ttlMs = params.ttl_minutes * 60_000
    const token = OperationToken.issue({
      id: OperationTokenID.ascending(),
      projectID,
      planID: plan.id,
      purpose: "approval",
      ttlMs,
    })
    const expiresAt = Date.now() + ttlMs

    const output = JSON.stringify(
      { token, plan_id: plan.id, canonical_hash: plan.canonical_hash, expires_at: expiresAt },
      null,
      2,
    )
    return {
      title: `ops_approve ${plan.id}`,
      output,
      metadata: { token, plan_id: plan.id, canonical_hash: plan.canonical_hash, expires_at: expiresAt },
    }
  },
})
