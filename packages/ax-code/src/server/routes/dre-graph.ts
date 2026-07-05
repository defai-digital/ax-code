import { Hono } from "hono"
import { validator } from "../validation"
import z from "zod"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { activitySection } from "../../quality/dre-graph-activity-section"
import { live, mermaidScript, themeScript, themeToggle } from "../../quality/dre-graph-assets"
import { branchSection } from "../../quality/dre-graph-branch-section"
import { changesSection } from "../../quality/dre-graph-changes-section"
import { index as indexPage } from "../../quality/dre-graph-index-page"
import { style } from "../../quality/dre-graph-style"
import { summary } from "../../quality/dre-graph-summary-section"
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

type SessionGraphContext = {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank: SessionBranchRank.Family | undefined
  rollback: SessionRollback.Point[]
}

async function loadSessionGraphContext(sessionID: SessionID, includeQuality: boolean): Promise<SessionGraphContext> {
  const session = await Session.get(sessionID)
  const [graph, dre, risk, rank, rollback] = await Promise.all([
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
  ])
  return { session, graph, dre, risk, rank, rollback }
}

async function loadSessionList(): Promise<Session.Info[]> {
  return [...Session.list({ limit: 50, directory: Instance.directory })]
}

function disableClientCache(c: { header: (name: string, value: string) => void }) {
  c.header("cache-control", "no-store")
}

function page(input: {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank?: SessionBranchRank.Family
  rollback: SessionRollback.Point[]
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

  return [
    "<!doctype html>",
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>AX Code · DRE · ${title}</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    // ── Nav ──
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand">AX Code DRE</span>`,
    `<div class="nav-sep"></div>`,
    `<a class="nav-link" href="#summary">Summary</a>`,
    `<a class="nav-link" href="#verdict">Verdict</a>`,
    `<a class="nav-link" href="#changes">Changes</a>`,
    `<a class="nav-link" href="#risk">Risk</a>`,
    `<a class="nav-link" href="#validation">Validation</a>`,
    `<a class="nav-link" href="#activity">Activity</a>`,
    `<a class="nav-link" href="#branches">Branches</a>`,
    `<div class="nav-sep"></div>`,
    `<span class="nav-back">${link(`/dre-graph`, "← All Sessions")}</span>`,
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
    `<div class="gviz-header">`,
    `<span class="gviz-label">Execution Graph</span>`,
    `<span class="gviz-status" id="gviz-status">loading…</span>`,
    `</div>`,
    `<div id="graph-viz" class="gviz-container"><span style="color:var(--muted);font-size:13px;font-style:italic;padding:12px;display:block">Loading…</span></div>`,
    `</div>`,
    `</header>`,
    // ── 1. Summary: "what happened and should I care?" ──
    summary({ dre: input.dre, risk: input.risk, graph: input.graph }),
    // ── 2. Verdict: "should I accept this?" ──
    verdictSection({ dre: input.dre, risk: input.risk }),
    // ── 3. Changes: "what files changed and how risky?" ──
    changesSection({ dre: input.dre }),
    // ── 4. Risk: "why is the risk what it is?" ──
    riskSection(input.risk, input.dre),
    // ── 5. Validation: "what was validated?" ──
    validationSection({ risk: input.risk }),
    // ── 6. Activity: "what did the agent actually work on?" ──
    activitySection(input.graph, input.dre, input.rollback),
    // ── 7. Branches: "which path is best?" ──
    branchSection(input.rank),
    // ── Footer ──
    `<footer class="footer">AX Code DRE · Debugging & Refactoring Engine</footer>`,
    live({ sessionID: input.session.id, directory: input.session.directory }),
    mermaidScript(input.session.id),
    `</body>`,
    `</html>`,
  ].join("")
}

export const DreGraphRoutes = lazy(() =>
  new Hono()
    .get("/", async (c) => {
      const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""
      const list = await loadSessionList()
      disableClientCache(c)
      c.header("content-type", "text/html; charset=utf-8")
      return c.body(indexPage({ list, search }))
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
