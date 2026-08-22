import { beforeEach, describe, expect, test } from "vitest"
import { DebugEngineQuery } from "../src/query"
import { RefactorPlanID, EmbeddingCacheID } from "../src/id"
import { installTestHost, type TestHost } from "./fixture/host"
import type { PlanInsert, EmbeddingInsert } from "../src/repository"

// Persistence contract for DebugEngineQuery against the in-memory
// Map-backed repos: CRUD round-trips, ordering/limit semantics, project
// scoping, and failure paths (a failing host write leaves no partial
// state). Phase 2 split the old FakeDb into two narrow repositories
// (plans + embeddings); the assertions below cover them both through the
// public DebugEngineQuery surface so the repository swap is invisible to
// callers.

function planRow(id: string, overrides: Partial<PlanInsert> = {}): PlanInsert {
  return {
    id: RefactorPlanID.make(id),
    project_id: "test-project",
    kind: "other",
    summary: `plan ${id}`,
    edits: [],
    affected_files: [],
    affected_symbols: [],
    risk: "low",
    status: "pending",
    graph_cursor_at_creation: null,
    preconditions: null,
    edit_groups: null,
    verification_plan: null,
    time_created: 1000,
    ...overrides,
  }
}

function embeddingRow(nodeID: string, overrides: Partial<EmbeddingInsert> = {}): EmbeddingInsert {
  return {
    id: EmbeddingCacheID.make(`ebc_${nodeID}`),
    project_id: "test-project",
    node_id: nodeID,
    signature_hash: `sig-${nodeID}`,
    model_id: "test-model",
    embedding: Buffer.from([1, 2, 3, 4]),
    dim: 1,
    time_created: 1000,
    ...overrides,
  }
}

