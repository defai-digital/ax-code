import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { live, mermaidScript, themeScript, themeToggle } from "../../quality/dre-graph-assets"
import { changesSection } from "../../quality/dre-graph-changes-section"
import { style } from "../../quality/dre-graph-style"
import { summary } from "../../quality/dre-graph-summary-section"
import { parseDreGraphTimeline, parseDreGraphTimelineStepDurationMs } from "../../quality/dre-graph-timeline"
import { indexFingerprint, sessionFingerprint } from "../../quality/dre-graph-fingerprint"
import { qualityReadinessSection } from "../../quality/dre-graph-quality-readiness"
import { validationSection } from "../../quality/dre-graph-validation-section"
import { verdictSection } from "../../quality/dre-graph-verdict-section"
import {
  agentDisplay,
  confidenceTone,
  esc,
  num,
  readiness,
  readinessTone,
  stamp,
  time,
  tone,
  validation,
} from "../../quality/dre-graph-format"
import { barChart, chip, flow, stepSummary } from "../../quality/dre-graph-widgets"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { lazy } from "../../util/lazy"
import { Locale } from "../../util/locale"
import { SESSION_ID_PARAM, withSessionID } from "./route-params"

const DRE_GRAPH_QUALITY_QUERY = z.object({
  quality: z.coerce.boolean().optional().default(false),
})

