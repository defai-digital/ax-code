import { sqliteTable, text, integer, blob, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { RefactorPlanID, EmbeddingCacheID } from "./id"
import { Timestamps } from "../storage/schema.sql"

// Debugging & Refactoring Engine tables.
//
// ADR-002/ADR-004: DRE owns its own tables. It never modifies v3's
// code_node / code_edge / code_file / code_index_cursor. In particular,
// debug_engine_embedding_cache has no foreign key into code_node because
// a cross-table FK would force a v3 schema migration. Stale rows are
// pruned opportunistically when DRE looks up a node that no longer
// exists in the graph.

// Persisted refactor plan. planRefactor writes a row here; applySafeRefactor
// reads it back, validates freshness against the graph cursor, and updates
// the status as the apply pipeline progresses.
export type RefactorPlanKind = "extract" | "rename" | "collapse" | "move" | "inline" | "other"
export type RefactorPlanRisk = "low" | "medium" | "high"
export type RefactorPlanStatus = "pending" | "applied" | "aborted" | "stale"

export const RefactorPlanTable = sqliteTable(
  "debug_engine_refactor_plan",
  {
    id: text().$type<RefactorPlanID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().$type<RefactorPlanKind>().notNull(),
    // Human-readable markdown summary. Never empty; the planner always
    // writes at least a one-line description.
    summary: text().notNull(),
    // JSON blob of the machine-readable edit list. Shape is defined by
    // DebugEngine.RefactorPlan["edits"]; we store as JSON so the plan
    // schema can evolve without a table migration.
    edits: text({ mode: "json" }).$type<unknown>().notNull(),
    // Flat list of file paths touched by the plan. Duplicated from `edits`
    // for cheap "is this plan stale" checks against the graph cursor.
    affected_files: text({ mode: "json" }).$type<string[]>().notNull(),
    // Flat list of symbol IDs touched by the plan. Same rationale.
    affected_symbols: text({ mode: "json" }).$type<string[]>().notNull(),
    risk: text().$type<RefactorPlanRisk>().notNull(),
    status: text().$type<RefactorPlanStatus>().notNull(),
    // code_index_cursor.commit_sha at the moment the plan was created. If
    // the cursor has moved since, applySafeRefactor may refuse the plan
    // as stale. Null when no cursor existed yet (fresh project).
    graph_cursor_at_creation: text(),
    ...Timestamps,
  },
  (table) => [
    index("debug_engine_refactor_plan_project_idx").on(table.project_id),
    index("debug_engine_refactor_plan_status_idx").on(table.project_id, table.status),
  ],
)

// DRE-owned embedding cache for duplicate detection. Keyed by node_id
// with no FK into code_node (ADR-004). Invalidated by signature_hash
// mismatch — if v3 reindexes a file and the normalized AST signature
// changes, the cache miss is automatic.
export const EmbeddingCacheTable = sqliteTable(
  "debug_engine_embedding_cache",
  {
    id: text().$type<EmbeddingCacheID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    // References code_node.id but NO foreign key — see ADR-004.
    node_id: text().notNull(),
    // Hash of the normalized function signature/body that produced this
    // embedding. Different hash = cache miss = recompute.
    signature_hash: text().notNull(),
    // Which embedding model was used. Lets different models coexist in
    // the cache without collision.
    model_id: text().notNull(),
    // Raw float32 vector, stored as a BLOB.
    embedding: blob({ mode: "buffer" }).notNull(),
    // Vector dimensionality, stored explicitly so consumers don't have
    // to infer from blob length / 4.
    dim: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("debug_engine_embedding_cache_project_idx").on(table.project_id),
    index("debug_engine_embedding_cache_node_idx").on(table.project_id, table.node_id),
    index("debug_engine_embedding_cache_sig_idx").on(table.project_id, table.signature_hash),
  ],
)
