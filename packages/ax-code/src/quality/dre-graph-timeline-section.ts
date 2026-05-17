import type { SessionDre } from "../session/dre"
import type { SessionRollback } from "../session/rollback"
import { esc } from "./dre-graph-format"
import { renderDreGraphRollbackBars } from "./dre-graph-rollback"
import { parseDreGraphTimeline, parseDreGraphTimelineStepDurationMs } from "./dre-graph-timeline"

export function timelineSection(dre: SessionDre.Snapshot, points: SessionRollback.Point[], detail?: SessionDre.Detail | null) {
  const parsed = parseDreGraphTimeline(dre.timeline)

  const ganttHtml = parsed.steps.length
    ? (() => {
        const durations = parsed.steps.map((s) => parseDreGraphTimelineStepDurationMs(s.duration))
        const maxDur = Math.max(...durations, 1)
        const allSameIndex = parsed.steps.every((s) => s.index === parsed.steps[0].index)

        return [
          `<div class="gantt">`,
          parsed.steps
            .map((step, idx) => {
              const dur = durations[idx]
              const pct = Math.max(2, (dur / maxDur) * 100)
              const hasErrors = step.errors.length > 0
              const barColor = hasErrors ? "var(--high)" : dur > maxDur * 0.5 ? "var(--warn)" : "var(--accent)"
              const counts = new Map<string, { count: number; totalMs: number; errors: number }>()

              for (const t of step.tools) {
                const entry = counts.get(t.name) ?? { count: 0, totalMs: 0, errors: 0 }
                entry.count++
                entry.totalMs += t.durationMs
                if (t.status === "ERR") entry.errors++
                counts.set(t.name, entry)
              }

              const sorted = [...counts.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs)
              const toolMaxMs = Math.max(...sorted.map((s) => s[1].totalMs), 1)
              const topTools = sorted
                .slice(0, 3)
                .map(([n, info]) => (info.count > 1 ? `${n} ×${info.count}` : n))
                .join(", ")
              const label = allSameIndex ? `Turn ${idx + 1}` : step.index

              return [
                `<div class="gantt-step">`,
                `<div class="gantt-header">`,
                `<span class="gantt-label">${esc(label)}</span>`,
                `<div class="gantt-bar-wrap">`,
                `<div class="gantt-bar" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>`,
                `</div>`,
                `<span class="gantt-dur">${esc(step.duration)}</span>`,
                `</div>`,
                `<div class="gantt-meta">`,
                topTools ? `<span class="gantt-tools-sig">${esc(topTools)}</span>` : "",
                step.routes.length ? `<span class="gantt-route">${step.routes.map((r) => esc(r)).join(", ")}</span>` : "",
                `</div>`,
                step.tools.length > 0
                  ? [
                      `<details class="gantt-details">`,
                      `<summary class="gantt-summary">${step.tools.length} tool call${step.tools.length === 1 ? "" : "s"}${hasErrors ? ` · <span class="gantt-err">${step.errors.length} error${step.errors.length === 1 ? "" : "s"}</span>` : ""}${step.tokens ? ` · ${esc(step.tokens)}` : ""}</summary>`,
                      `<div class="gantt-tools">`,
                      sorted
                        .slice(0, 10)
                        .map(([name, info]) => {
                          const timePct = Math.max(2, (info.totalMs / toolMaxMs) * 100)
                          const color =
                            info.errors > 0 ? "var(--high)" : info.totalMs > 5000 ? "var(--warn)" : "var(--low)"
                          return [
                            `<div class="gantt-tool-row">`,
                            `<span class="gantt-tool-name">${esc(name)}${info.count > 1 ? ` <span class="gantt-tool-count">×${info.count}</span>` : ""}</span>`,
                            `<div class="gantt-tool-bar-wrap"><div class="gantt-tool-bar" style="width:${timePct.toFixed(0)}%;background:${color}"></div></div>`,
                            `<span class="gantt-tool-ms">${info.totalMs >= 1000 ? `${(info.totalMs / 1000).toFixed(1)}s` : `${info.totalMs}ms`}</span>`,
                            `</div>`,
                          ].join("")
                        })
                        .join(""),
                      sorted.length > 10
                        ? `<span class="muted" style="font-size:11px;padding:4px 0">+${sorted.length - 10} more tools</span>`
                        : "",
                      `</div>`,
                      `</details>`,
                    ].join("")
                  : "",
                step.errors.length > 0 ? step.errors.map((e) => `<div class="gantt-error">${esc(e)}</div>`).join("") : "",
                `</div>`,
              ].join("")
            })
            .join(""),
          `</div>`,
        ].join("")
      })()
    : `<p class="empty">No timeline recorded.</p>`

  return [
    `<section class="band" id="timeline">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Timeline</h2><p>Execution trace — click a step to expand tool details</p></div>`,
    `<div class="grid">`,
    `<div class="panel">`,
    `<h3>Execution Trace</h3>`,
    parsed.header ? `<p class="muted" style="margin-bottom:14px">${esc(parsed.header.text)}</p>` : "",
    ganttHtml,
    detail?.notes.length
      ? [
          `<div style="margin-top:20px"><h3>Notes</h3>`,
          `<div class="driver-list">`,
          detail.notes
            .map((item) => `<div class="driver-item"><span class="driver-icon">·</span><span>${esc(item)}</span></div>`)
            .join(""),
          `</div></div>`,
        ].join("")
      : "",
    `</div>`,
    `<div class="panel" id="rollback">`,
    `<h3>Rollback Points <span class="rb-count">${points.length}</span></h3>`,
    renderDreGraphRollbackBars(points, "Run a session with assistant steps to populate rollback points."),
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
