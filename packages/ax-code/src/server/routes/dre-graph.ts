import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { lazy } from "../../util/lazy"

function esc(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function time(ms?: number) {
  if (ms == null) return "0s"
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
}

function stamp(ms?: number) {
  if (ms == null) return "unknown"
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19)
}

function num(value?: number) {
  return (value ?? 0).toLocaleString()
}

function tone(value?: string | null) {
  const text = (value ?? "").toLowerCase()
  if (text.includes("critical")) return "critical"
  if (text.includes("high")) return "high"
  if (text.includes("medium")) return "medium"
  return "low"
}

function chip(input: { label: string; kind?: string }) {
  return `<span class="chip ${esc(input.kind ?? "neutral")}">${esc(input.label)}</span>`
}

function stat(input: { label: string; value: string; kind?: string }) {
  return [
    `<div class="stat ${esc(input.kind ?? "neutral")}">`,
    `<span class="stat-label">${esc(input.label)}</span>`,
    `<strong class="stat-value">${esc(input.value)}</strong>`,
    "</div>",
  ].join("")
}

function flow(nodes: string[]) {
  if (nodes.length === 0) return `<p class="empty">No recorded nodes.</p>`
  return [
    `<div class="flow">`,
    nodes
      .map((item, idx) =>
        [
          idx > 0 ? `<span class="join" aria-hidden="true"></span>` : "",
          `<span class="node">${esc(item)}</span>`,
        ].join(""),
      )
      .join(""),
    `</div>`,
  ].join("")
}

function lines(items: string[]) {
  if (items.length === 0) return `<p class="empty">No recorded items.</p>`
  return [
    `<div class="list">`,
    items.map((item) => `<div class="list-row"><span>${esc(item)}</span></div>`).join(""),
    `</div>`,
  ].join("")
}

