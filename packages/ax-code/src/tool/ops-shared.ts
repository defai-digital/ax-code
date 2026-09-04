import z from "zod"
import { NamedError } from "@ax-code/util/error"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import { OperationJournalID, OperationPlanID } from "@/operation/id"
import { OperationJournal, OperationPlan } from "@/operation/query"

export const PlanNotFoundError = NamedError.create(
  "OpsPlanNotFoundError",
  z.object({ planID: z.string(), message: z.string() }),
)

/** Loads a plan or fails the tool call with a typed, user-readable error. */
export function loadPlan(planID: string): OperationPlan.Row {
  const plan = OperationPlan.get(OperationPlanID.make(planID))
  if (!plan) throw new PlanNotFoundError({ planID, message: `Operation plan not found: ${planID}` })
  return plan
}

/**
 * Appends the next journaled event for a plan, continuing the hash chain
 * from the plan's latest entry. Every plan mutation flows through this
 * helper so sequence numbering and prev-entry chaining stay consistent.
 */
export function appendPlanJournal(input: {
  plan: OperationPlan.Row
  projectID: ProjectID
  actor: string
  status: OperationJournal.Status
  payload: unknown
  sessionID?: SessionID
}): { sequence: number; entryHash: string } {
  const latest = OperationJournal.latestEntry(input.plan.id)
  const sequence = (latest?.sequence ?? 0) + 1
  const entryHash = OperationJournal.append({
    id: OperationJournalID.ascending(),
    planID: input.plan.id,
    projectID: input.projectID,
    sequence,
    actor: input.actor,
    status: input.status,
    planCanonicalHash: input.plan.canonical_hash,
    payload: input.payload,
    prevEntryHash: latest?.entry_hash,
    sessionID: input.sessionID,
  })
  return { sequence, entryHash }
}
