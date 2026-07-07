import { describe, expect, test } from "vitest"
import { verdictSection } from "../../src/quality/dre-graph-verdict-section"
import type { SessionDre } from "../../src/session/dre"
import type { SessionRisk } from "../../src/session/risk"

function dre(detail?: Partial<NonNullable<SessionDre.Snapshot["detail"]>>): SessionDre.Snapshot {
  return {
    detail: detail
      ? {
          scorecard: { total: 0.75 },
          semantic: null,
          ...detail,
        }
      : null,
  } as SessionDre.Snapshot
}

function risk(input?: {
  readiness?: string
  validationState?: SessionRisk.Detail["assessment"]["signals"]["validationState"]
  validationCommands?: string[]
  unknowns?: string[]
  mitigations?: string[]
  confidence?: number
  level?: string
  score?: number
}): SessionRisk.Detail {
  return {
    assessment: {
      readiness: input?.readiness ?? "ready",
      confidence: input?.confidence ?? 0.8,
      level: input?.level ?? "LOW",
      score: input?.score ?? 12,
      unknowns: input?.unknowns ?? [],
      mitigations: input?.mitigations ?? [],
      signals: {
        validationState: input?.validationState ?? "passed",
        validationCommands: input?.validationCommands ?? [],
      },
    },
  } as SessionRisk.Detail
}

describe("quality.dre-graph-verdict-section", () => {
  test("omits the verdict when DRE detail is absent", () => {
    expect(verdictSection({ dre: dre(), risk: risk() })).toBe("")
  })

  test("renders readiness headline and core stats", () => {
    const html = verdictSection({
      dre: dre({ scorecard: { total: 0.82 } as any }),
      risk: risk({ readiness: "needs_validation", confidence: 0.61, level: "HIGH", score: 78 }),
    })

    expect(html).toContain(`<section class="verdict" id="verdict">`)
    expect(html).toContain(`<div class="verdict-inner medium">`)
    expect(html).toContain(`Needs validation before accepting`)
    expect(html).toContain(`<strong class="stat-value">61%</strong>`)
    expect(html).toContain(`<strong class="stat-value">0.82</strong>`)
    expect(html).toContain(`class="gauge"`)
    expect(html).toContain(`>78</text>`)
    expect(html).toContain(`>HIGH</text>`)
    expect(html).toContain("Heuristic score from session signals")
  })

  test("renders escaped validation command summary and semantic callouts", () => {
    const html = verdictSection({
      dre: dre({
        semantic: {
          headline: `Changed <core>& API`,
          risk: "high",
          files: 2,
          additions: 10,
          deletions: 4,
        } as any,
      }),
      risk: risk({
        validationState: "failed",
        validationCommands: [`bun test <suite> --flag`, "pnpm typecheck", "ignored extra command", "not shown"],
        unknowns: [`Unknown <risk>&`],
        mitigations: [`Run <tests>&`],
      }),
    })

    expect(html).toContain(`validation failed (bun test &amp;lt;suite&amp;gt;, pnpm typecheck, ignored extra command)`)
    expect(html).not.toContain("not shown")
    expect(html).toContain(`Changed &lt;core&gt;&amp; API`)
    expect(html).toContain(`<span class="chip high">high</span>`)
    expect(html).toContain(`2 files`)
    expect(html).toContain(`Unknown &lt;risk&gt;&amp;`)
    expect(html).toContain(`Run &lt;tests&gt;&amp;`)
  })
})
