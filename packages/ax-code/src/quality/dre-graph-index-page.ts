import type { Session } from "../session"
import { Risk } from "../risk/score"
import { SessionUsage } from "../session/usage"
import { live, themeScript, themeToggle } from "./dre-graph-assets"
import { compact, esc, num, readiness, readinessTone, stamp, tone } from "./dre-graph-format"
import { style } from "./dre-graph-style"
import { barChart, chip, dailyChart, stat } from "./dre-graph-widgets"

export type SessionSummaryRow = { session: Session.Info; risk: Risk.Assessment }

const DASHBOARD_WINDOW_DAYS = 30
const ACTIVITY_CHART_DAYS = 14
const TOP_BREAKDOWN = 8

function usagePanel(usage: SessionUsage.Info) {
  return [
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>Usage — last ${usage.days ?? DASHBOARD_WINDOW_DAYS} days</h3>`,
    `<div class="summary-stats">`,
    stat({ label: "Sessions", value: num(usage.sessions), icon: "⬡" }),
    stat({ label: "Messages", value: num(usage.messages), icon: "✉" }),
    stat({ label: "Tokens", value: compact(usage.totalTokens), icon: "◈" }),
    stat({
      label: "Cache share",
      value: usage.cacheShare === undefined ? "—" : `${Math.round(usage.cacheShare * 100)}%`,
      kind: usage.cacheShare === undefined ? "neutral" : usage.cacheShare >= 0.5 ? "low" : "neutral",
      icon: "▣",
    }),
    `</div>`,
    `<p class="muted" style="font-size:12px;margin-top:10px">${num(usage.tokens.input)} in · ${num(
      usage.tokens.output,
    )} out · ${num(usage.tokens.reasoning)} reasoning · ${num(usage.tokens.cache.read)} cache read · ${num(
      usage.tokens.cache.write,
    )} cache write</p>`,
    `</div>`,
  ].join("")
}

function activityPanel(usage: SessionUsage.Info) {
  if (usage.perDay.length === 0) return ""
  return [
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>Activity — last ${ACTIVITY_CHART_DAYS} days</h3>`,
    dailyChart({ days: usage.perDay.slice(-ACTIVITY_CHART_DAYS) }),
    `<p class="muted" style="font-size:11px;margin-top:8px">Bar height is tokens per day; hover for detail. ${num(
      usage.activeDays,
    )} active day${usage.activeDays === 1 ? "" : "s"} in the window.</p>`,
    `</div>`,
  ].join("")
}

function breakdownPanel(input: {
  title: string
  items: { label: string; value: number; detail?: string }[]
  empty: string
}) {
  return [
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>${esc(input.title)}</h3>`,
    input.items.length ? barChart({ items: input.items, format: compact }) : `<p class="empty">${esc(input.empty)}</p>`,
    `</div>`,
  ].join("")
}

function health(rows: SessionSummaryRow[]) {
  if (rows.length === 0) return ""
  const scores = rows.map((r) => r.risk.score)
  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  const readinessCounts = rows.reduce(
    (acc, r) => {
      acc[r.risk.readiness] = (acc[r.risk.readiness] ?? 0) + 1
      return acc
    },
    {} as Record<Risk.Readiness, number>,
  )
  const validated = rows.filter(
    (r) => r.risk.signals.validationState === "passed" || r.risk.signals.validationState === "failed",
  )
  const passRate = validated.length
    ? Math.round((validated.filter((r) => r.risk.signals.validationState === "passed").length / validated.length) * 100)
    : undefined

  return [
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>Session Health</h3>`,
    `<div class="summary-stats">`,
    stat({ label: "Avg risk", value: `${avgScore}/100`, kind: tone(Risk.levelForScore(avgScore)), icon: "◌" }),
    stat({ label: "Ready", value: num(readinessCounts.ready ?? 0), kind: "low", icon: "✓" }),
    stat({
      label: "Needs attention",
      value: num((readinessCounts.needs_validation ?? 0) + (readinessCounts.needs_review ?? 0)),
      kind: (readinessCounts.needs_validation ?? 0) + (readinessCounts.needs_review ?? 0) > 0 ? "medium" : "neutral",
      icon: "◑",
    }),
    stat({
      label: "Blocked",
      value: num(readinessCounts.blocked ?? 0),
      kind: (readinessCounts.blocked ?? 0) > 0 ? "high" : "neutral",
      icon: "✗",
    }),
    stat({
      label: "Validation pass rate",
      value: passRate === undefined ? "—" : `${passRate}%`,
      kind: passRate === undefined ? "neutral" : passRate >= 80 ? "low" : passRate >= 40 ? "medium" : "high",
      icon: "▣",
    }),
    `</div>`,
    `</div>`,
  ].join("")
}

export function index(input: { rows: SessionSummaryRow[]; usage: SessionUsage.Info; search: string }) {
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const dir = base.get("directory") ?? input.rows[0]?.session.directory ?? undefined
  const link = (path: string, label: string, query?: Record<string, string>) => {
    const url = new URL(path, "http://ax-code.local")
    for (const [key, value] of base.entries()) url.searchParams.set(key, value)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    return `<a href="${esc(url.pathname + url.search)}">${esc(label)}</a>`
  }

  const models = Object.entries(input.usage.models)
    .sort((a, b) => b[1].tokens - a[1].tokens || a[0].localeCompare(b[0]))
    .slice(0, TOP_BREAKDOWN)
    .map(([model, entry]) => ({
      label: model,
      value: entry.tokens,
      detail: `${num(entry.messages)} message${entry.messages === 1 ? "" : "s"}`,
    }))
  const tools = Object.entries(input.usage.tools)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_BREAKDOWN)
    .map(([tool, count]) => ({ label: tool, value: count }))

  return [
    "<!doctype html>",
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>AX Code · Dashboard</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand" title="AX Code workspace dashboard">AX Code</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">Workspace Dashboard</div>`,
    `<p class="hero-subtitle">${dir ? `${esc(dir)} · ` : ""}${input.rows.length} session${
      input.rows.length === 1 ? "" : "s"
    } in this workspace</p>`,
    `</div>`,
    `</header>`,
    `<section class="band">`,
    `<div class="wrap">`,
    usagePanel(input.usage),
    activityPanel(input.usage),
    breakdownPanel({
      title: "Model usage",
      items: models,
      empty: "No model usage recorded in this window.",
    }),
    breakdownPanel({
      title: "Tool usage",
      items: tools,
      empty: "No tool calls recorded in this window.",
    }),
    health(input.rows),
    `<div class="panel">`,
    `<h3>Sessions</h3>`,
    input.rows.length
      ? `<div class="session-list">${input.rows
          .map(({ session: item, risk }) =>
            [
              `<div class="session-card">`,
              `<div class="session-head">`,
              `<strong>${esc(item.title)}</strong>`,
              link(`/dre-graph/session/${item.id}`, "View →"),
              `</div>`,
              `<div class="tag-row">`,
              chip({ label: stamp(item.time.updated) }),
              chip({ label: item.parentID ? "fork" : "root" }),
              chip({ label: `${compact(input.usage.perSession[item.id] ?? 0)} tokens` }),
              chip({ label: `${risk.level.toLowerCase()} risk`, kind: tone(risk.level) }),
              chip({ label: readiness(risk.readiness), kind: readinessTone(risk.readiness) }),
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
