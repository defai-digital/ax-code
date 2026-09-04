import z from "zod"
import { NamedError } from "@ax-code/util/error"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import { Hash } from "@/util/hash"
import { Log } from "@/util/log"
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
  beforeSnapshotRef?: string
  afterSnapshotRef?: string
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
    beforeSnapshotRef: input.beforeSnapshotRef,
    afterSnapshotRef: input.afterSnapshotRef,
    planCanonicalHash: input.plan.canonical_hash,
    payload: input.payload,
    prevEntryHash: latest?.entry_hash,
    sessionID: input.sessionID,
  })
  return { sequence, entryHash }
}

const bashLinkageLog = Log.create({ service: "operation.bash-linkage" })

// Canonical form of the per-project sentinel plan collecting destructive bash
// approvals that are not covered by an approved operation plan. Fixed object,
// so its sha256 canonical hash is stable and the (project_id,
// canonical_hash) unique index makes get-or-create idempotent.
const UNPLANNED_CANONICAL = {
  kind: "unplanned-mutations",
  target: "adhoc",
  intent: "Mutations approved outside an operation plan",
} as const

function getOrCreateUnplannedPlan(projectID: ProjectID): OperationPlan.Row {
  const canonicalHash = Hash.fast(JSON.stringify(UNPLANNED_CANONICAL))
  const existing = OperationPlan.byHash(projectID, canonicalHash)
  if (existing) return existing
  try {
    OperationPlan.create({
      id: OperationPlanID.ascending(),
      projectID,
      kind: UNPLANNED_CANONICAL.kind,
      canonical: UNPLANNED_CANONICAL,
    })
  } catch {
    // Unique (project_id, canonical_hash) index: a concurrent writer created
    // the sentinel between our lookup and insert — fall through and use theirs.
  }
  const plan = OperationPlan.byHash(projectID, canonicalHash)
  if (!plan) throw new Error("unplanned-mutations sentinel plan unavailable after create")
  return plan
}

/**
 * Links an allowed `bash_destructive` approval to the operation journal
 * (PRD-2026-09-04 sequencing item 3). Best-effort by contract: this runs on
 * the bash execution hot path and must never block or fail the command, so
 * every failure is logged and swallowed. The payload carries only classifier
 * output (commands + reason) — never secrets.
 *
 * Links to the newest approved plan of the project, preferring the one
 * created by the current session; when no approved plan exists, entries go to
 * the per-project "unplanned-mutations" sentinel plan instead.
 */
export function recordDestructiveApproval(input: {
  projectID: ProjectID
  sessionID?: SessionID
  commands: string[]
  reason: string
}): { planID: OperationPlanID; sequence: number; unplanned: boolean } | undefined {
  try {
    const approved = OperationPlan.listByProject(input.projectID, { status: "approved" })
    const plan =
      (input.sessionID ? approved.find((row) => row.origin_session_id === input.sessionID) : undefined) ?? approved[0]
    if (plan) {
      const { sequence } = appendPlanJournal({
        plan,
        projectID: input.projectID,
        actor: "user",
        status: "approved",
        payload: { source: "bash_destructive", commands: input.commands, reason: input.reason },
        sessionID: input.sessionID,
      })
      return { planID: plan.id, sequence, unplanned: false }
    }
    const sentinel = getOrCreateUnplannedPlan(input.projectID)
    const { sequence } = appendPlanJournal({
      plan: sentinel,
      projectID: input.projectID,
      actor: "user",
      status: "approved",
      payload: { source: "bash_destructive", commands: input.commands, reason: input.reason, unplanned: true },
      sessionID: input.sessionID,
    })
    return { planID: sentinel.id, sequence, unplanned: true }
  } catch (error) {
    bashLinkageLog.warn("failed to journal bash_destructive approval", {
      projectID: input.projectID,
      error: NamedError.message(error),
    })
    return undefined
  }
}
