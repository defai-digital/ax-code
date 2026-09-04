import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { SessionID } from "../session/schema"
import { Timestamps } from "../storage/schema.sql"
import type { OperationJournalID, OperationPlanID, OperationTokenID } from "./id"

export type OperationPlanStatus = "draft" | "approved" | "rejected" | "expired" | "superseded"

export type OperationJournalStatus =
  | "planned"
  | "approved"
  | "executed"
  | "verified"
  | "rolled_back"
  | "failed"
  | "aborted"
  // Human (or policy) denial of an approval request — the plan moves to
  // "rejected" and the denial is journaled as its own entry.
  | "rejected"

// Cloud Operations Mode plan registry (PRD-2026-09-04-cloud-operations-mode).
//
// One row per OperationPlan: the human-reviewable intent an agent wants to
// execute against an external target (cloud account, network device). The
// canonical JSON + sha256 hash is what `ops_approve` pins — approving a plan
// approves exactly that hash, so args drift is detectable.
//
// origin_session_id is intentionally NOT an FK. Plans are the durable safety
// record for state pushed outside the git worktree and must survive session
// deletion (compaction, revert) — unlike audit_semantic_call, which cascades.
export const OperationPlanTable = sqliteTable(
  "operation_plan",
  {
    id: text().$type<OperationPlanID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    status: text().$type<OperationPlanStatus>().notNull(),
    canonical_json: text({ mode: "json" }).$type<unknown>().notNull(),
    canonical_hash: text().notNull(),
    origin_session_id: text().$type<SessionID>(),
    // Self-reference to the plan this one supersedes. Plain text, no FK —
    // a superseded plan row may be removed independently.
    supersedes_plan_id: text().$type<OperationPlanID>(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("operation_plan_project_hash_idx").on(table.project_id, table.canonical_hash),
    index("operation_plan_project_status_idx").on(table.project_id, table.status),
    index("operation_plan_origin_session_idx").on(table.origin_session_id),
  ],
)

// Append-only operation journal. One row per journaled event (plan created,
// approved, applied, verified, rolled back, ...). From the agent's
// perspective nothing here is ever updated or deleted; `entry_hash` chains
// each entry to its predecessor's hash so tampering with history is
// detectable via OperationJournal.verifyChain.
//
// Deliberately NO time_updated — append-only means a row, once written, is
// immutable. session_id is recorded for audit correlation only, no FK.
export const OperationJournalTable = sqliteTable(
  "operation_journal",
  {
    id: text().$type<OperationJournalID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    plan_id: text()
      .$type<OperationPlanID>()
      .notNull()
      .references(() => OperationPlanTable.id, { onDelete: "cascade" }),
    sequence: integer().notNull(),
    actor: text().notNull(),
    status: text().$type<OperationJournalStatus>().notNull(),
    // Hash-addressed snapshot refs (e.g. snapshot store digest), not paths.
    before_snapshot_ref: text(),
    after_snapshot_ref: text(),
    plan_canonical_hash: text().notNull(),
    payload_json: text({ mode: "json" }).$type<unknown>().notNull(),
    entry_hash: text().notNull(),
    // Hash of the previous entry of this plan; null = first entry.
    prev_entry_hash: text(),
    session_id: text().$type<SessionID>(),
    time_created: integer()
      .notNull()
      .$default(() => Date.now()),
  },
  (table) => [
    index("operation_journal_plan_sequence_idx").on(table.plan_id, table.sequence),
    index("operation_journal_project_status_idx").on(table.project_id, table.status),
    index("operation_journal_project_created_idx").on(table.project_id, table.time_created, table.id),
    index("operation_journal_plan_entry_hash_idx").on(table.plan_id, table.entry_hash),
  ],
)

// Single-use approval tokens. The raw bearer secret is NEVER persisted —
// only its sha256. Redemption must be an atomic conditional UPDATE (not a
// plan-blob read-modify-write), which is why this is its own table and not
// a JSON column on operation_plan. Expiry is lazy: checked at consume time,
// with pruneExpired for best-effort cleanup of dead rows.
export const OperationTokenTable = sqliteTable(
  "operation_token",
  {
    id: text().$type<OperationTokenID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    plan_id: text()
      .$type<OperationPlanID>()
      .notNull()
      .references(() => OperationPlanTable.id, { onDelete: "cascade" }),
    token_hash: text().notNull(),
    purpose: text().notNull(),
    expires_at: integer().notNull(),
    consumed_at: integer(),
    ...Timestamps,
  },
  (table) => [
    uniqueIndex("operation_token_hash_idx").on(table.token_hash),
    index("operation_token_plan_idx").on(table.plan_id),
    index("operation_token_expires_idx").on(table.expires_at),
  ],
)
