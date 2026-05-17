import { Hono } from "hono"
import { validator } from "hono-openapi"
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
import { style } from "../../quality/dre-graph-style"
import { summary } from "../../quality/dre-graph-summary-section"
import { timelineSection } from "../../quality/dre-graph-timeline-section"
import { indexFingerprint, sessionFingerprint } from "../../quality/dre-graph-fingerprint"
import { riskSection } from "../../quality/dre-graph-risk-section"
import { validationSection } from "../../quality/dre-graph-validation-section"
import { verdictSection } from "../../quality/dre-graph-verdict-section"
import { agentDisplay, esc, stamp, tone } from "../../quality/dre-graph-format"
import { barChart, chip, flow, stepSummary } from "../../quality/dre-graph-widgets"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { lazy } from "../../util/lazy"
import { SESSION_ID_PARAM, withSessionID } from "./route-params"

const DRE_GRAPH_QUALITY_QUERY = z.object({
  quality: z.coerce.boolean().optional().default(false),
})

// ── (legacy retained for reference — replaced by activitySection) ──
function graphSection(input: SessionGraph.Snapshot, dre: SessionDre.Snapshot) {
  const head = input.topology.find((item) => item.kind === "heading")
  const path = input.topology.find((item) => item.kind === "path")
  const steps = input.topology.filter((item) => item.kind === "step")
  const pairs = input.topology.filter((item) => item.kind === "pair")
  const detail = dre.detail

  return [
    `<section class="band" id="graph">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Execution</h2><p>${esc(head?.text ?? "No execution graph recorded.")}</p></div>`,
    `<div class="grid">`,
    // Left: Agent routes + Tool sequence
    `<div class="panel">`,
    detail?.routes.length
      ? [
          `<h3>Agent Routes</h3>`,
          `<div class="route-flow">`,
          detail.routes
            .map(
              (item) =>
                `<div class="route-item"><span class="route-from">${esc(agentDisplay(item.from))}</span><span class="route-arrow">→</span><span class="route-to">${esc(agentDisplay(item.to))}</span><span class="route-conf">${item.confidence.toFixed(2)}</span></div>`,
            )
            .join(""),
          `</div>`,
        ].join("")
      : `<h3>Agent Routes</h3><p class="empty">No routes recorded.</p>`,
    detail?.tools.length
      ? [
          `<div style="margin-top:20px"><h3>Tool Usage</h3>`,
          (() => {
            const counts = new Map<string, number>()
            for (const t of detail.tools) counts.set(t, (counts.get(t) ?? 0) + 1)
            const median = [...counts.values()].sort((a, b) => a - b)[Math.floor(counts.size / 2)] ?? 1
            return barChart({
              items: [...counts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 12)
                .map(([label, value]) => ({ label, value })),
              unit: "×",
              colorFn: (v) => (v > median * 4 ? "var(--warn)" : v > median * 2 ? "var(--accent)" : "var(--low)"),
            })
          })(),
          `</div>`,
          `<div style="margin-top:16px"><h3>Tool Sequence</h3>${flow(detail.tools)}</div>`,
        ].join("")
      : "",
    `</div>`,
    // Right: Critical path (pipeline view) + Tool pairs
    `<div class="panel">`,
    `<h3>Critical Path</h3>`,
    path && "nodes" in path
      ? (() => {
          // Parse path nodes into phases grouped by step markers
          type Phase = { label: string; tools: Map<string, number> }
          const phases: Phase[] = []
          let current: Phase = { label: "Init", tools: new Map() }
          phases.push(current)
          for (const node of path.nodes) {
            if (node.startsWith("Step ")) {
              current = { label: node, tools: new Map() }
              phases.push(current)
              continue
            }
            // Extract tool name — strip args and "ok"/"ERR" result nodes
            const colonIdx = node.indexOf(":")
            if (colonIdx > 0) {
              const tool = node.slice(0, colonIdx).trim()
              if (!tool.endsWith(" ok") && !tool.endsWith(" ERR")) {
                current.tools.set(tool, (current.tools.get(tool) ?? 0) + 1)
              }
            } else if (node.startsWith("Start ")) {
              current.label = node
            }
            // Skip result nodes like "read ok", "glob ok"
          }
          // Filter out empty phases
          const active = phases.filter((p) => p.tools.size > 0)
          if (active.length === 0) return `<p class="empty">No path recorded.</p>`

          return [
            `<div class="cpath">`,
            `<div class="cpath-summary">${path.nodes.length.toLocaleString()} nodes across ${active.length} phase${active.length === 1 ? "" : "s"}</div>`,
            active
              .map((phase, idx) => {
                const total = [...phase.tools.values()].reduce((a, b) => a + b, 0)
                const sorted = [...phase.tools.entries()].sort((a, b) => b[1] - a[1])
                return [
                  idx > 0 ? `<div class="cpath-connector"><span class="cpath-arrow">↓</span></div>` : "",
                  `<div class="cpath-phase">`,
                  `<div class="cpath-phase-head">`,
                  `<span class="cpath-phase-label">${esc(phase.label)}</span>`,
                  `<span class="cpath-phase-count">${total} call${total === 1 ? "" : "s"}</span>`,
                  `</div>`,
                  `<div class="cpath-tools">`,
                  sorted
                    .slice(0, 6)
                    .map(([name, count]) => {
                      const pct = Math.max(8, (count / total) * 100)
                      return `<div class="cpath-tool"><span class="cpath-tool-name">${esc(name)}${count > 1 ? ` <span class="cpath-tool-n">×${count}</span>` : ""}</span><div class="cpath-tool-bar" style="width:${pct.toFixed(0)}%"></div></div>`
                    })
                    .join(""),
                  sorted.length > 6
                    ? `<span class="muted" style="font-size:11px">+${sorted.length - 6} more</span>`
                    : "",
                  `</div>`,
                  `</div>`,
                ].join("")
              })
              .join(""),
            `</div>`,
          ].join("")
        })()
      : `<p class="empty">No path recorded.</p>`,
    pairs.length
      ? [
          `<div style="margin-top:20px"><h3>Tool Pairs <span class="rb-count">${pairs.length}</span></h3>`,
          `<div class="pair-list">`,
          pairs
            .slice(0, 12)
            .map((item) => {
              // Clean up pair labels — strip raw args
              const callName = item.call.split(":")[0].trim()
              const resultName = item.result.split(" ")[0].trim()
              return `<div class="pair"><span>${esc(callName)}</span><span class="pair-arrow">→</span><span>${esc(resultName)}</span></div>`
            })
            .join(""),
          pairs.length > 12
            ? `<span class="muted" style="font-size:11px;padding:6px 0;display:block">+${pairs.length - 12} more pairs</span>`
            : "",
          `</div></div>`,
        ].join("")
      : "",
    `</div>`,
    `</div>`,
    // Step flows — compact summaries per step
    steps.length
      ? [
          `<div class="panel" style="margin-top:20px">`,
          `<h3>Steps (${steps.length})</h3>`,
          `<div class="step-grid">`,
          steps
            .map(
              (item) =>
                `<div class="lane"><div class="lane-head">Step ${item.stepIndex}<span class="lane-count">${item.nodes.length} calls</span></div>${stepSummary(item.nodes)}</div>`,
            )
            .join(""),
          `</div></div>`,
        ].join("")
      : "",
    `</div>`,
    `</section>`,
  ].join("")
}

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
    SessionBranchRank.family(sessionID).catch(() => undefined),
    SessionRollback.points(sessionID).catch((): SessionRollback.Point[] => []),
  ])
  return { session, graph, dre, risk, rank, rollback }
}

