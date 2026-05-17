import { SessionDre } from "../session/dre"
import { SessionRisk } from "../session/risk"
import { confidenceTone, esc, num, readiness, readinessTone, tone, validation } from "./dre-graph-format"
import { qualityReadinessSection } from "./dre-graph-quality-readiness"
import { barChart, chip } from "./dre-graph-widgets"

export function riskSection(input: SessionRisk.Detail, dre: SessionDre.Snapshot) {
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
