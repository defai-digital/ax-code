import { SessionRisk } from "../../session/risk"
import { esc, validation } from "./dre-graph-format"
import { chip } from "./dre-graph-widgets"

export function validationSection(input: { risk: SessionRisk.Detail }) {
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
          .map((cmd) => {
            const icon =
              sig.validationState === "failed" ? "\u2717" : sig.validationState === "passed" ? "\u2713" : "\u2026"
            const label =
              sig.validationState === "failed"
                ? "failed"
                : sig.validationState === "passed"
                  ? "passed"
                  : sig.validationState === "partial"
                    ? "partial"
                    : "not run"
            const kind =
              sig.validationState === "failed"
                ? "high"
                : sig.validationState === "passed"
                  ? "low"
                  : sig.validationState === "partial"
                    ? "medium"
                    : "neutral"
            return `<div class="validation-item"><span class="validation-icon">${icon}</span><span class="validation-cmd">${esc(cmd)}</span><span class="validation-status">${chip({ label, kind })}</span></div>`
          })
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
