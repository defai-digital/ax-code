import { describe, expect, test } from "bun:test"
import { branchSection } from "../../src/quality/dre-graph-branch-section"
import type { SessionBranchRank } from "../../src/session/branch"

function item(input: Partial<SessionBranchRank.Item> & { id: string; title: string }): SessionBranchRank.Item {
  return {
    id: input.id,
    title: input.title,
    headline: input.headline ?? "Branch headline",
    current: input.current ?? false,
    recommended: input.recommended ?? false,
    semantic: input.semantic ?? null,
    risk: {
      level: "LOW",
      score: 10,
      confidence: 0.7,
      readiness: "ready",
      summary: "ready",
      breakdown: [],
      evidence: [],
      unknowns: [],
      mitigations: [],
      signals: {
        filesChanged: 1,
        linesChanged: 2,
        testCoverage: 1,
        apiEndpointsAffected: 0,
        crossModule: false,
        securityRelated: false,
        validationState: "passed",
        validationCount: 1,
        validationFailures: 0,
        validationCommands: [],
        toolFailures: 0,
        totalTools: 1,
        diffState: "recorded",
        semanticRisk: null,
        primaryChange: null,
      },
      ...input.risk,
    },
    view: input.view ?? {
      tools: [],
      routes: [],
      counts: {},
      plan: "",
      notes: [],
    },
    decision: input.decision ?? {
      total: 0.82,
      breakdown: [],
    },
  } as SessionBranchRank.Item
}

function family(input?: Partial<SessionBranchRank.Family>): SessionBranchRank.Family {
  const current = item({ id: "current", title: "Current branch", current: true })
  const recommended = input?.recommended ?? item({ id: "recommended", title: "Recommended branch", recommended: true })
  return {
    currentID: "current",
    recommendedID: recommended.id,
    confidence: 0.8,
    reasons: ["Better validation"],
    root: { id: "root", title: "Root" },
    current: { id: "current", title: "Current branch" },
    recommended,
    items: [current, recommended],
    ...input,
  } as SessionBranchRank.Family
}

describe("quality.dre-graph-branch-section", () => {
  test("renders nothing without branch rank input", () => {
    expect(branchSection()).toBe("")
  })

  test("renders switching summary, badges, scorecard, evidence, and semantic summary", () => {
    const html = branchSection(
      family({
        reasons: ["Safer <reason>&"],
        recommended: item({
          id: "recommended",
          title: "Recommended <branch>",
          recommended: true,
          headline: "Fixes the risky path",
          risk: {
            readiness: "needs_validation",
            evidence: ["Evidence <one>", "Evidence two", "Hidden evidence"],
          } as Partial<SessionBranchRank.Item["risk"]> as SessionBranchRank.Item["risk"],
          decision: {
            total: 0.73,
            breakdown: [
              { key: "correctness", label: "Correctness <score>", value: 0.7, detail: "Good & tested" },
              { key: "safety", label: "Safety", value: 0.35, detail: "" },
            ],
          },
          semantic: {
            headline: "Refactor <summary>",
            additions: 12,
            deletions: 3,
          } as SessionBranchRank.Item["semantic"],
        }),
      }),
    )

    expect(html).toContain(`<section class="band" id="branches">`)
    expect(html).toContain(`Switch to <strong>Recommended &lt;branch&gt;</strong> — Safer &lt;reason&gt;&amp;`)
    expect(html).toContain(`<span class="chip low">recommended</span>`)
    expect(html).toContain(`<div class="branch-readiness medium">`)
    expect(html).toContain(`<span>Needs validation</span>`)
    expect(html).toContain(`<span class="branch-score-chip">73/100</span>`)
    expect(html).toContain(`Correctness &lt;score&gt;`)
    expect(html).toContain(`Good &amp; tested`)
    expect(html).toContain(`Evidence &lt;one&gt;`)
    expect(html).not.toContain(`Hidden evidence`)
    expect(html).toContain(`Refactor &lt;summary&gt; <span class="muted">(+12 / -3)</span>`)
  })

  test("renders current-branch summary when already on recommended branch", () => {
    const recommended = item({ id: "same", title: "Same branch", current: true, recommended: true })
    const html = branchSection(
      family({
        current: { id: "same", title: "Same branch" } as SessionBranchRank.Family["current"],
        recommended,
        items: [recommended],
        reasons: ["Already best"],
      }),
    )

    expect(html).toContain(`You're on the recommended branch · Already best`)
    expect(html).not.toContain("branch-compare")
  })
})