function graph(input: SessionGraph.Snapshot) {
  const head = input.topology.find((item) => item.kind === "heading")
  const path = input.topology.find((item) => item.kind === "path")
  const steps = input.topology.filter((item) => item.kind === "step")
  const pairs = input.topology.filter((item) => item.kind === "pair")
  const meta = input.graph.metadata

  return [
    `<section class="band">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    `<div class="panel-head">`,
    `<h2>Execution Graph</h2>`,
    `<p>${esc(head?.text ?? "No execution graph recorded.")}</p>`,
    `</div>`,
    `<div class="stats">`,
    stat({ label: "Nodes", value: num(input.graph.nodes.length) }),
    stat({ label: "Edges", value: num(input.graph.edges.length) }),
    stat({ label: "Steps", value: num(meta.steps) }),
    stat({ label: "Risk", value: `${meta.risk.level} ${meta.risk.score}/100`, kind: tone(meta.risk.level) }),
    `</div>`,
    `<div class="split">`,
    `<div>`,
    `<h3>Critical Path</h3>`,
    path && "nodes" in path ? flow(path.nodes) : `<p class="empty">No path recorded.</p>`,
    `</div>`,
    `<div>`,
    `<h3>Tool Pairs</h3>`,
    pairs.length
      ? `<div class="pair-list">${pairs
          .map((item) => `<div class="pair"><span>${esc(item.call)}</span><span class="pair-arrow">→</span><span>${esc(item.result)}</span></div>`)
          .join("")}</div>`
      : `<p class="empty">No tool/result pairs recorded.</p>`,
    `</div>`,
    `</div>`,
    `<div>`,
    `<h3>Step Flows</h3>`,
    steps.length
      ? steps
          .map(
            (item) =>
              `<div class="lane"><div class="lane-head">Step ${item.stepIndex}</div>${flow(item.nodes)}</div>`,
          )
          .join("")
      : `<p class="empty">No step flows recorded.</p>`,
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

function decision(input: SessionDre.Snapshot) {
  const detail = input.detail
  return [
    `<div class="panel-head">`,
    `<h2>Decision Engine</h2>`,
    detail ? `<p>${esc(detail.decision)}</p>` : `<p>No DRE decision recorded.</p>`,
    `</div>`,
    detail
      ? [
          `<div class="stats">`,
          stat({ label: "Risk", value: `${detail.level} ${detail.score}/100`, kind: tone(detail.level) }),
          stat({ label: "Duration", value: time(detail.duration) }),
          stat({ label: "Tokens", value: `${num(detail.tokens.input)}/${num(detail.tokens.output)}` }),
          stat({ label: "Stats", value: detail.stats }),
          `</div>`,
          `<div class="stack">`,
          `<div><h3>Plan</h3><p>${esc(detail.plan)}</p></div>`,
          `<div><h3>Summary</h3><p>${esc(detail.summary)}</p></div>`,
          `<div><h3>Scorecard</h3>${detail.scorecard.breakdown.length ? `<div class="list">${detail.scorecard.breakdown
            .map(
              (item) =>
                `<div class="list-row"><span>${esc(item.label)}</span><strong>${Math.round(item.value * 100)}%</strong><span class="muted">${esc(item.detail)}</span></div>`,
            )
            .join("")}</div>` : `<p class="empty">No scoring recorded.</p>`}</div>`,
          `<div><h3>Routes</h3>${detail.routes.length ? `<div class="list">${detail.routes
            .map(
              (item) =>
                `<div class="list-row"><span>${esc(item.from)} → ${esc(item.to)}</span><strong>${item.confidence.toFixed(2)}</strong></div>`,
            )
            .join("")}</div>` : `<p class="empty">No routes recorded.</p>`}</div>`,
          `<div><h3>Notes</h3>${lines(detail.notes)}</div>`,
          `<div><h3>Tool Mix</h3>${detail.tools.length ? flow(detail.tools) : `<p class="empty">No tools recorded.</p>`}</div>`,
          `<div><h3>Semantic Diff</h3>${
            detail.semantic
              ? `${flow([detail.semantic.headline, ...detail.semantic.signals.slice(0, 3)])}`
              : `<p class="empty">No semantic diff recorded.</p>`
          }</div>`,
          `</div>`,
        ].join("")
      : `<p class="empty">Run a session with tool activity to populate this view.</p>`,
    `</div>`,
  ].join("")
}

function risk(input: SessionRisk.Detail) {
  return [
    `<div class="stack">`,
    `<div class="stats">`,
    stat({ label: "Level", value: input.assessment.level, kind: tone(input.assessment.level) }),
    stat({ label: "Score", value: `${input.assessment.score}/100`, kind: tone(input.assessment.level) }),
    stat({ label: "Files", value: num(input.assessment.signals.filesChanged) }),
    stat({ label: "Lines", value: num(input.assessment.signals.linesChanged) }),
    `</div>`,
    `<div><h3>Drivers</h3>${lines(input.drivers)}</div>`,
    `<div><h3>Breakdown</h3>${
      input.assessment.breakdown.length
        ? `<div class="list">${input.assessment.breakdown
            .map(
              (item) =>
                `<div class="list-row"><span>${esc(item.label)}</span><strong>+${item.points}</strong><span class="muted">${esc(item.detail)}</span></div>`,
            )
            .join("")}</div>`
        : `<p class="empty">No breakdown recorded.</p>`
    }</div>`,
    `<div><h3>Semantic Diff</h3>${
      input.semantic ? flow([input.semantic.headline, ...input.semantic.signals.slice(0, 3)]) : `<p class="empty">No semantic diff recorded.</p>`
    }</div>`,
    `</div>`,
  ].join("")
}

function branches(input: SessionBranchRank.Family) {
  return [
    `<section class="band">`,
    `<div class="wrap grid">`,
    `<div class="panel">`,
    `<div class="panel-head">`,
    `<h2>Branch Ranking</h2>`,
    `<p>${esc(input.reasons.join(" · "))}</p>`,
    `</div>`,
    `<div class="stats">`,
    stat({ label: "Current", value: input.current.title }),
    stat({ label: "Recommended", value: input.recommended.title, kind: "low" }),
    stat({ label: "Confidence", value: input.confidence.toFixed(2) }),
    `</div>`,
    `<div class="list">`,
    input.items
      .map((item) =>
        [
          `<div class="list-row branch">`,
          `<div class="branch-head">`,
          `<strong>${esc(item.title)}</strong>`,
          `<div class="tag-row">`,
          item.current ? chip({ label: "Current", kind: "neutral" }) : "",
          item.recommended ? chip({ label: "Recommended", kind: "low" }) : "",
          chip({ label: `${item.risk.level} ${item.risk.score}/100`, kind: tone(item.risk.level) }),
          chip({ label: `Score ${item.decision.total.toFixed(2)}`, kind: "neutral" }),
          `</div>`,
          `</div>`,
          `<span>${esc(item.headline)}</span>`,
          `<span class="muted">${esc(item.view.plan)}</span>`,
          item.semantic ? `<span class="muted">${esc(item.semantic.headline)}</span>` : "",
          `</div>`,
        ].join(""),
      )
      .join(""),
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

function rollback(points: SessionRollback.Point[]) {
  return [
    `<div class="panel">`,
    `<div class="panel-head">`,
    `<h2>Rollback Points</h2>`,
    `<p>${points.length ? `${points.length} recorded step${points.length === 1 ? "" : "s"}.` : "No rollback points recorded."}</p>`,
    `</div>`,
    points.length
      ? `<div class="list">${points
          .map(
            (item) =>
              `<div class="list-row"><strong>Step ${item.step}</strong><span>${esc(item.kinds.join(", ") || "no tool kind")}</span><span class="muted">${esc(item.tools.join(" · ") || "no tool labels")}</span><span class="muted">${time(item.duration)} · ${item.tokens ? `${num(item.tokens.input)}/${num(item.tokens.output)} tokens` : "no tokens"}</span></div>`,
          )
          .join("")}</div>`
      : `<p class="empty">Run a session with assistant steps to populate rollback points.</p>`,
    `</div>`,
  ].join("")
}

function style() {
  return `
    :root {
      color-scheme: dark;
      --bg: #0e1110;
      --panel: #161b19;
      --line: #27302b;
      --text: #f3efe5;
      --muted: #b7b0a1;
      --accent: #66c2a5;
      --warn: #e7b95a;
      --high: #e8796b;
      --critical: #f04f88;
      --low: #74d68f;
      --shadow: rgba(0, 0, 0, 0.28);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: linear-gradient(180deg, #101514 0%, #0b0e0e 100%);
      color: var(--text);
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .hero, .band { padding: 24px 20px; }
    .wrap { max-width: 1200px; margin: 0 auto; }
    .hero .wrap { display: grid; gap: 16px; }
    .hero h1 { margin: 0; font-size: 32px; line-height: 1.1; }
    .hero p { margin: 0; color: var(--muted); }
    .meta, .links, .stats, .tag-row, .flow { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .links { row-gap: 8px; }
    .grid { max-width: 1200px; margin: 0 auto; display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .panel {
      background: color-mix(in srgb, var(--panel) 94%, black);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 14px 40px var(--shadow);
    }
    .panel-head { display: grid; gap: 6px; margin-bottom: 16px; }
    .panel-head h2, h3 { margin: 0; }
    .panel-head p, .stack p, .muted { color: var(--muted); }
    .stack { display: grid; gap: 16px; }
    .stat, .chip, .node {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      background: rgba(255, 255, 255, 0.03);
    }
    .stat { min-width: 132px; display: grid; gap: 4px; }
    .stat-label { font-size: 12px; color: var(--muted); text-transform: uppercase; }
    .stat-value { font-size: 15px; }
    .low { border-color: color-mix(in srgb, var(--low) 65%, var(--line)); }
    .medium { border-color: color-mix(in srgb, var(--warn) 65%, var(--line)); }
    .high { border-color: color-mix(in srgb, var(--high) 65%, var(--line)); }
    .critical { border-color: color-mix(in srgb, var(--critical) 65%, var(--line)); }
    .join {
      width: 24px;
      height: 2px;
      background: color-mix(in srgb, var(--accent) 55%, transparent);
      border-radius: 999px;
    }
    .split { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-bottom: 16px; }
    .lane { display: grid; gap: 10px; padding-top: 12px; }
    .lane-head { color: var(--muted); font-size: 13px; text-transform: uppercase; }
    .pair-list, .list { display: grid; gap: 10px; }
    .pair, .list-row {
      display: grid;
      gap: 6px;
      padding: 12px 0;
      border-top: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
    }
    .pair:first-child, .list-row:first-child { border-top: 0; padding-top: 0; }
    .pair-arrow { color: var(--accent); }
    .branch { align-items: start; }
    .branch-head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: space-between;
      align-items: center;
    }
    .session-list {
      display: grid;
      gap: 12px;
    }
    .session-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: rgba(255, 255, 255, 0.03);
    }
    .session-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .empty { color: var(--muted); margin: 0; }
    @media (max-width: 900px) {
      .grid, .split { grid-template-columns: 1fr; }
      .hero h1 { font-size: 26px; }
    }
  `
}

function index(input: { list: Session.Info[]; search: string }) {
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
    `<title>AX DRE Graph</title>`,
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div>`,
    `<h1>DRE Graph</h1>`,
    `<p>DRE Graph Sessions</p>`,
    `</div>`,
    `<div class="meta">`,
    chip({ label: `${input.list.length} session${input.list.length === 1 ? "" : "s"}` }),
    `</div>`,
    `</div>`,
    `</header>`,
    `<section class="band">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    `<div class="panel-head">`,
    `<h2>Sessions</h2>`,
    `<p>Recent sessions for this workspace.</p>`,
    `</div>`,
    input.list.length
      ? `<div class="session-list">${input.list
          .map(
            (item) =>
              `<div class="session-card"><div class="session-head"><strong>${esc(item.title)}</strong>${link(
                `/dre-graph/session/${item.id}`,
                "open",
              )}</div><div class="tag-row">${chip({ label: item.id })}${chip({ label: stamp(item.time.updated) })}${chip({
                label: item.parentID ? "fork" : "root",
              })}</div><span class="muted">${esc(item.directory)}</span></div>`,
          )
          .join("")}</div>`
      : `<p class="empty">No sessions recorded.</p>`,
    `</div>`,
    `</div>`,
    `</section>`,
    `</body>`,
    `</html>`,
  ].join("")
}

function page(input: {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank: SessionBranchRank.Family
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
    `<title>AX DRE Graph · ${title}</title>`,
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div>`,
    `<h1>DRE Graph</h1>`,
    `<p>${title}</p>`,
    `</div>`,
    `<div class="meta">`,
    chip({ label: sid }),
    chip({ label: dir }),
    chip({ label: `${input.rank.recommended.title} recommended`, kind: tone(input.rank.recommended.risk.level) }),
    `</div>`,
    `<div class="links">`,
    link(`/dre-graph`, "all sessions"),
    link(`/session/${sid}/graph`, "graph json"),
    link(`/session/${sid}/dre`, "dre json"),
    link(`/session/${sid}/risk`, "risk json"),
    link(`/session/${sid}/branch/rank`, "branch json"),
    link(`/session/${sid}/rollback`, "rollback json"),
    link(`/graph/${sid}`, "ascii graph", { format: "ascii" }),
    link(`/graph/${sid}`, "mermaid", { format: "mermaid" }),
    `</div>`,
    `</div>`,
    `</header>`,
    graph(input.graph),
    `<section class="band">`,
    `<div class="wrap grid">`,
    `<div class="panel">${decision(input.dre)}</div>`,
    `<div class="panel"><div class="panel-head"><h2>Risk Detail</h2><p>${esc(input.risk.title)}</p></div>${risk(input.risk)}</div>`,
    `</div>`,
    `</section>`,
    branches(input.rank),
    `<section class="band">`,
    `<div class="wrap grid">`,
    rollback(input.rollback),
    `<div class="panel"><div class="panel-head"><h2>Timeline</h2><p>${esc(input.dre.timeline[0]?.text ?? "No timeline recorded.")}</p></div>${lines(
      input.dre.timeline.slice(1).map((item) => item.text),
    )}</div>`,
    `</div>`,
    `</section>`,
    `</body>`,
    `</html>`,
  ].join("")
}

export const DreGraphRoutes = lazy(() =>
  new Hono()
    .get("/", async (c) => {
      const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""
      const list = [] as Session.Info[]
      for await (const item of Session.list({ limit: 50 })) list.push(item)
      c.header("content-type", "text/html; charset=utf-8")
      return c.body(index({ list, search }))
    })
    .get(
      "/session/:sessionID",
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const sid = c.req.valid("param").sessionID
        const session = await Session.get(sid)
        const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""
        const [graphData, dre, riskData, rank, points] = await Promise.all([
          Promise.resolve(SessionGraph.snapshot(sid)),
          SessionDre.snapshot(sid),
          SessionRisk.load(sid),
          SessionBranchRank.family(sid),
          SessionRollback.points(sid),
        ])

        c.header("content-type", "text/html; charset=utf-8")
        return c.body(
          page({
            session,
            graph: graphData,
            dre,
            risk: riskData,
            rank,
            rollback: points,
            search,
          }),
        )
      },
    ),
)
