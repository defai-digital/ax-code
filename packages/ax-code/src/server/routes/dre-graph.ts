import { Hono } from "hono"
import { validator } from "../validation"
import z from "zod"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { SessionUsage } from "../../session/usage"
import { Risk } from "../../risk/score"
import { activitySection } from "../../quality/dre-graph-activity-section"
import { executionSummaryScript, live, themeScript, themeToggle } from "../../quality/dre-graph-assets"
import { branchSection } from "../../quality/dre-graph-branch-section"
import { changesSection } from "../../quality/dre-graph-changes-section"
import { index as indexPage } from "../../quality/dre-graph-index-page"
import { style } from "../../quality/dre-graph-style"
import { summary } from "../../quality/dre-graph-summary-section"
import { usageSection } from "../../quality/dre-graph-usage-section"
import { indexFingerprint, sessionFingerprint } from "../../quality/dre-graph-fingerprint"
import { riskSection } from "../../quality/dre-graph-risk-section"
import { validationSection } from "../../quality/dre-graph-validation-section"
import { verdictSection } from "../../quality/dre-graph-verdict-section"
import { esc, stamp } from "../../quality/dre-graph-format"
import { chip } from "../../quality/dre-graph-widgets"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { SESSION_ID_PARAM, withSessionID } from "./route-params"
import { requireCurrentProjectSession } from "./session-lookup"
import { QueryBoolean } from "./query"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "server.dre-graph" })

const DRE_GRAPH_QUALITY_QUERY = z.object({
  quality: QueryBoolean.optional().default(false),
})

function emptyUsage(days?: number): SessionUsage.Info {
  return {
    days,
    sessions: 0,
    messages: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    totalTokens: 0,
    cacheShare: undefined,
    models: {},
    tools: {},
    perDay: [],
    perSession: {},
    activeDays: 0,
  }
}

type SessionGraphContext = {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank: SessionBranchRank.Family | undefined
  rollback: SessionRollback.Point[]
  usage: SessionUsage.Info
}

async function loadSessionGraphContext(sessionID: SessionID, includeQuality: boolean): Promise<SessionGraphContext> {
  const session = await Session.get(sessionID)
  const [graph, dre, risk, rank, rollback, usage] = await Promise.all([
    Promise.resolve(SessionGraph.snapshot(sessionID)),
    SessionDre.snapshot(sessionID),
    SessionRisk.load(sessionID, { includeQuality }),
    SessionBranchRank.family(sessionID).catch((error) => {
      log.warn("failed to load DRE branch rank", { sessionID, error })
      return undefined
    }),
    SessionRollback.points(sessionID).catch((error): SessionRollback.Point[] => {
      log.warn("failed to load DRE rollback points", { sessionID, error })
      return []
    }),
    SessionUsage.load({ sessionID }).catch((error) => {
      log.warn("failed to load session usage", { sessionID, error })
      return undefined
    }),
  ])
  return {
    session,
    graph,
    dre,
    risk,
    rank,
    rollback,
    usage: usage ?? emptyUsage(),
  }
}

async function loadSessionList(): Promise<Session.Info[]> {
  return [...Session.list({ limit: 50, directory: Instance.directory })]
}

async function loadSessionSummaries(): Promise<{ session: Session.Info; risk: Risk.Assessment }[]> {
  const list = await loadSessionList()
  return list.map((session) => ({ session, risk: Risk.fromSession(session.id) }))
}

function disableClientCache(c: { header: (name: string, value: string) => void }) {
  c.header("cache-control", "no-store")
}

/**
 * The risk/trust sections only earn their place when the assessment has
 * substance. A chat-only or trivially-small session scores under 15 with
 * "not_run" validation and no unknowns — rendering a 0/100 gauge and empty
 * scorecards there is exactly the "not meaningful" noise users reported.
 */
function hasRiskSubstance(assessment: SessionRisk.Detail["assessment"]) {
  return (
    assessment.score >= 15 ||
    assessment.signals.validationState !== "not_run" ||
    assessment.readiness === "blocked" ||
    assessment.unknowns.length > 0
  )
}

