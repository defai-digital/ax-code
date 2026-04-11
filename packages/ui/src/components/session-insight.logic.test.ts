import { describe, expect, test } from "bun:test"
import type { SessionCompareResult } from "@ax-code/sdk/v2"
import {
  sessionCompareDelta,
  sessionCompareFacts,
  sessionCompareLead,
  sessionInsightDuration,
  sessionInsightVariant,
  sessionRollbackFacts,
  sessionRollbackLead,
  sessionRollbackToolLead,
} from "./session-insight.logic"

const result = {
  session1: {
    id: "ses_a",
    title: "safe",
    risk: {
      level: "LOW",
      score: 10,
      signals: {
        filesChanged: 1,
        linesChanged: 12,
        testCoverage: 1,
        apiEndpointsAffected: 0,
        crossModule: false,
        securityRelated: false,
        validationPassed: true,
        toolFailures: 0,
        totalTools: 2,
      },
      summary: "minimal change",
      breakdown: [],
    },
    decision: { total: 0.97, breakdown: [] },
    events: 8,
    plan: "inspect-first incremental edit",
    headline: "decision 0.97",
    semantic: null,
  },
  session2: {
    id: "ses_b",
    title: "risky",
    risk: {
      level: "HIGH",
      score: 72,
      signals: {
        filesChanged: 4,
        linesChanged: 180,
        testCoverage: 0,
        apiEndpointsAffected: 1,
        crossModule: true,
        securityRelated: false,
        validationPassed: false,
        toolFailures: 1,
        totalTools: 3,
      },
      summary: "broad change",
      breakdown: [],
    },
    decision: { total: 0.44, breakdown: [] },
    events: 11,
    plan: "multi-file rewrite",
    headline: "decision 0.44",
    semantic: null,
  },
  differences: {
    toolChainDiffers: true,
    routeDiffers: true,
    eventCountDelta: 3,
  },
  advisory: {
    winner: "A",
    confidence: 0.83,
    reasons: ["lower risk", "higher decision score"],
  },
  decision: {
    winner: "A",
    confidence: 0.83,
    recommendation: "Prefer safe",
    reasons: ["lower risk", "higher decision score"],
    differences: ["strategy: inspect-first incremental edit vs multi-file rewrite"],
    session1: {
      title: "safe",
      plan: "inspect-first incremental edit",
      headline: "decision 0.97",
      change: null,
      validation: "validation passed",
    },
    session2: {
      title: "risky",
      plan: "multi-file rewrite",
      headline: "decision 0.44",
      change: null,
      validation: "validation failed",
    },
  },
  analysis: {
    session1: {
      tools: ["read", "edit"],
      routes: [],
      counts: {},
      plan: "inspect-first incremental edit",
      notes: ["validation passed"],
      decision: { total: 0.97, breakdown: [] },
      headline: "decision 0.97",
    },
    session2: {
      tools: ["read", "edit", "bash"],
      routes: [{ from: "build", to: "debug", confidence: 0.91 }],
      counts: {},
      plan: "multi-file rewrite",
      notes: ["validation failed"],
      decision: { total: 0.44, breakdown: [] },
      headline: "decision 0.44",
    },
  },
} satisfies SessionCompareResult

const point = {
  step: 2,
  messageID: "msg_2",
  partID: "prt_2",
  duration: 12_000,
  tokens: {
    input: 18,
    output: 6,
  },
  tools: ["read: demo.ts", "edit: demo.ts"],
  kinds: ["read", "edit"],
}

describe("session-insight.logic", () => {
  test("maps risk levels to card variants", () => {
    expect(sessionInsightVariant("LOW")).toBe("success")
    expect(sessionInsightVariant("MEDIUM")).toBe("warning")
    expect(sessionInsightVariant("HIGH")).toBe("error")
    expect(sessionInsightVariant()).toBe("normal")
  })

  test("formats durations and compare lead text", () => {
    expect(sessionInsightDuration(12_000)).toBe("12s")
    expect(sessionInsightDuration(125_000)).toBe("2m 5s")
    expect(sessionCompareLead(result)).toBe("Prefer safe")
    expect(sessionCompareLead({ ...result, advisory: { ...result.advisory, winner: "tie" } })).toBe(
      "No clear recommendation",
    )
  })

  test("summarizes comparison facts and deltas", () => {
    expect(sessionCompareFacts(result.session1)).toEqual(["1 file", "12 lines", "8 events"])
    expect(sessionCompareDelta(result)).toEqual(["tool chain changed", "routing changed", "+3 events"])
  })

  test("summarizes rollback points", () => {
    expect(sessionRollbackLead([])).toBe("No rollback points recorded")
    expect(sessionRollbackLead([point])).toBe("1 rollback point at step 2")
    expect(sessionRollbackLead([point, { ...point, step: 4 }])).toBe("2 rollback points from step 2 to 4")
    expect(sessionRollbackFacts(point)).toEqual(["step 2", "12s", "18/6 tokens", "2 tools"])
    expect(sessionRollbackToolLead(point)).toBe("read: demo.ts +1 more")
    expect(sessionRollbackToolLead({ ...point, tools: [] })).toBe("No tool calls recorded")
  })
})
