// Engine-typed storage contracts for the Debugging & Refactoring Engine.
//
// This file is the ONLY persistence port in the package: every host writes
// or reads DRE-owned state through a `PlanRepository` or
// `EmbeddingRepository` here. The core ships concrete drizzle-backed
// implementations (packages/ax-code/src/dre/repositories.ts); tests ship
// in-memory Map-backed implementations. Neither the engine nor any other
// package module imports drizzle types — schema.sql.ts is the only place
// drizzle-orm appears, and only as the table DSL used by the host's
// concrete impls.
//
// ADR-002/ADR-004: DRE never touches v3 code_* tables. Repository IDs
// cross the boundary as plain strings (ProjectID is a string alias;
// RefactorPlanID and EmbeddingCacheID are branded but unique to the
// package). Branded IDs carry the engine's identity at the type level
// without dragging a drizzle row type into the contract.

import type { EmbeddingCacheID, ProjectID, RefactorPlanID } from "./id"
import type {
  RefactorPlanKind,
  RefactorPlanRisk,
  RefactorPlanStatus,
  RefactorPlanPreconditions,
  RefactorEditGroup,
  RefactorVerificationStep,
} from "./schema.sql"

// Runtime sentinel exported so consumers can detect that the repository
// surface is wired — interfaces alone are erased by the bundler. The
// constant carries the Phase 2 schema version so external consumers
// (core glue, tests, future adapters) can branch on a package-level
// revision without inspecting the package.json.
export const REPOSITORY_SCHEMA_VERSION = 1 as const

// ─── Refactor plan row ──────────────────────────────────────────────────
//
// Mirrors debug_engine_refactor_plan (schema.sql.ts) field-for-field so
// the core drizzle impl can map directly. The shape is engine-typed, not
// drizzle-derived: callers see `status: RefactorPlanStatus`, not the
// raw TEXT string of the SQL column.

export type PlanRow = {
  id: RefactorPlanID
  project_id: ProjectID
  kind: RefactorPlanKind
  summary: string
  // JSON blob of the machine-readable edit list. Phase 1 stores an array of
  // DebugEngine.RefactorEdit; the column is `text` so future shapes can
  // vary without a migration — typed as `unknown` here.
  edits: unknown
  affected_files: string[]
  affected_symbols: string[]
  risk: RefactorPlanRisk
  status: RefactorPlanStatus
  // code_index_cursor.commit_sha at the moment the plan was created.
  // Null when no cursor existed yet (fresh project). Existence +
  // staleness comparison happens in apply-safe-refactor.ts.
  graph_cursor_at_creation: string | null
  // Phase 3 (D5): nullable JSON columns (see schema.sql.ts). Null for rows
  // written before the migration or by callers that don't supply them.
  preconditions: RefactorPlanPreconditions | null
  edit_groups: RefactorEditGroup[] | null
  verification_plan: RefactorVerificationStep[] | null
  time_created: number
  time_updated: number
}

// Insert shape — same as the row for plans; spelling it out keeps the
// `time_updated` field optional (a `.$onUpdate` default fills it).
export type PlanInsert = Omit<PlanRow, "time_updated"> & {
  time_updated?: number
}

export type PlanListOptions = {
  status?: RefactorPlanStatus
  limit?: number
}

// Sync interface — matches the core's `Database.use` semantics (no
// async/await surprises for the engine). `use<T>(callback)` here is
// reserved for future composition; current consumers call methods
// directly.
export interface PlanRepository {
  insertPlan(row: PlanInsert): void
  getPlan(projectID: ProjectID, id: RefactorPlanID): PlanRow | undefined
  listPlans(projectID: ProjectID, opts?: PlanListOptions): PlanRow[]
  updatePlanStatus(projectID: ProjectID, id: RefactorPlanID, status: RefactorPlanStatus): void
  deletePlan(projectID: ProjectID, id: RefactorPlanID): void
}

// ─── Embedding cache row ───────────────────────────────────────────────
//
// Mirrors debug_engine_embedding_cache. Keyed by (project_id, node_id);
// see EmbeddingRepository.upsertEmbedding for the collision policy.

export type EmbeddingRow = {
  id: EmbeddingCacheID
  project_id: ProjectID
  // References code_node.id but NO foreign key — see ADR-004.
  node_id: string
  // Hash of the normalized function signature/body that produced this
  // embedding. Different hash = cache miss = recompute.
  signature_hash: string
  // Which embedding model was used. Lets different models coexist.
  model_id: string
  // Raw float32 vector. Buffer for node:sqlite BLOB type, Uint8Array
  // would also work — pick what the host can round-trip.
  embedding: Buffer
  // Vector dimensionality (Buffer.length / 4 for float32) stored
  // explicitly so consumers don't have to recompute.
  dim: number
  time_created: number
  time_updated: number
}

export type EmbeddingInsert = Omit<EmbeddingRow, "time_updated"> & {
  time_updated?: number
}

export interface EmbeddingRepository {
  upsertEmbedding(row: EmbeddingInsert): void
  getEmbedding(projectID: ProjectID, nodeID: string): EmbeddingRow | undefined
  deleteEmbedding(projectID: ProjectID, nodeID: string): void
}

// ─── Composite store shape ─────────────────────────────────────────────

export interface DebugEngineStores {
  plans: PlanRepository
  embeddings: EmbeddingRepository
}
