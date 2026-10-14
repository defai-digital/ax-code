import { describe, expect, test } from "vitest"
import type { ExecutionGraph } from "../../src/graph"
import { GraphFormat } from "../../src/graph/format"

function graph(): ExecutionGraph.Graph {
  return {
    sessionID: "ses_graph_format",
    nodes: [
      { id: "step-1", type: "step", label: "Step 1", timestamp: 1, stepIndex: 1, duration: 250 },
      { id: "tool-1", type: "tool_call", label: "read: a.ts", timestamp: 2, tool: "read" },
      { id: "res-1", type: "tool_result", label: "read: a.ts", timestamp: 3 },
    ],
    edges: [
      { from: "step-1", to: "tool-1", type: "step_contains" },
      { from: "step-1", to: "res-1", type: "step_contains" },
    ],
    metadata: {
      duration: 250,
      tokens: { input: 10, output: 5 },
      risk: { level: "LOW", score: 0, summary: "test" },
      agents: [],
      tools: ["read"],
      steps: 1,
      errors: 0,
    },
  }
}

describe("GraphFormat.mermaid step labels", () => {
  test("counts tool calls, not their result rows, in the step label", () => {
    const output = GraphFormat.mermaid(graph())
    // One tool call plus its result row is one tool, not two.
    expect(output).toContain("Step 1 · 1 tools")
    expect(output).not.toContain("2 tools")
  })
})
