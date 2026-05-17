import type { SessionBranchRank } from "../session/branch"
import { esc, readinessTone } from "./dre-graph-format"
import { chip } from "./dre-graph-widgets"

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

export function branchSection(input?: SessionBranchRank.Family) {
  if (!input) return ""

  const isSwitching = input.current.id !== input.recommended.id
  const topReason = input.reasons[0] ?? ""

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

function branchCard(item: SessionBranchRank.Item) {
  const ready = item.risk.readiness
  const readyTone = readinessTone(ready)
  const scoreTotal = Math.round(item.decision.total * 100)

  return [
    `<div class="branch-card ${item.recommended ? "recommended" : ""}${item.current ? " current" : ""}">`,
    `<div class="branch-head">`,
    `<strong class="branch-title">${esc(item.title)}</strong>`,
    `<div class="tag-row">`,
    item.current ? chip({ label: "current" }) : "",
    item.recommended ? chip({ label: "recommended", kind: "low" }) : "",
    `</div>`,
    `</div>`,
    `<div class="branch-readiness ${readyTone}">`,
    `<span class="branch-readiness-icon">${readinessIcon[ready] ?? "?"}</span>`,
    `<span>${esc(readinessLabel[ready] ?? ready)}</span>`,
    `<span class="branch-score-chip">${scoreTotal}/100</span>`,
    `</div>`,
    `<p class="branch-headline">${esc(item.headline)}</p>`,
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
    item.semantic
      ? `<div class="branch-semantic">${esc(item.semantic.headline)} <span class="muted">(+${item.semantic.additions} / -${item.semantic.deletions})</span></div>`
      : "",
    `</div>`,
  ].join("")
}