describe("DebugEngineQuery", () => {
  let testHost: TestHost

  beforeEach(() => {
    testHost = installTestHost()
  })

  test("insertPlan + getPlan round-trips, scoped by project", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_one"))
    const found = DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_one"))
    expect(found?.id).toBe("rpl_one")
    expect(found?.summary).toBe("plan rpl_one")
    expect(DebugEngineQuery.getPlan("other-project", RefactorPlanID.make("rpl_one"))).toBeUndefined()
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_missing"))).toBeUndefined()
  })

  test("listPlans orders by time_created descending and filters by status", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_old", { time_created: 1000 }))
    DebugEngineQuery.insertPlan(planRow("rpl_new", { time_created: 3000 }))
    DebugEngineQuery.insertPlan(planRow("rpl_mid", { time_created: 2000, status: "applied" }))
    DebugEngineQuery.insertPlan(planRow("rpl_other_project", { project_id: "other-project", time_created: 4000 }))

    expect(DebugEngineQuery.listPlans("test-project").map((p) => p.id)).toEqual(["rpl_new", "rpl_mid", "rpl_old"])
    expect(DebugEngineQuery.listPlans("test-project", { status: "applied" }).map((p) => p.id)).toEqual(["rpl_mid"])
    expect(DebugEngineQuery.listPlans("test-project", { status: "stale" })).toEqual([])
  })

  test("listPlans limit semantics: 0/NaN/Infinity/negative yield nothing, fractions floor", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_a", { time_created: 1000 }))
    DebugEngineQuery.insertPlan(planRow("rpl_b", { time_created: 2000 }))
    DebugEngineQuery.insertPlan(planRow("rpl_c", { time_created: 3000 }))

    expect(DebugEngineQuery.listPlans("test-project", { limit: 2 }).map((p) => p.id)).toEqual(["rpl_c", "rpl_b"])
    expect(DebugEngineQuery.listPlans("test-project", { limit: 2.9 })).toHaveLength(2)
    expect(DebugEngineQuery.listPlans("test-project", { limit: 0 })).toEqual([])
    expect(DebugEngineQuery.listPlans("test-project", { limit: -5 })).toEqual([])
    expect(DebugEngineQuery.listPlans("test-project", { limit: Number.NaN })).toEqual([])
    expect(DebugEngineQuery.listPlans("test-project", { limit: Number.POSITIVE_INFINITY })).toEqual([])
  })

  test("updatePlanStatus only touches the matching project + id", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_target"))
    DebugEngineQuery.insertPlan(planRow("rpl_bystander"))

    DebugEngineQuery.updatePlanStatus("test-project", RefactorPlanID.make("rpl_target"), "applied")
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_target"))?.status).toBe("applied")
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_bystander"))?.status).toBe("pending")

    // Wrong project is a no-op.
    DebugEngineQuery.updatePlanStatus("other-project", RefactorPlanID.make("rpl_target"), "stale")
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_target"))?.status).toBe("applied")
  })

  test("deletePlan removes only the matching project + id", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_gone"))
    DebugEngineQuery.insertPlan(planRow("rpl_kept"))

    DebugEngineQuery.deletePlan("other-project", RefactorPlanID.make("rpl_gone"))
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_gone"))).toBeDefined()

    DebugEngineQuery.deletePlan("test-project", RefactorPlanID.make("rpl_gone"))
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_gone"))).toBeUndefined()
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_kept"))).toBeDefined()
  })

  test("upsertEmbedding replaces on (project, node) collision — newest wins", () => {
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-1"))
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-1", { signature_hash: "sig-v2", dim: 3 }))

    const rows = [...testHost.stores.embeddings.storeFor("test-project").values()]
    expect(rows).toHaveLength(1)
    const found = DebugEngineQuery.getEmbedding("test-project", "node-1")
    expect(found?.signature_hash).toBe("sig-v2")
    expect(found?.dim).toBe(3)
    // A different node in the same project is untouched.
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-2"))
    expect(DebugEngineQuery.getEmbedding("test-project", "node-1")).toBeDefined()
    expect(DebugEngineQuery.getEmbedding("test-project", "node-2")).toBeDefined()
  })

  test("deleteEmbedding and __clearProject are project-scoped", () => {
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-1"))
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-9", { project_id: "other-project" }))
    DebugEngineQuery.insertPlan(planRow("rpl_a"))
    DebugEngineQuery.insertPlan(planRow("rpl_z", { project_id: "other-project" }))

    DebugEngineQuery.deleteEmbedding("other-project", "node-1")
    expect(DebugEngineQuery.getEmbedding("test-project", "node-1")).toBeDefined()

    DebugEngineQuery.__clearProject("test-project")
    expect(DebugEngineQuery.listPlans("test-project")).toEqual([])
    expect(DebugEngineQuery.getEmbedding("test-project", "node-1")).toBeUndefined()
    expect(DebugEngineQuery.listPlans("other-project")).toHaveLength(1)
    expect(DebugEngineQuery.getEmbedding("other-project", "node-9")).toBeDefined()
  })

  test("a failing store write throws and persists nothing", () => {
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-1"))
    const before = DebugEngineQuery.getEmbedding("test-project", "node-1")

    // upsertEmbedding writes through the embedding repo directly; a
    // commit-time failure must throw and the existing row stays intact.
    testHost.stores.hooks.beforeEmbeddingWrite = () => {
      throw new Error("simulated disk failure")
    }
    expect(() => DebugEngineQuery.upsertEmbedding(embeddingRow("node-1", { signature_hash: "sig-v2" }))).toThrow(
      "simulated disk failure",
    )
    expect(DebugEngineQuery.getEmbedding("test-project", "node-1")?.signature_hash).toBe(before?.signature_hash)
  })

  test("host repo failures propagate and persist nothing", () => {
    testHost.stores.hooks.beforePlanWrite = () => {
      throw new Error("database unavailable")
    }
    expect(() => DebugEngineQuery.insertPlan(planRow("rpl_never"))).toThrow("database unavailable")
    expect(testHost.stores.plans.storeFor("test-project").size).toBe(0)
    testHost.stores.hooks.beforePlanWrite = undefined
    expect(DebugEngineQuery.getPlan("test-project", RefactorPlanID.make("rpl_never"))).toBeUndefined()
  })

  test("query functions never publish host events", () => {
    DebugEngineQuery.insertPlan(planRow("rpl_a"))
    DebugEngineQuery.listPlans("test-project")
    DebugEngineQuery.upsertEmbedding(embeddingRow("node-1"))
    DebugEngineQuery.__clearProject("test-project")
    expect(testHost.events.published).toEqual([])
  })
})
