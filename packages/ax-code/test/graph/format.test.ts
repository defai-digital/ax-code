import { describe, expect, test } from "bun:test"
import type { ExecutionGraph } from "../../src/graph"
import { GraphFormat } from "../../src/graph/format"

describe("graph format", () => {
  test("formats execution graphs as timeline lines", () => {
    const lines = GraphFormat.timeline({
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

    expect(lines.map((line) => line.text)).toEqual([
      "Duration 1s | Risk low (10/100) | Tokens 20/40",
      "Start (build)",
      "build → debug (confidence 0.92)",
      "Step 1 | 0s | tokens 20/40",
      "read: a.ts -> ok (30ms)",
      "LLM stop (120ms)",
      "ToolError: boom",
    ])
  })

  test("keeps pre-step routes when they share a timestamp with the first step", () => {
    const lines = GraphFormat.timeline({
      sessionID: "ses_1",
      nodes: [
        { id: "session-start", type: "session", label: "Start (build)", timestamp: 1 },
        { id: "route-1", type: "agent_route", label: "build → debug", timestamp: 2, confidence: 0.92 },
        { id: "step-1", type: "step", label: "Step #1", timestamp: 2, stepIndex: 1 },
      ],
      edges: [],
      metadata: {
        duration: 0,
        tokens: { input: 0, output: 0 },
        risk: { level: "LOW", score: 0, summary: "minimal change" },
        agents: ["build", "debug"],
        tools: [],
        steps: 1,
        errors: 0,
      },
    })

    expect(lines.map((line) => line.text)).toEqual([
      "Duration 0s | Risk low (0/100) | Tokens 0/0",
      "Start (build)",
      "build → debug (confidence 0.92)",
      "Step 1",
    ])
  })

  test("formats execution graphs as topology lines", () => {
    const graph: ExecutionGraph.Graph = {
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
    const lines = GraphFormat.topology(graph)

    expect(lines).toEqual([
      "Duration 1s | Steps 1 | Tools 1 | Errors 1",
      "Critical path: Start (build) → build → debug → Step #1 → read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
      "Step 1 flow: read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
      "Call/result: read: a.ts → read ok",
    ])

    expect(GraphFormat.topologyLines(graph)).toEqual([
      { kind: "heading", text: "Duration 1s | Steps 1 | Tools 1 | Errors 1" },
      {
        kind: "path",
        text: "Critical path: Start (build) → build → debug → Step #1 → read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
        nodes: ["Start (build)", "build → debug", "Step #1", "read: a.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
      },
      {
        kind: "step",
        stepIndex: 1,
        text: "Step 1 flow: read: a.ts → read ok → LLM stop (120ms) → ToolError: boom",
        nodes: ["read: a.ts", "read ok", "LLM stop (120ms)", "ToolError: boom"],
      },
      {
        kind: "pair",
        text: "Call/result: read: a.ts → read ok",
        call: "read: a.ts",
        result: "read ok",
      },
    ])
  })

  test("formats execution graphs as ascii graph lines", () => {
    const lines = GraphFormat.ascii({
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
        { from: "session-start", to: "route-1", type: "sequence" },
        { from: "route-1", to: "step-1", type: "sequence" },
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

    const pad = " ".repeat("[Start (build)] -> [build → debug] -> ".length)

    expect(lines).toEqual([
      "Duration 1s | Risk low (10/100) | Tokens 20/40",
      "[Start (build)] -> [build → debug] -> [Step #1]",
      `${pad}|-> [read: a.ts] => [read ok]`,
      `${pad}|-> [LLM stop (120ms)]`,
      `${pad}\`-> [ToolError: boom]`,
    ])
  })
})
