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

describe("GraphFormat high-level rendering", () => {
  function chainedGraph(): ExecutionGraph.Graph {
    return {
      sessionID: "ses_graph_chain",
      nodes: [
        { id: "session-start", type: "session", label: "Start (review)", timestamp: 1, agent: "review" },
        { id: "step-1", type: "step", label: "Step 1", timestamp: 2, stepIndex: 1, duration: 100 },
        { id: "tool-1", type: "tool_call", label: "read: a.ts", timestamp: 3, tool: "read" },
        { id: "step-2", type: "step", label: "Step 2", timestamp: 4, stepIndex: 2, duration: 100 },
        { id: "route-1", type: "agent_route", label: "build", timestamp: 5, agent: "build" },
        { id: "step-3", type: "step", label: "Step 3", timestamp: 6, stepIndex: 3, duration: 100 },
        { id: "session-end", type: "session", label: "End (done)", timestamp: 7 },
      ],
      edges: [
        { from: "session-start", to: "step-1", type: "sequence" },
        { from: "step-1", to: "tool-1", type: "sequence" },
        { from: "tool-1", to: "step-2", type: "sequence" },
        { from: "step-2", to: "route-1", type: "sequence" },
        { from: "route-1", to: "step-3", type: "sequence" },
        { from: "step-3", to: "session-end", type: "sequence" },
        { from: "step-1", to: "tool-1", type: "step_contains" },
      ],
      metadata: {
        duration: 700,
        tokens: { input: 10, output: 5 },
        risk: { level: "LOW", score: 0, summary: "test" },
        // Sorted alphabetically: build sorts before review.
        agents: ["build", "review"],
        tools: ["read"],
        steps: 3,
        errors: 0,
      },
    }
  }

  test("mermaid connects consecutive high-level nodes through tool nodes", () => {
    const output = GraphFormat.mermaid(chainedGraph())
    expect(output).toContain("step_1 --> step_2")
    expect(output).toContain("step_2 --> route_1")
    expect(output).toContain("route_1 --> step_3")
    expect(output).toContain("step_3 --> session_end")
  })

  test("gantt attributes pre-route steps to the session-start agent", () => {
    const output = GraphFormat.gantt(chainedGraph())
    // Step 1/2 ran under review; only step 3 follows the route to build.
    expect(output).toMatch(/section Review\n {4}Step 1/)
  })

  test("svg gantt labels pre-route steps with the session-start agent", () => {
    const output = GraphFormat.svgGantt(chainedGraph())
    expect(output).toContain("Review")
    // agentDisplay maps build -> Dev; the routed step must switch labels.
    expect(output).toContain("Dev")
  })
})
