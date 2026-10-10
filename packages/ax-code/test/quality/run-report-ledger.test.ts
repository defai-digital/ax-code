import { describe, expect, test } from "vitest"
import { attentionReasons, buildLedger, ledgerGroup, ledgerSection } from "../../src/quality/run-report/run-report-ledger"
import type { Risk } from "../../src/risk/score"
import type { Session } from "../../src/session"

function risk(input: { readiness?: string; level?: string; signals?: Record<string, unknown> }): Risk.Assessment {
  return {
    level: input.level ?? "LOW",
    score: 10,
    readiness: input.readiness ?? "ready",
    signals: input.signals ?? {},
  } as unknown as Risk.Assessment
}
function row(id: string, assessment: Risk.Assessment, title = id) {
  return { session: { id, title, time: { updated: 1_700_000_000_000 } } as unknown as Session.Info, risk: assessment }
}
const link = (path: string, label: string) => `<a href="${path}">${label}</a>`

describe("quality.run-report-ledger", () => {
  test("each session lands in exactly one group", () => {
    expect(ledgerGroup(risk({ signals: {} }))).toBe("readonly")
    expect(ledgerGroup(risk({ signals: { filesChanged: 2, validationState: "not_run" } }))).toBe("unverified")
    expect(ledgerGroup(risk({ signals: { filesChanged: 2, validationState: "partial" } }))).toBe("unverified")
    expect(ledgerGroup(risk({ signals: { linesChanged: 9, validationState: "passed" } }))).toBe("verified")
    expect(ledgerGroup(risk({ readiness: "blocked", signals: { filesChanged: 1, validationState: "passed" } }))).toBe(
      "attention",
    )
    expect(ledgerGroup(risk({ signals: { filesChanged: 1, validationState: "failed" } }))).toBe("attention")
    expect(ledgerGroup(risk({ signals: { toolFailures: 2 } }))).toBe("attention")
  })

  test("attention reasons are specific and ordered", () => {
    expect(
      attentionReasons(risk({ readiness: "needs_review", signals: { validationState: "failed", toolFailures: 1 } })),
    ).toEqual(["needs review", "validation failed", "1 tool failure"])
    expect(attentionReasons(risk({ signals: { toolFailures: 5 } }))).toEqual(["5 tool failures"])
    expect(attentionReasons(risk({}))).toEqual([])
  })

  test("counts add up and coverage is verified over changed", () => {
    const ledger = buildLedger([
      row("a", risk({ signals: { filesChanged: 1, validationState: "passed" } })),
      row("b", risk({ signals: { filesChanged: 1, validationState: "not_run" } })),
      row("c", risk({ signals: {} })),
      row("d", risk({ readiness: "blocked", signals: { filesChanged: 4 } })),
    ])
    const sum = Object.values(ledger.groups).reduce((n, g) => n + g.length, 0)
    expect(sum).toBe(ledger.total)
    expect(ledger).toMatchObject({ total: 4, changed: 3, verified: 1, attention: 1 })
    expect(ledger.coverage).toBeCloseTo(1 / 3)
    expect(buildLedger([row("x", risk({}))]).coverage).toBeUndefined()
  })

  test("the headline is honest when nothing changed or everything is verified", () => {
    const none = ledgerSection({ rows: [row("a", risk({}))], perSession: {}, link })
    expect(none).toContain("No session here changed files")
    expect(none).toContain("Nothing needs your attention.")
    const all = ledgerSection({
      rows: [row("a", risk({ signals: { filesChanged: 1, validationState: "passed" } }))],
      perSession: {},
      link,
    })
    expect(all).toContain("1 of 1 session that changed files was verified.")
    expect(all).not.toContain("has-attention")
    expect(all).toContain("complete")
  })

  test("groups render with escaped titles, evidence chips, reasons and open state", () => {
    const html = ledgerSection({
      rows: [
        row(
          "s1",
          risk({ signals: { toolFailures: 2, filesChanged: 3, linesChanged: 1500, validationState: "not_run" } }),
          `<b>x</b>`,
        ),
        row("s2", risk({ signals: {} }), "chat"),
        row("s3", risk({ signals: { filesChanged: 1, linesChanged: 2, validationState: "passed" } }), "done"),
      ],
      perSession: { s1: 2_000_000 },
      link,
    })
    expect(html).not.toContain("<b>x</b>")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain("2 tool failures")
    expect(html).toContain("3 files · 1.5k lines")
    expect(html).toContain("not verified")
    expect(html).toContain("no changes")
    expect(html).toContain("2.0M tokens")
    expect(html).toMatch(/class="panel ledger-group attention[^"]*"[^>]* open>/)
    expect(html).not.toMatch(/class="panel ledger-group readonly[^"]*"[^>]* open>/)
    expect(html).toContain("/run-report/session/s1")
  })

  test("an empty workspace renders nothing", () => {
    expect(ledgerSection({ rows: [], perSession: {}, link })).toBe("")
  })
})
