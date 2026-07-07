import { SessionDre } from "../session/dre"
import { SessionRisk } from "../session/risk"
import { esc, num, tone } from "./dre-graph-format"
import { qualityReadinessSection } from "./dre-graph-quality-readiness"
import { barChart, chip } from "./dre-graph-widgets"

export function riskSection(input: SessionRisk.Detail, dre: SessionDre.Snapshot) {
  const detail = dre.detail
  const sig = input.assessment.signals

  // Signals grid — the detailed signal data (readiness/confidence/validation already lead the page in Verdict;
  // this section covers only what isn't shown there, plus the diff-source caveat)
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
    {
      label: "Diff source",
      value: sig.diffState,
      kind: sig.diffState === "recorded" ? "low" : sig.diffState === "derived" ? "medium" : "high",
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
          `<p class="muted" style="font-size:12px;margin-top:-6px;margin-bottom:10px">How this session's outcome compares against historical replay data.</p>`,
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
