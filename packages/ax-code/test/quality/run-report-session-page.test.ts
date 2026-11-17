import { expect, test, vi } from "vitest"
import { sessionPage, type SessionReportData } from "../../src/quality/run-report/run-report-session-page"
import { index } from "../../src/quality/run-report/run-report-index-page"
import { SessionID } from "../../src/session/schema"

vi.mock("../../src/server/server", () => {
  throw new Error("Report rendering must not load the HTTP server")
})
vi.mock("../../src/session", () => {
  throw new Error("Report rendering must consume supplied session data")
})
vi.mock("../../src/replay/query", () => {
  throw new Error("Report rendering must not query replay evidence")
})
vi.mock("../../src/quality/probabilistic-rollout", () => {
  throw new Error("Report rendering must use readiness presentation helpers")
})
vi.mock("../../src/risk/score", () => {
  throw new Error("Report rendering must not load evidence scoring")
})

function data(): SessionReportData {
  return {
    session: {
      id: SessionID.make("ses_report"),
      title: "Review <auth>& flow",
      directory: "/repo/a b",
      time: { created: 1_700_000_000_000, updated: 1_700_000_001_000 },
    } as SessionReportData["session"],
    graph: {
      graph: {
        nodes: [],
        edges: [],
        metadata: { steps: 0, tools: [], errors: 0, agents: [], duration: 0, tokens: { input: 0, output: 0 } },
      },
    } as unknown as SessionReportData["graph"],
    dre: { detail: null, timeline: [] } as unknown as SessionReportData["dre"],
    risk: {
      assessment: {
        score: 0,
        level: "LOW",
        readiness: "ready",
        confidence: 0,
        summary: "No changes",
        signals: {
          filesChanged: 0,
          linesChanged: 0,
          testCoverage: 0,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "not_run",
          validationCount: 0,
          validationFailures: 0,
          validationCommands: [],
          toolFailures: 0,
          totalTools: 0,
          diffState: "missing",
        },
        breakdown: [],
        evidence: [],
        unknowns: [],
        mitigations: [],
      },
      drivers: [],
    } as unknown as SessionReportData["risk"],
    rollback: [],
    usage: {
      days: undefined,
      sessions: 1,
      messages: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      totalTokens: 0,
      cacheShare: undefined,
      models: {},
      tools: {},
      perDay: [],
      perSession: {},
      activeDays: 0,
    },
  }
}

test("renders session and index pages without loading session or HTTP services", () => {
  const input = data()
  const search = "?directory=/repo/a b&quality=true"
  const html = sessionPage({ ...input, search })
  expect(html).toContain("Session Report · Review &lt;auth&gt;&amp; flow")
  expect(html).toContain('<a href="/run-report?directory=%2Frepo%2Fa+b&amp;quality=true">← Dashboard</a>')
  expect(html).toContain('id="evidence"')
  expect(html).not.toContain('href="#risk"')
  expect(index({ rows: [], usage: input.usage, search })).toContain("Workspace Dashboard")
})

test("meaningful risk without DRE detail has no dangling verdict links", () => {
  const input = data()
  input.risk.assessment.score = 20
  const html = sessionPage({ ...input, search: "" })
  expect(html).toContain('id="risk"')
  expect(html).not.toContain('id="verdict"')
  expect(html.includes('href="#verdict"')).toBe(false)
  for (const match of html.matchAll(/class="nav-link" href="#([^"]+)"/g)) {
    expect(html).toContain(`id="${match[1]}"`)
  }
})

test("escapes the session directory exactly once in its identity chip", () => {
  const input = data()
  input.session.directory = "/repo/a&b"
  const html = sessionPage({ ...input, search: "" })
  expect(html.includes('<span class="chip neutral">/repo/a&amp;b</span>')).toBe(true)
})

test("renders and links the verdict when meaningful risk and DRE detail are both available", () => {
  const input = data()
  input.risk.assessment.score = 20
  input.dre.detail = {
    level: "LOW",
    score: 20,
    confidence: 0.75,
    readiness: "ready",
    summary: "Review complete",
    stats: "",
    decision: "Accept",
    plan: "Review changes",
    duration: 0,
    tokens: { input: 0, output: 0 },
    drivers: [],
    breakdown: [],
    evidence: [],
    unknowns: [],
    mitigations: [],
    routes: [],
    counts: [],
    tools: [],
    notes: [],
    semantic: null,
    scorecard: { total: 0.75, breakdown: [] },
  }
  const html = sessionPage({ ...input, search: "" })
  expect(html).toContain('id="verdict"')
  expect(html).toContain('class="nav-link" href="#verdict"')
  expect(html).toContain('class="stage-link" href="#verdict"')
})
