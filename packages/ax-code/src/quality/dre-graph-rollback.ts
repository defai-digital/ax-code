import type { SessionRollback } from "../session/rollback"
import { esc, time } from "./dre-graph-format"

export function renderDreGraphRollbackBars(points: SessionRollback.Point[], emptyMessage: string) {
  if (!points.length) return `<p class="empty">${esc(emptyMessage)}</p>`

  const maxDuration = Math.max(...points.map((point) => point.duration ?? 0), 1)

  return [
    `<div class="rb-bars-list">`,
    points
      .map((point, index) => {
        const duration = point.duration ?? 0
        const durationPct = Math.max(3, (duration / maxDuration) * 100)
        const barColor = duration > maxDuration * 0.6 ? "var(--warn)" : "var(--accent)"
        const toolSummary = summarizeRollbackToolKinds(point.kinds)

        return [
          `<div class="rb-row">`,
          `<span class="rb-idx">${index + 1}</span>`,
          `<div class="rb-content">`,
          `<div class="rb-bar-line">`,
          `<div class="rb-bar-track"><div class="rb-bar-fill" style="width:${durationPct.toFixed(0)}%;background:${barColor}"></div></div>`,
          `<span class="rb-dur">${time(duration)}</span>`,
          `</div>`,
          toolSummary ? `<span class="rb-tools-text">${esc(toolSummary)}</span>` : "",
          `</div>`,
          `</div>`,
        ].join("")
      })
      .join(""),
    `</div>`,
  ].join("")
}

export function summarizeRollbackToolKinds(kinds: string[]) {
  const counts = new Map<string, number>()
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => (count > 1 ? `${kind} ×${count}` : kind)).join(", ")
}
