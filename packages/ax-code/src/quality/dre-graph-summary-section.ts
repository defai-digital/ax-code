import { SessionDre } from "../session/dre"
import { SessionGraph } from "../session/graph"
import { SessionRisk } from "../session/risk"
import { confidenceTone, esc, num, readiness, readinessTone, time, tone } from "./dre-graph-format"
import { chip, donut, gauge, stat } from "./dre-graph-widgets"

export function summary(input: { dre: SessionDre.Snapshot; risk: SessionRisk.Detail; graph: SessionGraph.Snapshot }) {
  const detail = input.dre.detail
  const riskLevel = detail?.level ?? input.risk.assessment.level
  const riskScore = detail?.score ?? input.risk.assessment.score
  const meta = input.graph.graph.metadata

  return [
    `<section class="summary" id="summary">`,
    `<div class="wrap">`,
    `<div class="summary-grid">`,
    `<div class="summary-risk">`,
    gauge({ score: riskScore, max: 100, level: riskLevel }),
    `</div>`,
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
          detail.semantic.signals.length
            ? detail.semantic.signals
                .slice(0, 3)
                .map((s) => chip({ label: s }))
                .join("")
            : "",
          `</div>`,
          `</div>`,
        ].join("")
      : "",
    `</div>`,
    `</section>`,
  ].join("")
}
