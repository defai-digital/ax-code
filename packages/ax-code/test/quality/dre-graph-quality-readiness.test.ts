import { describe, expect, test } from "vitest"
import { qualityReadinessSection } from "../../src/quality/dre-graph-quality-readiness"
import type { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"
import type { SessionRisk } from "../../src/session/risk"

function summary(
  input: Partial<ProbabilisticRollout.ReplayReadinessSummary> & {
    workflow: ProbabilisticRollout.Workflow
  },
): ProbabilisticRollout.ReplayReadinessSummary {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-replay-readiness-summary",
    sessionID: "session-1",
    projectID: "project-1",
    exportedAt: "2026-05-17T00:00:00.000Z",
    totalItems: 2,
    anchorItems: 1,
    evidenceItems: 1,
    toolSummaryCount: 1,
    labeledItems: 2,
    resolvedLabeledItems: 2,
    unresolvedLabeledItems: 0,
    missingLabels: 0,
    readyForBenchmark: true,
    overallStatus: "pass",
    nextAction: null,
    gates: [],
    ...input,
    workflow: input.workflow,
  }
}

describe("quality.dre-graph-quality-readiness", () => {
  test("omits the section when quality readiness is absent", () => {
    expect(qualityReadinessSection({ quality: undefined } as SessionRisk.Detail)).toBe("")
    expect(qualityReadinessSection({ quality: { review: null, debug: null, qa: null } } as SessionRisk.Detail)).toBe("")
  })

  test("renders workflow readiness summaries with status chips", () => {
    const html = qualityReadinessSection({
      quality: {
        review: summary({ workflow: "review" }),
        debug: null,
        qa: null,
      },
    } as SessionRisk.Detail)

    expect(html).toContain("Quality Readiness")
    expect(html).toContain(`<span class="validation-icon">R</span>`)
    expect(html).toContain(`<strong>review</strong> · ready · benchmark ready · 2/2 resolved labels`)
    expect(html).toContain(`<span class="chip low">ready</span>`)
  })

  test("escapes targeted recommendations and next action text", () => {
    const html = qualityReadinessSection({
      quality: {
        review: null,
        debug: null,
        qa: summary({
          workflow: "qa",
          readyForBenchmark: false,
          overallStatus: "warn",
          nextAction: `Run <qa>& review`,
          gates: [{ name: "targeted-test-recommendation", status: "pass", detail: "first: <script> | bun test a" }],
        }),
      },
    } as SessionRisk.Detail)

    expect(html).toContain(`<span class="validation-icon">Q</span>`)
    expect(html).toContain(`<strong>qa</strong> · not ready · label coverage complete · 2/2 resolved labels`)
    expect(html).toContain(`first: &lt;script&gt;`)
    expect(html).toContain(`Run &lt;qa&gt;&amp; review`)
    expect(html).toContain(`<span class="chip medium">not ready</span>`)
  })
})
