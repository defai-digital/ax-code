import { Hono } from "hono"
import { validator } from "../validation"
import z from "zod"
import { EventQuery } from "../../replay/query"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { SessionUsage } from "../../session/usage"
import { Risk } from "../../risk/score"
import { index as indexPage } from "../../quality/run-report/run-report-index-page"
import { sessionPage, type SessionReportData } from "../../quality/run-report/run-report-session-page"
import { indexFingerprint, sessionFingerprint } from "../../quality/run-report/run-report-fingerprint"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { Log } from "../../util/log"
import { lazy } from "../../util/lazy"
import { SESSION_ID_PARAM, withSessionID } from "./route-params"
import { requireCurrentProjectSession } from "./session-lookup"
import { QueryBoolean } from "./query"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "server.run-report" })

const RUN_REPORT_QUALITY_QUERY = z.object({
  quality: QueryBoolean.optional().default(false),
  // Raw `c.req.url` query derivation is dangerous even with encodeURIComponent
  // and esc() guards today — bind `directory` here (the only value reused as a
  // fetch URL) so a future refactor that drops one escape layer cannot turn
  // it into an injection/traversal vector. The `search` parameter remains raw
  // because it's already rounded through `URLSearchParams` and esc().
  directory: z.string().max(1024).optional(),
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

async function loadSessionGraphContext(sessionID: SessionID, includeQuality: boolean): Promise<SessionReportData> {
  // The views below each read the session's event log; share one decode.
  return EventQuery.memoizeReads(() => loadSessionGraphContextUnmemoized(sessionID, includeQuality))
}

async function loadSessionGraphContextUnmemoized(
  sessionID: SessionID,
  includeQuality: boolean,
): Promise<SessionReportData> {
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

export const RunReportRoutes = lazy(() =>
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
      validator("query", RUN_REPORT_QUALITY_QUERY),
      withSessionID(async (sessionID, c) => {
        await requireCurrentProjectSession(sessionID)
        const quality = c.req.valid("query").quality
        const context = await loadSessionGraphContext(sessionID, quality)
        const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""

        disableClientCache(c)
        c.header("content-type", "text/html; charset=utf-8")
        return c.body(
          sessionPage({
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
      validator("query", RUN_REPORT_QUALITY_QUERY),
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
