import { describe, expect, test } from "vitest"
import { buildEvidenceChain, evidenceSection } from "../../src/quality/dre-graph/dre-graph-evidence"
import type { SessionDre } from "../../src/session/dre"
import type { SessionGraph } from "../../src/session/graph"
import type { SessionRisk } from "../../src/session/risk"
import type { SessionRollback } from "../../src/session/rollback"

function build(input: {
  signals?: Record<string, unknown>
  readiness?: string
  steps?: number
  errors?: number
  rollback?: number
  semantic?: boolean
  title?: string
  anchors?: string[]
}) {
  const chain = buildEvidenceChain({
    session: {
      title: input.title ?? "Fix login",
      directory: "/repo",
      time: { created: 1_700_000_000_000, updated: 1_700_000_001_000 },
    },
    graph: {
      graph: {
        metadata: {
          steps: input.steps ?? 3,
          errors: input.errors ?? 0,
          tools: ["read", "edit"],
          agents: ["build"],
          duration: 1000,
          tokens: { input: 10, output: 2 },
        },
      },
    } as unknown as SessionGraph.Snapshot,
    dre: {
      detail: { duration: 5000, semantic: input.semantic ? { headline: "Changed auth flow" } : null },
    } as unknown as SessionDre.Snapshot,
    risk: {
      assessment: {
        readiness: input.readiness ?? "ready",
        level: "LOW",
        score: 12,
        confidence: 0.7,
        signals: {
          filesChanged: 0,
          linesChanged: 0,
          totalTools: 2,
          toolFailures: 0,
          validationState: "not_run",
          validationCommands: [],
          validationCount: 0,
          validationFailures: 0,
          diffState: "missing",
          ...input.signals,
        },
      },
      drivers: ["small change"],
    } as unknown as SessionRisk.Detail,
    rollback: Array.from({ length: input.rollback ?? 0 }, (_, i) => ({ step: i + 1 })) as SessionRollback.Point[],
    anchors: input.anchors ? new Set(input.anchors) : undefined,
  })
  return { chain, stage: (key: string) => chain.stages.find((s) => s.key === key)! }
}

describe("quality.dre-graph-evidence", () => {
  test("a read-only run is complete: nothing to verify or roll back is not a gap", () => {
    const { chain, stage } = build({})
    expect(chain.stages.map((s) => s.key)).toEqual(["asked", "did", "changed", "verified", "decided", "reversible"])
    expect(stage("changed").state).toBe("na")
    expect(stage("verified").state).toBe("na")
    expect(stage("reversible").state).toBe("na")
    expect(chain.gaps).toHaveLength(0)
    expect(chain.headline).toBe("Evidence chain complete")
  })

  test("changed files without validation or rollback are loud gaps", () => {
    const { chain, stage } = build({ signals: { filesChanged: 3, linesChanged: 40, diffState: "recorded" } })
    expect(stage("changed").state).toBe("recorded")
    expect(stage("verified")).toMatchObject({ state: "gap", headline: "Changes were not verified" })
    expect(stage("reversible")).toMatchObject({ state: "gap", headline: "No rollback point recorded" })
    expect(chain.gaps.map((s) => s.key)).toEqual(["verified", "reversible"])
    expect(chain.headline).toBe("2 evidence gaps: verified, reversible")
  })

  test("derived diffs are labelled derived and a missing diff for changed files is a gap", () => {
    expect(
      build({ signals: { filesChanged: 1, linesChanged: 5, diffState: "derived" } }).stage("changed"),
    ).toMatchObject({
      state: "derived",
    })
    expect(
      build({ signals: { filesChanged: 1, linesChanged: 5, diffState: "derived" } })
        .stage("changed")
        .facts.join(" "),
    ).toContain("estimated from tool events")
    expect(build({ signals: { filesChanged: 1, linesChanged: 5, diffState: "missing" } }).stage("changed").state).toBe(
      "gap",
    )
  })

  test("validation states map to recorded, attention and gap", () => {
    const passed = build({
      signals: {
        filesChanged: 1,
        linesChanged: 1,
        diffState: "recorded",
        validationState: "passed",
        validationCount: 2,
        validationCommands: ["pnpm test"],
      },
    })
    expect(passed.stage("verified")).toMatchObject({ state: "recorded", headline: "Validation passed (2)" })
    expect(passed.stage("verified").facts).toEqual(["pnpm test"])
    const failed = build({ signals: { validationState: "failed", validationCount: 3, validationFailures: 1 } })
    expect(failed.stage("verified")).toMatchObject({ state: "attention", headline: "Validation failed (1 of 3)" })
    expect(build({ signals: { validationState: "partial" } }).stage("verified").state).toBe("attention")
  })

  test("errors and blocked readiness need attention, and rollback points are recorded evidence", () => {
    const { stage, chain } = build({
      errors: 2,
      readiness: "blocked",
      rollback: 3,
      signals: { filesChanged: 1, linesChanged: 1, diffState: "recorded", validationState: "passed" },
    })
    expect(stage("did").state).toBe("attention")
    expect(stage("did").headline).toContain("2 errors")
    expect(stage("decided").state).toBe("attention")
    expect(stage("reversible")).toMatchObject({ state: "recorded", headline: "3 rollback points" })
    expect(chain.headline).toBe("Chain complete, but a step needs attention")
  })

  test("no recorded steps is a gap in what the agent did", () => {
    expect(build({ steps: 0 }).stage("did")).toMatchObject({ state: "gap", headline: "No execution recorded" })
  })

  test("stages only link to anchors that are rendered", () => {
    const { chain } = build({ anchors: ["evidence", "timeline", "summary", "activity"] })
    const hrefs = chain.stages.map((s) => s.href)
    expect(hrefs).not.toContain("#verdict")
    expect(hrefs).not.toContain("#validation")
    expect(hrefs).not.toContain("#changes")
    const all = build({
      semantic: true,
      anchors: ["evidence", "timeline", "summary", "activity", "verdict", "validation", "changes"],
    })
    expect(all.chain.stages.find((s) => s.key === "decided")!.href).toBe("#verdict")
    expect(all.chain.stages.find((s) => s.key === "changed")!.href).toBe("#changes")
  })

  test("the section escapes hostile text and offers a replay command and raw trace links", () => {
    const { chain } = build({ title: `<script>alert(1)</script>` })
    const html = evidenceSection({ sessionID: "ses_abc", directory: "/tmp/a b", chain, readiness: "ready" })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("ax-code replay ses_abc")
    expect(html).toContain("/graph/ses_abc?directory=%2Ftmp%2Fa%20b")
    expect(html).toContain("format=markdown")
    expect(html).toContain('id="evidence"')
    expect((html.match(/class="stage /g) ?? []).length).toBe(6)
  })
})
