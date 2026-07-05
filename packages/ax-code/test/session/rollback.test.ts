import { describe, expect, test } from "vitest"
import type { ExecutionGraph } from "../../src/graph"
import { SessionRollback } from "../../src/session/rollback"
import { MessageID, PartID } from "../../src/session/schema"

function graph(): ExecutionGraph.Graph {
  return {
    sessionID: "ses_rollback",
    nodes: [
      {
        id: "step-1",
        type: "step",
        label: "Step 1",
        timestamp: 1,
        stepIndex: 1,
        duration: 250,
        tokens: { input: 10, output: 5 },
      },
      {
        id: "tool-read-1",
        type: "tool_call",
        label: "read: src/app.ts",
        timestamp: 2,
        tool: "read",
      },
      {
        id: "tool-edit",
        type: "tool_call",
        label: "edit: src/app.ts",
        timestamp: 3,
        tool: "edit",
      },
      {
        id: "tool-read-2",
        type: "tool_call",
        label: "read: src/config.ts",
        timestamp: 4,
        tool: "read",
      },
    ],
    edges: [
      { from: "step-1", to: "tool-read-1", type: "step_contains" },
      { from: "step-1", to: "tool-edit", type: "step_contains" },
      { from: "step-1", to: "tool-read-2", type: "step_contains" },
    ],
    metadata: {
      duration: 250,
      tokens: { input: 10, output: 5 },
      risk: { level: "LOW", score: 0, summary: "test" },
      agents: [],
      tools: ["read", "edit"],
      steps: 1,
      errors: 0,
    },
  }
}

describe("SessionRollback.detail", () => {
  test("deduplicates tool kinds while preserving labels and order", () => {
    const [point] = SessionRollback.detail({
      points: [
        {
          step: 1,
          messageID: MessageID.make("msg_rollback"),
          partID: PartID.make("part_rollback"),
          tools: [],
          kinds: [],
        },
      ],
      graph: graph(),
    })

    expect(point).toMatchObject({
      duration: 250,
      tokens: { input: 10, output: 5 },
      tools: ["read: src/app.ts", "edit: src/app.ts", "read: src/config.ts"],
      kinds: ["read", "edit"],
    })
  })
})