function page(input: {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank?: SessionBranchRank.Family
  rollback: SessionRollback.Point[]
  usage: SessionUsage.Info
  search: string
}) {
  const title = esc(input.session.title)
  const dir = esc(input.session.directory)
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const link = (path: string, label: string, query?: Record<string, string>) => {
    const url = new URL(path, "http://ax-code.local")
    for (const [key, value] of base.entries()) url.searchParams.set(key, value)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    return `<a href="${esc(url.pathname + url.search)}">${esc(label)}</a>`
  }

  // Section visibility predicates — the nav is built from the same predicates
  // so it never links to an anchor that is not rendered.
  const showTrust = hasRiskSubstance(input.risk.assessment)
  const showValidation = input.risk.assessment.signals.validationCommands.length > 0
  const showBranches = (input.rank?.items.length ?? 0) > 1

  const nav: string[] = [
    `<a class="nav-link" href="#usage">Usage</a>`,
    `<a class="nav-link" href="#summary">Summary</a>`,
    `<a class="nav-link" href="#changes">Changes</a>`,
    `<a class="nav-link" href="#timeline">Timeline</a>`,
    `<a class="nav-link" href="#activity">Activity</a>`,
    ...(showTrust
      ? [`<a class="nav-link" href="#verdict">Verdict</a>`, `<a class="nav-link" href="#risk">Risk</a>`]
      : []),
    ...(showValidation ? [`<a class="nav-link" href="#validation">Validation</a>`] : []),
    ...(showBranches ? [`<a class="nav-link" href="#branches">Branches</a>`] : []),
  ]

  const ganttSrc = `/graph/${input.session.id}?format=svggantt&directory=${encodeURIComponent(input.session.directory)}`

  return [
    "<!doctype html>",
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>AX Code · Session Report · ${title}</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    // ── Nav ──
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand" title="AX Code session report">AX Code</span>`,
    `<div class="nav-sep"></div>`,
    ...nav,
    `<div class="nav-sep"></div>`,
    `<span class="nav-back">${link(`/dre-graph`, "← Dashboard")}</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    // ── Hero: session identity ──
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">${title}</div>`,
    `<div class="meta" style="margin-top:6px">`,
    chip({ label: dir }),
    chip({ label: stamp(input.session.time.updated) }),
    `</div>`,
    `<div class="gviz-summary-bar">`,
    `<span class="gviz-summary-icon">⬡</span>`,
    `<span class="gviz-summary-status" id="gviz-summary-status">Loading session…</span>`,
    `<span class="gviz-summary-sep">·</span>`,
    `<span class="gviz-summary-detail" id="gviz-summary-detail"></span>`,
    `</div>`,
    `</div>`,
    `</header>`,
    // ── 1. Usage: "what did this session use?" — every session has this data ──
    usageSection({ usage: input.usage, duration: input.dre.detail?.duration }),
    // ── 2. Summary: "what happened?" ──
    summary({ dre: input.dre, graph: input.graph }),
    // ── 3. Changes: "what files changed and how risky?" ──
    changesSection({ dre: input.dre }),
    // ── 4. Timeline: full execution Gantt rendered by the /graph route ──
    `<section class="band" id="timeline">`,
    `<div class="wrap">`,
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>Timeline</h3>`,
    `<details><summary class="muted" style="cursor:pointer;font-size:13px">Execution timeline (Gantt)</summary>`,
    `<img src="${esc(ganttSrc)}" alt="Session execution timeline" style="width:100%;margin-top:10px" loading="lazy" />`,
    `</details>`,
    `</div>`,
    `</div>`,
    `</section>`,
    // ── 5. Activity: "what did the agent actually work on?" ──
    activitySection(input.graph, input.dre, input.rollback),
    // ── 5. Trust sections: only when there is something to say ──
    showTrust ? verdictSection({ dre: input.dre, risk: input.risk }) : "",
    showTrust ? riskSection(input.risk, input.dre) : "",
    showValidation ? validationSection({ risk: input.risk }) : "",
    showBranches ? branchSection(input.rank) : "",
    // ── Footer ──
    `<footer class="footer">AX Code Session Report · Debugging & Refactoring Engine</footer>`,
    live({ sessionID: input.session.id, directory: input.session.directory }),
    executionSummaryScript(input.session.id, input.session.directory),
    `</body>`,
    `</html>`,
  ].join("")
}

export const DreGraphRoutes = lazy(() =>
  new Hono()
    .get("/", async (c) => {
      const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""
      const [rows, usage] = await Promise.all([
        loadSessionSummaries(),
        SessionUsage.load({ days: 30, projectID: Instance.project.id }).catch((error) => {
          log.warn("failed to load workspace usage", { error })
          return undefined
        }),
      ])
      disableClientCache(c)
      c.header("content-type", "text/html; charset=utf-8")
      return c.body(indexPage({ rows, usage: usage ?? emptyUsage(30), search }))
    })
    .get("/fingerprint", async (c) => {
      const list = await loadSessionList()
      disableClientCache(c)
      return c.json(indexFingerprint(list))
    })
    .get(
      "/session/:sessionID",
      validator("param", SESSION_ID_PARAM),
      validator("query", DRE_GRAPH_QUALITY_QUERY),
      withSessionID(async (sessionID, c) => {
        await requireCurrentProjectSession(sessionID)
        const quality = c.req.valid("query").quality
        const context = await loadSessionGraphContext(sessionID, quality)
        const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""

        disableClientCache(c)
        c.header("content-type", "text/html; charset=utf-8")
        return c.body(
          page({
            session: context.session,
            graph: context.graph,
            dre: context.dre,
            risk: context.risk,
            rank: context.rank,
            rollback: context.rollback,
            usage: context.usage,
            search,
          }),
        )
      }),
    )
    .get(
      "/session/:sessionID/fingerprint",
      validator("param", SESSION_ID_PARAM),
      validator("query", DRE_GRAPH_QUALITY_QUERY),
      withSessionID(async (sessionID, c) => {
        await requireCurrentProjectSession(sessionID)
        const quality = c.req.valid("query").quality
        const context = await loadSessionGraphContext(sessionID, quality)

        disableClientCache(c)
        return c.json(
          sessionFingerprint({
            session: context.session,
            graph: context.graph,
            dre: context.dre,
            risk: context.risk,
            rank: context.rank,
            rollback: context.rollback,
          }),
        )
      }),
    ),
)
