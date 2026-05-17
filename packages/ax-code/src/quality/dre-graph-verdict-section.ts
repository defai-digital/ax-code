import { SessionDre } from "../session/dre"
import { SessionRisk } from "../session/risk"
import { confidenceTone, esc, readiness, readinessTone, tone, validation } from "./dre-graph-format"
import { chip, stat } from "./dre-graph-widgets"

export function verdictSection(input: { dre: SessionDre.Snapshot; risk: SessionRisk.Detail }) {
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
  const validationLabel =
    sig.validationCommands.length > 0
      ? `${validation(sig)} (${sig.validationCommands
          .slice(0, 3)
          .map((c) => esc(c.split(" ").slice(0, 3).join(" ")))
          .join(", ")})`
      : validation(sig)

  return [
    `<section class="verdict" id="verdict">`,
    `<div class="verdict-inner ${readyTone}">`,
    `<div class="verdict-headline ${readyTone}">${esc(headlines[ready] ?? readiness(ready))}</div>`,
    `<div class="verdict-grid">`,
    stat({
      label: "Confidence",
      value: `${Math.round(input.risk.assessment.confidence * 100)}%`,
      kind: confidenceTone(input.risk.assessment.confidence),
    }),
    stat({ label: "Risk", value: `${input.risk.assessment.score}/100`, kind: tone(input.risk.assessment.level) }),
    stat({
      label: "Validation",
      value: validationLabel,
      kind: sig.validationState === "passed" ? "low" : sig.validationState === "failed" ? "high" : "neutral",
    }),
    stat({
      label: "Decision",
      value: detail.scorecard.total.toFixed(2),
      kind: detail.scorecard.total >= 0.7 ? "low" : detail.scorecard.total >= 0.4 ? "medium" : "high",
    }),
    `</div>`,
    detail.semantic
      ? `<div style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">${esc(detail.semantic.headline)} \u00b7 ${chip({ label: detail.semantic.risk, kind: tone(detail.semantic.risk) })} \u00b7 ${detail.semantic.files} file${detail.semantic.files === 1 ? "" : "s"} \u00b7 <span class="diff-add">+${detail.semantic.additions}</span> <span class="diff-del">-${detail.semantic.deletions}</span></div>`
      : "",
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
