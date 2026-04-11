import { describe, expect, test } from "bun:test"
import { SessionDre } from "../../src/cli/cmd/tui/routes/session/dre"
import { Risk } from "../../src/risk/score"

describe("tui session dre helpers", () => {
  test("summarizes execution, plan, and drivers for the sidebar", () => {
    const risk = Risk.assess({
      filesChanged: 4,
      linesChanged: 180,
      testCoverage: 0,
      apiEndpointsAffected: 1,
      crossModule: true,
      securityRelated: false,
      validationPassed: undefined,
      toolFailures: 0,
      totalTools: 3,
    })

    const result = SessionDre.summarize({
      graph: {
        sessionID: "ses_1",
        nodes: [{ id: "step-1", type: "step", label: "Step #1", timestamp: 1, stepIndex: 1 }],
        edges: [],
        metadata: {
          duration: 1000,
          tokens: { input: 10, output: 20 },
          risk: { level: risk.level, score: risk.score, summary: risk.summary },
          agents: ["build", "debug"],
          tools: ["read", "edit"],
          steps: 3,
          errors: 1,
        },
      },
      risk,
      view: {
        tools: ["read", "edit"],
        routes: [{ from: "build", to: "debug", confidence: 0.92 }],
        counts: { "tool.call": 2 },
        plan: "delegated inspect-first multi-file edit",
        notes: ["validation not recorded", "1 replay divergence"],
      },
    })

    expect(result).toEqual({
      level: "CRITICAL",
      score: risk.score,
      summary: risk.summary,
      stats: "3 steps · 1 route · 2 tool calls · 1 error",
      decision: "decision 0.44 · correctness 0.55 · safety 0.30",
      plan: "delegated inspect-first multi-file edit",
      notes: ["validation not recorded", "1 replay divergence"],
      drivers: ["Validation coverage · no validation run recorded", "API surface · 1 route files affected"],
    })
  })

  test("returns nothing for empty execution graphs", () => {
    const risk = Risk.assess({
      filesChanged: 0,
      linesChanged: 0,
      testCoverage: 1,
      apiEndpointsAffected: 0,
      crossModule: false,
      securityRelated: false,
      validationPassed: true,
      toolFailures: 0,
      totalTools: 0,
    })

    expect(
      SessionDre.summarize({
        graph: {
          sessionID: "ses_1",
          nodes: [],
          edges: [],
          metadata: {
            duration: 0,
            tokens: { input: 0, output: 0 },
            risk: { level: risk.level, score: risk.score, summary: risk.summary },
            agents: [],
            tools: [],
            steps: 0,
            errors: 0,
          },
        },
        risk,
        view: {
          tools: [],
          routes: [],
          counts: {},
          plan: "read-only investigation",
          notes: [],
        },
      }),
    ).toBeUndefined()
  })

  test("builds searchable detail entries", () => {
    const entries = SessionDre.entries(
      SessionDre.merge(
        {
      level: "MEDIUM",
      score: 35,
      summary: "4 files changed, no test coverage",
      stats: "2 steps · 1 route · 3 tool calls",
      decision: "decision 0.66 · correctness 0.75 · safety 0.65",
      plan: "delegated inspect-first incremental edit",
      notes: ["validation not recorded"],
      drivers: ["Validation coverage · no validation run recorded", "File churn · 4 files changed"],
      breakdown: [
        {
          kind: "tests",
          label: "Validation coverage",
          points: 25,
          detail: "no validation run recorded",
        },
        {
          kind: "files",
          label: "File churn",
          points: 10,
          detail: "4 files changed",
        },
      ],
      scorecard: {
        total: 0.66,
        breakdown: [
          {
            key: "correctness",
            label: "Correctness",
            value: 0.75,
            detail: "validation not recorded, 0 divergences, 0 tool failures",
          },
          { key: "safety", label: "Safety", value: 0.65, detail: "risk 35/100" },
          { key: "simplicity", label: "Simplicity", value: 0.71, detail: "4 files, 80 lines, 3 tool calls, 1 route" },
          { key: "validation", label: "Validation", value: 0.45, detail: "validation not recorded" },
        ],
      },
      duration: 12_000,
      tokens: { input: 120, output: 45 },
      routes: [{ from: "build", to: "debug", confidence: 0.92 }],
      tools: ["read", "grep", "edit"],
      semantic: null,
      counts: [
        { type: "tool.call", count: 3 },
        { type: "agent.route", count: 1 },
      ],
        },
        {
          headline: "bug fix · demo.ts",
          risk: "medium",
          primary: "bug_fix",
          files: 1,
          additions: 6,
          deletions: 2,
          counts: [{ kind: "bug_fix", count: 1 }],
          signals: ["8 lines touched", "runtime path affected"],
          changes: [
            {
              file: "/tmp/demo.ts",
              status: "modified",
              kind: "bug_fix",
              risk: "medium",
              summary: "bug fix · demo.ts",
              additions: 6,
              deletions: 2,
              signals: ["8 lines touched", "runtime path affected"],
            },
          ],
        },
      ),
    )

    expect(entries[0]).toEqual({
      id: "risk",
      title: "Risk medium (35/100)",
      description: "4 files changed, no test coverage",
      footer: "2 steps · 1 route · 3 tool calls · 12s · 120/45 tokens",
      category: "Overview",
    })
    expect(entries.some((item) => item.category === "Changes" && item.title === "bug fix · demo.ts")).toBe(true)
    expect(entries.some((item) => item.category === "Risk" && item.title === "Validation coverage (+25)")).toBe(true)
    expect(entries.some((item) => item.category === "Routing" && item.title === "build → debug")).toBe(true)
    expect(entries.some((item) => item.category === "Score" && item.title === "Decision 0.66")).toBe(true)
    expect(entries.some((item) => item.category === "Tools" && item.title === "3. edit")).toBe(true)
    expect(entries.some((item) => item.category === "Events" && item.title === "tool.call")).toBe(true)
  })

  test("formats execution graphs as timeline lines", () => {
    const lines = SessionDre.timeline({
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
    })

    expect(lines.map((line) => line.text)).toEqual([
      "Duration 1s · Risk low (10/100) · Tokens 20/40",
      "Start (build)",
      "build → debug (confidence 0.92)",
      "Step 1 · 0s · tokens 20/40",
      "read: a.ts → ok (30ms)",
      "LLM stop (120ms)",
      "ToolError: boom",
    ])
  })
})
