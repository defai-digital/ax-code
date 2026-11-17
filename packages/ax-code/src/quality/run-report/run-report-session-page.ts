import type { Session } from "../../session"
import type { SessionBranchRank } from "../../session/branch"
import type { SessionDre } from "../../session/dre"
import type { SessionGraph } from "../../session/graph"
import type { SessionRisk } from "../../session/risk"
import type { SessionRollback } from "../../session/rollback"
import type { SessionUsage } from "../../session/usage"
import { activitySection } from "./run-report-activity-section"
import { executionSummaryScript, live, themeScript, themeToggle } from "./run-report-assets"
import { branchSection } from "./run-report-branch-section"
import { changesSection } from "./run-report-changes-section"
import { style } from "./run-report-style"
import { summary } from "./run-report-summary-section"
import { buildEvidenceChain, evidenceSection } from "./run-report-evidence"
import { traceSection } from "./run-report-waterfall"
import { usageSection } from "./run-report-usage-section"
import { riskSection } from "./run-report-risk-section"
import { validationSection } from "./run-report-validation-section"
import { verdictSection } from "./run-report-verdict-section"
import { esc, stamp } from "./run-report-format"
import { chip } from "./run-report-widgets"
import { createReportLink } from "./run-report-links"

/**
 * The risk/trust sections only earn their place when the assessment has
 * substance. A chat-only or trivially-small session scores under 15 with
 * "not_run" validation and no unknowns — rendering a 0/100 gauge and empty
 * scorecards there is exactly the "not meaningful" noise users reported.
 */
const MIN_RISK_SCORE_FOR_DETAILS = 15

function hasRiskSubstance(assessment: SessionRisk.Detail["assessment"]): boolean {
  return (
    assessment.score >= MIN_RISK_SCORE_FOR_DETAILS ||
    assessment.signals.validationState !== "not_run" ||
    assessment.readiness === "blocked" ||
    assessment.unknowns.length > 0
  )
}

export type SessionReportData = {
  session: Session.Info
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank?: SessionBranchRank.Family
  rollback: SessionRollback.Point[]
  usage: SessionUsage.Info
}

export function sessionPage(input: SessionReportData & { search: string }): string {
  const title = esc(input.session.title)
  const base = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search)
  const link = createReportLink(base)

  // Section visibility predicates — the nav is built from the same predicates
  // so it never links to an anchor that is not rendered.
  const showTrust = hasRiskSubstance(input.risk.assessment)
  const showVerdict = showTrust && Boolean(input.dre.detail)
  const showValidation = input.risk.assessment.signals.validationCommands.length > 0
  const showBranches = (input.rank?.items.length ?? 0) > 1

  const showChanges = Boolean(input.dre.detail?.semantic)
  const anchors = new Set([
    "evidence",
    "timeline",
    "summary",
    "activity",
    "usage",
    ...(showChanges ? ["changes"] : []),
    ...(showVerdict ? ["verdict"] : []),
    ...(showTrust ? ["risk"] : []),
    ...(showValidation ? ["validation"] : []),
    ...(showBranches ? ["branches"] : []),
  ])
  const chain = buildEvidenceChain({
    session: input.session,
    graph: input.graph,
    dre: input.dre,
    risk: input.risk,
    rollback: input.rollback,
    anchors,
  })

  const nav: string[] = [
    `<a class="nav-link" href="#evidence">Evidence</a>`,
    `<a class="nav-link" href="#timeline">Trace</a>`,
    `<a class="nav-link" href="#summary">Summary</a>`,
    ...(showChanges ? [`<a class="nav-link" href="#changes">Changes</a>`] : []),
    `<a class="nav-link" href="#activity">Activity</a>`,
    ...(showVerdict ? [`<a class="nav-link" href="#verdict">Verdict</a>`] : []),
    ...(showTrust ? [`<a class="nav-link" href="#risk">Risk</a>`] : []),
    ...(showValidation ? [`<a class="nav-link" href="#validation">Validation</a>`] : []),
    ...(showBranches ? [`<a class="nav-link" href="#branches">Branches</a>`] : []),
  ]

  const ganttSrc = `/graph/${input.session.id}?format=svggantt&directory=${encodeURIComponent(input.session.directory)}`

  return [
    "<!doctype html>",
    `<html lang="en">`,
    `<head>`,
    `<meta charset="utf-8" />`,
    `<meta name="viewport" content="width=device-width, initial-scale=1" />`,
    `<title>AX Code · Session Report · ${title}</title>`,
    themeScript(),
    `<style>${style()}</style>`,
    `</head>`,
    `<body>`,
    // ── Nav ──
    `<nav class="nav"><div class="nav-inner">`,
    `<span class="nav-brand" title="AX Code session report">AX Code</span>`,
    `<div class="nav-sep"></div>`,
    ...nav,
    `<div class="nav-sep"></div>`,
    `<span class="nav-back">${link(`/run-report`, "← Dashboard")}</span>`,
    `<span class="live" id="live-status">connecting</span>`,
    themeToggle(),
    `</div></nav>`,
    // ── Hero: session identity ──
    `<header class="hero">`,
    `<div class="wrap">`,
    `<div class="hero-title">${title}</div>`,
    `<div class="meta" style="margin-top:6px">`,
    chip({ label: input.session.directory }),
    chip({ label: stamp(input.session.time.updated) }),
    `</div>`,
    `<div class="gviz-summary-bar">`,
    `<span class="gviz-summary-icon">⬡</span>`,
    `<span class="gviz-summary-status" id="gviz-summary-status">Loading session…</span>`,
    `<span class="gviz-summary-sep">·</span>`,
    `<span class="gviz-summary-detail" id="gviz-summary-detail"></span>`,
    `</div>`,
    `</div>`,
    `</header>`,
    // ── 1. Evidence chain: asked → did → changed → verified → decided → reversible ──
    evidenceSection({
      sessionID: input.session.id,
      directory: input.session.directory,
      chain,
      readiness: input.risk.assessment.readiness,
    }),
    // ── 2. Trace: every model and tool call on a time axis, failures marked ──
    traceSection({ graph: input.graph.graph, ganttHref: ganttSrc }),
    // ── 3. Summary: decision and plan ──
    summary({ dre: input.dre, graph: input.graph, stats: false }),
    // ── 4. Changes: only when a semantic diff exists; otherwise the chain already says why not ──
    showChanges ? changesSection({ dre: input.dre }) : "",
    // ── 5. Activity: "what did the agent actually work on?" ──
    activitySection(input.graph, input.dre, input.rollback),
    // ── 6. Resources: tokens and models, useful context but not the headline ──
    usageSection({ usage: input.usage, duration: input.dre.detail?.duration }),
    // ── 5. Trust sections: only when there is something to say ──
    showVerdict ? verdictSection({ dre: input.dre, risk: input.risk }) : "",
    showTrust ? riskSection(input.risk, input.dre) : "",
    showValidation ? validationSection({ risk: input.risk }) : "",
    showBranches ? branchSection(input.rank) : "",
    // ── Footer ──
    `<footer class="footer">AX Code Session Report · Debugging & Refactoring Engine</footer>`,
    live({ sessionID: input.session.id, directory: input.session.directory }),
    executionSummaryScript(input.session.id, input.session.directory),
    `</body>`,
    `</html>`,
  ].join("")
}
