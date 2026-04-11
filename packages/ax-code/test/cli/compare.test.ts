import { describe, expect, test } from "bun:test"
import { CompareView } from "../../src/cli/cmd/compare"
import { SessionCompare } from "../../src/session/compare"

describe("compare view", () => {
  test("renders decision-level recommendation output", () => {
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
        decision: {
          total: 0.97,
          breakdown: [
            { key: "correctness", label: "Correctness", value: 0.95, detail: "validation passed" },
            { key: "safety", label: "Safety", value: 1, detail: "risk 10/100" },
            { key: "simplicity", label: "Simplicity", value: 0.93, detail: "1 file" },
            { key: "validation", label: "Validation", value: 1, detail: "validation passed" },
          ],
        },
        events: 8,
        plan: "delegated inspect-first incremental edit",
        headline: "decision 0.97 · correctness 0.95 · safety 1.00",
        semantic: {
          headline: "bug fix · demo.ts",
          risk: "low",
          primary: "bug_fix",
          files: 1,
          additions: 4,
          deletions: 1,
          counts: [{ kind: "bug_fix", count: 1 }],
          signals: ["5 lines touched"],
          changes: [
            {
              file: "/tmp/demo.ts",
              status: "modified",
              kind: "bug_fix",
              risk: "low",
              summary: "bug fix · demo.ts",
              additions: 4,
              deletions: 1,
              signals: ["5 lines touched"],
            },
          ],
        },
      },
      session2: {
        id: "ses_b",
        title: "risky",
        risk: {
          level: "HIGH",
          score: 55,
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
          summary: "4 files changed, no test coverage, 1 API endpoints, validation failed, 1 tool failures",
          breakdown: [],
        },
        decision: {
          total: 0.43,
          breakdown: [
            { key: "correctness", label: "Correctness", value: 0.25, detail: "validation failed" },
            { key: "safety", label: "Safety", value: 0.41, detail: "risk 55/100" },
            { key: "simplicity", label: "Simplicity", value: 0.52, detail: "4 files" },
            { key: "validation", label: "Validation", value: 0, detail: "validation failed" },
          ],
        },
        events: 11,
        plan: "delegated inspect-first multi-file edit",
        headline: "decision 0.43 · correctness 0.25 · safety 0.41",
        semantic: {
          headline: "rewrite · risky.ts",
          risk: "high",
          primary: "rewrite",
          files: 4,
          additions: 130,
          deletions: 4,
          counts: [{ kind: "rewrite", count: 4 }],
          signals: ["134 lines touched"],
          changes: [
            {
              file: "/tmp/risky.ts",
              status: "modified",
              kind: "rewrite",
              risk: "high",
              summary: "rewrite · risky.ts",
              additions: 130,
              deletions: 4,
              signals: ["134 lines touched"],
            },
          ],
        },
      },
      differences: {
        toolChainDiffers: true,
        routeDiffers: true,
        eventCountDelta: 3,
      },
      advisory: {
        winner: "A",
        confidence: 0.87,
        reasons: ["validation passed", "lower risk score", "higher decision score"],
      },
      decision: {
        winner: "A",
        confidence: 0.87,
        recommendation: "Prefer safe",
        reasons: ["validation passed", "lower risk score", "higher decision score"],
        differences: [
          "strategy: delegated inspect-first incremental edit vs delegated inspect-first multi-file edit",
          "decision score: 0.97 vs 0.43",
          "risk: 10/100 vs 55/100",
        ],
        session1: {
          title: "safe",
          plan: "delegated inspect-first incremental edit",
          headline: "decision 0.97 · correctness 0.95 · safety 1.00",
          change: "bug fix · demo.ts",
          validation: "validation passed",
        },
        session2: {
          title: "risky",
          plan: "delegated inspect-first multi-file edit",
          headline: "decision 0.43 · correctness 0.25 · safety 0.41",
          change: "rewrite · risky.ts",
          validation: "validation failed",
        },
      },
      analysis: {
        session1: {
          tools: ["read", "edit"],
          routes: [{ from: "build", to: "debug", confidence: 0.92 }],
          counts: { "tool.call": 2 },
          plan: "delegated inspect-first incremental edit",
          notes: ["validation passed"],
          decision: {
            total: 0.97,
            breakdown: [
              { key: "correctness", label: "Correctness", value: 0.95, detail: "validation passed" },
              { key: "safety", label: "Safety", value: 1, detail: "risk 10/100" },
              { key: "simplicity", label: "Simplicity", value: 0.93, detail: "1 file" },
              { key: "validation", label: "Validation", value: 1, detail: "validation passed" },
            ],
          },
          headline: "decision 0.97 · correctness 0.95 · safety 1.00",
        },
        session2: {
          tools: ["read", "edit", "bash"],
          routes: [{ from: "build", to: "security", confidence: 0.71 }],
          counts: { "tool.call": 3 },
          plan: "delegated inspect-first multi-file edit",
          notes: ["validation failed", "1 tool failures"],
          decision: {
            total: 0.43,
            breakdown: [
              { key: "correctness", label: "Correctness", value: 0.25, detail: "validation failed" },
              { key: "safety", label: "Safety", value: 0.41, detail: "risk 55/100" },
              { key: "simplicity", label: "Simplicity", value: 0.52, detail: "4 files" },
              { key: "validation", label: "Validation", value: 0, detail: "validation failed" },
            ],
          },
          headline: "decision 0.43 · correctness 0.25 · safety 0.41",
        },
      },
    } satisfies SessionCompare.Result

    const lines = CompareView.decisionLines(result)

    expect(lines.join("\n")).toContain("Decision Diff")
    expect(lines.join("\n")).toContain("Recommendation: Prefer safe")
    expect(lines.join("\n")).toContain("A: safe")
    expect(lines.join("\n")).toContain("validation passed")
    expect(lines.join("\n")).toContain("strategy: delegated inspect-first incremental edit vs delegated inspect-first multi-file edit")
  })
})
