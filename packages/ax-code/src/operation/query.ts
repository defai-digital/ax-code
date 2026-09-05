import { randomBytes } from "node:crypto"
import { Database, and, desc, eq, gte, isNull, lt } from "@/storage/db"
import { Hash } from "@/util/hash"
import { Log } from "@/util/log"
import type { ProjectID } from "@/project/schema"
import type { SessionID } from "@/session/schema"
import type { OperationJournalID, OperationPlanID, OperationTokenID } from "./id"
import { OperationJournalTable, OperationPlanTable, OperationTokenTable } from "./operation.sql"
import type { OperationJournalStatus, OperationPlanStatus } from "./operation.sql"

// Storage-layer ops for the Cloud Operations Mode tables
// (PRD-2026-09-04-cloud-operations-mode). These namespaces are deliberately
// dumb persistence: *what* gets written lives here, *when* (approval
// gates, token issuance after INTERACTIVE_ONLY asks) lives in the tools.

export namespace OperationPlan {
  const log = Log.create({ service: "operation.plan" })
  export type Row = typeof OperationPlanTable.$inferSelect
  export type Status = OperationPlanStatus

  export type CreateInput = {
    id: OperationPlanID
    projectID: ProjectID
    kind: string
    canonical: unknown
    originSessionID?: SessionID
    supersedesPlanID?: OperationPlanID
  }

  /** Derives the canonical hash and inserts the plan with status "draft". Returns the canonical hash. */
  export function create(input: CreateInput): string {
    const canonicalHash = Hash.fast(JSON.stringify(input.canonical))
    Database.use((db) =>
      db
        .insert(OperationPlanTable)
        .values({
          id: input.id,
          project_id: input.projectID,
          kind: input.kind,
          status: "draft",
          canonical_json: input.canonical,
          canonical_hash: canonicalHash,
          origin_session_id: input.originSessionID,
          supersedes_plan_id: input.supersedesPlanID,
        })
        .run(),
    )
    return canonicalHash
  }

  export function byHash(projectID: ProjectID, canonicalHash: string): Row | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(OperationPlanTable)
        .where(and(eq(OperationPlanTable.project_id, projectID), eq(OperationPlanTable.canonical_hash, canonicalHash)))
        .limit(1)
        .all(),
    )[0]
  }

  export function get(id: OperationPlanID): Row | undefined {
    return Database.use((db) =>
      db.select().from(OperationPlanTable).where(eq(OperationPlanTable.id, id)).limit(1).all(),
    )[0]
  }

  export function listByProject(projectID: ProjectID, opts?: { status?: Status; limit?: number }): Row[] {
    const conditions = [eq(OperationPlanTable.project_id, projectID)]
    if (opts?.status) conditions.push(eq(OperationPlanTable.status, opts.status))
    const limit = opts?.limit && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : undefined
    const query = Database.use((db) =>
      db
        .select()
        .from(OperationPlanTable)
        .where(and(...conditions))
        .orderBy(desc(OperationPlanTable.time_created), desc(OperationPlanTable.id))
        .all(),
    )
    const rows = limit ? query.slice(0, limit) : query
    if (!limit && query.length > 100) {
      log.warn("unbounded plan listing returned many rows", { projectID, count: query.length })
    }
    return rows
  }

  /**
   * Plan rows are mutable for status only; every transition is journaled by
   * the caller (OperationJournal.append), this function only moves the flag.
   */
  export function transition(id: OperationPlanID, nextStatus: Status): void {
    Database.use((db) =>
      db.update(OperationPlanTable).set({ status: nextStatus }).where(eq(OperationPlanTable.id, id)).run(),
    )
  }
}

export namespace OperationJournal {
  const log = Log.create({ service: "operation.journal" })
  export type Row = typeof OperationJournalTable.$inferSelect
  export type Status = OperationJournalStatus

