import { describe, expect, test } from "vitest"
import { summary } from "../../src/quality/dre-graph-summary-section"
import type { SessionDre } from "../../src/session/dre"
import type { SessionGraph } from "../../src/session/graph"
import type { SessionRisk } from "../../src/session/risk"

function graph(meta?: Partial<SessionGraph.Snapshot["graph"]["metadata"]>): SessionGraph.Snapshot {
  return {
    graph: {
      metadata: {
        steps: 3,
        tools: ["read", "edit"],
        errors: 0,
        ...meta,
      },
    },
  } as SessionGraph.Snapshot
}

function risk(input?: Partial<SessionRisk.Detail["assessment"]>): SessionRisk.Detail {
  return {
    assessment: {
      level: "LOW",
      score: 12,
      confidence: 0.81,
      readiness: "ready",
      signals: {
        filesChanged: 2,
        linesChanged: 42,
      },
      ...input,
    },
  } as SessionRisk.Detail
}

function dre(detail?: Partial<NonNullable<SessionDre.Snapshot["detail"]>>): SessionDre.Snapshot {
  return {
    detail: detail
      ? {
          decision: "Accept",
          plan: "Ship it",
          duration: 125_000,
          level: "MEDIUM",
          score: 55,
          tokens: { input: 1200, output: 300 },
          semantic: null,
          ...detail,
        }
      : null,
  } as SessionDre.Snapshot
}

describe("quality.dre-graph-summary-section", () => {
  test("renders no-detail summary with risk fallback", () => {
    const html = summary({ dre: dre(), risk: risk({ level: "HIGH", score: 88 }), graph: graph() })

    expect(html).toContain(`<section class="summary" id="summary">`)
    expect(html).toContain("No DRE analysis available yet")
    expect(html).toContain(`stroke="#ef4444"`)
    expect(html).toContain(`>88</text>`)
    expect(html).not.toContain("summary-stats")
  })

  test("renders detail stats and token donut", () => {
    const html = summary({
      dre: dre({ decision: `Accept <now>`, plan: `Run & merge`, duration: 125_000 }),
      risk: risk({ confidence: 0.61, readiness: "needs_validation" }),
      graph: graph({ steps: 4, tools: ["read", "edit", "bash"], errors: 2 }),
    })

    expect(html).toContain("Accept &lt;now&gt;")
    expect(html).toContain("Run &amp; merge")
    expect(html).toContain(`<span class="stat-label">Steps</span><strong class="stat-value">4</strong>`)
    expect(html).toContain(`<span class="stat-label">Tools</span><strong class="stat-value">3</strong>`)
    expect(html).toContain(`<span class="stat-label">Duration</span><strong class="stat-value">2m 5s</strong>`)
    expect(html).toContain(`<span class="stat-label">Confidence</span><strong class="stat-value">61%</strong>`)
    expect(html).toContain(`<span class="stat-label">Ready</span><strong class="stat-value">needs validation</strong>`)
    expect(html).toContain(`<span class="stat-label">Errors</span><strong class="stat-value">2</strong>`)
    expect(html).toContain(`<div class="donut-wrap">`)
    expect(html).toContain(`<span>Input</span><strong>1,200</strong>`)
    expect(html).toContain(`<span>Output</span><strong>300</strong>`)
  })

  test("renders escaped semantic banner and only first three signals", () => {
    const html = summary({
      dre: dre({
        semantic: {
          headline: `Changed <api>& flow`,
          risk: "high",
          files: 2,
          additions: 10,
          deletions: 4,
          signals: ["one", "two <x>", "three", "four"],
        } as any,
      }),
      risk: risk(),
      graph: graph(),
    })

    expect(html).toContain(`<span class="semantic-text">Changed &lt;api&gt;&amp; flow</span>`)
    expect(html).toContain(`<span class="chip high">high risk</span>`)
    expect(html).toContain(`<span class="chip neutral">2 files</span>`)
    expect(html).toContain(`<span class="chip neutral">+10</span>`)
    expect(html).toContain(`<span class="chip neutral">-4</span>`)
    expect(html).toContain(`<span class="chip neutral">one</span>`)
    expect(html).toContain(`<span class="chip neutral">two &lt;x&gt;</span>`)
    expect(html).toContain(`<span class="chip neutral">three</span>`)
    expect(html).not.toContain("four")
  })
})
