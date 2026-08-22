// Core-side drizzle-backed implementations of the engine's narrow
// persistence contracts (PlanRepository, EmbeddingRepository). Phase 2
// D2: this file replaces the old `DreDbPort` handle and its callers in
// src/dre-glue.ts. The schema is shared with the package via
// `@ax-code/ax-code-reason/schema.sql`.
//
// Each repository is a small adapter — it speaks drizzle's `eq`/`and`
// conditions and `desc` orderings internally and the engine-typed row
// shape externally. The engine never sees drizzle types because the
// repository interface is defined in the package (`repository.ts`); the
// core side just maps ProjectID strings into the `(project_id, ...)`
// where-clauses.
//
// Transaction semantics:
// - `use`-backed methods (`insertPlan`, `getPlan`, `listPlans`,
//   `updatePlanStatus`, `deletePlan`, `getEmbedding`, `deleteEmbedding`)
//   call `Database.use` (a single-statement transaction). Atomicity is
//   per call.
// - `upsertEmbedding` performs a delete + insert inside one
//   `Database.transaction` so the cache row key collision can never
//   leak a half-state.
//
// Same-row shape pin: rows returned from drizzle are mapped into the
// engine-typed `PlanRow` / `EmbeddingRow` (see packages/ax-code-reason
// /src/repository.ts). Field names match exactly so a single
// structural cast is enough — drizzle's `$inferSelect` already encodes
// the table columns, and our `PlanRow` was defined to mirror them.

import { Database, and, desc, eq } from "@/storage/db"
import { RefactorPlanTable, EmbeddingCacheTable, type RefactorPlanStatus } from "@ax-code/ax-code-reason/schema.sql"
import type {
  EmbeddingRepository,
  EmbeddingRow,
  EmbeddingInsert,
  PlanInsert,
  PlanListOptions,
  PlanRepository,
  PlanRow,
} from "@ax-code/ax-code-reason/repository"
import type { ProjectID } from "@ax-code/ax-code-reason/id"
import type { RefactorPlanID, EmbeddingCacheID } from "@ax-code/ax-code-reason/id"

// ─── Plan repository ──────────────────────────────────────────────────

export function createPlanRepository(): PlanRepository & {
  /** Drop every plan row for a project (test helper). */
  __clearProject(projectID: ProjectID): void
} {
  return {
    insertPlan(row: PlanInsert): void {
      Database.use((db) => db.insert(RefactorPlanTable).values(row).run())
    },
    getPlan(projectID: ProjectID, id: RefactorPlanID): PlanRow | undefined {
      const rows = Database.use((db) =>
        db
          .select()
          .from(RefactorPlanTable)
          .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
          .limit(1)
          .all(),
      ) as PlanRow[]
      return rows[0]
    },
    listPlans(projectID: ProjectID, opts?: PlanListOptions): PlanRow[] {
      return Database.use((db) => {
        const filters = [eq(RefactorPlanTable.project_id, projectID)]
        if (opts?.status) filters.push(eq(RefactorPlanTable.status, opts.status))
        const q = db
          .select()
          .from(RefactorPlanTable)
          .where(and(...filters))
          .orderBy(desc(RefactorPlanTable.time_created))
        const limit = normalizeLimit(opts?.limit)
        if (limit === undefined) return q.all() as PlanRow[]
        if (limit === 0) return []
        return q.limit(limit).all() as PlanRow[]
      })
    },
    updatePlanStatus(projectID: ProjectID, id: RefactorPlanID, status: RefactorPlanStatus): void {
      Database.use((db) =>
        db
          .update(RefactorPlanTable)
          .set({ status, time_updated: Date.now() })
          .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
          .run(),
      )
    },
    deletePlan(projectID: ProjectID, id: RefactorPlanID): void {
      Database.use((db) =>
        db
          .delete(RefactorPlanTable)
          .where(and(eq(RefactorPlanTable.project_id, projectID), eq(RefactorPlanTable.id, id)))
          .run(),
      )
    },
    __clearProject(projectID: ProjectID): void {
      Database.use((db) => db.delete(RefactorPlanTable).where(eq(RefactorPlanTable.project_id, projectID)).run())
    },
  }
}

// ─── Embedding repository ─────────────────────────────────────────────

export function createEmbeddingRepository(): EmbeddingRepository & {
  /** Drop every embedding row for a project (test helper, mirrors the package's Map-backed fake). */
  __clearProject(projectID: ProjectID): void
} {
  return {
    upsertEmbedding(row: EmbeddingInsert): void {
      // On node_id collision, replace (newest wins). The delete + insert
      // must share a transaction so a partial failure can never leave an
      // empty (project_id, node_id) slot.
      Database.transaction((db) => {
        db.delete(EmbeddingCacheTable)
          .where(and(eq(EmbeddingCacheTable.project_id, row.project_id), eq(EmbeddingCacheTable.node_id, row.node_id)))
          .run()
        db.insert(EmbeddingCacheTable).values(row).run()
      })
    },
    getEmbedding(projectID: ProjectID, nodeID: string): EmbeddingRow | undefined {
      const rows = Database.use((db) =>
        db
          .select()
          .from(EmbeddingCacheTable)
          .where(and(eq(EmbeddingCacheTable.project_id, projectID), eq(EmbeddingCacheTable.node_id, nodeID)))
          .limit(1)
          .all(),
      ) as EmbeddingRow[]
      return rows[0]
    },
    deleteEmbedding(projectID: ProjectID, nodeID: string): void {
      Database.use((db) =>
        db
          .delete(EmbeddingCacheTable)
          .where(and(eq(EmbeddingCacheTable.project_id, projectID), eq(EmbeddingCacheTable.node_id, nodeID)))
          .run(),
      )
    },
    __clearProject(projectID: ProjectID): void {
      Database.use((db) => db.delete(EmbeddingCacheTable).where(eq(EmbeddingCacheTable.project_id, projectID)).run())
    },
  }
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.floor(limit))
}
