import { describe, expect, test } from "bun:test"
import { SessionGraph } from "../../src/cli/cmd/tui/routes/session/graph"

describe("tui session graph helpers", () => {
  test("builds searchable entries from execution graphs", () => {
    const entries = SessionGraph.entries({
      sessionID: "ses_1",
      nodes: [
        { id: "session-start", type: "session", label: "Start (build)", timestamp: 1 },
        { id: "route-1", type: "agent_route", label: "build → debug", timestamp: 2, confidence: 0.92 },
        {
          id: "step-1",
          type: "step",
          label: "Step #1",
          timestamp: 3,
          stepIndex: 1,
          duration: 800,
          tokens: { input: 20, output: 40 },
        },
        { id: "call-1", type: "tool_call", label: "read: a.ts", timestamp: 4, callID: "1", tool: "read" },
        {
          id: "result-1",
          type: "tool_result",
          label: "read ok",
          timestamp: 5,
          duration: 30,
          status: "ok",
          callID: "1",
          tool: "read",
        },
        {
          id: "llm-1",
          type: "llm",
          label: "LLM stop (120ms)",
          timestamp: 6,
          duration: 120,
          tokens: { input: 20, output: 40 },
        },
        { id: "error-1", type: "error", label: "ToolError: boom", timestamp: 7, status: "error" },
      ],
      edges: [
        { from: "step-1", to: "call-1", type: "step_contains" },
        { from: "call-1", to: "result-1", type: "call_result" },
        { from: "step-1", to: "result-1", type: "step_contains" },
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
    })

    expect(entries[0]).toEqual({
      id: "summary",
      title: "7 nodes · 5 edges",
      description: "Risk low (10/100) · 1 step · 1 tool · 1 error",
      footer: "1s · 20/40 tokens",
      category: "Overview",
    })
    expect(entries.some((item) => item.category === "Routing" && item.title === "build → debug")).toBe(true)
    expect(entries.some((item) => item.category === "Steps" && item.title === "Step 1" && item.description === "4 child events")).toBe(true)
    expect(entries.some((item) => item.category === "Tools" && item.title === "read: a.ts" && item.description === "ok")).toBe(true)
    expect(entries.some((item) => item.category === "LLM" && item.title === "LLM stop (120ms)" && item.description === "20/40 tokens")).toBe(true)
    expect(entries.some((item) => item.category === "Errors" && item.title === "ToolError: boom")).toBe(true)
    expect(
      entries.some(
        (item) =>
          item.category === "Topology" &&
          item.title === "Critical path" &&
          item.description === "Start (build) → build → debug → Step #1 → read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
      ),
    ).toBe(true)
    expect(
      entries.some(
        (item) =>
          item.category === "Topology" &&
          item.title === "Step 1 flow" &&
          item.description === "read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
      ),
    ).toBe(true)
    expect(
      entries.some(
        (item) =>
          item.category === "Topology" &&
          item.title === "read: a.ts" &&
          item.description === "read ok" &&
          item.footer === "call → result",
      ),
    ).toBe(true)
  })

  test("builds ascii graph lines from execution graphs", () => {
    const lines = SessionGraph.ascii({
      sessionID: "ses_1",
      nodes: [
        { id: "session-start", type: "session", label: "Start (build)", timestamp: 1 },
        { id: "route-1", type: "agent_route", label: "build → debug", timestamp: 2, confidence: 0.92 },
        {
          id: "step-1",
          type: "step",
          label: "Step #1",
          timestamp: 3,
          stepIndex: 1,
          duration: 800,
          tokens: { input: 20, output: 40 },
        },
        { id: "call-1", type: "tool_call", label: "read: a.ts", timestamp: 4, callID: "1", tool: "read" },
        {
          id: "result-1",
          type: "tool_result",
          label: "read ok",
          timestamp: 5,
          duration: 30,
          status: "ok",
          callID: "1",
          tool: "read",
        },
        {
          id: "llm-1",
          type: "llm",
          label: "LLM stop (120ms)",
          timestamp: 6,
          duration: 120,
          tokens: { input: 20, output: 40 },
        },
      ],
      edges: [
        { from: "session-start", to: "route-1", type: "sequence" },
        { from: "route-1", to: "step-1", type: "sequence" },
        { from: "step-1", to: "call-1", type: "step_contains" },
        { from: "call-1", to: "result-1", type: "call_result" },
        { from: "step-1", to: "result-1", type: "step_contains" },
        { from: "step-1", to: "llm-1", type: "step_contains" },
      ],
      metadata: {
        duration: 1200,
        tokens: { input: 20, output: 40 },
        risk: { level: "LOW", score: 10, summary: "minimal change" },
        agents: ["build", "debug"],
        tools: ["read"],
        steps: 1,
        errors: 0,
      },
    })

    const pad = " ".repeat("[Start (build)] -> [build → debug] -> ".length)

    expect(lines).toEqual([
      "Duration 1s | Risk low (10/100) | Tokens 20/40",
      "[Start (build)] -> [build → debug] -> [Step #1]",
      `${pad}|-> [read: a.ts] => [read ok]`,
      `${pad}\`-> [LLM stop (120ms)]`,
    ])
  })
})
