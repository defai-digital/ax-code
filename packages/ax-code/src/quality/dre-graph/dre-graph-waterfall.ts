import type { ExecutionGraph } from "../../graph"
import { clip, formatDuration, linear, niceTicks } from "./dre-graph-svg"
import { esc } from "./dre-graph-format"

export type WaterfallRow = {
  id: string
  label: string
  kind: "tool" | "llm" | "error"
  status: "ok" | "error" | "pending"
  start: number
  duration: number
  step?: number
  tokens?: { input: number; output: number }
  /** Offset from the first event on the wall clock; `start` is shorter when idle gaps are compressed. */
  wallStart: number
}

export type Waterfall = {
  rows: WaterfallRow[]
  total: number
  hidden: number
  slowest?: WaterfallRow
  failures: number
  /** Set when long idle gaps were collapsed so bars stay visible; both values are milliseconds. */
  compressed?: { wall: number; active: number }
}

const MAX_ROWS = 40
/** Below this active/wall-clock share a run counts as mostly idle. */
const IDLE_RATIO = 0.25

/**
 * Turn the recorded execution graph into time-ordered rows for a waterfall: when each model
 * call and tool call started, how long it ran, and whether it failed. When a long run has
 * more rows than fit, the slowest and failed rows are kept and the rest are counted.
 */
export function buildWaterfall(graph: ExecutionGraph.Graph): Waterfall {
  const timed = graph.nodes.filter(
    (node) =>
      (node.type === "tool_call" || node.type === "llm" || node.type === "error") && Number.isFinite(node.timestamp),
  )
  if (timed.length === 0) return { rows: [], total: 0, hidden: 0, failures: 0 }
  const origin = timed.reduce((earliest, node) => Math.min(earliest, node.timestamp), Infinity)
  const all: WaterfallRow[] = timed
    .map((node) => ({
      id: node.id,
      label: node.type === "llm" ? "model" : (node.tool ?? node.label),
      kind: node.type === "tool_call" ? ("tool" as const) : node.type === "llm" ? ("llm" as const) : ("error" as const),
      status: node.type === "error" ? ("error" as const) : (node.status ?? "ok"),
      start: Math.max(0, node.timestamp - origin),
      wallStart: Math.max(0, node.timestamp - origin),
      duration: Number.isFinite(node.duration) ? Math.max(0, node.duration!) : 0,
      step: node.stepIndex,
      tokens: node.tokens,
    }))
    .sort((a, b) => a.start - b.start)
  const wall = all.reduce((latest, row) => Math.max(latest, row.start + row.duration), 1)
  let total = wall
  let compressed: Waterfall["compressed"]
  // Scheduled or waiting runs can span hours with minutes of work; on a wall-clock axis every
  // bar becomes a hairline. Collapse long idle gaps and say so, keeping order and durations.
  let active = 0
  let reach = 0
  for (const row of all) {
    const end = row.start + row.duration
    active += Math.max(0, end - Math.max(row.start, reach))
    reach = Math.max(reach, end)
  }
  if (all.length > 1 && active > 0 && active / wall < IDLE_RATIO) {
    const cap = Math.max(1000, active * 0.02)
    let removed = 0
    let covered = 0
    for (const row of all) {
      const gap = row.start - covered
      if (gap > cap) removed += gap - cap
      covered = Math.max(covered, row.start + row.duration)
      row.start -= removed
    }
    total = all.reduce((latest, row) => Math.max(latest, row.start + row.duration), 1)
    compressed = { wall, active }
  }
  let kept = all
  if (all.length > MAX_ROWS) {
    const keep = new Set(
      [...all]
        .sort((a, b) => Number(b.status === "error") - Number(a.status === "error") || b.duration - a.duration)
        .slice(0, MAX_ROWS)
        .map((row) => row.id),
    )
    kept = all.filter((row) => keep.has(row.id))
  }
  const slowest = [...kept].filter((row) => row.kind === "tool").sort((a, b) => b.duration - a.duration)[0]
  return {
    rows: kept,
    total,
    hidden: all.length - kept.length,
    slowest: slowest && slowest.duration > 0 ? slowest : undefined,
    failures: all.filter((row) => row.status === "error").length,
    compressed,
  }
}