  export type AppendInput = {
    id: OperationJournalID
    planID: OperationPlanID
    projectID: ProjectID
    sequence: number
    actor: string
    status: Status
    beforeSnapshotRef?: string
    afterSnapshotRef?: string
    planCanonicalHash: string
    payload: unknown
    sessionID?: SessionID
    prevEntryHash?: string
  }

  /**
   * Appends one immutable entry and returns its entry_hash. The hash binds
   * payload + predecessor hash, so an entry can only be forged or reordered
   * by recomputing every subsequent hash. This namespace exports no update
   * or delete functions — the journal is append-only from the agent's
   * perspective.
   */
  export function append(input: AppendInput): string {
    const entryHash = Hash.fast(JSON.stringify(input.payload) + (input.prevEntryHash ?? ""))
    Database.use((db) =>
      db
        .insert(OperationJournalTable)
        .values({
          id: input.id,
          plan_id: input.planID,
          project_id: input.projectID,
          sequence: input.sequence,
          actor: input.actor,
          status: input.status,
          before_snapshot_ref: input.beforeSnapshotRef,
          after_snapshot_ref: input.afterSnapshotRef,
          plan_canonical_hash: input.planCanonicalHash,
          payload_json: input.payload,
          entry_hash: entryHash,
          prev_entry_hash: input.prevEntryHash,
          session_id: input.sessionID,
        })
        .run(),
    )
    return entryHash
  }

  /** Entries of a plan in sequence order (chronological). */
  export function list(planID: OperationPlanID, opts?: { limit?: number }): Row[] {
    const limit = opts?.limit && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : undefined
    return Database.use((db) => {
      const query = db
        .select()
        .from(OperationJournalTable)
        .where(eq(OperationJournalTable.plan_id, planID))
        .orderBy(OperationJournalTable.sequence)
        .all()
      return limit ? query.slice(0, limit) : query
    })
  }

  /** Journal entries across all plans of a project, newest first. */
  export function listByProject(projectID: ProjectID, opts?: { status?: Status; limit?: number }): Row[] {
    const conditions = [eq(OperationJournalTable.project_id, projectID)]
    if (opts?.status) conditions.push(eq(OperationJournalTable.status, opts.status))
    const limit = opts?.limit && Number.isFinite(opts.limit) ? Math.max(1, Math.floor(opts.limit)) : undefined
    const query = Database.use((db) =>
      db
        .select()
        .from(OperationJournalTable)
        .where(and(...conditions))
        .orderBy(desc(OperationJournalTable.time_created), desc(OperationJournalTable.id))
        .all(),
    )
    const rows = limit ? query.slice(0, limit) : query
    if (!limit && query.length > 500) {
      log.warn("unbounded journal listing returned many rows", { projectID, count: query.length })
    }
    return rows
  }

  /** Highest-sequence entry of a plan, for chain continuation. */
  export function latestEntry(planID: OperationPlanID): Row | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(OperationJournalTable)
        .where(eq(OperationJournalTable.plan_id, planID))
        .orderBy(desc(OperationJournalTable.sequence))
        .limit(1)
        .all(),
    )[0]
  }

  /**
   * Walks a plan's entries in sequence order and recomputes the hash chain:
   * each entry must hash (payload + own prev_entry_hash) to its stored
   * entry_hash, and its prev_entry_hash must equal the previous entry's
   * stored entry_hash (null = first). Returns the first break.
   */
  export function verifyChain(planID: OperationPlanID): { ok: boolean; brokenAt?: number } {
    const entries = Database.use((db) =>
      db
        .select()
        .from(OperationJournalTable)
        .where(eq(OperationJournalTable.plan_id, planID))
        .orderBy(OperationJournalTable.sequence)
        .all(),
    )
    let previousHash: string | null = null
    for (const entry of entries) {
      const expected = Hash.fast(JSON.stringify(entry.payload_json) + (entry.prev_entry_hash ?? ""))
      if (expected !== entry.entry_hash) return { ok: false, brokenAt: entry.sequence }
      if ((entry.prev_entry_hash ?? null) !== previousHash) return { ok: false, brokenAt: entry.sequence }
      previousHash = entry.entry_hash
    }
    return { ok: true }
  }
}

