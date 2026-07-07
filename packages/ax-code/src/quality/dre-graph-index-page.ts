import type { Session } from "../session"
import { Risk } from "../risk/score"
import { live, themeScript, themeToggle } from "./dre-graph-assets"
import { esc, num, readiness, readinessTone, stamp, tone } from "./dre-graph-format"
import { style } from "./dre-graph-style"
import { chip, stat } from "./dre-graph-widgets"

export type SessionSummaryRow = { session: Session.Info; risk: Risk.Assessment }

function overview(rows: SessionSummaryRow[]) {
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
  const validated = rows.filter((r) => r.risk.signals.validationState === "passed" || r.risk.signals.validationState === "failed")
  const passRate = validated.length
    ? Math.round((validated.filter((r) => r.risk.signals.validationState === "passed").length / validated.length) * 100)
    : undefined

  return [
    `<div class="panel" style="margin-bottom:16px">`,
    `<h3>Workspace Overview</h3>`,
    `<div class="summary-stats">`,
    stat({ label: "Sessions", value: num(rows.length), icon: "⬡" }),
    stat({ label: "Avg risk", value: `${avgScore}/100`, kind: tone(Risk.levelForScore(avgScore)), icon: "◌" }),
    stat({ label: "Ready", value: num(readinessCounts.ready ?? 0), kind: "low", icon: "✓" }),
    stat({
      label: "Needs attention",
      value: num((readinessCounts.needs_validation ?? 0) + (readinessCounts.needs_review ?? 0)),
      kind: (readinessCounts.needs_validation ?? 0) + (readinessCounts.needs_review ?? 0) > 0 ? "medium" : "neutral",
      icon: "◑",
    }),
    stat({ label: "Blocked", value: num(readinessCounts.blocked ?? 0), kind: (readinessCounts.blocked ?? 0) > 0 ? "high" : "neutral", icon: "✗" }),
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

export function index(input: { rows: SessionSummaryRow[]; search: string }) {
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const dir = base.get("directory") ?? input.rows[0]?.session.directory ?? undefined
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
    `<span class="nav-brand" title="Debugging & Refactoring Engine">AX Code DRE</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">Sessions</div>`,
    `<p class="hero-subtitle">${input.rows.length} session${input.rows.length === 1 ? "" : "s"} in this workspace</p>`,
    `</div>`,
    `</header>`,
    `<section class="band">`,
    `<div class="wrap">`,
    overview(input.rows),
    `<div class="panel">`,
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
