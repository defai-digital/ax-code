import type { Session } from "../../session"
import type { Risk } from "../../risk/score"
import { compact, esc, num, readiness, readinessTone, stamp, tone } from "./run-report-format"
import { chip } from "./run-report-widgets"

type Row = { session: Session.Info; risk: Risk.Assessment }

/**
 * The workspace ledger answers "what did the agents change here, and is it verified?"
 * before it says anything about token volume. Sessions fall into exactly one group so
 * the counts add up and nothing that needs a human decision hides in a flat list.
 */
export type LedgerGroup = "attention" | "unverified" | "verified" | "readonly"

const GROUPS: { key: LedgerGroup; title: string; hint: string; open: boolean }[] = [
  {
    key: "attention",
    title: "Needs your attention",
    hint: "Blocked, needs review, failed validation, or tool failures",
    open: true,
  },
  {
    key: "unverified",
    title: "Changed, not verified",
    hint: "Files changed without a passing validation on record",
    open: true,
  },
  { key: "verified", title: "Changed and verified", hint: "Files changed and validation passed", open: false },
  { key: "readonly", title: "No file changes", hint: "Read-only work, questions and investigation", open: false },
]

function signals(risk: Risk.Assessment) {
  const raw = (risk.signals ?? {}) as Partial<Risk.Assessment["signals"]>
  return {
    changed: (raw.filesChanged ?? 0) > 0 || (raw.linesChanged ?? 0) > 0,
    files: raw.filesChanged ?? 0,
    lines: raw.linesChanged ?? 0,
    validation: raw.validationState ?? "not_run",
    failures: raw.toolFailures ?? 0,
  }
}

/** Why a session needs a human. Empty when it does not. */
export function attentionReasons(risk: Risk.Assessment): string[] {
  const s = signals(risk)
  return [
    risk.readiness === "blocked" ? "blocked" : "",
    risk.readiness === "needs_review" ? "needs review" : "",
    s.validation === "failed" ? "validation failed" : "",
    s.failures > 0 ? `${s.failures} tool ${s.failures === 1 ? "failure" : "failures"}` : "",
  ].filter(Boolean)
}

export function ledgerGroup(risk: Risk.Assessment): LedgerGroup {
  const s = signals(risk)
  if (attentionReasons(risk).length > 0) return "attention"
  if (!s.changed) return "readonly"
  return s.validation === "passed" ? "verified" : "unverified"
}

export function buildLedger(rows: Row[]) {
  const groups: Record<LedgerGroup, Row[]> = { attention: [], unverified: [], verified: [], readonly: [] }
  for (const row of rows) groups[ledgerGroup(row.risk)].push(row)
  const changed = rows.filter((row) => signals(row.risk).changed).length
  const verified = rows.filter((row) => signals(row.risk).changed && signals(row.risk).validation === "passed").length
  return {
    groups,
    total: rows.length,
    changed,
    verified,
    attention: groups.attention.length,
    coverage: changed > 0 ? verified / changed : undefined,
  }
}

function funnelRow(label: string, value: number, max: number, kind: string) {
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0
  return [
    `<div class="funnel-row ${kind}">`,
    `<span class="funnel-label">${esc(label)}</span>`,
    `<span class="funnel-bar" aria-hidden="true"><i style="width:${width}%"></i></span>`,
    `<strong class="funnel-value">${num(value)}</strong>`,
    `</div>`,
  ].join("")
}

function card(row: Row, usage: Record<string, number>, link: (path: string, label: string) => string) {
  const s = signals(row.risk)
  const reasons = attentionReasons(row.risk)
  const verification =
    s.validation === "passed"
      ? chip({ label: "verified", kind: "low" })
      : s.validation === "failed"
        ? chip({ label: "validation failed", kind: "high" })
        : s.validation === "partial"
          ? chip({ label: "partially verified", kind: "medium" })
          : s.changed
            ? chip({ label: "not verified", kind: "medium" })
            : ""
  return [
    `<div class="session-card">`,
    `<div class="session-head">`,
    `<strong>${esc(row.session.title)}</strong>`,
    link(`/run-report/session/${row.session.id}`, "View →"),
    `</div>`,
    reasons.length ? `<div class="ledger-reason">${esc(reasons.join(" · "))}</div>` : "",
    `<div class="tag-row">`,
    chip({ label: stamp(row.session.time.updated) }),
    chip({ label: row.session.parentID ? "fork" : "root" }),
    chip({
      label: s.changed
        ? `${num(s.files)} ${s.files === 1 ? "file" : "files"} · ${compact(s.lines)} lines`
        : "no changes",
      kind: s.changed ? "neutral" : "neutral",
    }),
    verification,
    chip({ label: `${compact(usage[row.session.id] ?? 0)} tokens` }),
    chip({ label: `${row.risk.level.toLowerCase()} risk`, kind: tone(row.risk.level) }),
    chip({ label: readiness(row.risk.readiness), kind: readinessTone(row.risk.readiness) }),
    `</div>`,
    // Titles repeat ("count line of code"); the id tail tells the sessions apart.
    `<span class="muted" style="font-size:12px">${esc(row.session.id)}</span>`,
    `</div>`,
  ].join("")
}

export function ledgerSection(input: {
  rows: Row[]
  perSession: Record<string, number>
  link: (path: string, label: string) => string
}) {
  const ledger = buildLedger(input.rows)
  if (ledger.total === 0) return ""
  const headline =
    ledger.changed === 0
      ? "No session here changed files, so nothing needs verification."
      : `${ledger.verified} of ${ledger.changed} ${ledger.changed === 1 ? "session" : "sessions"} that changed files ${ledger.verified === 1 ? "was" : "were"} verified.`
  const tone =
    ledger.attention > 0 ? "has-attention" : ledger.coverage === 1 || ledger.changed === 0 ? "complete" : "has-gaps"
  return [
    `<div class="panel ledger" style="margin-bottom:16px">`,
    `<h3>Evidence ledger</h3>`,
    `<div class="ledger-head ${tone}">`,
    `<strong>${esc(headline)}</strong>`,
    ledger.attention > 0
      ? `<span>${ledger.attention} ${ledger.attention === 1 ? "session needs" : "sessions need"} your attention.</span>`
      : `<span>Nothing needs your attention.</span>`,
    `</div>`,
    `<div class="funnel">`,
    funnelRow("Sessions", ledger.total, ledger.total, "neutral"),
    funnelRow("Changed files", ledger.changed, ledger.total, "changed"),
    funnelRow("Verified", ledger.verified, ledger.total, "verified"),
    funnelRow("Needs attention", ledger.attention, ledger.total, "attention"),
    `</div>`,
    `</div>`,
    GROUPS.map((group) => {
      const items = ledger.groups[group.key]
      if (items.length === 0) return ""
      return [
        `<details class="panel ledger-group ${group.key}" style="margin-bottom:16px"${group.open ? " open" : ""}>`,
        `<summary><span class="ledger-title">${esc(group.title)}</span><span class="ledger-count">${items.length}</span><span class="ledger-hint">${esc(group.hint)}</span></summary>`,
        `<div class="session-list">${items.map((row) => card(row, input.perSession, input.link)).join("")}</div>`,
        `</details>`,
      ].join("")
    }).join(""),
  ].join("")
}
