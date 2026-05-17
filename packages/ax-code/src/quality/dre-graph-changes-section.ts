import { SessionDre } from "../session/dre"
import { esc, tone } from "./dre-graph-format"
import { chip } from "./dre-graph-widgets"

export function changesSection(input: { dre: SessionDre.Snapshot }) {
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
          c.signals[0]
            ? `<span class="change-signal" title="${esc(c.signals.join(" \u00b7 "))}">${esc(c.signals[0])}</span>`
            : `<span class="change-signal"></span>`,
          `</div>`,
        ].join(""),
      )
      .join(""),
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
