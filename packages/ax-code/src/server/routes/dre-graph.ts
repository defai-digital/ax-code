import { Hono } from "hono"
import { validator } from "hono-openapi"
import z from "zod"
import { Session } from "../../session"
import { SessionBranchRank } from "../../session/branch"
import { SessionDre } from "../../session/dre"
import { SessionGraph } from "../../session/graph"
import { SessionRisk } from "../../session/risk"
import { ProbabilisticRollout } from "../../quality/probabilistic-rollout"
import { SessionRollback } from "../../session/rollback"
import { SessionID } from "../../session/schema"
import { lazy } from "../../util/lazy"

// Maps agent internal identifiers → human-readable display names
const AGENT_DISPLAY: Record<string, string> = {
  build: "Dev",
  plan: "Planner",
  react: "Reasoner",
  general: "Assistant",
  explore: "Researcher",
  security: "Security",
  architect: "Architect",
  debug: "Debugger",
  perf: "Perf",
  devops: "DevOps",
  test: "Tester",
}

function agentDisplay(name: string): string {
  return AGENT_DISPLAY[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

function esc(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function json(value: unknown) {
  const text = JSON.stringify(value) ?? "null"
  return text.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")
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

function confidenceTone(value: number) {
  if (value >= 0.8) return "low"
  if (value >= 0.6) return "medium"
  return "high"
}

function readinessTone(value: string) {
  if (value === "ready") return "low"
  if (value === "needs_validation") return "medium"
  if (value === "needs_review") return "high"
  return "critical"
}

function readiness(value: string) {
  return value.replaceAll("_", " ")
}

function qualityStatusKind(value: "pass" | "warn" | "fail") {
  if (value === "pass") return "low"
  if (value === "warn") return "medium"
  return "high"
}

function validation(input: SessionRisk.Detail["assessment"]["signals"]) {
  if (input.validationState === "passed") return "validation passed"
  if (input.validationState === "failed") return "validation failed"
  if (input.validationState === "partial") return "partial validation"
  return "validation not recorded"
}

function chip(input: { label: string; kind?: string }) {
  return `<span class="chip ${esc(input.kind ?? "neutral")}">${esc(input.label)}</span>`
}

function stat(input: { label: string; value: string; kind?: string; icon?: string }) {
  return [
    `<div class="stat ${esc(input.kind ?? "neutral")}">`,
    input.icon ? `<span class="stat-icon">${input.icon}</span>` : "",
    `<span class="stat-label">${esc(input.label)}</span>`,
    `<strong class="stat-value">${esc(input.value)}</strong>`,
    "</div>",
  ].join("")
}

function flow(nodes: string[], opts?: { max?: number }) {
  if (nodes.length === 0) return `<p class="empty">No recorded nodes.</p>`
  // Compress consecutive identical nodes: [read, read, read, edit] → [{name:"read", count:3}, {name:"edit", count:1}]
  const runs: { name: string; count: number }[] = []
  for (const n of nodes) {
    const last = runs[runs.length - 1]
    if (last && last.name === n) last.count++
    else runs.push({ name: n, count: 1 })
  }
  const max = opts?.max ?? 20
  const truncated = runs.length > max
  const visible = truncated ? runs.slice(0, max) : runs
  return [
    `<div class="flow">`,
    visible
      .map((item, idx) =>
        [
          idx > 0 ? `<span class="join" aria-hidden="true"></span>` : "",
          item.count > 1
            ? `<span class="node group">${esc(item.name)}<span class="node-count">×${item.count}</span></span>`
            : `<span class="node">${esc(item.name)}</span>`,
        ].join(""),
      )
      .join(""),
    truncated ? `<span class="join" aria-hidden="true"></span><span class="node trunc">+${runs.length - max} more</span>` : "",
    `</div>`,
    nodes.length > 10 ? `<p class="flow-summary">${nodes.length} total calls across ${runs.length} groups</p>` : "",
  ].join("")
}

// Compact step summary — instead of rendering all nodes, show tool counts as mini bars
function stepSummary(nodes: string[]) {
  if (nodes.length === 0) return `<span class="muted">empty</span>`
  const counts = new Map<string, number>()
  for (const n of nodes) {
    // Skip result nodes ("read ok", "glob ERR"), step markers, and session nodes
    if (n.endsWith(" ok") || n.endsWith(" ERR") || n.startsWith("Step ") || n.startsWith("Start ")) continue
    // Extract tool name — strip args after ":"
    const colonIdx = n.indexOf(":")
    const name = colonIdx > 0 ? n.slice(0, colonIdx).trim() : n.trim()
    if (!name) continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const max = Math.max(...sorted.map((s) => s[1]), 1)
  return [
    `<div class="step-bars">`,
    sorted.slice(0, 6).map(([name, count]) => {
      const pct = Math.min(100, (count / max) * 100)
      const color = count > 10 ? "var(--warn)" : "var(--accent)"
      return `<div class="step-bar-row"><span class="step-bar-label">${esc(name)}</span><div class="step-bar-track"><div class="step-bar-fill" style="width:${pct.toFixed(0)}%;background:${color}"></div></div><span class="step-bar-count">${count}</span></div>`
    }).join(""),
    sorted.length > 6 ? `<span class="muted" style="font-size:11px">+${sorted.length - 6} more tools</span>` : "",
    `</div>`,
  ].join("")
}

// ── Chart helpers (pure CSS/SVG, no JS) ────────────────────────────

// SVG arc gauge — replaces the risk-ring div with a proper arc
function gauge(input: { score: number; max: number; level: string }) {
  const pct = Math.min(1, Math.max(0, input.score / input.max))
  const r = 44
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct * 0.75) // 270° arc
  const color = { critical: "#dc2626", high: "#ef4444", medium: "#eab308", low: "#22c55e" }[tone(input.level)] ?? "#22c55e"
  return [
    `<svg class="gauge" viewBox="0 0 100 100" width="128" height="128">`,
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(39,39,42,0.8)" stroke-width="5" stroke-dasharray="${circ * 0.75} ${circ * 0.25}" stroke-dashoffset="0" transform="rotate(135 50 50)" stroke-linecap="round"/>`,
    `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="${circ * 0.75} ${circ * 0.25}" stroke-dashoffset="${offset}" transform="rotate(135 50 50)" stroke-linecap="round" style="filter: drop-shadow(0 0 8px ${color}30)"/>`,
    `<text x="50" y="44" text-anchor="middle" fill="${color}" font-size="24" font-weight="700">${input.score}</text>`,
    `<text x="50" y="58" text-anchor="middle" fill="#a1a1aa" font-size="9">/ ${input.max}</text>`,
    `<text x="50" y="76" text-anchor="middle" fill="${color}" font-size="7.5" font-weight="700" letter-spacing="0.12em">${input.level.toUpperCase()}</text>`,
    `</svg>`,
  ].join("")
}

// Horizontal bar chart — each bar shows label, value, and a proportional bar
function barChart(input: { items: { label: string; value: number; detail?: string }[]; max?: number; unit?: string; colorFn?: (v: number) => string }) {
  if (input.items.length === 0) return `<p class="empty">No data.</p>`
  const max = input.max ?? Math.max(...input.items.map((i) => i.value), 1)
  const colorFn = input.colorFn ?? (() => "var(--accent)")
  return [
    `<div class="bar-chart">`,
    input.items
      .map((item) => {
        const pct = Math.min(100, Math.max(0, (item.value / max) * 100))
        const color = colorFn(item.value)
        return [
          `<div class="bar-row">`,
          `<span class="bar-label">${esc(item.label)}</span>`,
          `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div></div>`,
          `<span class="bar-value" style="color:${color}">${item.value}${input.unit ? esc(input.unit) : ""}</span>`,
          item.detail ? `<span class="bar-detail">${esc(item.detail)}</span>` : "",
          `</div>`,
        ].join("")
      })
      .join(""),
    `</div>`,
  ].join("")
}

// Donut chart — shows proportions (e.g., input vs output tokens)
function donut(input: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = input.segments.reduce((a, b) => a + b.value, 0)
  if (total === 0) return `<p class="empty">No data.</p>`
  const size = input.size ?? 80
  const r = 30
  const circ = 2 * Math.PI * r
  let offset = 0
  const arcs = input.segments.map((seg) => {
    const pct = seg.value / total
    const dash = circ * pct
    const gap = circ - dash
    const arc = `<circle cx="40" cy="40" r="${r}" fill="none" stroke="${seg.color}" stroke-width="8" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 40 40)"/>`
    offset += dash
    return arc
  })
  return [
    `<div class="donut-wrap">`,
    `<svg viewBox="0 0 80 80" width="${size}" height="${size}">${arcs.join("")}</svg>`,
    `<div class="donut-legend">`,
    input.segments
      .map(
        (seg) =>
          `<div class="donut-item"><span class="donut-dot" style="background:${seg.color}"></span><span>${esc(seg.label)}</span><strong>${num(seg.value)}</strong><span class="muted">(${Math.round((seg.value / total) * 100)}%)</span></div>`,
      )
      .join(""),
    `</div>`,
    `</div>`,
  ].join("")
}

// ── Section 1: Summary banner ──────────────────────────────────────
// The first thing users see. Answers "what happened and should I care?"
function summary(input: {
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  graph: SessionGraph.Snapshot
}) {
  const detail = input.dre.detail
  const riskLevel = detail?.level ?? input.risk.assessment.level
  const riskScore = detail?.score ?? input.risk.assessment.score
  const meta = input.graph.graph.metadata

  return [
    `<section class="summary" id="summary">`,
    `<div class="wrap">`,
    `<div class="summary-grid">`,
    // Risk gauge — SVG arc
    `<div class="summary-risk">`,
    gauge({ score: riskScore, max: 100, level: riskLevel }),
    `</div>`,
    // Decision + key metrics
    `<div class="summary-details">`,
    detail
      ? [
          `<div class="summary-decision">${esc(detail.decision)}</div>`,
          `<div class="summary-plan">${esc(detail.plan)}</div>`,
          `<div class="summary-row">`,
          `<div class="summary-stats">`,
          stat({ label: "Steps", value: num(meta.steps), icon: "⬡" }),
          stat({ label: "Tools", value: num(meta.tools.length), icon: "⚙" }),
          stat({ label: "Duration", value: time(detail.duration), icon: "⏱" }),
          stat({ label: "Files", value: num(input.risk.assessment.signals.filesChanged), icon: "◻" }),
          stat({ label: "Lines", value: num(input.risk.assessment.signals.linesChanged), icon: "≡" }),
          stat({
            label: "Confidence",
            value: `${Math.round(input.risk.assessment.confidence * 100)}%`,
            kind: confidenceTone(input.risk.assessment.confidence),
            icon: "◌",
          }),
          stat({
            label: "Ready",
            value: readiness(input.risk.assessment.readiness),
            kind: readinessTone(input.risk.assessment.readiness),
            icon: "✓",
          }),
          stat({ label: "Errors", value: num(meta.errors), kind: meta.errors > 0 ? "high" : "neutral", icon: "✗" }),
          `</div>`,
          donut({
            segments: [
              { label: "Input", value: detail.tokens.input, color: "var(--accent)" },
              { label: "Output", value: detail.tokens.output, color: "var(--low)" },
            ],
            size: 72,
          }),
          `</div>`,
        ].join("")
      : `<div class="summary-decision">No DRE analysis available yet. Send a message to generate session data.</div>`,
    `</div>`,
    `</div>`,
    // Semantic diff banner
    detail?.semantic
      ? [
          `<div class="semantic-banner">`,
          `<span class="semantic-icon">△</span>`,
          `<span class="semantic-text">${esc(detail.semantic.headline)}</span>`,
          `<div class="semantic-chips">`,
          chip({ label: `${detail.semantic.risk} risk`, kind: tone(detail.semantic.risk) }),
          chip({ label: `${detail.semantic.files} files` }),
          chip({ label: `+${detail.semantic.additions}` }),
          chip({ label: `-${detail.semantic.deletions}` }),
          detail.semantic.signals.length ? detail.semantic.signals.slice(0, 3).map((s) => chip({ label: s })).join("") : "",
          `</div>`,
          `</div>`,
        ].join("")
      : "",
    `</div>`,
    `</section>`,
  ].join("")
}

// ── Section 1b: Verdict — "should I accept this?" ─────────────────
function verdictSection(input: { dre: SessionDre.Snapshot; risk: SessionRisk.Detail }) {
  const detail = input.dre.detail
  if (!detail) return ""
  const sig = input.risk.assessment.signals
  const ready = input.risk.assessment.readiness
  const readyTone = readinessTone(ready)
  const headlines: Record<string, string> = {
    ready: "Ready to accept",
    needs_validation: "Needs validation before accepting",
    needs_review: "Needs manual review",
    blocked: "Blocked \u2014 do not accept",
  }
  const validationLabel = sig.validationCommands.length > 0
    ? `${validation(sig)} (${sig.validationCommands.slice(0, 3).map((c) => esc(c.split(" ").slice(0, 3).join(" "))).join(", ")})`
    : validation(sig)

  return [
    `<section class="verdict" id="verdict">`,
    `<div class="verdict-inner ${readyTone}">`,
    `<div class="verdict-headline ${readyTone}">${esc(headlines[ready] ?? readiness(ready))}</div>`,
    `<div class="verdict-grid">`,
    stat({ label: "Confidence", value: `${Math.round(input.risk.assessment.confidence * 100)}%`, kind: confidenceTone(input.risk.assessment.confidence) }),
    stat({ label: "Risk", value: `${input.risk.assessment.score}/100`, kind: tone(input.risk.assessment.level) }),
    stat({ label: "Validation", value: validationLabel, kind: sig.validationState === "passed" ? "low" : sig.validationState === "failed" ? "high" : "neutral" }),
    stat({ label: "Decision", value: detail.scorecard.total.toFixed(2), kind: detail.scorecard.total >= 0.7 ? "low" : detail.scorecard.total >= 0.4 ? "medium" : "high" }),
    `</div>`,
    detail.semantic ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">${esc(detail.semantic.headline)} \u00b7 ${chip({ label: detail.semantic.risk, kind: tone(detail.semantic.risk) })} \u00b7 ${detail.semantic.files} file${detail.semantic.files === 1 ? "" : "s"} \u00b7 <span class="diff-add">+${detail.semantic.additions}</span> <span class="diff-del">-${detail.semantic.deletions}</span></div>` : "",
    input.risk.assessment.unknowns.length > 0
      ? `<div class="verdict-callout"><span class="verdict-callout-icon" style="color:var(--warn)">?</span> ${esc(input.risk.assessment.unknowns[0])}</div>`
      : "",
    input.risk.assessment.mitigations.length > 0
      ? `<div class="verdict-callout"><span class="verdict-callout-icon" style="color:var(--low)">\u2192</span> ${esc(input.risk.assessment.mitigations[0])}</div>`
      : "",
    `</div>`,
    `</section>`,
  ].join("")
}

// ── Section 1c: Changes — "what files changed and how risky?" ─────
function changesSection(input: { dre: SessionDre.Snapshot }) {
  const changes = input.dre.detail?.semantic?.changes
  if (!changes || changes.length === 0)
    return [
      `<section class="band" id="changes">`,
      `<div class="wrap">`,
      `<div class="section-head"><h2>Changes</h2><p>No semantic diff recorded</p></div>`,
      `</div>`,
      `</section>`,
    ].join("")
  const kindLabel = (k: string) => k.replace(/_/g, " ")
  return [
    `<section class="band" id="changes">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Changes</h2><p>${changes.length} file${changes.length === 1 ? "" : "s"} changed</p></div>`,
    `<div class="panel">`,
    changes
      .map((c) =>
        [
          `<div class="changes-row">`,
          `<span class="risk-dot ${esc(c.risk)}"></span>`,
          `<span class="file-path" title="${esc(c.file)}">${esc(c.file)}</span>`,
          chip({ label: kindLabel(c.kind), kind: tone(c.risk) }),
          `<span class="diff-stat"><span class="diff-add">+${c.additions}</span> <span class="diff-del">-${c.deletions}</span></span>`,
          c.signals[0] ? `<span class="change-signal" title="${esc(c.signals.join(" \u00b7 "))}">${esc(c.signals[0])}</span>` : `<span class="change-signal"></span>`,
          `</div>`,
        ].join(""),
      )
      .join(""),
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

// ── Section 1d: Validation — "what was validated?" ────────────────
function validationSection(input: { risk: SessionRisk.Detail }) {
  const sig = input.risk.assessment.signals
  if (sig.validationCount === 0 && sig.validationCommands.length === 0)
    return [
      `<section class="band" id="validation">`,
      `<div class="wrap">`,
      `<div class="section-head"><h2>Validation</h2><p>No validation commands recorded</p></div>`,
      `</div>`,
      `</section>`,
    ].join("")
  return [
    `<section class="band" id="validation">`,
    `<div class="wrap">`,
    `<div class="section-head"><h2>Validation</h2><p>${validation(sig)}</p></div>`,
    `<div class="panel">`,
    `<div class="validation-list">`,
    sig.validationCommands.length > 0
      ? sig.validationCommands
          .map(
            (cmd) =>
              `<div class="validation-item"><span class="validation-icon">${sig.validationState === "failed" ? "\u2717" : "\u2713"}</span><span class="validation-cmd">${esc(cmd)}</span><span class="validation-status">${chip({ label: sig.validationState === "failed" ? "failed" : "passed", kind: sig.validationState === "failed" ? "high" : "low" })}</span></div>`,
          )
          .join("")
      : `<div class="validation-item"><span class="validation-icon" style="color:var(--muted)">\u2014</span><span class="validation-cmd" style="color:var(--muted)">No validation commands recorded</span></div>`,
    sig.validationState === "not_run" && sig.filesChanged > 0
      ? `<div class="validation-item"><span class="validation-icon" style="color:var(--warn)">!</span><span class="validation-cmd" style="color:var(--warn)">Code changed but no tests were run</span></div>`
      : "",
    `</div>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}

function qualityReadinessSection(input: SessionRisk.Detail) {
  const summaries = [
    input.quality?.review ? { workflow: "review" as const, summary: input.quality.review } : null,
    input.quality?.debug ? { workflow: "debug" as const, summary: input.quality.debug } : null,
    input.quality?.qa ? { workflow: "qa" as const, summary: input.quality.qa } : null,
  ].filter((item): item is { workflow: "review" | "debug" | "qa"; summary: NonNullable<SessionRisk.QualityReadiness["review"]> } => !!item)

  if (summaries.length === 0) return ""

  return [
    `<div style="margin-top:20px"><h3>Quality Readiness</h3>`,
    `<div class="validation-list">`,
    summaries
      .map(({ workflow, summary }) => {
        const first = ProbabilisticRollout.targetedTestRecommendations(summary)[0]
        const firstLine = first ? `<br><span class="muted">first: ${esc(first)}</span>` : ""
        return [
          `<div class="validation-item">`,
          `<span class="validation-icon">${workflow === "review" ? "R" : workflow === "debug" ? "D" : "Q"}</span>`,
          `<span class="validation-cmd">`,
          `<strong>${esc(workflow)}</strong> · ${esc(summary.readyForBenchmark ? "benchmark ready" : "benchmark not ready")} · ${summary.resolvedLabeledItems}/${summary.totalItems} resolved labels`,
          firstLine,
          summary.nextAction ? `<br><span class="muted">${esc(summary.nextAction)}</span>` : "",
          `</span>`,
          `<span class="validation-status">${chip({ label: summary.overallStatus, kind: qualityStatusKind(summary.overallStatus) })}</span>`,
          `</div>`,
        ].join("")
      })
      .join(""),
    `</div></div>`,
  ].join("")
}

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
    { label: "Files changed", value: num(sig.filesChanged), kind: sig.filesChanged > 10 ? "high" : sig.filesChanged > 3 ? "medium" : "low" },
    { label: "Lines changed", value: num(sig.linesChanged), kind: sig.linesChanged > 200 ? "high" : sig.linesChanged > 50 ? "medium" : "low" },
    { label: "Test coverage", value: `${Math.round(sig.testCoverage * 100)}%`, kind: sig.testCoverage >= 0.8 ? "low" : sig.testCoverage >= 0.4 ? "medium" : "high" },
    { label: "API endpoints", value: num(sig.apiEndpointsAffected), kind: sig.apiEndpointsAffected > 0 ? "medium" : "low" },
    { label: "Tool failures", value: `${sig.toolFailures}/${sig.totalTools}`, kind: sig.toolFailures > 0 ? "high" : "low" },
    { label: "Validations", value: `${sig.validationCount - sig.validationFailures}/${sig.validationCount} passed`, kind: sig.validationFailures > 0 ? "high" : sig.validationCount > 0 ? "low" : "neutral" },
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
    signalItems.map((item) => [
      `<div class="signal-item">`,
      `<span class="signal-label">${esc(item.label)}</span>`,
      `<span class="signal-value ${item.kind}">${item.value}</span>`,
      `</div>`,
    ].join("")).join(""),
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
            .map((item) => `<div class="evidence-item"><span class="ev-icon ev-evidence">●</span><span>${esc(item)}</span></div>`)
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
            .map((item) => `<div class="evidence-item"><span class="ev-icon ev-unknown">?</span><span>${esc(item)}</span></div>`)
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
            .map((item, idx) => `<div class="evidence-item"><span class="ev-icon ev-action">${idx + 1}</span><span>${esc(item)}</span></div>`)
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
function activitySection(
  graph: SessionGraph.Snapshot,
  dre: SessionDre.Snapshot,
  points: SessionRollback.Point[],
) {
  const parsed = parseTimeline(dre.timeline)
  const detail = dre.detail

  // Rank steps by duration, top 3
  const durations = parsed.steps.map((s) => {
    const m = s.duration.match(/(?:(\d+)m\s*)?(\d+)s/)
    return m ? (parseInt(m[1] ?? "0") * 60 + parseInt(m[2] ?? "0")) * 1000 : 0
  })
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
    let searches = 0, shells = 0, webs = 0, others = 0
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
    if (reads.length) parts.push(reads.length <= 2 ? `read ${reads.filter(Boolean).join(", ")}` : `read ${reads.length} files`)
    if (edits.length) parts.push(edits.length <= 2 ? `edited ${edits.filter(Boolean).join(", ")}` : `edited ${edits.length} files`)
    if (searches) parts.push(`searched ${searches}×`)
    if (shells) parts.push(`ran ${shells} command${shells > 1 ? "s" : ""}`)
    if (webs) parts.push(`fetched ${webs} URL${webs > 1 ? "s" : ""}`)
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
          const toolTiming = [...step.tools]
            .filter((t) => t.durationMs > 0)
            .sort((a, b) => b.durationMs - a.durationMs)
          const slowestMs = toolTiming[0]?.durationMs ?? 1
          const toolTimingHtml = toolTiming.length
            ? [
                `<div class="act-timing">`,
                `<div class="act-timing-label">Time breakdown</div>`,
                toolTiming.slice(0, 8).map((t) => {
                  const tpct = Math.max(3, (t.durationMs / slowestMs) * 100)
                  const tcolor = t.status === "ERR" ? "var(--high)" : t.durationMs > 5000 ? "var(--warn)" : "var(--low)"
                  const ms = t.durationMs >= 1000 ? `${(t.durationMs / 1000).toFixed(1)}s` : `${t.durationMs}ms`
                  const argLabel = t.args ? ` ${t.args.split("/").pop()?.split("\\").pop() ?? t.args}`.slice(0, 28) : ""
                  return [
                    `<div class="act-timing-row">`,
                    `<span class="act-timing-name">${esc(t.name)}${argLabel ? `<span class="act-timing-arg">${esc(argLabel)}</span>` : ""}${t.status === "ERR" ? ` <span class="act-err-badge">ERR</span>` : ""}</span>`,
                    `<div class="act-timing-track"><div class="act-timing-bar" style="width:${tpct.toFixed(0)}%;background:${tcolor}"></div></div>`,
                    `<span class="act-timing-ms">${ms}</span>`,
                    `</div>`,
                  ].join("")
                }).join(""),
                toolTiming.length > 8 ? `<span class="muted" style="font-size:11px">+${toolTiming.length - 8} more tools (no timing)</span>` : "",
                `</div>`,
              ].join("")
            : ""

          // Files read and edited
          const filesRead = step.tools.filter((t) => /^(read|view|cat)$/.test(t.name.toLowerCase()) && t.args).map((t) => t.args.split("/").pop() ?? t.args)
          const filesEdited = step.tools.filter((t) => /^(edit|write|apply_patch|multiedit|patch)$/.test(t.name.toLowerCase()) && t.args).map((t) => t.args.split("/").pop() ?? t.args)
          const filesHtml = (filesRead.length || filesEdited.length)
            ? [
                `<div class="act-files">`,
                filesRead.length ? `<div class="act-files-row"><span class="act-files-label">Read</span><span class="act-files-list">${esc(filesRead.slice(0, 5).join(", "))}${filesRead.length > 5 ? ` +${filesRead.length - 5}` : ""}</span></div>` : "",
                filesEdited.length ? `<div class="act-files-row"><span class="act-files-label">Edited</span><span class="act-files-list act-files-edited">${esc(filesEdited.slice(0, 5).join(", "))}${filesEdited.length > 5 ? ` +${filesEdited.length - 5}` : ""}</span></div>` : "",
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
            const role = i === 0 && !isRouted ? "primary" : isRouted ? `routed · ${conf != null ? (conf * 100).toFixed(0) + "% conf" : ""}` : "active"
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
          detail.notes.map((item) => `<div class="driver-item"><span class="driver-icon">·</span><span>${esc(item)}</span></div>`).join(""),
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
            active.map((phase, idx) => {
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
                sorted.slice(0, 6).map(([name, count]) => {
                  const pct = Math.max(8, (count / total) * 100)
                  return `<div class="cpath-tool"><span class="cpath-tool-name">${esc(name)}${count > 1 ? ` <span class="cpath-tool-n">×${count}</span>` : ""}</span><div class="cpath-tool-bar" style="width:${pct.toFixed(0)}%"></div></div>`
                }).join(""),
                sorted.length > 6 ? `<span class="muted" style="font-size:11px">+${sorted.length - 6} more</span>` : "",
                `</div>`,
                `</div>`,
              ].join("")
            }).join(""),
            `</div>`,
          ].join("")
        })()
      : `<p class="empty">No path recorded.</p>`,
    pairs.length
      ? [
          `<div style="margin-top:20px"><h3>Tool Pairs <span class="rb-count">${pairs.length}</span></h3>`,
          `<div class="pair-list">`,
          pairs.slice(0, 12).map((item) => {
            // Clean up pair labels — strip raw args
            const callName = item.call.split(":")[0].trim()
            const resultName = item.result.split(" ")[0].trim()
            return `<div class="pair"><span>${esc(callName)}</span><span class="pair-arrow">→</span><span>${esc(resultName)}</span></div>`
          }).join(""),
          pairs.length > 12 ? `<span class="muted" style="font-size:11px;padding:6px 0;display:block">+${pairs.length - 12} more pairs</span>` : "",
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
      item.decision.breakdown.map((part) => {
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
      }).join(""),
      `</div>`,
      // Top evidence — specific reasons behind the risk score
      item.risk.evidence.length
        ? [
            `<div class="branch-evidence">`,
            item.risk.evidence.slice(0, 2).map((e) => `<div class="branch-ev-item"><span class="ev-dot">·</span><span>${esc(e)}</span></div>`).join(""),
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

// Parse timeline into structured steps for Gantt-style rendering
function parseTimeline(lines: SessionDre.TimelineLine[]) {
  type ToolEntry = { name: string; args: string; status: string; durationMs: number }
  type Step = { index: string; duration: string; tokens: string; tools: ToolEntry[]; routes: string[]; errors: string[]; llms: string[] }
  const header = lines.find((l) => l.kind === "heading")
  const meta = lines.filter((l) => l.kind === "meta")
  const steps: Step[] = []
  let current: Step | undefined
  for (const line of lines) {
    if (line.kind === "step") {
      // "Step 0 · 2s · tokens 2/193"
      const parts = line.text.split(" · ")
      current = { index: parts[0] ?? "", duration: parts[1] ?? "", tokens: parts[2] ?? "", tools: [], routes: [], errors: [], llms: [] }
      steps.push(current)
    } else if (line.kind === "tool" && current) {
      // "read: README.md → ok (6ms)" or "tool_name → ok (6ms)"
      const m = line.text.match(/^(\S+?):\s*(.*?)\s*→\s*(\S+)\s*(?:\((\d+)ms\))?$/)
      if (m) {
        current.tools.push({ name: m[1], args: m[2], status: m[3], durationMs: parseInt(m[4] ?? "0") })
      } else {
        const m2 = line.text.match(/^(\S+)\s*→\s*(\S+)\s*(?:\((\d+)ms\))?$/)
        if (m2) current.tools.push({ name: m2[1], args: "", status: m2[2], durationMs: parseInt(m2[3] ?? "0") })
        else current.tools.push({ name: line.text, args: "", status: "ok", durationMs: 0 })
      }
    } else if (line.kind === "route" && current) {
      current.routes.push(line.text)
    } else if (line.kind === "error" && current) {
      current.errors.push(line.text)
    } else if (line.kind === "llm" && current) {
      current.llms.push(line.text)
    }
  }
  return { header, meta, steps }
}

function timelineSection(dre: SessionDre.Snapshot, points: SessionRollback.Point[], detail?: SessionDre.Detail | null) {
  const parsed = parseTimeline(dre.timeline)

  // Build Gantt-style step bars
  const ganttHtml = parsed.steps.length
    ? (() => {
        // Compute max duration for proportional bars
        const durations = parsed.steps.map((s) => {
          const m = s.duration.match(/(?:(\d+)m\s*)?(\d+)s/)
          return m ? (parseInt(m[1] ?? "0") * 60 + parseInt(m[2] ?? "0")) * 1000 : 0
        })
        const maxDur = Math.max(...durations, 1)

        // Check if all steps have the same index (e.g., all "Step 0")
        const allSameIndex = parsed.steps.every((s) => s.index === parsed.steps[0].index)

        return [
          `<div class="gantt">`,
          parsed.steps.map((step, idx) => {
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
            const topTools = sorted.slice(0, 3).map(([n, info]) => info.count > 1 ? `${n} ×${info.count}` : n).join(", ")
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
              step.routes.length ? `<span class="gantt-route">${step.routes.map((r) => esc(r)).join(", ")}</span>` : "",
              `</div>`,
              // Collapsible tool details
              step.tools.length > 0
                ? [
                    `<details class="gantt-details">`,
                    `<summary class="gantt-summary">${step.tools.length} tool call${step.tools.length === 1 ? "" : "s"}${hasErrors ? ` · <span class="gantt-err">${step.errors.length} error${step.errors.length === 1 ? "" : "s"}</span>` : ""}${step.tokens ? ` · ${esc(step.tokens)}` : ""}</summary>`,
                    `<div class="gantt-tools">`,
                    sorted.slice(0, 10).map(([name, info]) => {
                      const timePct = Math.max(2, (info.totalMs / toolMaxMs) * 100)
                      const color = info.errors > 0 ? "var(--high)" : info.totalMs > 5000 ? "var(--warn)" : "var(--low)"
                      return [
                        `<div class="gantt-tool-row">`,
                        `<span class="gantt-tool-name">${esc(name)}${info.count > 1 ? ` <span class="gantt-tool-count">×${info.count}</span>` : ""}</span>`,
                        `<div class="gantt-tool-bar-wrap"><div class="gantt-tool-bar" style="width:${timePct.toFixed(0)}%;background:${color}"></div></div>`,
                        `<span class="gantt-tool-ms">${info.totalMs >= 1000 ? `${(info.totalMs / 1000).toFixed(1)}s` : `${info.totalMs}ms`}</span>`,
                        `</div>`,
                      ].join("")
                    }).join(""),
                    sorted.length > 10 ? `<span class="muted" style="font-size:11px;padding:4px 0">+${sorted.length - 10} more tools</span>` : "",
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
          }).join(""),
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
          detail.notes.map((item) => `<div class="driver-item"><span class="driver-icon">·</span><span>${esc(item)}</span></div>`).join(""),
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
                const toolSummary = [...uniq.entries()].map(([k, v]) => v > 1 ? `${k} ×${v}` : k).join(", ")
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

function indexFingerprint(list: Session.Info[]) {
  return list.map((item) => ({
    id: item.id,
    updated: item.time.updated,
    title: item.title,
    parentID: item.parentID ?? null,
  }))
}

function sessionFingerprint(input: {
  session: Awaited<ReturnType<typeof Session.get>>
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank?: SessionBranchRank.Family
  rollback: SessionRollback.Point[]
}) {
  return {
    session: {
      id: input.session.id,
      updated: input.session.time.updated,
      title: input.session.title,
    },
    graph: {
      nodes: input.graph.graph.nodes.length,
      edges: input.graph.graph.edges.length,
      steps: input.graph.graph.metadata.steps,
      errors: input.graph.graph.metadata.errors,
      duration: input.graph.graph.metadata.duration,
      tokens: input.graph.graph.metadata.tokens,
    },
    dre: {
      score: input.dre.detail?.score ?? null,
      confidence: input.dre.detail?.confidence ?? null,
      readiness: input.dre.detail?.readiness ?? null,
      stats: input.dre.detail?.stats ?? null,
      decision: input.dre.detail?.decision ?? null,
      routes: input.dre.detail?.routes.length ?? 0,
      tools: input.dre.detail?.tools.length ?? 0,
      notes: input.dre.detail?.notes.length ?? 0,
      semantic: input.dre.detail?.semantic?.headline ?? null,
      timeline: input.dre.timeline.length,
    },
    risk: {
      score: input.risk.assessment.score,
      level: input.risk.assessment.level,
      confidence: input.risk.assessment.confidence,
      readiness: input.risk.assessment.readiness,
      validation: input.risk.assessment.signals.validationState,
      files: input.risk.assessment.signals.filesChanged,
      lines: input.risk.assessment.signals.linesChanged,
      evidence: input.risk.assessment.evidence.length,
      unknowns: input.risk.assessment.unknowns.length,
      mitigations: input.risk.assessment.mitigations.length,
      quality: input.risk.quality
        ? {
            review: input.risk.quality.review
              ? {
                  status: input.risk.quality.review.overallStatus,
                  ready: input.risk.quality.review.readyForBenchmark,
                  resolvedLabels: input.risk.quality.review.resolvedLabeledItems,
                }
              : null,
            debug: input.risk.quality.debug
              ? {
                  status: input.risk.quality.debug.overallStatus,
                  ready: input.risk.quality.debug.readyForBenchmark,
                  resolvedLabels: input.risk.quality.debug.resolvedLabeledItems,
                }
              : null,
            qa: input.risk.quality.qa
              ? {
                  status: input.risk.quality.qa.overallStatus,
                  ready: input.risk.quality.qa.readyForBenchmark,
                  resolvedLabels: input.risk.quality.qa.resolvedLabeledItems,
                }
              : null,
          }
        : null,
    },
    rank: input.rank
      ? {
          confidence: input.rank.confidence,
          recommended: input.rank.recommended.id,
          items: input.rank.items.map((item) => ({
            id: item.id,
            score: item.decision.total,
            risk: item.risk.score,
          })),
        }
      : null,
    rollback: input.rollback.length,
  }
}

// Inline script in <head> — sets theme before first paint to prevent flash
function themeScript() {
  return [
    `<script>`,
    `(function(){`,
    `  var t=localStorage.getItem('ax-theme')||'dark';`,
    `  document.documentElement.setAttribute('data-theme',t);`,
    `})()`,
    `</script>`,
  ].join("")
}

// Theme toggle button + JS wired to Mermaid re-init
function themeToggle() {
  return [
    `<button class="theme-btn" id="theme-btn" onclick="axToggleTheme()" title="Switch theme">☀ Light</button>`,
    `<script>`,
    `function axToggleTheme(){`,
    `  var next=document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark';`,
    `  document.documentElement.setAttribute('data-theme',next);`,
    `  localStorage.setItem('ax-theme',next);`,
    `  var b=document.getElementById('theme-btn');`,
    `  if(b)b.textContent=next==='dark'?'☀ Light':'◑ Dark';`,
    `  if(window._reinitGraph)window._reinitGraph(next);`,
    `}`,
    `(function(){`,
    `  var t=document.documentElement.getAttribute('data-theme')||'dark';`,
    `  var b=document.getElementById('theme-btn');`,
    `  if(b)b.textContent=t==='dark'?'☀ Light':'◑ Dark';`,
    `})()`,
    `</script>`,
  ].join("")
}

function live(input: { sessionID?: string; directory?: string }) {
  return [
    `<script>`,
    `(() => {`,
    `const cfg = ${json({
      sessionID: input.sessionID ?? null,
      directory: input.directory ?? null,
      poll:
        input.sessionID == null
          ? `/dre-graph/fingerprint${input.directory ? `?directory=${encodeURIComponent(input.directory)}` : ""}`
          : `/dre-graph/session/${input.sessionID}/fingerprint${input.directory ? `?directory=${encodeURIComponent(input.directory)}` : ""}`,
      fingerprint: null,
    })}`,
    `const session = [`,
    `  "session.created",`,
    `  "session.updated",`,
    `  "session.deleted",`,
    `  "session.diff",`,
    `  "session.error",`,
    `  "session.status",`,
    `  "session.idle",`,
    `  "session.compacted",`,
    `]`,
    `const detail = [`,
    `  "message.updated",`,
    `  "message.removed",`,
    `  "message.part.updated",`,
    `  "message.part.removed",`,
    `  "message.part.delta",`,
    `]`,
    `const allow = cfg.sessionID == null ? session : [...session, ...detail]`,
    `let seen = JSON.stringify(cfg.fingerprint)`,
    `const node = document.getElementById("live-status")`,
    `const set = (text, kind) => {`,
    `  if (!node) return`,
    `  node.textContent = text`,
    `  node.className = kind ? "live " + kind : "live"`,
    `}`,
    `const pick = (props) => props?.sessionID ?? props?.info?.id ?? props?.info?.sessionID ?? props?.message?.sessionID ?? props?.part?.sessionID ?? props?.session?.id ?? null`,
    `const same = (data) => cfg.directory == null || data?.directory === cfg.directory`,
    `const keep = (data) => {`,
    `  const payload = data?.payload`,
    `  if (!payload || !same(data)) return false`,
    `  if (payload.type === "server.connected" || payload.type === "server.heartbeat") return false`,
    `  if (payload.type === "server.instance.disposed") return true`,
    `  if (!allow.includes(payload.type)) return false`,
    `  if (cfg.sessionID == null) return true`,
    `  return pick(payload.properties ?? {}) === cfg.sessionID`,
    `}`,
    `const key = "dre-live:" + (cfg.sessionID ?? cfg.directory ?? "index")`,
    `const gap = 2000`,
    `let wait = 0`,
    `const pull = () => {`,
    `  if (wait) return`,
    `  const last = Number(window.sessionStorage.getItem(key) ?? "0")`,
    `  const left = Math.max(350, gap - (Date.now() - last))`,
    `  set("updating", "wait")`,
    `  wait = window.setTimeout(() => {`,
    `    window.sessionStorage.setItem(key, String(Date.now()))`,
    `    window.location.reload()`,
    `  }, left)`,
    `}`,
    `const sync = async () => {`,
    `  if (!cfg.poll) return`,
    `  const res = await fetch(cfg.poll, { cache: "no-store", headers: { accept: "application/json" } })`,
    `  if (!res.ok) return`,
    `  const next = JSON.stringify(await res.json())`,
    `  if (seen === "null") {`,
    `    seen = next`,
    `    return`,
    `  }`,
    `  if (next === seen) return`,
    `  pull()`,
    `}`,
    `let _liveSrc = null;`,
    `if (typeof EventSource !== "function") {`,
    `  set("manual refresh", "off")`,
    `} else {`,
    `  set("connecting", "")`,
    `  const src = new EventSource("/global/event")`,
    `  _liveSrc = src`,
    `  src.onopen = () => set("live", "sync")`,
    `  src.onerror = () => set("offline", "off")`,
    `  src.onmessage = (event) => {`,
    `    const data = JSON.parse(event.data)`,
    `    if (keep(data)) pull()`,
    `  }`,
    `}`,
    `const _poll = window.setInterval(() => {`,
    `  if (document.visibilityState !== "visible") return`,
    `  sync().catch(() => {})`,
    `}, cfg.sessionID == null ? 5000 : 2000)`,
    `const _onVisible = () => {`,
    `  if (document.visibilityState !== "visible") return`,
    `  sync().catch(() => {})`,
    `}`,
    `document.addEventListener("visibilitychange", _onVisible)`,
    `window.addEventListener("beforeunload", () => {`,
    `  window.clearInterval(_poll)`,
    `  document.removeEventListener("visibilitychange", _onVisible)`,
    `  _liveSrc?.close()`,
    `}, { once: true })`,
    `sync().catch(() => {})`,
    `})()`,
    `</script>`,
  ].join("\n")
}

function mermaidScript(sid: string) {
  return [
    `<script>`,
    `const _AGENT = {`,
    `  build:'Dev', plan:'Planner', react:'Reasoner', general:'Assistant',`,
    `  explore:'Researcher', security:'Security', architect:'Architect',`,
    `  debug:'Debugger', perf:'Perf', devops:'DevOps', test:'Tester',`,
    `};`,
    `function _agentName(n) { return _AGENT[n] || (n ? n.charAt(0).toUpperCase()+n.slice(1) : 'Agent'); }`,
    `function _fmtMs(ms) { const s=Math.round(ms/1000); return s>=60 ? Math.floor(s/60)+'m '+s%60+'s' : s+'s'; }`,
    `function _updateSummary(graph) {`,
    `  const el = document.getElementById('gviz-summary-status');`,
    `  const dl = document.getElementById('gviz-summary-detail');`,
    `  if (!el || !dl) return;`,
    `  const meta = graph.metadata;`,
    `  const nodes = graph.nodes || [];`,
    `  const sorted = [...nodes].sort((a,b) => a.timestamp - b.timestamp);`,
    `  const lastRoute = [...sorted].reverse().find(n => n.type === 'agent_route');`,
    `  const currentAgent = lastRoute ? lastRoute.agent : meta.agents[0];`,
    `  const pendingStep = nodes.find(n => n.type === 'step' && n.duration == null && n.status !== 'error');`,
    `  const doneSteps = nodes.filter(n => n.type === 'step' && n.duration != null).length;`,
    `  const toolCounts = {};`,
    `  for (const t of meta.tools) toolCounts[t] = (toolCounts[t]||0)+1;`,
    `  const topTools = Object.entries(toolCounts).sort((a,b)=>b[1]-a[1]).slice(0,3)`,
    `    .map(([t,c])=>c>1?t+'\u00d7'+c:t).join(', ');`,
    `  const dur = meta.duration > 0 ? _fmtMs(meta.duration) : null;`,
    `  const errBadge = meta.errors > 0 ? ' \u00b7 '+meta.errors+' error'+(meta.errors>1?'s':'') : '';`,
    `  if (nodes.length === 0) {`,
    `    el.textContent = 'Waiting for session data\u2026'; dl.textContent = '';`,
    `  } else if (pendingStep) {`,
    `    el.textContent = _agentName(currentAgent)+' \u00b7 Step '+(pendingStep.stepIndex ?? doneSteps+1)+' of '+meta.steps+' \u2014 in progress';`,
    `    dl.textContent = (topTools || 'working'+(dur?' \u00b7 '+dur+' elapsed':''));`,
    `  } else {`,
    `    const risk = meta.risk.level;`,
    `    const riskColor = {LOW:'var(--low)',MEDIUM:'var(--warn)',HIGH:'var(--high)',CRITICAL:'var(--critical)'}[risk]||'var(--muted)';`,
    `    el.textContent = 'Completed \u00b7 '+meta.steps+' step'+(meta.steps===1?'':'s')+(dur?' \u00b7 '+dur:'');`,
    `    dl.innerHTML = (topTools?topTools+' \u00b7 ':'')+'<span style="color:'+riskColor+'">'+risk+' risk</span>'+errBadge;`,
    `  }`,
    `}`,
    `const _sid = ${json(sid)};`,
    `let _last = null;`,
    `async function _renderGraph() {`,
    `  const status = document.getElementById('gviz-status');`,
    `  try {`,
    `    const [svgRes, jsonRes] = await Promise.all([`,
    `      fetch('/graph/' + _sid + '?format=svggantt', { cache: 'no-store' }),`,
    `      fetch('/graph/' + _sid + '?format=json', { cache: 'no-store' }),`,
    `    ]);`,
    `    if (jsonRes.ok) { const j = await jsonRes.json(); _updateSummary(j.data); }`,
    `    if (!svgRes.ok) return;`,
    `    const text = await svgRes.text();`,
    `    if (text === _last) { if (status) status.textContent = 'updated ' + new Date().toLocaleTimeString(); return; }`,
    `    _last = text;`,
    `    const el = document.getElementById('graph-viz');`,
    `    if (el) el.innerHTML = text;`,
    `    if (status) status.textContent = 'updated ' + new Date().toLocaleTimeString();`,
    `  } catch(e) {`,
    `    const el = document.getElementById('graph-viz');`,
    `    if (el && !el.querySelector('svg')) el.innerHTML = '<span style="color:var(--muted);font-size:13px;font-style:italic;padding:12px;display:block">Graph unavailable — no execution data yet</span>';`,
    `    if (status) status.textContent = 'unavailable';`,
    `  }`,
    `}`,
    `_renderGraph();`,
    `const _refresh = window.setInterval(_renderGraph, 15000);`,
    `window.addEventListener("beforeunload", () => window.clearInterval(_refresh), { once: true });`,
    `window._reinitGraph = function() { _last = null; _renderGraph(); };`,
    `</script>`,
  ].join("\n")
}

function style() {
  return `
    /* ── Shared structural variables ── */
    :root {
      --radius: 12px; --radius-sm: 8px; --radius-xs: 6px;
    }
    /* ── Dark theme (default) ── */
    :root, [data-theme="dark"] {
      color-scheme: dark;
      --bg: #09090b; --panel: #18181b; --surface: #27272a;
      --line: #3f3f46; --line-subtle: #27272a;
      --text: #fafafa; --text-secondary: #d4d4d8; --muted: #a1a1aa;
      --accent: #3b82f6; --accent-light: #60a5fa; --accent-subtle: rgba(59,130,246,0.1);
      --warn: #eab308; --high: #ef4444; --critical: #dc2626; --low: #22c55e;
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.35);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.30);
      --shadow-lg: 0 8px 32px rgba(0,0,0,0.40);
      --nav-bg: rgba(9,9,11,0.85);
    }
    /* ── Light theme ── */
    [data-theme="light"] {
      color-scheme: light;
      --bg: #f8fafc; --panel: #ffffff; --surface: #f1f5f9;
      --line: #cbd5e1; --line-subtle: #e2e8f0;
      --text: #0f172a; --text-secondary: #475569; --muted: #94a3b8;
      --accent: #2563eb; --accent-light: #3b82f6; --accent-subtle: rgba(37,99,235,0.08);
      --warn: #d97706; --high: #dc2626; --critical: #b91c1c; --low: #16a34a;
      --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 32px rgba(0,0,0,0.12);
      --nav-bg: rgba(248,250,252,0.90);
    }
    * { box-sizing: border-box; margin: 0; }
    html { scroll-behavior: smooth; scroll-padding-top: 56px; }
    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      font-feature-settings: "cv11", "ss01";
    }
    a { color: var(--accent-light); text-decoration: none; transition: color 0.15s; }
    a:hover { color: var(--text); text-decoration: none; }
    h2 { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
    h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 12px; }
    p { color: var(--muted); line-height: 1.6; }

    /* Navigation */
    .nav {
      position: sticky; top: 0; z-index: 10;
      background: var(--nav-bg);
      backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid var(--line-subtle);
      padding: 0 24px;
    }
    .theme-btn {
      margin-left: 8px; padding: 4px 10px; font-size: 12px; font-weight: 500;
      border: 1px solid var(--line); border-radius: var(--radius-xs);
      background: var(--surface); color: var(--text-secondary);
      cursor: pointer; white-space: nowrap; transition: all 0.15s;
      font-family: inherit;
    }
    .theme-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-subtle); }
    .nav-inner {
      max-width: 1200px; margin: 0 auto;
      display: flex; align-items: center; gap: 2px; height: 52px;
      overflow-x: auto;
    }
    .nav-brand {
      font-weight: 700; font-size: 14px; color: var(--text); white-space: nowrap;
      margin-right: 16px; letter-spacing: -0.02em;
    }
    .nav-link {
      font-size: 13px; color: var(--muted); white-space: nowrap;
      padding: 8px 12px; border-radius: var(--radius-xs);
      transition: all 0.15s;
    }
    .nav-link:hover { color: var(--text); text-decoration: none; background: var(--surface); }
    .nav-back { font-size: 13px; color: var(--muted); white-space: nowrap; margin-left: auto; padding: 6px 12px; border-radius: var(--radius-xs); transition: all 0.15s; }
    .nav-back:hover { color: var(--text); text-decoration: none; background: var(--surface); }
    .nav-sep { width: 1px; height: 16px; background: var(--line-subtle); flex-shrink: 0; margin: 0 8px; }
    .live { font-size: 11px; color: var(--muted); white-space: nowrap; padding: 3px 10px; border-radius: 20px; background: var(--surface); }
    .live.sync { color: var(--low); background: rgba(34,197,94,0.08); }
    .live.wait { color: var(--warn); background: rgba(234,179,8,0.08); }
    .live.off { color: var(--high); background: rgba(239,68,68,0.08); }

    /* Layout */
    .band { padding: 32px 24px; }
    .band + .band { border-top: 1px solid var(--line-subtle); }
    .wrap { max-width: 1200px; margin: 0 auto; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 16px; }
    .grid-thirds { display: flex; flex-wrap: wrap; gap: 12px; margin: 16px 0; }
    .section-head { margin-bottom: 8px; }
    .section-head h2 { margin-bottom: 2px; }
    .section-head p { margin: 0; font-size: 13px; }

    /* ── Summary banner ── */
    .summary {
      padding: 48px 24px 40px;
      background: linear-gradient(180deg, rgba(24,24,27,0.9) 0%, var(--bg) 100%);
      border-bottom: 1px solid var(--line-subtle);
    }
    .summary-grid { display: flex; gap: 40px; align-items: flex-start; }
    .summary-risk { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .summary-details { flex: 1; min-width: 0; }
    .summary-decision { font-size: 22px; font-weight: 600; line-height: 1.3; margin-bottom: 6px; letter-spacing: -0.02em; color: var(--text); }
    .summary-plan { color: var(--muted); font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
    .summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .summary-stats .stat { min-width: 0; }
    .semantic-banner {
      margin-top: 28px; padding: 16px 20px;
      background: var(--panel); border: 1px solid var(--line-subtle); border-radius: var(--radius);
      display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
      box-shadow: var(--shadow-sm);
    }
    .semantic-icon { font-size: 18px; color: var(--accent); }
    .semantic-text { font-size: 14px; font-weight: 500; flex: 1; min-width: 200px; color: var(--text-secondary); }
    .semantic-chips { display: flex; flex-wrap: wrap; gap: 6px; }

    /* Panels */
    .panel {
      background: var(--panel); border: 1px solid var(--line-subtle);
      border-radius: var(--radius); padding: 24px;
      box-shadow: var(--shadow-sm);
      transition: border-color 0.2s;
    }
    .panel:hover { border-color: var(--line); }
    .panel-head { margin-bottom: 16px; }
    .panel-head h2 { margin-bottom: 4px; }
    .panel-head p { margin: 0; }

    /* Stats */
    .stat {
      flex: 1; min-width: 100px;
      border: 1px solid var(--line-subtle); border-radius: var(--radius-sm);
      padding: 12px 14px; background: var(--panel);
      display: flex; flex-direction: column; gap: 3px;
      transition: border-color 0.15s;
    }
    .stat:hover { border-color: var(--line); }
    .stat-icon { font-size: 14px; opacity: 0.45; margin-bottom: 2px; }
    .stat-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; }
    .stat-value { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
    .stat.low { border-left: 3px solid var(--low); }
    .stat.medium { border-left: 3px solid var(--warn); }
    .stat.high { border-left: 3px solid var(--high); }
    .stat.critical { border-left: 3px solid var(--critical); }

    /* Chips */
    .chip {
      display: inline-flex; align-items: center;
      padding: 3px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 500;
      border: 1px solid var(--line-subtle); background: var(--panel);
      color: var(--text-secondary);
    }
    .chip.low { color: var(--low); border-color: rgba(34, 197, 94, 0.25); background: rgba(34,197,94,0.06); }
    .chip.medium { color: var(--warn); border-color: rgba(234, 179, 8, 0.25); background: rgba(234,179,8,0.06); }
    .chip.high { color: var(--high); border-color: rgba(239, 68, 68, 0.25); background: rgba(239,68,68,0.06); }
    .chip.critical { color: var(--critical); border-color: rgba(220, 38, 38, 0.25); background: rgba(220,38,38,0.06); }
    .tag-row { display: flex; flex-wrap: wrap; gap: 6px; }

    /* Flow — compressed with run-length grouping */
    .flow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .node {
      padding: 4px 10px; border-radius: var(--radius-xs);
      font-size: 12px; font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
      background: var(--accent-subtle); border: 1px solid rgba(59, 130, 246, 0.15); color: var(--accent-light);
      transition: background 0.15s;
    }
    .node:hover { background: rgba(59,130,246,0.15); }
    .node.group { padding-right: 6px; }
    .node-count {
      display: inline-block; margin-left: 4px; padding: 1px 5px;
      border-radius: 8px; font-size: 10px; font-weight: 700;
      background: rgba(59, 130, 246, 0.2); color: var(--accent-light);
    }
    .node.trunc { background: rgba(161,161,170,0.08); border-color: rgba(161,161,170,0.15); color: var(--muted); font-style: italic; }
    .join { width: 12px; height: 1px; background: rgba(59, 130, 246, 0.25); border-radius: 999px; }
    .flow-summary { font-size: 11px; color: var(--muted); margin-top: 8px; }

    /* Step summary — mini bar charts per step */
    .step-bars { display: grid; gap: 4px; }
    .step-bar-row { display: grid; grid-template-columns: 90px 1fr 28px; gap: 6px; align-items: center; font-size: 12px; }
    .step-bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-family: ui-monospace, SFMono-Regular, monospace; }
    .step-bar-track { height: 6px; background: rgba(48,54,61,0.5); border-radius: 3px; overflow: hidden; }
    .step-bar-fill { height: 100%; border-radius: 3px; min-width: 2px; }
    .step-bar-count { text-align: right; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
    .lane-count { float: right; font-weight: 400; color: var(--muted); font-size: 11px; }

    /* Agent routes */
    .route-flow { display: flex; flex-wrap: wrap; gap: 8px; }
    .route-item {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle); font-size: 13px;
      transition: border-color 0.15s;
    }
    .route-item:hover { border-color: var(--line); }
    .route-from, .route-to { font-weight: 600; color: var(--text); }
    .route-arrow { color: var(--accent); }
    .route-conf { color: var(--muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; }

    /* Risk drivers */
    .driver-list { display: grid; gap: 0; }
    .driver-item {
      display: flex; gap: 10px; align-items: baseline; font-size: 13px; line-height: 1.5;
      padding: 8px 0; border-bottom: 1px solid var(--line-subtle);
      color: var(--text-secondary);
    }
    .driver-item:last-child { border-bottom: none; }
    .driver-icon { color: var(--accent); flex-shrink: 0; }

    /* Risk status indicators */
    .risk-status-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
      margin: 16px 0 12px;
    }
    .risk-indicator {
      display: flex; gap: 10px; align-items: center;
      padding: 12px 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.15s;
    }
    .risk-indicator:hover { border-color: var(--line); }
    .ri-icon {
      width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 700; flex-shrink: 0;
    }
    .risk-indicator.low .ri-icon { background: rgba(34,197,94,0.12); color: var(--low); }
    .risk-indicator.medium .ri-icon { background: rgba(234,179,8,0.12); color: var(--warn); }
    .risk-indicator.high .ri-icon { background: rgba(239,68,68,0.12); color: var(--high); }
    .risk-indicator.critical .ri-icon { background: rgba(220,38,38,0.12); color: var(--critical); }
    .ri-content { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
    .ri-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500; }
    .ri-value { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Risk flags */
    .risk-flags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }

    /* Signal grid */
    .signal-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
    }
    .signal-item {
      display: flex; flex-direction: column; gap: 2px;
      padding: 10px 12px; border-radius: var(--radius-xs);
      background: var(--surface);
    }
    .signal-label { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
    .signal-value { font-size: 14px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, monospace; }
    .signal-value.low { color: var(--low); }
    .signal-value.medium { color: var(--warn); }
    .signal-value.high { color: var(--high); }
    .signal-value.neutral { color: var(--text-secondary); }

    /* Evidence / Unknowns / Actions lists */
    .evidence-list { display: grid; gap: 0; }
    .evidence-item {
      display: flex; gap: 10px; align-items: baseline; font-size: 13px; line-height: 1.5;
      padding: 8px 0; border-bottom: 1px solid var(--line-subtle);
      color: var(--text-secondary);
    }
    .evidence-item:last-child { border-bottom: none; }
    .ev-icon {
      width: 20px; height: 20px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 700; flex-shrink: 0;
    }
    .ev-evidence { background: rgba(59,130,246,0.12); color: var(--accent-light); }
    .ev-unknown { background: rgba(234,179,8,0.12); color: var(--warn); }
    .ev-action { background: rgba(34,197,94,0.12); color: var(--low); }

    /* Tables */
    .table-wrap { overflow-x: auto; border-radius: var(--radius-sm); border: 1px solid var(--line-subtle); }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th {
      text-align: left; font-size: 10px; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--muted);
      padding: 10px 16px; background: rgba(39,39,42,0.5); font-weight: 600;
    }
    .data-table td { padding: 10px 16px; border-top: 1px solid var(--line-subtle); vertical-align: top; color: var(--text-secondary); }
    .data-table tbody tr:first-child td { border-top: 1px solid var(--line-subtle); }
    .data-table tr:hover td { background: rgba(59, 130, 246, 0.03); }
    .data-table .num { font-family: ui-monospace, SFMono-Regular, monospace; text-align: right; white-space: nowrap; font-weight: 500; }
    .data-table .num.low { color: var(--low); }
    .data-table .num.medium { color: var(--warn); }
    .data-table .num.high { color: var(--high); }
    .block { display: block; }

    /* Gantt-style timeline */
    .gantt { display: grid; gap: 0; }
    .gantt-step {
      border-bottom: 1px solid var(--line-subtle);
      padding: 12px 0;
    }
    .gantt-step:last-child { border-bottom: none; }
    .gantt-header {
      display: grid; grid-template-columns: 60px 1fr 50px; gap: 10px;
      align-items: center; font-size: 13px;
    }
    .gantt-label { font-weight: 600; white-space: nowrap; color: var(--text); font-size: 13px; }
    .gantt-bar-wrap {
      height: 10px; background: var(--surface); border-radius: 5px;
      overflow: hidden;
    }
    .gantt-bar { height: 100%; border-radius: 5px; min-width: 3px; transition: width 0.4s ease; }
    .gantt-dur {
      font-size: 12px; color: var(--muted); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .gantt-meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
    .gantt-tools-sig {
      font-size: 12px; color: var(--text-secondary);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .gantt-route { font-size: 12px; color: var(--accent-light); }
    .gantt-details { margin-top: 8px; }
    .gantt-summary {
      font-size: 12px; color: var(--muted); cursor: pointer;
      padding: 6px 10px; border-radius: var(--radius-xs);
      list-style: none; user-select: none;
      transition: background 0.15s;
    }
    .gantt-summary::-webkit-details-marker { display: none; }
    .gantt-summary::before { content: "▸ "; color: var(--accent); }
    details[open] > .gantt-summary::before { content: "▾ "; }
    .gantt-summary:hover { background: var(--surface); }
    .gantt-err { color: var(--high); font-weight: 600; }
    .gantt-tools { padding: 10px 0 4px 18px; display: grid; gap: 5px; }
    .gantt-tool-row {
      display: grid; grid-template-columns: 130px 1fr 50px; gap: 8px;
      align-items: center; font-size: 12px;
    }
    .gantt-tool-name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary);
    }
    .gantt-tool-count {
      font-size: 10px; font-weight: 600; padding: 1px 5px;
      border-radius: 6px; background: var(--accent-subtle); color: var(--accent-light);
    }
    .gantt-tool-bar-wrap { height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; }
    .gantt-tool-bar { height: 100%; border-radius: 2px; min-width: 2px; }
    .gantt-tool-ms {
      font-size: 11px; color: var(--muted); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .gantt-error {
      padding: 6px 10px; margin-top: 6px; font-size: 12px;
      color: var(--high); background: rgba(239,68,68,0.06);
      border-left: 2px solid var(--high); border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    }

    /* Rollback — horizontal bar list */
    .rb-count {
      font-size: 10px; font-weight: 600; padding: 2px 8px;
      border-radius: 20px; background: var(--surface); color: var(--muted);
      margin-left: 6px; vertical-align: middle;
    }
    .rb-bars-list { display: grid; gap: 0; }
    .rb-row {
      display: grid; grid-template-columns: 28px 1fr; gap: 10px;
      align-items: center; padding: 8px 0;
      border-bottom: 1px solid var(--line-subtle);
      transition: background 0.1s;
    }
    .rb-row:last-child { border-bottom: none; }
    .rb-row:hover { background: rgba(59,130,246,0.02); }
    .rb-idx {
      font-size: 11px; font-weight: 600; color: var(--muted); text-align: center;
      width: 24px; height: 24px; line-height: 24px;
      border-radius: 50%; background: var(--surface);
    }
    .rb-content { display: grid; gap: 3px; }
    .rb-bar-line { display: grid; grid-template-columns: 1fr 44px; gap: 8px; align-items: center; }
    .rb-bar-track { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
    .rb-bar-fill { height: 100%; border-radius: 3px; min-width: 3px; }
    .rb-dur {
      font-size: 12px; color: var(--text-secondary); text-align: right;
      font-family: ui-monospace, SFMono-Regular, monospace; white-space: nowrap;
    }
    .rb-tools-text { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Steps */
    .step-grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
    .lane {
      padding: 14px; border-radius: var(--radius-sm);
      background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.15s;
    }
    .lane:hover { border-color: var(--line); }
    .lane-head { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; font-weight: 600; }

    /* Critical path — pipeline view */
    .cpath { display: grid; gap: 0; }
    .cpath-summary { font-size: 12px; color: var(--muted); margin-bottom: 12px; }
    .cpath-connector { display: flex; justify-content: center; padding: 2px 0; }
    .cpath-arrow { color: var(--line); font-size: 14px; }
    .cpath-phase {
      border: 1px solid var(--line-subtle); border-radius: var(--radius-sm);
      padding: 12px 14px; background: var(--surface);
      transition: border-color 0.15s;
    }
    .cpath-phase:hover { border-color: var(--line); }
    .cpath-phase-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 8px;
    }
    .cpath-phase-label { font-size: 13px; font-weight: 600; color: var(--text); }
    .cpath-phase-count { font-size: 11px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, monospace; }
    .cpath-tools { display: grid; gap: 4px; }
    .cpath-tool { display: flex; align-items: center; gap: 8px; }
    .cpath-tool-name {
      font-size: 12px; color: var(--text-secondary);
      font-family: ui-monospace, SFMono-Regular, monospace;
      min-width: 100px; flex-shrink: 0;
    }
    .cpath-tool-n {
      font-size: 10px; font-weight: 600; padding: 0 4px;
      border-radius: 4px; background: var(--accent-subtle); color: var(--accent-light);
    }
    .cpath-tool-bar {
      height: 4px; border-radius: 2px;
      background: var(--accent); opacity: 0.5;
    }

    /* Pairs */
    .pair-list { display: grid; gap: 6px; }
    .pair {
      display: flex; gap: 8px; align-items: center;
      padding: 8px 12px; border-radius: var(--radius-xs);
      background: var(--panel); border: 1px solid var(--line-subtle);
      font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace;
      transition: border-color 0.15s;
    }
    .pair:hover { border-color: var(--line); }
    .pair-arrow { color: var(--accent); }

    /* Branches */
    .branch-list { display: grid; gap: 10px; }
    .branch-card {
      display: grid; gap: 10px; padding: 18px;
      border-radius: var(--radius); background: var(--panel); border: 1px solid var(--line-subtle);
      transition: border-color 0.2s, box-shadow 0.2s;
      box-shadow: var(--shadow-sm);
    }
    .branch-card.recommended { border-color: rgba(34, 197, 94, 0.3); }
    .branch-card:hover { border-color: var(--line); box-shadow: var(--shadow-md); }
    .branch-head {
      display: flex; flex-wrap: wrap; gap: 8px;
      justify-content: space-between; align-items: center;
    }

    /* Session index */
    .hero { padding: 36px 24px 28px; border-bottom: 1px solid var(--line-subtle); }
    .hero .wrap { display: grid; gap: 12px; }
    .hero-title { font-size: 28px; font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
    .hero-subtitle { color: var(--muted); font-size: 15px; }
    .session-list { display: grid; gap: 10px; }
    .session-card {
      display: grid; gap: 10px;
      border: 1px solid var(--line-subtle); border-radius: var(--radius);
      padding: 16px; background: var(--panel);
      transition: border-color 0.2s, box-shadow 0.2s;
      box-shadow: var(--shadow-sm);
    }
    .session-card:hover { border-color: var(--accent); box-shadow: var(--shadow-md); }
    .session-head {
      display: flex; flex-wrap: wrap; justify-content: space-between;
      gap: 8px; align-items: center;
    }
    .links { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

    .muted { color: var(--muted); }
    .empty { color: var(--muted); font-style: italic; font-size: 13px; }
    .footer {
      padding: 28px 24px; border-top: 1px solid var(--line-subtle);
      text-align: center; font-size: 11px; color: var(--muted); letter-spacing: 0.02em;
    }

    /* ── Execution summary bar ── */
    .gviz-summary-bar {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 14px; margin-top: 14px; margin-bottom: 6px;
      background: var(--surface); border: 1px solid var(--line-subtle);
      border-radius: var(--radius-xs); font-size: 13px; line-height: 1;
    }
    .gviz-summary-icon { color: var(--accent); font-size: 12px; flex-shrink: 0; }
    .gviz-summary-status { font-weight: 600; color: var(--text); white-space: nowrap; }
    .gviz-summary-sep { color: var(--line); flex-shrink: 0; }
    .gviz-summary-detail { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* ── Execution graph viz (Mermaid inline) ── */
    .gviz-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 14px; margin-bottom: 6px;
    }
    .gviz-label {
      font-size: 10px; font-weight: 600; color: var(--muted);
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .gviz-status {
      font-size: 11px; color: var(--muted);
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .gviz-container {
      overflow: hidden;
      background: var(--panel); border: 1px solid var(--line-subtle);
      border-radius: var(--radius-sm); padding: 16px;
      transition: border-color 0.15s;
    }
    .gviz-container:hover { border-color: var(--line); }
    .gviz-container svg { display: block; width: 100%; height: auto; }

    /* SVG Gauge */
    .gauge { display: block; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2)); }
    .summary-risk { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }

    /* Summary row — stats + donut side by side */
    .summary-row { display: flex; gap: 24px; align-items: flex-start; }
    .summary-row .summary-stats { flex: 1; }

    /* Bar chart */
    .bar-chart { display: grid; gap: 8px; }
    .bar-row { display: grid; grid-template-columns: 130px 1fr 48px; gap: 10px; align-items: center; }
    .bar-label { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); }
    .bar-track { height: 6px; background: var(--surface); border-radius: 3px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
    .bar-value { font-size: 12px; font-weight: 600; text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; }
    .bar-detail { grid-column: 1 / -1; font-size: 11px; color: var(--muted); margin-top: -4px; padding-left: 0; }

    /* Donut chart */
    .donut-wrap { display: flex; gap: 14px; align-items: center; flex-shrink: 0; }
    .donut-legend { display: grid; gap: 5px; }
    .donut-item { display: flex; gap: 6px; align-items: center; font-size: 12px; white-space: nowrap; color: var(--text-secondary); }
    .donut-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .donut-item strong { margin-left: auto; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text); }

    /* ── Verdict ── */
    .verdict { padding: 20px 24px; }
    .verdict-inner { max-width: 1200px; margin: 0 auto; background: var(--panel); border: 1px solid var(--line-subtle); border-radius: var(--radius); padding: 24px 28px; box-shadow: var(--shadow-md); }
    .verdict-inner.low { border-left: 4px solid var(--low); }
    .verdict-inner.medium { border-left: 4px solid var(--warn); }
    .verdict-inner.high { border-left: 4px solid var(--high); }
    .verdict-inner.critical { border-left: 4px solid var(--critical); }
    .verdict-headline { font-size: 20px; font-weight: 700; margin-bottom: 14px; letter-spacing: -0.02em; }
    .verdict-headline.low { color: var(--low); }
    .verdict-headline.medium { color: var(--warn); }
    .verdict-headline.high { color: var(--high); }
    .verdict-headline.critical { color: var(--critical); }
    .verdict-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
    .verdict-callout { display: flex; gap: 10px; align-items: baseline; padding: 10px 14px; border-radius: var(--radius-sm); background: var(--surface); font-size: 13px; margin-top: 6px; color: var(--text-secondary); }
    .verdict-callout-icon { flex-shrink: 0; font-size: 14px; }

    /* ── Changes table ── */
    .changes-row { display: grid; grid-template-columns: 12px 1fr auto auto auto; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line-subtle); font-size: 13px; }
    .changes-row:last-child { border-bottom: none; }
    .risk-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .risk-dot.low { background: var(--low); }
    .risk-dot.medium { background: var(--warn); }
    .risk-dot.high { background: var(--high); }
    .file-path { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .diff-stat { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; white-space: nowrap; }
    .diff-add { color: var(--low); }
    .diff-del { color: var(--high); }
    .change-signal { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px; }

    /* ── Validation ── */
    .validation-list { display: grid; gap: 6px; }
    .validation-item { display: flex; gap: 10px; align-items: center; padding: 8px 14px; background: var(--surface); border-radius: var(--radius-xs); font-size: 13px; }
    .validation-icon { flex-shrink: 0; font-size: 14px; }
    .validation-cmd { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--text-secondary); flex: 1; }
    .validation-status { font-size: 12px; flex-shrink: 0; }

    /* ── Branch scorecard ── */
    .branch-scorecard { margin-top: 10px; display: grid; gap: 4px; }
    .branch-score-row { display: grid; grid-template-columns: 76px 1fr 36px; gap: 6px; align-items: center; font-size: 11px; }
    .branch-compare { grid-template-columns: repeat(2, 1fr); }
    .branch-title { font-size: 14px; }
    .branch-readiness { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 7px 10px; border-radius: var(--radius-xs); margin: 8px 0; }
    .branch-readiness.low { background: rgba(34,197,94,0.1); color: var(--low); }
    .branch-readiness.medium { background: rgba(234,179,8,0.1); color: var(--warn); }
    .branch-readiness.high { background: rgba(239,68,68,0.1); color: var(--high); }
    .branch-readiness.critical { background: rgba(220,38,38,0.15); color: var(--critical); }
    .branch-readiness-icon { font-size: 14px; flex-shrink: 0; }
    .branch-score-chip { margin-left: auto; font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; font-weight: 700; }
    .branch-headline { font-size: 13px; color: var(--text-secondary); margin: 8px 0; line-height: 1.5; }
    .branch-score-label { color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; }
    .branch-score-track { height: 4px; background: var(--surface); border-radius: 2px; overflow: hidden; }
    .branch-score-fill { height: 100%; border-radius: 2px; min-width: 2px; }
    .branch-score-val { text-align: right; font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; font-weight: 600; min-width: 32px; }
    .branch-score-detail { grid-column: 1 / -1; font-size: 11px; color: var(--muted); margin: -2px 0 4px; padding-left: 2px; font-style: italic; }
    .branch-evidence { margin-top: 10px; display: grid; gap: 3px; }
    .branch-ev-item { display: flex; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .ev-dot { color: var(--muted); flex-shrink: 0; }
    .branch-semantic { font-size: 12px; color: var(--muted); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-subtle); }

    /* ── Activity section ── */
    .act-card { background: var(--surface); border-radius: var(--radius-sm); padding: 14px 16px; margin-bottom: 10px; border: 1px solid var(--line-subtle); }
    .act-card-err { border-color: rgba(239,68,68,0.3); }
    .act-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 7px; flex-wrap: wrap; }
    .act-label { font-weight: 600; font-size: 13px; white-space: nowrap; min-width: 52px; }
    .act-agent { font-size: 11px; color: var(--accent-light); background: var(--accent-subtle); padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
    .act-bar-wrap { flex: 1; height: 5px; background: var(--panel); border-radius: 3px; overflow: hidden; min-width: 40px; }
    .act-bar { height: 100%; border-radius: 3px; min-width: 4px; }
    .act-dur { font-size: 12px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); white-space: nowrap; }
    .act-err-badge { font-size: 11px; color: var(--high); white-space: nowrap; }
    .act-card-summary { list-style: none; cursor: pointer; }
    .act-card-summary::-webkit-details-marker { display: none; }
    .act-card[open] .act-card-summary { margin-bottom: 12px; }
    .act-card-summary:hover .act-label { color: var(--accent-light); }
    .act-summary { font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5; }
    .act-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .act-expand { border-top: 1px solid var(--line-subtle); margin-top: 12px; padding-top: 12px; display: grid; gap: 12px; }
    .act-timing { display: grid; gap: 5px; }
    .act-timing-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 2px; }
    .act-timing-row { display: grid; grid-template-columns: 1fr 120px 44px; gap: 8px; align-items: center; }
    .act-timing-name { font-size: 12px; font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .act-timing-arg { color: var(--muted); margin-left: 4px; }
    .act-timing-track { height: 5px; background: var(--panel); border-radius: 3px; overflow: hidden; }
    .act-timing-bar { height: 100%; border-radius: 3px; min-width: 3px; }
    .act-timing-ms { font-size: 11px; font-family: ui-monospace, SFMono-Regular, monospace; text-align: right; color: var(--text-secondary); }
    .act-files { display: grid; gap: 4px; }
    .act-files-row { display: flex; gap: 8px; font-size: 12px; align-items: baseline; }
    .act-files-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); white-space: nowrap; min-width: 36px; }
    .act-files-list { font-family: ui-monospace, SFMono-Regular, monospace; color: var(--text-secondary); }
    .act-files-edited { color: var(--accent-light); }
    .act-error-list { display: grid; gap: 4px; }
    /* ── Agent roster ── */
    .agent-roster { display: grid; gap: 5px; }
    .agent-item { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 7px 10px; background: var(--surface); border-radius: var(--radius-xs); }
    .agent-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; }
    .agent-name { flex: 1; font-weight: 500; }
    .agent-tag { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }

    @media (max-width: 900px) {
      .grid, .step-grid { grid-template-columns: 1fr; }
      .summary-grid { flex-direction: column; align-items: center; text-align: center; }
      .summary-stats { grid-template-columns: repeat(2, 1fr); }
      .risk-status-row { grid-template-columns: repeat(2, 1fr); }
      .signal-grid { grid-template-columns: repeat(2, 1fr); }
      .summary-row { flex-direction: column; }
      .bar-row { grid-template-columns: 100px 1fr 40px; }
      .hero-title { font-size: 22px; }
      .nav-inner { gap: 2px; }
      .verdict-grid { grid-template-columns: repeat(2, 1fr); }
      .changes-row { grid-template-columns: 12px 1fr auto auto; }
      .change-signal { display: none; }
    }
  `
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
          .map(
            (item) =>
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
      const list = [] as Session.Info[]
      for await (const item of Session.list({ limit: 50, directory })) list.push(item)
      c.header("cache-control", "no-store")
      c.header("content-type", "text/html; charset=utf-8")
      return c.body(index({ list, search }))
    })
    .get("/fingerprint", async (c) => {
      const directory = c.req.query("directory") ?? undefined
      const list = [] as Session.Info[]
      for await (const item of Session.list({ limit: 50, directory })) list.push(item)
      c.header("cache-control", "no-store")
      return c.json(indexFingerprint(list))
    })
    .get(
      "/session/:sessionID",
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          quality: z.coerce.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sid = c.req.valid("param").sessionID
        const query = c.req.valid("query")
        const session = await Session.get(sid)
        const search = c.req.url.includes("?") ? c.req.url.slice(c.req.url.indexOf("?")) : ""
        const [graphData, dre, riskData, rank, points] = await Promise.all([
          Promise.resolve(SessionGraph.snapshot(sid)),
          SessionDre.snapshot(sid),
          SessionRisk.load(sid, { includeQuality: query.quality }),
          SessionBranchRank.family(sid).catch(() => undefined),
          SessionRollback.points(sid),
        ])

        c.header("cache-control", "no-store")
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
    )
    .get(
      "/session/:sessionID/fingerprint",
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "query",
        z.object({
          quality: z.coerce.boolean().optional().default(false),
        }),
      ),
      async (c) => {
        const sid = c.req.valid("param").sessionID
        const query = c.req.valid("query")
        const session = await Session.get(sid)
        const [graphData, dre, riskData, rank, points] = await Promise.all([
          Promise.resolve(SessionGraph.snapshot(sid)),
          SessionDre.snapshot(sid),
          SessionRisk.load(sid, { includeQuality: query.quality }),
          SessionBranchRank.family(sid).catch(() => undefined),
          SessionRollback.points(sid),
        ])

        c.header("cache-control", "no-store")
        return c.json(
          sessionFingerprint({
            session,
            graph: graphData,
            dre,
            risk: riskData,
            rank,
            rollback: points,
          }),
        )
      },
    )
)
