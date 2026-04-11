import { describe, expect, test } from "bun:test"
import type { ExecutionGraph, ExecutionGraphTopologyLine } from "@ax-code/sdk/v2"
import { sessionGraphLayout } from "./session-graph.logic"

const graph: ExecutionGraph = {
  sessionID: "ses_1",
  nodes: [
    { id: "session-start", type: "session", label: "Start (build)", timestamp: 1 },
    { id: "route-1", type: "agent_route", label: "build → debug", timestamp: 2, confidence: 0.92 },
    { id: "step-1", type: "step", label: "Step #1", timestamp: 3, stepIndex: 1, duration: 800, tokens: { input: 20, output: 40 } },
    { id: "call-1", type: "tool_call", label: "read: demo.ts", timestamp: 4, callID: "1", tool: "read" },
    { id: "result-1", type: "tool_result", label: "read ok", timestamp: 5, duration: 30, status: "ok", callID: "1", tool: "read" },
    { id: "llm-1", type: "llm", label: "LLM stop (120ms)", timestamp: 6, duration: 120, tokens: { input: 20, output: 40 } },
    { id: "error-1", type: "error", label: "ToolError: boom", timestamp: 7, status: "error" },
  ],
  edges: [
    { from: "session-start", to: "route-1", type: "sequence" },
    { from: "route-1", to: "step-1", type: "sequence" },
    { from: "step-1", to: "call-1", type: "step_contains" },
    { from: "call-1", to: "result-1", type: "call_result" },
    { from: "step-1", to: "llm-1", type: "step_contains" },
    { from: "step-1", to: "error-1", type: "step_contains" },
  ],
  metadata: {
    duration: 1200,
    tokens: { input: 20, output: 40 },
    risk: { level: "LOW", score: 10, summary: "minimal change" },
    agents: ["build", "debug"],
    tools: ["read"],
    steps: 1,
    errors: 1,
  },
}

const topology: ExecutionGraphTopologyLine[] = [
  { kind: "heading", text: "Duration 1s | Steps 1 | Tools 1 | Errors 1" },
  {
    kind: "path",
    text: "Critical path: Start (build) → build → debug → Step #1 → read: demo.ts → read ok → LLM stop (120ms) → ToolError: boom",
    nodes: ["Start (build)", "build → debug", "Step #1", "read: demo.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
  },
  {
    kind: "step",
    stepIndex: 1,
    text: "Step 1 flow: read: demo.ts → read ok → LLM stop (120ms) → ToolError: boom",
    nodes: ["read: demo.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
  },
  {
    kind: "pair",
    text: "Call/result: read: demo.ts → read ok",
    call: "read: demo.ts",
    result: "read ok",
  },
]

describe("session-graph.logic", () => {
  test("lays out nodes, edges, and critical path markers", () => {
    const out = sessionGraphLayout(graph, topology)

    expect(out.width).toBeGreaterThan(700)
    expect(out.height).toBeGreaterThan(300)
    expect(out.path).toBe("Start (build) → build → debug → Step #1 → read: demo.ts → read ok → LLM stop (120ms) → ToolError: boom")
    expect(out.nodes.find((item) => item.id === "session-start")).toMatchObject({ x: 24, y: 24, critical: true })
    expect(out.nodes.find((item) => item.id === "call-1")).toMatchObject({ y: 100, critical: true })
    expect(out.nodes.find((item) => item.id === "result-1")).toMatchObject({ y: 176, critical: true })
    expect(out.nodes.find((item) => item.id === "error-1")).toMatchObject({ y: 328, critical: true })
    expect(out.edges.find((item) => item.type === "call_result")).toMatchObject({ from: "call-1", to: "result-1" })
  })
})
