import { describe, expect, test } from "vitest"
import { riskSection } from "../../src/quality/dre-graph-risk-section"
import type { SessionDre } from "../../src/session/dre"
import type { SessionRisk } from "../../src/session/risk"

function risk(input?: {
  drivers?: string[]
  summary?: string
  signals?: Partial<SessionRisk.Detail["assessment"]["signals"]>
  breakdown?: SessionRisk.Detail["assessment"]["breakdown"]
  evidence?: string[]
  unknowns?: string[]
  mitigations?: string[]
}): SessionRisk.Detail {
  return {
    drivers: input?.drivers ?? [],
    assessment: {
      summary: input?.summary ?? "low risk",
      confidence: 0.65,
      readiness: "needs_validation",
      breakdown: input?.breakdown ?? [],
      evidence: input?.evidence ?? [],
      unknowns: input?.unknowns ?? [],
      mitigations: input?.mitigations ?? [],
      signals: {
        filesChanged: 4,
        linesChanged: 80,
        testCoverage: 0.5,
        apiEndpointsAffected: 1,
        toolFailures: 1,
        totalTools: 3,
        validationCount: 2,
        validationFailures: 1,
        validationState: "partial",
        diffState: "derived",
        crossModule: false,
        securityRelated: false,
        semanticRisk: null,
        primaryChange: null,
        ...input?.signals,
      },
    },
  } as SessionRisk.Detail
}

function dre(scorecard?: NonNullable<SessionDre.Snapshot["detail"]>["scorecard"]): SessionDre.Snapshot {
  return {
    detail: scorecard ? { scorecard } : null,
  } as SessionDre.Snapshot
}

describe("quality.dre-graph-risk-section", () => {
  test("renders status indicators and signal grid", () => {
    const html = riskSection({ ...risk({ summary: `Risk <summary>&` }) }, dre())

    expect(html).toContain(`<section class="band" id="risk">`)
    expect(html).toContain(`<h2>Risk Analysis</h2><p>Risk &lt;summary&gt;&amp;</p>`)
    expect(html).toContain(`<span class="ri-label">Readiness</span><span class="ri-value">needs validation</span>`)
    expect(html).toContain(`<span class="ri-label">Confidence</span><span class="ri-value">65%</span>`)
    expect(html).toContain(`<span class="ri-label">Validation</span><span class="ri-value">partial validation</span>`)
    expect(html).toContain(`<span class="ri-label">Diff source</span><span class="ri-value">derived</span>`)
    expect(html).toContain(`<span class="signal-label">Files changed</span><span class="signal-value medium">4</span>`)
    expect(html).toContain(`<span class="signal-label">Lines changed</span><span class="signal-value medium">80</span>`)
    expect(html).toContain(
      `<span class="signal-label">Test coverage</span><span class="signal-value medium">50%</span>`,
    )
    expect(html).toContain(`<span class="signal-label">API endpoints</span><span class="signal-value medium">1</span>`)
    expect(html).toContain(`<span class="signal-label">Tool failures</span><span class="signal-value high">1/3</span>`)
    expect(html).toContain(
      `<span class="signal-label">Validations</span><span class="signal-value high">1/2 passed</span>`,
    )
  })

  test("renders flags, bars, and escaped evidence lists", () => {
    const html = riskSection(
      risk({
        drivers: [`Driver <one>&`],
        signals: {
          crossModule: true,
          securityRelated: true,
          semanticRisk: "high",
          primaryChange: "refactor",
        },
        breakdown: [{ label: `Risk <factor>`, points: 16, detail: `detail&` } as any],
        evidence: [`Evidence <item>&`],
        unknowns: [`Unknown <item>&`],
        mitigations: [`Mitigate <item>&`],
      }),
      dre({
        total: 0.8,
        breakdown: [{ label: `Score <item>`, value: 0.72, detail: `score&detail` }],
      } as any),
    )

    expect(html).toContain(`<span class="chip medium">cross-module</span>`)
    expect(html).toContain(`<span class="chip high">security-related</span>`)
    expect(html).toContain(`<span class="chip high">semantic: high</span>`)
    expect(html).toContain(`<span class="chip neutral">refactor</span>`)
    expect(html).toContain(`Risk &lt;factor&gt;`)
    expect(html).toContain(`detail&amp;`)
    expect(html).toContain(`Score &lt;item&gt;`)
    expect(html).toContain(`score&amp;detail`)
    expect(html).toContain(`Driver &lt;one&gt;&amp;`)
    expect(html).toContain(`Evidence &lt;item&gt;&amp;`)
    expect(html).toContain(`Unknown &lt;item&gt;&amp;`)
    expect(html).toContain(`Mitigate &lt;item&gt;&amp;`)
  })

  test("renders empty drivers fallback", () => {
    const html = riskSection(risk(), dre())

    expect(html).toContain(`<h3>Risk Drivers</h3><p class="empty">No drivers recorded.</p>`)
    expect(html).not.toContain("Risk Factors")
    expect(html).not.toContain("Decision Scorecard")
  })
})