// ── Section 2: Risk Analysis ───────────────────────────────────────
function riskSection(input: SessionRisk.Detail, dre: SessionDre.Snapshot) {
  const detail = dre.detail
  const sig = input.assessment.signals
  const conf = input.assessment.confidence
  const rdns = input.assessment.readiness

  // Status indicators row — the quick "should I worry?" signals
  const statusRow = [
    `<div class="risk-status-row">`,
    // Readiness indicator — most important
    `<div class="risk-indicator ${readinessTone(rdns)}">`,
    `<span class="ri-icon">${rdns === "ready" ? "✓" : rdns === "needs_validation" ? "◔" : rdns === "needs_review" ? "◑" : "✗"}</span>`,
    `<div class="ri-content"><span class="ri-label">Readiness</span><span class="ri-value">${readiness(rdns)}</span></div>`,
    `</div>`,
    // Confidence
    `<div class="risk-indicator ${confidenceTone(conf)}">`,
    `<span class="ri-icon">${conf >= 0.8 ? "●" : conf >= 0.6 ? "◔" : "○"}</span>`,
    `<div class="ri-content"><span class="ri-label">Confidence</span><span class="ri-value">${Math.round(conf * 100)}%</span></div>`,
    `</div>`,
    // Validation
    `<div class="risk-indicator ${readinessTone(sig.validationState === "passed" ? "ready" : sig.validationState === "failed" ? "blocked" : sig.validationState === "partial" ? "needs_review" : "needs_validation")}">`,
    `<span class="ri-icon">${sig.validationState === "passed" ? "✓" : sig.validationState === "failed" ? "✗" : sig.validationState === "partial" ? "◔" : "—"}</span>`,
    `<div class="ri-content"><span class="ri-label">Validation</span><span class="ri-value">${validation(sig)}</span></div>`,
    `</div>`,
    // Diff source
    `<div class="risk-indicator ${sig.diffState === "recorded" ? "low" : sig.diffState === "derived" ? "medium" : "high"}">`,
    `<span class="ri-icon">${sig.diffState === "recorded" ? "◉" : sig.diffState === "derived" ? "◔" : "○"}</span>`,
    `<div class="ri-content"><span class="ri-label">Diff source</span><span class="ri-value">${sig.diffState}</span></div>`,
    `</div>`,
    `</div>`,
  ].join("")

  // Signals grid — the detailed signal data
  const signalItems = [
    {
      label: "Files changed",
      value: num(sig.filesChanged),
      kind: sig.filesChanged > 10 ? "high" : sig.filesChanged > 3 ? "medium" : "low",
    },
    {
      label: "Lines changed",
      value: num(sig.linesChanged),
      kind: sig.linesChanged > 200 ? "high" : sig.linesChanged > 50 ? "medium" : "low",
    },
    {
      label: "Test coverage",
      value: `${Math.round(sig.testCoverage * 100)}%`,
      kind: sig.testCoverage >= 0.8 ? "low" : sig.testCoverage >= 0.4 ? "medium" : "high",
    },
    {
      label: "API endpoints",
      value: num(sig.apiEndpointsAffected),
      kind: sig.apiEndpointsAffected > 0 ? "medium" : "low",
    },
    {
      label: "Tool failures",
      value: `${sig.toolFailures}/${sig.totalTools}`,
      kind: sig.toolFailures > 0 ? "high" : "low",
    },
    {
      label: "Validations",
      value: `${sig.validationCount - sig.validationFailures}/${sig.validationCount} passed`,
      kind: sig.validationFailures > 0 ? "high" : sig.validationCount > 0 ? "low" : "neutral",
    },
  ]
  const flags = [
    ...(sig.crossModule ? [chip({ label: "cross-module", kind: "medium" })] : []),
    ...(sig.securityRelated ? [chip({ label: "security-related", kind: "high" })] : []),
    ...(sig.semanticRisk ? [chip({ label: `semantic: ${sig.semanticRisk}`, kind: tone(sig.semanticRisk) })] : []),
    ...(sig.primaryChange ? [chip({ label: sig.primaryChange })] : []),
  ]

  return [
    `<section class="band" id="risk">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Risk Analysis</h2><p>${esc(input.assessment.summary)}</p></div>`,
    // Status indicators — top row, full width
    statusRow,
    // Flags
    flags.length ? `<div class="risk-flags">${flags.join("")}</div>` : "",
    `<div class="grid">`,
    // Left: Signals + Breakdown
    `<div class="panel">`,
    `<h3>Signals</h3>`,
    `<div class="signal-grid">`,
    signalItems
      .map((item) =>
        [
          `<div class="signal-item">`,
          `<span class="signal-label">${esc(item.label)}</span>`,
          `<span class="signal-value ${item.kind}">${item.value}</span>`,
          `</div>`,
        ].join(""),
      )
      .join(""),
    `</div>`,
    qualityReadinessSection(input),
    input.assessment.breakdown.length
      ? [
          `<div style="margin-top:20px"><h3>Risk Factors</h3>`,
          barChart({
            items: input.assessment.breakdown.map((item) => ({
              label: item.label,
              value: item.points,
              detail: item.detail,
            })),
            unit: " pts",
            colorFn: (v) => (v > 15 ? "var(--high)" : v > 5 ? "var(--warn)" : "var(--low)"),
          }),
          `</div>`,
        ].join("")
      : "",
    detail?.scorecard.breakdown.length
      ? [
          `<div style="margin-top:20px"><h3>Decision Scorecard</h3>`,
          barChart({
            items: detail.scorecard.breakdown.map((item) => ({
              label: item.label,
              value: Math.round(item.value * 100),
              detail: item.detail,
            })),
            max: 100,
            unit: "%",
            colorFn: (v) => (v >= 70 ? "var(--low)" : v >= 40 ? "var(--warn)" : "var(--high)"),
          }),
          `</div>`,
        ].join("")
      : "",
    `</div>`,
    // Right: Drivers + Evidence + Unknowns + Mitigations
    `<div class="panel">`,
    input.drivers.length
      ? [
          `<h3>Risk Drivers</h3>`,
          `<div class="driver-list">`,
          input.drivers
            .map((item) => `<div class="driver-item"><span class="driver-icon">▸</span><span>${esc(item)}</span></div>`)
            .join(""),
          `</div>`,
        ].join("")
      : `<h3>Risk Drivers</h3><p class="empty">No drivers recorded.</p>`,
    input.assessment.evidence.length
      ? [
          `<div style="margin-top:20px">`,
          `<h3>Evidence</h3>`,
          `<div class="evidence-list">`,
          input.assessment.evidence
            .map(
              (item) =>
                `<div class="evidence-item"><span class="ev-icon ev-evidence">●</span><span>${esc(item)}</span></div>`,
            )
            .join(""),
          `</div></div>`,
        ].join("")
      : "",
    input.assessment.unknowns.length
      ? [
          `<div style="margin-top:20px">`,
          `<h3>Unknowns</h3>`,
          `<div class="evidence-list">`,
          input.assessment.unknowns
            .map(
              (item) =>
                `<div class="evidence-item"><span class="ev-icon ev-unknown">?</span><span>${esc(item)}</span></div>`,
            )
            .join(""),
          `</div></div>`,
        ].join("")
      : "",
    input.assessment.mitigations.length
      ? [
          `<div style="margin-top:20px">`,
          `<h3>Recommended Actions</h3>`,
          `<div class="evidence-list">`,
          input.assessment.mitigations
            .map(
              (item, idx) =>
                `<div class="evidence-item"><span class="ev-icon ev-action">${idx + 1}</span><span>${esc(item)}</span></div>`,
            )
            .join(""),
          `</div></div>`,
        ].join("")
      : "",
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

// ── Section 3: Execution Graph ─────────────────────────────────────
function activitySection(graph: SessionGraph.Snapshot, dre: SessionDre.Snapshot, points: SessionRollback.Point[]) {
  const parsed = parseDreGraphTimeline(dre.timeline)
  const detail = dre.detail

  // Rank steps by duration, top 3
  const durations = parsed.steps.map((s) => parseDreGraphTimelineStepDurationMs(s.duration))
  const maxDur = Math.max(...durations, 1)
  const allSameIndex = parsed.steps.every((s) => s.index === parsed.steps[0]?.index)
  const ranked = parsed.steps
    .map((s, i) => ({ step: s, dur: durations[i], seq: i }))
    .sort((a, b) => b.dur - a.dur || b.step.tools.length - a.step.tools.length)
    .slice(0, 3)

  // Plain-English summary of what a step actually did
  function activitySummary(tools: { name: string; args: string; status: string }[]): string {
    const reads: string[] = []
    const edits: string[] = []
    let searches = 0,
      shells = 0,
      webs = 0,
      others = 0
    for (const t of tools) {
      const n = t.name.toLowerCase()
      const arg = t.args ? (t.args.split("/").pop()?.split("\\").pop() ?? t.args) : ""
      if (/^(read|view|cat)$/.test(n)) reads.push(arg || t.name)
      else if (/^(edit|write|apply_patch|multiedit|patch)$/.test(n)) edits.push(arg || t.name)
      else if (/^(grep|glob|search|find|code_intelligence|semantic)/.test(n)) searches++
      else if (/^(bash|run|exec|shell|command)$/.test(n)) shells++
      else if (/^(web_fetch|web_search|fetch|browse)/.test(n)) webs++
      else others++
    }
    const parts: string[] = []
    if (reads.length)
      parts.push(reads.length <= 2 ? `read ${reads.filter(Boolean).join(", ")}` : `read ${reads.length} files`)
    if (edits.length)
      parts.push(edits.length <= 2 ? `edited ${edits.filter(Boolean).join(", ")}` : `edited ${edits.length} files`)
    if (searches) parts.push(`searched ${searches}×`)
    if (shells) parts.push(Locale.pluralize(shells, "ran {} command", "ran {} commands"))
    if (webs) parts.push(Locale.pluralize(webs, "fetched {} URL", "fetched {} URLs"))
    if (others) parts.push(`${others} misc`)
    return parts.join(" · ") || "no tool calls"
  }

  function toolChips(tools: { name: string }[]): string {
    const counts = new Map<string, number>()
    for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => chip({ label: count > 1 ? `${name} ×${count}` : name }))
      .join("")
  }

  const topStepsHtml = ranked.length
    ? ranked
        .map(({ step, dur, seq }) => {
          const label = allSameIndex ? `Turn ${seq + 1}` : step.index
          const pct = Math.max(4, (dur / maxDur) * 100)
          const hasErrors = step.errors.length > 0
          const barColor = hasErrors ? "var(--high)" : dur === maxDur ? "var(--warn)" : "var(--accent)"
          const agentLabel = step.routes.length ? step.routes[step.routes.length - 1] : ""

          // Tool timing breakdown — sorted slowest first, answers "why so long?"
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

          // Files read and edited
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
            `<div class="act-summary">${esc(activitySummary(step.tools))}</div>`,
            `<div class="act-chips">${toolChips(step.tools)}</div>`,
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

  // Agent roster — which agents were involved and their role
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

  // Tool usage — aggregate counts
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

  // Rollback points
  const rbHtml = points.length
    ? (() => {
        const maxRbDur = Math.max(...points.map((p) => p.duration ?? 0), 1)
        return [
          `<div class="rb-bars-list">`,
          points
            .map((item, idx) => {
              const dur = item.duration ?? 0
              const durPct = Math.max(3, (dur / maxRbDur) * 100)
              const barColor = dur > maxRbDur * 0.6 ? "var(--warn)" : "var(--accent)"
              const uniq = new Map<string, number>()
              for (const t of item.kinds) uniq.set(t, (uniq.get(t) ?? 0) + 1)
              const toolSummary = [...uniq.entries()].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(", ")
              return [
                `<div class="rb-row">`,
                `<span class="rb-idx">${idx + 1}</span>`,
                `<div class="rb-content">`,
                `<div class="rb-bar-line">`,
                `<div class="rb-bar-track"><div class="rb-bar-fill" style="width:${durPct.toFixed(0)}%;background:${barColor}"></div></div>`,
                `<span class="rb-dur">${time(dur)}</span>`,
                `</div>`,
                toolSummary ? `<span class="rb-tools-text">${esc(toolSummary)}</span>` : "",
                `</div>`,
                `</div>`,
              ].join("")
            })
            .join(""),
          `</div>`,
        ].join("")
      })()
    : `<p class="empty">No rollback points recorded.</p>`

  return [
    `<section class="band" id="activity">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Activity</h2><p>Top steps by duration — what the agent actually worked on</p></div>`,
    `<div class="grid">`,
    // Left: key steps (top 3 by duration)
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
    // Right: agents + tool usage + rollback
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

// ── Section 4: Branches ────────────────────────────────────────────
function branchSection(input?: SessionBranchRank.Family) {
  if (!input) return ""

  const readinessLabel: Record<string, string> = {
    ready: "Ready to accept",
    needs_validation: "Needs validation",
    needs_review: "Needs review",
    blocked: "Blocked",
  }
  const readinessIcon: Record<string, string> = {
    ready: "✓",
    needs_validation: "⚠",
    needs_review: "⊙",
    blocked: "✗",
  }

  const isSwitching = input.current.id !== input.recommended.id
  const topReason = input.reasons[0] ?? ""

  function branchCard(item: SessionBranchRank.Item) {
    const ready = item.risk.readiness
    const readyTone = readinessTone(ready)
    const scoreTotal = Math.round(item.decision.total * 100)

    return [
      `<div class="branch-card ${item.recommended ? "recommended" : ""}${item.current ? " current" : ""}">`,
      // Header: title + badges
      `<div class="branch-head">`,
      `<strong class="branch-title">${esc(item.title)}</strong>`,
      `<div class="tag-row">`,
      item.current ? chip({ label: "current" }) : "",
      item.recommended ? chip({ label: "recommended", kind: "low" }) : "",
      `</div>`,
      `</div>`,
      // Readiness — most actionable signal, shown prominently
      `<div class="branch-readiness ${readyTone}">`,
      `<span class="branch-readiness-icon">${readinessIcon[ready] ?? "?"}</span>`,
      `<span>${esc(readinessLabel[ready] ?? ready)}</span>`,
      `<span class="branch-score-chip">${scoreTotal}/100</span>`,
      `</div>`,
      // What this branch actually did
      `<p class="branch-headline">${esc(item.headline)}</p>`,
      // Decision breakdown with explanations — the "why"
      `<div class="branch-scorecard">`,
      item.decision.breakdown
        .map((part) => {
          const pct = Math.round(part.value * 100)
          const color = part.value >= 0.7 ? "var(--low)" : part.value >= 0.4 ? "var(--warn)" : "var(--high)"
          return [
            `<div class="branch-score-row">`,
            `<span class="branch-score-label">${esc(part.label)}</span>`,
            `<div class="branch-score-track"><div class="branch-score-fill" style="width:${pct}%;background:${color}"></div></div>`,
            `<span class="branch-score-val" style="color:${color}">${pct}%</span>`,
            `</div>`,
            part.detail ? `<div class="branch-score-detail">${esc(part.detail)}</div>` : "",
          ].join("")
        })
        .join(""),
      `</div>`,
      // Top evidence — specific reasons behind the risk score
      item.risk.evidence.length
        ? [
            `<div class="branch-evidence">`,
            item.risk.evidence
              .slice(0, 2)
              .map((e) => `<div class="branch-ev-item"><span class="ev-dot">·</span><span>${esc(e)}</span></div>`)
              .join(""),
            `</div>`,
          ].join("")
        : "",
      // Semantic diff summary if available
      item.semantic
        ? `<div class="branch-semantic">${esc(item.semantic.headline)} <span class="muted">(+${item.semantic.additions} / -${item.semantic.deletions})</span></div>`
        : "",
      `</div>`,
    ].join("")
  }

  return [
    `<section class="band" id="branches">`,
    `<div class="wrap">`,
    `<div class="section-head">`,
    `<h2>Branches</h2>`,
    `<p>${isSwitching ? `Switch to <strong>${esc(input.recommended.title)}</strong> — ${esc(topReason)}` : `You're on the recommended branch · ${esc(topReason)}`}</p>`,
    `</div>`,
    `<div class="branch-list ${input.items.length === 2 ? "branch-compare" : ""}">`,
    input.items.map(branchCard).join(""),
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

// ── Section 5: Timeline + Rollback ─────────────────────────────────

function timelineSection(dre: SessionDre.Snapshot, points: SessionRollback.Point[], detail?: SessionDre.Detail | null) {
  const parsed = parseDreGraphTimeline(dre.timeline)

  // Build Gantt-style step bars
  const ganttHtml = parsed.steps.length
    ? (() => {
        // Compute max duration for proportional bars
        const durations = parsed.steps.map((s) => parseDreGraphTimelineStepDurationMs(s.duration))
        const maxDur = Math.max(...durations, 1)

        // Check if all steps have the same index (e.g., all "Step 0")
        const allSameIndex = parsed.steps.every((s) => s.index === parsed.steps[0].index)

        return [
          `<div class="gantt">`,
          parsed.steps
            .map((step, idx) => {
              const dur = durations[idx]
              const pct = Math.max(2, (dur / maxDur) * 100)
              const hasErrors = step.errors.length > 0
              const barColor = hasErrors ? "var(--high)" : dur > maxDur * 0.5 ? "var(--warn)" : "var(--accent)"

              // Group tools by name for compact summary
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

              // Build a short tool signature for the header (e.g., "read ×12, edit ×3")
              const topTools = sorted
                .slice(0, 3)
                .map(([n, info]) => (info.count > 1 ? `${n} ×${info.count}` : n))
                .join(", ")
              // Use sequential "Turn N" label when all steps share the same index
              const label = allSameIndex ? `Turn ${idx + 1}` : step.index

              return [
                `<div class="gantt-step">`,
                // Step header with duration bar
                `<div class="gantt-header">`,
                `<span class="gantt-label">${esc(label)}</span>`,
                `<div class="gantt-bar-wrap">`,
                `<div class="gantt-bar" style="width:${pct.toFixed(1)}%;background:${barColor}"></div>`,
                `</div>`,
                `<span class="gantt-dur">${esc(step.duration)}</span>`,
                `</div>`,
                // Tool signature + route — visible without expanding
                `<div class="gantt-meta">`,
                topTools ? `<span class="gantt-tools-sig">${esc(topTools)}</span>` : "",
                step.routes.length
                  ? `<span class="gantt-route">${step.routes.map((r) => esc(r)).join(", ")}</span>`
                  : "",
                `</div>`,
                // Collapsible tool details
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
                // Errors inline (always visible)
                step.errors.length > 0
                  ? step.errors.map((e) => `<div class="gantt-error">${esc(e)}</div>`).join("")
                  : "",
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
    // Gantt timeline
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
    // Rollback — horizontal bar list
    `<div class="panel" id="rollback">`,
    `<h3>Rollback Points <span class="rb-count">${points.length}</span></h3>`,
    points.length
      ? (() => {
          const maxDur = Math.max(...points.map((p) => p.duration ?? 0), 1)
          // Deduplicate tool names (strip args) and count unique tools per point
          const toolName = (t: string) => t.split(":")[0].trim()
          return [
            `<div class="rb-bars-list">`,
            points
              .map((item, idx) => {
                const dur = item.duration ?? 0
                const durPct = Math.max(3, (dur / maxDur) * 100)
                const barColor = dur > maxDur * 0.6 ? "var(--warn)" : "var(--accent)"
                // Count unique tool types
                const uniq = new Map<string, number>()
                for (const t of item.kinds) uniq.set(t, (uniq.get(t) ?? 0) + 1)
                const toolSummary = [...uniq.entries()].map(([k, v]) => (v > 1 ? `${k} ×${v}` : k)).join(", ")
                return [
                  `<div class="rb-row">`,
                  `<span class="rb-idx">${idx + 1}</span>`,
                  `<div class="rb-content">`,
                  `<div class="rb-bar-line">`,
                  `<div class="rb-bar-track"><div class="rb-bar-fill" style="width:${durPct.toFixed(0)}%;background:${barColor}"></div></div>`,
                  `<span class="rb-dur">${time(dur)}</span>`,
                  `</div>`,
                  toolSummary ? `<span class="rb-tools-text">${esc(toolSummary)}</span>` : "",
                  `</div>`,
                  `</div>`,
                ].join("")
              })
              .join(""),
            `</div>`,
          ].join("")
        })()
      : `<p class="empty">Run a session with assistant steps to populate rollback points.</p>`,
    `</div>`,
    `</div>`,
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
