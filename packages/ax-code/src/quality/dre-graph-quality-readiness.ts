import { SessionRisk } from "../session/risk"
import { ProbabilisticRollout } from "./probabilistic-rollout"
import { esc } from "./dre-graph-format"
import { chip } from "./dre-graph-widgets"

export function qualityReadinessSection(input: SessionRisk.Detail) {
  const summaries = [
    input.quality?.review ? { workflow: "review" as const, summary: input.quality.review } : null,
    input.quality?.debug ? { workflow: "debug" as const, summary: input.quality.debug } : null,
    input.quality?.qa ? { workflow: "qa" as const, summary: input.quality.qa } : null,
  ].filter(
    (
      item,
    ): item is { workflow: "review" | "debug" | "qa"; summary: NonNullable<SessionRisk.QualityReadiness["review"]> } =>
      !!item,
  )

  if (summaries.length === 0) return ""

  return [
    `<div style="margin-top:20px"><h3>Quality Readiness</h3>`,
    `<p class="muted" style="font-size:12px;margin-top:-6px;margin-bottom:10px">Replay-based readiness estimate per workflow — how likely review, debug, and QA passes are to hold up.</p>`,
    `<div class="validation-list">`,
    summaries
      .map(({ workflow, summary }) => {
        const first = ProbabilisticRollout.targetedTestRecommendations(summary)[0]
        const firstLine = first ? `<br><span class="muted">first: ${esc(first)}</span>` : ""
        const readiness = ProbabilisticRollout.readinessStateLabel(summary)
        const detail = ProbabilisticRollout.readinessDetailLabel(summary)
        const nextAction = ProbabilisticRollout.readinessNextActionLabel(summary)
        return [
          `<div class="validation-item">`,
          `<span class="validation-icon">${workflow === "review" ? "R" : workflow === "debug" ? "D" : "Q"}</span>`,
          `<span class="validation-cmd">`,
          `<strong>${esc(workflow)}</strong> · ${esc(readiness)} · ${esc(detail)}`,
          firstLine,
          nextAction ? `<br><span class="muted">${esc(nextAction)}</span>` : "",
          `</span>`,
          `<span class="validation-status">${chip({
            label: ProbabilisticRollout.readinessStateLabel(summary),
            kind: ProbabilisticRollout.readinessStateKind(summary),
          })}</span>`,
          `</div>`,
        ].join("")
      })
      .join(""),
    `</div></div>`,
  ].join("")
}