const LABEL_W = 170
const PLOT_W = 780
const ROW_H = 22
const TOP = 26

export function waterfallSvg(chart: Waterfall): string {
  const ticks = niceTicks(chart.total, 5)
  const height = TOP + chart.rows.length * ROW_H + 8
  const axisMax = ticks[ticks.length - 1] || chart.total
  const x = linear(axisMax, PLOT_W)
  return [
    `<svg class="waterfall" viewBox="0 0 ${LABEL_W + PLOT_W + 20} ${height}" role="img" aria-label="${esc(
      `Execution waterfall: ${chart.rows.length} calls over ${formatDuration(chart.total)}`,
    )}">`,
    ticks
      .map(
        (tick) =>
          `<g class="wf-tick"><line x1="${LABEL_W + x(tick)}" x2="${LABEL_W + x(tick)}" y1="${TOP - 6}" y2="${height - 6}" />` +
          `<text x="${LABEL_W + x(tick)}" y="${TOP - 10}" text-anchor="middle">${esc(formatDuration(tick))}</text></g>`,
      )
      .join(""),
    chart.rows
      .map((row, index) => {
        const y = TOP + index * ROW_H
        const barW = Math.max(3, x(row.duration))
        const slowest = chart.slowest?.id === row.id
        const detail = [
          row.kind === "llm" ? "model call" : row.kind === "error" ? "error" : `tool ${row.label}`,
          formatDuration(row.duration),
          `starts +${formatDuration(row.wallStart)}`,
          row.step !== undefined ? `step ${row.step}` : "",
          row.status,
          row.tokens
            ? `${row.tokens.input.toLocaleString()} in / ${row.tokens.output.toLocaleString()} out tokens`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
        return [
          `<g class="wf-row ${esc(row.kind)} ${esc(row.status)}${slowest ? " slowest" : ""}">`,
          `<title>${esc(detail)}</title>`,
          `<text class="wf-label" x="${LABEL_W - 8}" y="${y + 14}" text-anchor="end">${row.status === "error" ? "✗ " : ""}${esc(clip(row.label, 24))}</text>`,
          `<rect class="wf-bar" x="${LABEL_W + x(row.start)}" y="${y + 3}" width="${barW}" height="${ROW_H - 8}" rx="3" />`,
          // Keep the duration readable: right of the bar when there is room, otherwise left of it.
          x(row.start) + barW + 46 > PLOT_W
            ? `<text class="wf-dur" x="${LABEL_W + x(row.start) - 6}" y="${y + 14}" text-anchor="end">${esc(formatDuration(row.duration))}</text>`
            : `<text class="wf-dur" x="${LABEL_W + x(row.start) + barW + 6}" y="${y + 14}">${esc(formatDuration(row.duration))}</text>`,
          `</g>`,
        ].join("")
      })
      .join(""),
    `</svg>`,
  ].join("")
}

export function traceSection(input: { graph: ExecutionGraph.Graph; ganttHref: string }) {
  const chart = buildWaterfall(input.graph)
  const caption =
    chart.rows.length === 0
      ? "No timed steps were recorded for this run."
      : [
          chart.compressed
            ? `${chart.rows.length + chart.hidden} timed calls · ${formatDuration(chart.compressed.active)} active in ${formatDuration(chart.compressed.wall)} (idle gaps compressed)`
            : `${chart.rows.length + chart.hidden} timed ${chart.rows.length + chart.hidden === 1 ? "call" : "calls"} over ${formatDuration(chart.total)}`,
          chart.slowest ? `slowest: ${chart.slowest.label} ${formatDuration(chart.slowest.duration)}` : "",
          chart.failures > 0 ? `${chart.failures} failed` : "no failures",
          chart.hidden > 0 ? `showing the ${chart.rows.length} slowest and failed` : "",
        ]
          .filter(Boolean)
          .join(" · ")
  return [
    `<section class="band" id="timeline">`,
    `<div class="wrap">`,
    `<div class="panel">`,
    `<h3>Trace</h3>`,
    `<p class="trace-caption">${esc(caption)}</p>`,
    chart.rows.length > 0 ? waterfallSvg(chart) : "",
    `<p class="trace-links"><a href="${esc(input.ganttHref)}">Open the raw Gantt (SVG)</a></p>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