export namespace OperationToken {
  export type Row = typeof OperationTokenTable.$inferSelect

  export type ConsumeResult =
    | { ok: true; planID: OperationPlanID }
    | { ok: false; reason: "not_found" | "already_consumed" | "expired" }
    | { ok: false; reason: "plan_mismatch"; planID: OperationPlanID }

  export type IssueInput = {
    id: OperationTokenID
    projectID: ProjectID
    planID: OperationPlanID
    purpose: string
    ttlMs: number
  }

  /**
   * Issues a single-use approval token. The raw bearer secret is returned
   * exactly once and never persisted — only its sha256. Callers must hand it
   * to the operator (tool result) and drop it.
   */
  export function issue(input: IssueInput): string {
    const secret = randomBytes(32).toString("base64url")
    const tokenHash = Hash.fast(secret)
    Database.use((db) =>
      db
        .insert(OperationTokenTable)
        .values({
          id: input.id,
          project_id: input.projectID,
          plan_id: input.planID,
          token_hash: tokenHash,
          purpose: input.purpose,
          expires_at: Date.now() + input.ttlMs,
        })
        .run(),
    )
    return secret
  }

  /**
   * Atomically redeems a token. The conditional UPDATE is the single-use
   * guarantee: two concurrent consumers cannot both see consumed_at IS NULL
   * and both win — exactly one statement changes a row. The follow-up SELECT
   * only runs to disambiguate the failure reason and never re-checks state.
   */
  export function consume(input: {
    token: string
    now?: number
    planID?: OperationPlanID
    projectID?: ProjectID
  }): ConsumeResult {
    const now = input.now ?? Date.now()
    const tokenHash = Hash.fast(input.token)
    return Database.transaction((db) => {
      const redeemed = db
        .update(OperationTokenTable)
        .set({ consumed_at: now })
        .where(
          and(
            eq(OperationTokenTable.token_hash, tokenHash),
            isNull(OperationTokenTable.consumed_at),
            gte(OperationTokenTable.expires_at, now),
            ...(input.planID ? [eq(OperationTokenTable.plan_id, input.planID)] : []),
            ...(input.projectID ? [eq(OperationTokenTable.project_id, input.projectID)] : []),
          ),
        )
        .returning({ plan_id: OperationTokenTable.plan_id })
        .get()
      if (redeemed) return { ok: true, planID: redeemed.plan_id }

      const row = db
        .select({
          expires_at: OperationTokenTable.expires_at,
          consumed_at: OperationTokenTable.consumed_at,
          plan_id: OperationTokenTable.plan_id,
          project_id: OperationTokenTable.project_id,
        })
        .from(OperationTokenTable)
        .where(eq(OperationTokenTable.token_hash, tokenHash))
        .limit(1)
        .all()[0]
      if (!row) return { ok: false, reason: "not_found" }
      if (row.consumed_at !== null) return { ok: false, reason: "already_consumed" }
      if (input.projectID && row.project_id !== input.projectID) return { ok: false, reason: "not_found" }
      if (input.planID && row.plan_id !== input.planID) {
        return { ok: false, reason: "plan_mismatch", planID: row.plan_id }
      }
      return { ok: false, reason: "expired" }
    })
  }

  /** Best-effort cleanup of expired rows. Returns the number deleted. */
  export function pruneExpired(now?: number): number {
    const cutoff = now ?? Date.now()
    return Database.use((db) =>
      db
        .delete(OperationTokenTable)
        .where(lt(OperationTokenTable.expires_at, cutoff))
        .returning({ id: OperationTokenTable.id })
        .all(),
    ).length
  }
}
