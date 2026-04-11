import { describe, expect, test } from "bun:test"
import { ReplayCompare } from "../../src/replay/compare"
import type { ReplayEvent } from "../../src/replay/event"
import { Risk } from "../../src/risk/score"

describe("replay compare", () => {
  test("summarizes delegated inspect-first edits", () => {
    const evts: ReplayEvent[] = [
      { type: "session.start", sessionID: "ses_a", agent: "build", model: "test/model", directory: "/tmp" },
      { type: "agent.route", sessionID: "ses_a", fromAgent: "build", toAgent: "debug", confidence: 0.91 },
      { type: "tool.call", sessionID: "ses_a", tool: "read", callID: "call_read", input: { filePath: "/tmp/a.ts" } },
      { type: "tool.call", sessionID: "ses_a", tool: "edit", callID: "call_edit", input: { filePath: "/tmp/a.ts" } },
    ]
    const risk = Risk.assess({
      filesChanged: 1,
      linesChanged: 12,
      testCoverage: 1,
      apiEndpointsAffected: 0,
      crossModule: false,
      securityRelated: false,
      validationPassed: true,
      toolFailures: 0,
      totalTools: 2,
    })

    const view = ReplayCompare.view(evts, risk)
    const card = ReplayCompare.score({ risk, view })

    expect(view.plan).toBe("delegated inspect-first incremental edit")
    expect(view.notes).toContain("validation passed")
    expect(card.total).toBe(0.95)
    expect(card.breakdown).toEqual([
      {
        key: "correctness",
        label: "Correctness",
        value: 0.91,
        detail: "validation passed, confidence 0.69, 0 divergences, 0 tool failures",
      },
      { key: "safety", label: "Safety", value: 1, detail: "risk 0/100" },
      { key: "simplicity", label: "Simplicity", value: 0.93, detail: "1 file, 12 lines, 2 tool calls, 1 route" },
      { key: "validation", label: "Validation", value: 1, detail: "validation passed · ready" },
    ])
    expect(ReplayCompare.headline(card)).toBe("decision 0.95 · correctness 0.91 · safety 1.00")
  })

  test("advises the lower-risk validated session", () => {
    const evt: ReplayEvent = {
      type: "tool.call",
      sessionID: "ses_a",
      tool: "edit",
      callID: "call_edit",
      input: { filePath: "/tmp/a.ts" },
    }
    const riskA = Risk.assess({
      filesChanged: 1,
      linesChanged: 20,
      testCoverage: 1,
      apiEndpointsAffected: 0,
      crossModule: false,
      securityRelated: false,
      validationPassed: true,
      toolFailures: 0,
      totalTools: 2,
    })
    const riskB = Risk.assess({
      filesChanged: 6,
      linesChanged: 220,
      testCoverage: 0,
      apiEndpointsAffected: 1,
      crossModule: true,
      securityRelated: false,
      validationPassed: false,
      toolFailures: 1,
      totalTools: 3,
    })

    const viewA = ReplayCompare.view([evt], riskA)
    const viewB = ReplayCompare.view([evt], riskB, {
      divergences: [{ sequence: 1, expected: evt, actual: evt, reason: "mismatch" }],
    })

    const advice = ReplayCompare.advise({
      riskA,
      riskB,
      viewA,
      viewB,
      deepA: { divergences: [] },
      deepB: { divergences: [{ sequence: 1, expected: evt, actual: evt, reason: "mismatch" }] },
    })

    expect(advice.winner).toBe("A")
    expect(advice.confidence).toBeGreaterThan(0.6)
    expect(advice.reasons).toContain("validation passed")
    expect(advice.reasons).toContain("higher decision score")
  })

  test("prefers the narrower semantic change when replay signals are otherwise similar", () => {
    const risk = Risk.assess({
      filesChanged: 2,
      linesChanged: 40,
      testCoverage: 0,
      apiEndpointsAffected: 0,
      crossModule: false,
      securityRelated: false,
      validationPassed: undefined,
      toolFailures: 0,
      totalTools: 2,
    })

    const view = {
      tools: ["read", "edit"],
      routes: [],
      counts: { "tool.call": 2 },
      plan: "inspect-first incremental edit",
      notes: ["validation not recorded"],
    } satisfies ReplayCompare.View

    const advice = ReplayCompare.advise({
      riskA: risk,
      riskB: risk,
      viewA: view,
      viewB: view,
      semanticA: {
        primary: "bug_fix",
        risk: "low",
        headline: "bug fix · a.ts",
        files: 1,
      },
      semanticB: {
        primary: "rewrite",
        risk: "high",
        headline: "rewrite across 3 files",
        files: 3,
      },
    })

    expect(advice.winner).toBe("A")
    expect(advice.reasons).toContain("lower semantic change risk")
    expect(advice.reasons).toContain("avoids a broad rewrite")
  })

  test("ranks session candidates and recommends the strongest branch", () => {
    const riskA = Risk.assess({
      filesChanged: 1,
      linesChanged: 20,
      testCoverage: 1,
      apiEndpointsAffected: 0,
      crossModule: false,
      securityRelated: false,
      validationPassed: true,
      toolFailures: 0,
      totalTools: 2,
    })
    const riskB = Risk.assess({
      filesChanged: 4,
      linesChanged: 160,
      testCoverage: 0,
      apiEndpointsAffected: 1,
      crossModule: true,
      securityRelated: false,
      validationPassed: undefined,
      toolFailures: 0,
      totalTools: 3,
    })

    const ranked = ReplayCompare.rank([
      {
        id: "ses_b",
        title: "rewrite",
        risk: riskB,
        view: {
          tools: ["read", "edit", "edit"],
          routes: [{ from: "build", to: "debug", confidence: 0.92 }],
          counts: { "tool.call": 3 },
          plan: "delegated inspect-first multi-file edit",
          notes: ["validation not recorded"],
        },
      },
      {
        id: "ses_a",
        title: "incremental",
        risk: riskA,
        view: {
          tools: ["read", "edit"],
          routes: [],
          counts: { "tool.call": 2 },
          plan: "inspect-first incremental edit",
          notes: ["validation passed"],
        },
      },
    ])

    expect(ranked.recommended.id).toBe("ses_a")
    expect(ranked.items.map((item) => item.id)).toEqual(["ses_a", "ses_b"])
    expect(ranked.items[0]?.decision.total).toBeGreaterThan(ranked.items[1]!.decision.total)
    expect(ranked.reasons).toContain("higher decision score")
  })
})
