import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./ops_journal.txt"
import { Instance } from "@/project/instance"
import { OperationJournal } from "@/operation/query"
import { loadPlan } from "./ops-shared"

// Read-only audit view over the operation journal
// (PRD-2026-09-04-cloud-operations-mode): entries for one plan in sequence
// order, or across all plans of the project newest-first.

const LIMIT_DEFAULT = 50
const LIMIT_MAX = 200

const JOURNAL_STATUSES = z.enum(["planned", "approved", "executed", "verified", "rolled_back", "failed", "aborted"])

export const OpsJournalTool = Tool.define("ops_journal", {
  description: DESCRIPTION,
  parameters: z.object({
    plan_id: z.string().optional().describe("List entries of one plan (sequence order); omit for the whole project"),
    status: JOURNAL_STATUSES.optional().describe("Filter by entry status"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIMIT_MAX)
      .default(LIMIT_DEFAULT)
      .describe(`Max entries (default ${LIMIT_DEFAULT}, max ${LIMIT_MAX})`),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "ops_journal",
      patterns: ["*"],
      always: ["*"],
      metadata: {},
    })

    const rows = params.plan_id
      ? OperationJournal.list(OperationPlanIDOf(params.plan_id, Instance.project.id), { limit: params.limit })
      : OperationJournal.listByProject(Instance.project.id, { status: params.status, limit: params.limit })

    const entries = rows.map((row) => ({
      id: row.id,
      sequence: row.sequence,
      actor: row.actor,
      status: row.status,
      time_created: row.time_created,
      payload: row.payload_json,
      entry_hash: row.entry_hash,
      prev_entry_hash: row.prev_entry_hash,
      session_id: row.session_id,
    }))

    return {
      title: `ops_journal ${entries.length} entries`,
      output: JSON.stringify({ entries }, null, 2),
      metadata: { entries },
    }
  },
})

// Validates the plan exists (and so the error matches the other ops tools)
// before listing its entries.
function OperationPlanIDOf(planID: string, projectID: (typeof Instance.project)["id"]) {
  return loadPlan(planID, projectID).id
}
