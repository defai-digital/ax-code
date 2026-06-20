import { describe, expect, test } from "vitest"
import { indexFingerprint, sessionFingerprint } from "../../src/quality/dre-graph-fingerprint"

describe("quality.dre-graph-fingerprint", () => {
  test("summarizes session list entries for index fingerprints", () => {
    const result: unknown = indexFingerprint([
      {
        id: "ses_parent" as any,
        parentID: undefined,
        title: "Parent",
        time: { created: 1, updated: 2 },
      },
      {
        id: "ses_child" as any,
        parentID: "ses_parent" as any,
        title: "Child",
        time: { created: 3, updated: 4 },
      },
    ])

    expect(result).toEqual([
      { id: "ses_parent", updated: 2, title: "Parent", parentID: null },
      { id: "ses_child", updated: 4, title: "Child", parentID: "ses_parent" },
    ])
  })

  test("summarizes graph, DRE, risk, quality, rank, and rollback state", () => {
    const result: unknown = sessionFingerprint({
      session: {
        id: "ses_main" as any,
        title: "Main Session",
        time: { created: 10, updated: 20 },
      },
      graph: {
        graph: {
          nodes: [{ id: "n1" }, { id: "n2" }],
          edges: [{ from: "n1", to: "n2" }],
          metadata: {
            steps: 2,
            errors: 1,
            duration: 1234,
            tokens: { input: 10, output: 20 },
          },
        },
      } as any,
      dre: {
        timeline: [
          { kind: "heading", text: "timeline" },
          { kind: "step", text: "Step 0 · 1s · tokens 1/2" },
        ],
        detail: {
          score: 42,
          confidence: 0.75,
          readiness: "needs_review",
          stats: "2 steps",
          decision: "Review before accepting",
          routes: [{ agent: "build", reason: "default" }],
          tools: ["read", "bash"],
          notes: ["note"],
          semantic: { headline: "Changed auth" },
        },
      } as any,
      risk: {
        assessment: {
          score: 55,
          level: "HIGH",
          confidence: 0.6,
          readiness: "needs_validation",
          signals: {
            validationState: "partial",
            filesChanged: 3,
            linesChanged: 27,
          },
          evidence: ["e1", "e2"],
          unknowns: ["u1"],
          mitigations: ["m1", "m2"],
        },
        quality: {
          review: {
            overallStatus: "pass",
            readyForBenchmark: true,
            resolvedLabeledItems: 2,
          },
          debug: undefined,
          qa: {
            overallStatus: "fail",
            readyForBenchmark: false,
            resolvedLabeledItems: 1,
          },
        },
      } as any,
      rank: {
        confidence: 0.9,
        recommended: { id: "ses_child" },
        items: [
          { id: "ses_child", decision: { total: 0.8 }, risk: { score: 12 } },
          { id: "ses_main", decision: { total: 0.4 }, risk: { score: 55 } },
        ],
      } as any,
      rollback: [{}, {}] as any,
    })

    expect(result).toEqual({
      session: { id: "ses_main", updated: 20, title: "Main Session" },
      graph: {
        nodes: 2,
        edges: 1,
        steps: 2,
        errors: 1,
        duration: 1234,
        tokens: { input: 10, output: 20 },
      },
      dre: {
        score: 42,
        confidence: 0.75,
        readiness: "needs_review",
        stats: "2 steps",
        decision: "Review before accepting",
        routes: 1,
        tools: 2,
        notes: 1,
        semantic: "Changed auth",
        timeline: 2,
      },
      risk: {
        score: 55,
        level: "HIGH",
        confidence: 0.6,
        readiness: "needs_validation",
        validation: "partial",
        files: 3,
        lines: 27,
        evidence: 2,
        unknowns: 1,
        mitigations: 2,
        quality: {
          review: { status: "pass", ready: true, resolvedLabels: 2 },
          debug: null,
          qa: { status: "fail", ready: false, resolvedLabels: 1 },
        },
      },
      rank: {
        confidence: 0.9,
        recommended: "ses_child",
        items: [
          { id: "ses_child", score: 0.8, risk: 12 },
          { id: "ses_main", score: 0.4, risk: 55 },
        ],
      },
      rollback: 2,
    })
  })
})
