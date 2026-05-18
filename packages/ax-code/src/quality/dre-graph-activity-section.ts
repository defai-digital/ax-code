import type { SessionDre } from "../session/dre"
import type { SessionGraph } from "../session/graph"
import type { SessionRollback } from "../session/rollback"
import { dreGraphActivityToolLabels, summarizeDreGraphActivityTools } from "./dre-graph-activity"
import { agentDisplay, esc } from "./dre-graph-format"
import { renderDreGraphRollbackBars } from "./dre-graph-rollback"
import { parseDreGraphTimeline, parseDreGraphTimelineStepDurationMs } from "./dre-graph-timeline"
import { barChart, chip } from "./dre-graph-widgets"

export function activitySection(
  graph: SessionGraph.Snapshot,
  dre: SessionDre.Snapshot,
  points: SessionRollback.Point[],
) {
  const parsed = parseDreGraphTimeline(dre.timeline)
  const detail = dre.detail
  const durations = parsed.steps.map((s) => parseDreGraphTimelineStepDurationMs(s.duration))
  const maxDur = Math.max(...durations, 1)
  const allSameIndex = parsed.steps.every((s) => s.index === parsed.steps[0]?.index)
  const ranked = parsed.steps
    .map((s, i) => ({ step: s, dur: durations[i], seq: i }))
    .sort((a, b) => b.dur - a.dur || b.step.tools.length - a.step.tools.length)
    .slice(0, 3)

  const topStepsHtml = ranked.length
    ? ranked
        .map(({ step, dur, seq }) => {
          const label = allSameIndex ? `Turn ${seq + 1}` : step.index
          const pct = Math.max(4, (dur / maxDur) * 100)
          const hasErrors = step.errors.length > 0
          const barColor = hasErrors ? "var(--high)" : dur === maxDur ? "var(--warn)" : "var(--accent)"
          const agentLabel = step.routes.length ? step.routes[step.routes.length - 1] : ""
          const toolTiming = [...step.tools].filter((t) => t.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs)
          const slowestMs = toolTiming[0]?.durationMs ?? 1
          const toolTimingHtml = toolTiming.length
            ? [
                `<div class="act-timing">`,
                `<div class="act-timing-label">Time breakdown</div>`,
                toolTiming
                  .slice(0, 8)
                  .map((t) => {
                    const tpct = Math.max(3, (t.durationMs / slowestMs) * 100)
                    const tcolor =
                      t.status === "ERR" ? "var(--high)" : t.durationMs > 5000 ? "var(--warn)" : "var(--low)"
                    const ms = t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`
                    const argLabel = t.args
                      ? ` ${t.args.split("/").pop()?.split("\\").pop() ?? t.args}`.slice(0, 28)
                      : ""
                    return [
                      `<div class="act-timing-row">`,
                      `<span class="act-timing-name">${esc(t.name)}${argLabel ? `<span class="act-timing-arg">${esc(argLabel)}</span>` : ""}${t.status === "ERR" ? ` <span class="act-err-badge">ERR</span>` : ""}</span>`,
                      `<div class="act-timing-track"><div class="act-timing-bar" style="width:${tpct.toFixed(0)}%;background:${tcolor}"></div></div>`,
                      `<span class="act-timing-ms">${ms}</span>`,
                      `</div>`,
                    ].join("")
                  })
                  .join(""),
                toolTiming.length > 8
                  ? `<span class="muted" style="font-size:11px">+${toolTiming.length - 8} more tools (no timing)</span>`
                  : "",
                `</div>`,
              ].join("")
            : ""
          const filesRead = step.tools
            .filter((t) => /^(read|view|cat)$/.test(t.name.toLowerCase()) && t.args)
            .map((t) => t.args.split("/").pop() ?? t.args)
          const filesEdited = step.tools
            .filter((t) => /^(edit|write|apply_patch|multiedit|patch)$/.test(t.name.toLowerCase()) && t.args)
            .map((t) => t.args.split("/").pop() ?? t.args)
          const filesHtml =
            filesRead.length || filesEdited.length
              ? [
                  `<div class="act-files">`,
                  filesRead.length
                    ? `<div class="act-files-row"><span class="act-files-label">Read</span><span class="act-files-list">${esc(filesRead.slice(0, 5).join(", "))}${filesRead.length > 5 ? ` +${filesRead.length - 5}` : ""}</span></div>`
                    : "",
                  filesEdited.length
                    ? `<div class="act-files-row"><span class="act-files-label">Edited</span><span class="act-files-list act-files-edited">${esc(filesEdited.slice(0, 5).join(", "))}${filesEdited.length > 5 ? ` +${filesEdited.length - 5}` : ""}</span></div>`
                    : "",
                  `</div>`,
                ].join("")
              : ""
          const errorsHtml = step.errors.length
            ? `<div class="act-error-list">${step.errors.map((e) => `<div class="gantt-error">${esc(e)}</div>`).join("")}</div>`
            : ""

          return [
            `<details class="act-card${hasErrors ? " act-card-err" : ""}">`,
            `<summary class="act-card-summary">`,
            `<div class="act-card-head">`,
            `<span class="act-label">${esc(label)}</span>`,
            agentLabel ? `<span class="act-agent">${esc(agentDisplay(agentLabel))}</span>` : "",
            `<div class="act-bar-wrap"><div class="act-bar" style="width:${pct.toFixed(0)}%;background:${barColor}"></div></div>`,
            `<span class="act-dur">${esc(step.duration)}</span>`,
            hasErrors ? `<span class="act-err-badge">${step.errors.length} err</span>` : "",
            `</div>`,
            `<div class="act-summary">${esc(summarizeDreGraphActivityTools(step.tools))}</div>`,
            `<div class="act-chips">${dreGraphActivityToolLabels(step.tools)
              .map((label) => chip({ label }))
              .join("")}</div>`,
            `</summary>`,
            `<div class="act-expand">`,
            toolTimingHtml,
            filesHtml,
            errorsHtml,
            `</div>`,
            `</details>`,
          ].join("")
        })
        .join("")
    : `<p class="empty">No steps recorded yet.</p>`

  const agentMeta = graph.graph.metadata.agents
  const routedTargets = new Set((detail?.routes ?? []).map((r) => r.to))
  const routeConf = new Map((detail?.routes ?? []).map((r) => [r.to, r.confidence]))
  const agentsHtml = agentMeta.length
    ? [
        `<div class="agent-roster">`,
        agentMeta
          .map((a, i) => {
            const isRouted = routedTargets.has(a)
            const conf = routeConf.get(a)
            const role =
              i === 0 && !isRouted
                ? "primary"
                : isRouted
                  ? `routed · ${conf != null ? (conf * 100).toFixed(0) + "% conf" : ""}`
                  : "active"
            return `<div class="agent-item"><span class="agent-dot"></span><span class="agent-name">${esc(agentDisplay(a))}</span><span class="agent-tag">${esc(role)}</span></div>`
          })
          .join(""),
        `</div>`,
      ].join("")
    : `<p class="empty">No agent data.</p>`
  const toolUsageHtml = detail?.tools.length
    ? (() => {
        const counts = new Map<string, number>()
        for (const t of detail.tools) counts.set(t, (counts.get(t) ?? 0) + 1)
        const median = [...counts.values()].sort((a, b) => a - b)[Math.floor(counts.size / 2)] ?? 1
        return barChart({
          items: [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([label, value]) => ({ label, value })),
          unit: "×",
          colorFn: (v) => (v > median * 4 ? "var(--warn)" : v > median * 2 ? "var(--accent)" : "var(--low)"),
        })
      })()
    : `<p class="empty">No tool data.</p>`
  const rbHtml = renderDreGraphRollbackBars(points, "No rollback points recorded.")

  return [
    `<section class="band" id="activity">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Activity</h2><p>Top steps by duration — what the agent actually worked on</p></div>`,
    `<div class="grid">`,
    `<div class="panel">`,
    `<h3>Key Steps</h3>`,
    topStepsHtml,
    parsed.steps.length > 3
      ? `<p class="muted" style="font-size:12px;margin-top:12px">Showing top 3 of ${parsed.steps.length} steps — full breakdown in the execution graph above</p>`
      : "",
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
    `<div class="panel">`,
    `<h3>Agents Involved</h3>`,
    agentsHtml,
    `<h3 style="margin-top:20px">Tool Usage</h3>`,
    toolUsageHtml,
    `<h3 style="margin-top:20px">Rollback Points <span class="rb-count">${points.length}</span></h3>`,
    rbHtml,
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
