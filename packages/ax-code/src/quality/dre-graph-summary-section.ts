import { SessionDre } from "../session/dre"
import { SessionGraph } from "../session/graph"
import { esc, num, time, tone } from "./dre-graph-format"
import { chip, stat } from "./dre-graph-widgets"

export function summary(input: { dre: SessionDre.Snapshot; graph: SessionGraph.Snapshot }) {
  const detail = input.dre.detail
  const meta = input.graph.graph.metadata

  return [
    `<section class="summary" id="summary">`,
    `<div class="wrap">`,
    detail
      ? [
          `<div class="summary-decision">${esc(detail.decision)}</div>`,
          `<div class="summary-plan">${esc(detail.plan)}</div>`,
          `<div class="summary-stats">`,
          stat({ label: "Steps", value: num(meta.steps), icon: "⬡" }),
          stat({ label: "Tools", value: num(meta.tools.length), icon: "⚙" }),
          stat({ label: "Duration", value: time(detail.duration), icon: "⏱" }),
          stat({ label: "Errors", value: num(meta.errors), kind: meta.errors > 0 ? "high" : "neutral", icon: "✗" }),
          `</div>`,
          `<p class="muted" style="font-size:12px;margin-top:12px">${num(detail.tokens.input)} in · ${num(detail.tokens.output)} out tokens</p>`,
        ].join("")
      : `<div class="summary-decision">No DRE analysis available yet. Send a message to generate session data.</div>`,
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
