import { describe, expect, test } from "vitest"
import { DebugEngineQuery } from "../../src/debug-engine/query"
import { RefactorPlanID } from "../../src/debug-engine/id"
import { Instance } from "../../src/project/instance"
import type { ProjectID } from "../../src/project/schema"
import { tmpdir } from "../fixture/fixture"

function seedPlan(projectID: ProjectID) {
  const time = Date.now()
  DebugEngineQuery.insertPlan({
    id: RefactorPlanID.ascending(),
    project_id: projectID,
    kind: "other",
    summary: "Test plan",
    edits: [],
    affected_files: [],
    affected_symbols: [],
    risk: "low",
    status: "pending",
    graph_cursor_at_creation: null,
    time_created: time,
    time_updated: time,
  })
}

describe("DebugEngineQuery", () => {
  test("listPlans treats zero limit as no results", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        DebugEngineQuery.__clearProject(projectID)
        seedPlan(projectID)

        expect(DebugEngineQuery.listPlans(projectID, { limit: 0 })).toEqual([])

        DebugEngineQuery.__clearProject(projectID)
      },
    })
  })
})
