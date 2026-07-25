import { describe, expect, test } from "vitest"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { CodeIntelligence } from "../../src/code-intelligence"
import { CodeGraphQuery } from "../../src/code-intelligence/query"
import { CodeNodeID, CodeEdgeID } from "../../src/code-intelligence/id"
import { highlightLines } from "../../src/cli/cmd/index-graph"
import type { ProjectID } from "../../src/project/schema"

Log.init({ print: false })

// Degree-based orientation report over code_edge: top fan-in ("god
// nodes") and top fan-out. v1 is deterministic SQL aggregation — no
// clustering — so the test seeds a tiny star-shaped graph and checks
// ordering, hydration, and that dangling edge endpoints are dropped.

function seedNode(projectID: ProjectID, name: string, file: string) {
  const t = Date.now()
  const id = CodeNodeID.ascending()
  CodeGraphQuery.insertNode({
    id,
    project_id: projectID,
    kind: "function",
    name,
    qualified_name: name,
    file,
    range_start_line: 0,
    range_start_char: 0,
    range_end_line: 5,
    range_end_char: 0,
    signature: null,
    visibility: null,
    metadata: null,
    time_created: t,
    time_updated: t,
  })
  return id
}

function seedEdge(projectID: ProjectID, from: CodeNodeID, to: CodeNodeID, file: string) {
  const t = Date.now()
  CodeGraphQuery.insertEdge({
    id: CodeEdgeID.ascending(),
    project_id: projectID,
    kind: "calls",
    from_node: from,
    to_node: to,
    file,
    range_start_line: 1,
    range_start_char: 0,
    range_end_line: 1,
    range_end_char: 10,
    time_created: t,
    time_updated: t,
  })
}

describe("CodeGraphQuery.graphHighlights", () => {
  test("ranks fan-in and fan-out by degree and drops dangling endpoints", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        CodeIntelligence.__clearProject(projectID)
        try {
          const file = path.join(tmp.path, "core.ts")
          const hub = seedNode(projectID, "hub", file)
          const orchestrator = seedNode(projectID, "orchestrator", file)
          const helperA = seedNode(projectID, "helperA", file)
          const helperB = seedNode(projectID, "helperB", file)

          // hub is called by everyone (fan-in 3); orchestrator calls
          // everyone (fan-out 3, including one dangling target).
          seedEdge(projectID, orchestrator, hub, file)
          seedEdge(projectID, helperA, hub, file)
          seedEdge(projectID, helperB, hub, file)
          seedEdge(projectID, orchestrator, helperA, file)
          seedEdge(projectID, orchestrator, CodeNodeID.ascending(), file) // dangling to_node

          const highlights = CodeGraphQuery.graphHighlights(projectID, 3)
          expect(highlights).toBeDefined()

          expect(highlights!.nodeKinds).toMatchObject({ function: 4 })
          expect(highlights!.edgeKinds).toMatchObject({ calls: 5 })

          expect(highlights!.topFanIn[0]?.node.name).toBe("hub")
          expect(highlights!.topFanIn[0]?.degree).toBe(3)
          // The dangling to_node occupied a ranking slot but hydrates to
          // no node, so it is dropped rather than rendered blank.
          expect(highlights!.topFanIn.every((entry) => entry.node.name.length > 0)).toBe(true)

          expect(highlights!.topFanOut[0]?.node.name).toBe("orchestrator")
          expect(highlights!.topFanOut[0]?.degree).toBe(3)

          const lines = highlightLines(highlights!, tmp.path)
          expect(lines.some((line) => line.includes("hub") && line.includes("3 edges"))).toBe(true)
          expect(lines.some((line) => line.includes("core.ts"))).toBe(true)
        } finally {
          CodeIntelligence.__clearProject(projectID)
        }
      },
    })
  })
})
