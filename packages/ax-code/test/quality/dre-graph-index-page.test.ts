import { describe, expect, test } from "vitest"
import { index } from "../../src/quality/dre-graph-index-page"
import type { Session } from "../../src/session"
import type { SessionUsage } from "../../src/session/usage"
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

function usage(): SessionUsage.Info {
  return {
    days: 30,
    sessions: 2,
    messages: 42,
    tokens: { input: 120_000, output: 30_000, reasoning: 5_000, cache: { read: 200_000, write: 10_000 } },
    totalTokens: 365_000,
    cacheShare: 200_000 / 320_000,
    models: { "anthropic/claude-sonnet-4": { messages: 40, tokens: 360_000 } },
    tools: { bash: 12, edit: 7 },
    perDay: [{ day: "2026-08-18", sessions: 2, tokens: 365_000 }],
    perSession: { "session-1": 300_000, "session-2": 65_000 },
    activeDays: 1,
  }
}

describe("quality.dre-graph-index-page", () => {
  test("renders sessions with escaped titles and preserves index query parameters", () => {
    const html = index({
      search: "?directory=/tmp/a b&quality=true",
      usage: usage(),
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

    expect(html).toContain(`<title>AX Code · Dashboard</title>`)
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

    // Usage dashboard leads the page
    expect(html).toContain(`<h3>Usage — last 30 days</h3>`)
    expect(html).toContain(`<span class="stat-label">Sessions</span><strong class="stat-value">2</strong>`)
    expect(html).toContain(`<span class="stat-label">Messages</span><strong class="stat-value">42</strong>`)
    expect(html).toContain(`<span class="stat-label">Tokens</span><strong class="stat-value">365k</strong>`)
    expect(html).toContain(`<span class="stat-label">Cache share</span><strong class="stat-value">63%</strong>`)
    expect(html).toContain(`<h3>Activity — last 14 days</h3>`)
    expect(html).toContain(`daily-chart`)
    expect(html).toContain(`<h3>Model usage</h3>`)
    expect(html).toContain(`anthropic/claude-sonnet-4`)
    expect(html).toContain(`<h3>Tool usage</h3>`)
    // Per-session token chips
    expect(html).toContain(`<span class="chip neutral">300k tokens</span>`)
    expect(html).toContain(`<span class="chip neutral">65k tokens</span>`)

    // Session health block keeps the DRE readiness stats
    expect(html).toContain(`<h3>Session Health</h3>`)
    expect(html).toContain(`<span class="stat-label">Avg risk</span><strong class="stat-value">35/100</strong>`)
    expect(html).toContain(`<span class="stat-label">Ready</span><strong class="stat-value">1</strong>`)
    expect(html).toContain(`<span class="stat-label">Needs attention</span><strong class="stat-value">1</strong>`)
    expect(html).toContain(`<span class="stat-label">Blocked</span><strong class="stat-value">0</strong>`)
    expect(html).toContain(
      `<span class="stat-label">Validation pass rate</span><strong class="stat-value">50%</strong>`,
    )
  })

  test("renders empty state and falls back to query directory for live refresh", () => {
    const html = index({
      search: "?directory=/tmp/empty",
      usage: { ...usage(), sessions: 0, messages: 0, totalTokens: 0, perSession: {}, perDay: [], activeDays: 0 },
      rows: [],
    })

    expect(html).toContain(`0 sessions in this workspace`)
    expect(html).toContain(`No sessions recorded. Run ax-code to create your first session.`)
    expect(html).toContain(`/dre-graph/fingerprint?directory=%2Ftmp%2Fempty`)
    expect(html).not.toContain("Session Health")
  })
})
