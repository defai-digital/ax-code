import { Database, eq, and, desc } from "../storage/db"
import { RefactorPlanTable, EmbeddingCacheTable, type RefactorPlanStatus } from "./schema.sql"
import type { RefactorPlanID, EmbeddingCacheID } from "./id"
import type { ProjectID } from "../project/schema"

// Low-level CRUD for DRE-owned tables. Mirrors the structure of
// code-intelligence/query.ts — one namespace, one file, every function
// project-scoped, no ambient state. This is the only file that touches
// RefactorPlanTable and EmbeddingCacheTable directly.
//
// ADR-002: DRE must never write to code_node / code_edge / code_file /
// code_index_cursor. This namespace has no imports from
// code-intelligence/schema.sql — enforced by the file itself.

export namespace DebugEngineQuery {
  // ─── Refactor plan CRUD ─────────────────────────────────────────────

  export type PlanRow = typeof RefactorPlanTable.$inferSelect
  export type PlanInsert = typeof RefactorPlanTable.$inferInsert

  export function insertPlan(row: PlanInsert): void {
    Database.use((db) => db.insert(RefactorPlanTable).values(row).run())
  }

  export function getPlan(projectID: ProjectID, id: RefactorPlanID): PlanRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(RefactorPlanTable)
        .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
        .limit(1)
        .all(),
    )[0]
  }

  export function listPlans(projectID: ProjectID, opts?: { status?: RefactorPlanStatus; limit?: number }): PlanRow[] {
    const filters = [eq(RefactorPlanTable.project_id, projectID)]
    if (opts?.status) filters.push(eq(RefactorPlanTable.status, opts.status))
    return Database.use((db) => {
      const q = db
        .select()
        .from(RefactorPlanTable)
        .where(and(...filters))
        .orderBy(desc(RefactorPlanTable.time_created))
      return opts?.limit ? q.limit(opts.limit).all() : q.all()
    })
  }

  export function updatePlanStatus(projectID: ProjectID, id: RefactorPlanID, status: RefactorPlanStatus): void {
    Database.use((db) =>
      db
        .update(RefactorPlanTable)
        .set({ status })
        .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
        .run(),
    )
  }

  export function deletePlan(projectID: ProjectID, id: RefactorPlanID): void {
    Database.use((db) =>
      db
        .delete(RefactorPlanTable)
        .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
        .run(),
    )
  }

  // ─── Embedding cache CRUD ───────────────────────────────────────────

  export type CacheRow = typeof EmbeddingCacheTable.$inferSelect
  export type CacheInsert = typeof EmbeddingCacheTable.$inferInsert

  export function upsertEmbedding(row: CacheInsert): void {
    // On node_id collision, replace. We key the cache by (project_id,
    // node_id) rather than the surrogate `id`, so the only sensible
    // conflict policy is "newest wins".
    Database.transaction((db) => {
      db.delete(EmbeddingCacheTable)
        .where(and(eq(EmbeddingCacheTable.project_id, row.project_id), eq(EmbeddingCacheTable.node_id, row.node_id)))
        .run()
      db.insert(EmbeddingCacheTable).values(row).run()
    })
  }

  export function getEmbedding(projectID: ProjectID, nodeID: string): CacheRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(EmbeddingCacheTable)
        .where(and(eq(EmbeddingCacheTable.project_id, projectID), eq(EmbeddingCacheTable.node_id, nodeID)))
        .limit(1)
        .all(),
    )[0]
  }

  export function deleteEmbedding(projectID: ProjectID, nodeID: string): void {
    Database.use((db) =>
      db
        .delete(EmbeddingCacheTable)
        .where(and(eq(EmbeddingCacheTable.project_id, projectID), eq(EmbeddingCacheTable.node_id, nodeID)))
        .run(),
    )
  }

  // Test helper. Clears every DRE row for a project. Production code
  // should not need this — plans and caches live as long as the project.
  export function __clearProject(projectID: ProjectID): void {
    Database.use((db) => {
      db.delete(RefactorPlanTable).where(eq(RefactorPlanTable.project_id, projectID)).run()
      db.delete(EmbeddingCacheTable).where(eq(EmbeddingCacheTable.project_id, projectID)).run()
    })
  }
}
