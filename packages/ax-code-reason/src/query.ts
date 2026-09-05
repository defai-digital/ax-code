import { codeReasonHost } from "./host"
import { RefactorPlanID } from "./id"
import type { ProjectID } from "./id"
import type { RefactorPlanStatus } from "./schema.sql"
import type { PlanRow, PlanInsert, EmbeddingRow, EmbeddingInsert } from "./repository"

// Low-level CRUD for DRE-owned tables. Mirrors the structure of
// code-intelligence/query.ts — one namespace, one file, every function
// project-scoped, no ambient state. This is the only file that touches
// the plan + embedding repositories directly.
//
// ADR-002: DRE must never write to code_node / code_edge / code_file /
// code_index_cursor. This namespace has no imports from
// code-intelligence/schema.sql — enforced by the file itself.
//
// ADR-Phase-2 (D2): persistence flows through `host.stores.*` (a pair of
// narrow repositories), not a drizzle handle. The host implementation is
// the drizzle-backed `repositories.ts` shipped from core; the package
// stays drizzle-free.

function normalizeQueryLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.floor(limit))
}

export namespace DebugEngineQuery {
  // ─── Refactor plan CRUD ─────────────────────────────────────────────

  export function insertPlan(row: PlanInsert): void {
    codeReasonHost().stores.plans.insertPlan(row)
  }

  export function getPlan(projectID: ProjectID, id: RefactorPlanID): PlanRow | undefined {
    return codeReasonHost().stores.plans.getPlan(projectID, id)
  }

  export function listPlans(projectID: ProjectID, opts?: { status?: RefactorPlanStatus; limit?: number }): PlanRow[] {
    if (!opts) return codeReasonHost().stores.plans.listPlans(projectID)
    return codeReasonHost().stores.plans.listPlans(projectID, {
      status: opts.status,
      limit: normalizeQueryLimit(opts.limit),
    })
  }

  export function updatePlanStatus(projectID: ProjectID, id: RefactorPlanID, status: RefactorPlanStatus): void {
    codeReasonHost().stores.plans.updatePlanStatus(projectID, id, status)
  }

  export function deletePlan(projectID: ProjectID, id: RefactorPlanID): void {
    codeReasonHost().stores.plans.deletePlan(projectID, id)
  }

  // ─── Embedding cache CRUD ───────────────────────────────────────────

  export function upsertEmbedding(row: EmbeddingInsert): void {
    // On node_id collision, replace. We key the cache by (project_id,
    // node_id) rather than the surrogate `id`, so the only sensible
    // conflict policy is "newest wins".
    codeReasonHost().stores.embeddings.upsertEmbedding(row)
  }

  export function getEmbedding(projectID: ProjectID, nodeID: string): EmbeddingRow | undefined {
    return codeReasonHost().stores.embeddings.getEmbedding(projectID, nodeID)
  }

  export function deleteEmbedding(projectID: ProjectID, nodeID: string): void {
    codeReasonHost().stores.embeddings.deleteEmbedding(projectID, nodeID)
  }

  // Test helper. Clears every DRE row for a project. Production code
  // should not need this — plans and caches live as long as the project.
  export function __clearProject(projectID: ProjectID): void {
    const host = codeReasonHost()
    // Walk the public API so call-sites stay the same whether the host
    // is drizzle-backed (core) or Map-backed (tests).
    const plans = host.stores.plans.listPlans(projectID)
    for (const row of plans) host.stores.plans.deletePlan(projectID, row.id)
    // Embeddings have no list API — delegate to the repo's optional
    // project-scoped clear helper (Map-backed fakes + core drizzle impl
    // both implement it). Bind to the repo instance so a `this.rows`
    // lookup finds the Map.
    const embeddings = host.stores.embeddings as { __clearProject?: (this: unknown, id: ProjectID) => void }
    embeddings.__clearProject?.call(host.stores.embeddings, projectID)
  }
}
