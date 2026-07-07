import { describe, expect, test } from "vitest"
import { index } from "../../src/quality/dre-graph-index-page"
import type { Session } from "../../src/session"
import type { Risk } from "../../src/risk/score"

function session(input: { id: string; title: string; directory: string; parentID?: string }): Session.Info {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project",
    directory: input.directory,
    title: input.title,
    version: "1",
    parentID: input.parentID,
    time: {
      created: 1_700_000_000_000,
      updated: 1_700_000_001_000,
    },
  } as unknown as Session.Info
}

function risk(input: { level: string; score: number; readiness: string; validationState: string }): Risk.Assessment {
  return {
    level: input.level,
    score: input.score,
    readiness: input.readiness,
    signals: { validationState: input.validationState },
  } as unknown as Risk.Assessment
}

describe("quality.dre-graph-index-page", () => {
  test("renders sessions with escaped titles and preserves index query parameters", () => {
    const html = index({
      search: "?directory=/tmp/a b&quality=true",
      rows: [
        {
          session: session({ id: "session-1", title: "Session <one>&", directory: "/tmp/a b" }),
          risk: risk({ level: "LOW", score: 10, readiness: "ready", validationState: "passed" }),
        },
        {
          session: session({ id: "session-2", title: "Child", directory: "/tmp/a b", parentID: "session-1" }),
          risk: risk({ level: "HIGH", score: 60, readiness: "needs_review", validationState: "failed" }),
        },
      ],
    })

    expect(html).toContain(`<title>AX Code · DRE Sessions</title>`)
    expect(html).toContain(`2 sessions in this workspace`)
    expect(html).toContain(`Session &lt;one&gt;&amp;`)
    expect(html).toContain(`/dre-graph/session/session-1?directory=%2Ftmp%2Fa+b&amp;quality=true`)
    expect(html).toContain(`<span class="chip neutral">root</span>`)
    expect(html).toContain(`<span class="chip neutral">fork</span>`)
    expect(html).toContain(`<span class="chip low">low risk</span>`)
    expect(html).toContain(`<span class="chip low">ready</span>`)
    expect(html).toContain(`<span class="chip high">high risk</span>`)
    expect(html).toContain(`<span class="chip high">needs review</span>`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=%2Ftmp%2Fa%20b`)

    expect(html).toContain(`<h3>Workspace Overview</h3>`)
    expect(html).toContain(`<span class="stat-label">Sessions</span><strong class="stat-value">2</strong>`)
    expect(html).toContain(`<span class="stat-label">Avg risk</span><strong class="stat-value">35/100</strong>`)
    expect(html).toContain(`<span class="stat-label">Ready</span><strong class="stat-value">1</strong>`)
    expect(html).toContain(`<span class="stat-label">Needs attention</span><strong class="stat-value">1</strong>`)
    expect(html).toContain(`<span class="stat-label">Blocked</span><strong class="stat-value">0</strong>`)
    expect(html).toContain(`<span class="stat-label">Validation pass rate</span><strong class="stat-value">50%</strong>`)
  })

  test("renders empty state and falls back to query directory for live refresh", () => {
    const html = index({ search: "?directory=/tmp/empty", rows: [] })

    expect(html).toContain(`0 sessions in this workspace`)
    expect(html).toContain(`No sessions recorded. Run ax-code to create your first session.`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=%2Ftmp%2Fempty`)
    expect(html).not.toContain("Workspace Overview")
  })
})