async function loadSessionList(directory: string | undefined): Promise<Session.Info[]> {
  return [...Session.list({ limit: 50, directory })]
}

function disableClientCache(c: { header: (name: string, value: string) => void }) {
  c.header("cache-control", "no-store")
}

function index(input: { list: Session.Info[]; search: string }) {
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const dir = base.get("directory") ?? input.list[0]?.directory ?? undefined
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
    `<title>AX Code · DRE Sessions</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand">AX Code DRE</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">Sessions</div>`,
    `<p class="hero-subtitle">${input.list.length} session${input.list.length === 1 ? "" : "s"} in this workspace</p>`,
    `</div>`,
    `</header>`,
    `<section class="band">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    input.list.length
      ? `<div class="session-list">${input.list
          .map((item) =>
            [
              `<div class="session-card">`,
              `<div class="session-head">`,
              `<strong>${esc(item.title)}</strong>`,
              link(`/dre-graph/session/${item.id}`, "View →"),
              `</div>`,
              `<div class="tag-row">`,
              chip({ label: stamp(item.time.updated) }),
              chip({ label: item.parentID ? "fork" : "root" }),
              `</div>`,
              `<span class="muted" style="font-size:12px">${esc(item.id)}</span>`,
              `</div>`,
            ].join(""),
          )
          .join("")}</div>`
      : `<p class="empty">No sessions recorded. Run ax-code to create your first session.</p>`,
    `</div>`,
    `</div>`,
    `</section>`,
    live({ directory: dir }),
    `</body>`,
    `</html>`,
  ].join("")
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
  const sid = esc(input.session.id)
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
      const directory = c.req.query("directory") ?? undefined
      const list = await loadSessionList(directory)
      disableClientCache(c)
      c.header("content-type", "text/html; charset=utf-8")
      return c.body(index({ list, search }))
    })
    .get("/fingerprint", async (c) => {
      const directory = c.req.query("directory") ?? undefined
      const list = await loadSessionList(directory)
      disableClientCache(c)
      return c.json(indexFingerprint(list))
    })
    .get(
      "/session/:sessionID",
      validator("param", SESSION_ID_PARAM),
      validator("query", DRE_GRAPH_QUALITY_QUERY),
      withSessionID(async (sessionID, c) => {
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
