import type { SessionGraph } from "../../session/graph"
import type { SessionDre } from "../../session/dre"
import type { SessionRisk } from "../../session/risk"
import type { SessionRollback } from "../../session/rollback"
import { agentDisplay, esc, readiness, readinessTone, stamp, time } from "./run-report-format"
import { chip } from "./run-report-widgets"

/**
 * The evidence chain is the dashboard's reason to exist: AX Code records a session as a
 * structured event log with snapshots, so every claim about a run should say whether it
 * is recorded, derived (computed from recorded signals), missing, or not applicable.
 * Gaps are shown loudly; hiding "validation not recorded" in a footnote defeats the point.
 */
export type EvidenceState = "recorded" | "derived" | "gap" | "attention" | "na"

export type EvidenceStage = {
  key: "asked" | "did" | "changed" | "verified" | "decided" | "reversible"
  title: string
  question: string
  state: EvidenceState
  headline: string
  facts: string[]
  href: string
}

export type EvidenceChain = {
  stages: EvidenceStage[]
  gaps: EvidenceStage[]
  counts: Record<EvidenceState, number>
  headline: string
}

const STATE_LABEL: Record<EvidenceState, string> = {
  recorded: "recorded",
  derived: "derived",
  gap: "gap",
  attention: "needs attention",
  na: "n/a",
}

export function buildEvidenceChain(input: {
  session: { title: string; directory: string; time: { created?: number; updated: number } }
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rollback: SessionRollback.Point[]
  /** Section ids that are actually rendered; a stage never links to an anchor that is missing. */
  anchors?: ReadonlySet<string>
}): EvidenceChain {
  const link = (preferred: string, fallback: string) =>
    !input.anchors || input.anchors.has(preferred) ? `#${preferred}` : `#${fallback}`
  const meta = input.graph.graph.metadata
  const signals = input.risk.assessment.signals
  const assessment = input.risk.assessment
  const changed = signals.filesChanged > 0 || signals.linesChanged > 0
  const stages: EvidenceStage[] = []

  stages.push({
    key: "asked",
    title: "Asked",
    question: "What was this run for?",
    state: "recorded",
    headline: input.session.title,
    facts: [
      `Project ${input.session.directory}`,
      input.session.time.created
        ? `Started ${stamp(input.session.time.created)}`
        : `Updated ${stamp(input.session.time.updated)}`,
      meta.agents.length ? `Agents: ${meta.agents.map(agentDisplay).join(", ")}` : "No agent recorded",
    ],
    href: link("activity", "evidence"),
  })

  const calls = signals.totalTools
  const failures = Math.max(meta.errors, signals.toolFailures)
  stages.push({
    key: "did",
    title: "Did",
    question: "What did the agent actually do?",
    state: meta.steps === 0 ? "gap" : failures > 0 ? "attention" : "recorded",
    headline:
      meta.steps === 0
        ? "No execution recorded"
        : `${meta.steps} ${meta.steps === 1 ? "step" : "steps"} · ${calls} tool ${calls === 1 ? "call" : "calls"} · ${failures} ${failures === 1 ? "error" : "errors"}`,
    facts: [
      `Duration ${time(input.dre.detail?.duration ?? meta.duration)}`,
      `${meta.tokens.input.toLocaleString()} tokens in · ${meta.tokens.output.toLocaleString()} out`,
      ...(meta.tools.length ? [`Tools: ${meta.tools.slice(0, 4).join(", ")}${meta.tools.length > 4 ? "…" : ""}`] : []),
    ],
    href: link("timeline", "evidence"),
  })

  stages.push({
    key: "changed",
    title: "Changed",
    question: "What files changed, and is the diff on record?",
    state: !changed
      ? "na"
      : signals.diffState === "recorded"
        ? "recorded"
        : signals.diffState === "derived"
          ? "derived"
          : "gap",
    headline: !changed
      ? "No file changes detected"
      : `${signals.filesChanged} ${signals.filesChanged === 1 ? "file" : "files"} · ${signals.linesChanged.toLocaleString()} lines`,
    facts: [
      ...(input.dre.detail?.semantic ? [input.dre.detail.semantic.headline] : []),
      ...(changed && signals.diffState === "derived"
        ? ["Line churn is estimated from tool events, not a persisted diff"]
        : []),
      ...(changed && signals.diffState === "missing" ? ["No diff snapshot was recorded for the changed files"] : []),
      ...(!changed ? ["Nothing to compare: no diff recorded"] : []),
    ],
    href: input.dre.detail?.semantic ? link("changes", "timeline") : link("timeline", "evidence"),
  })

  const validationFacts = signals.validationCommands.slice(0, 3)
  stages.push({
    key: "verified",
    title: "Verified",
    question: "Was the result checked?",
    state:
      signals.validationState === "passed"
        ? "recorded"
        : signals.validationState === "failed" || signals.validationState === "partial"
          ? "attention"
          : changed
            ? "gap"
            : "na",
    headline:
      signals.validationState === "passed"
        ? `Validation passed (${signals.validationCount})`
        : signals.validationState === "failed"
          ? `Validation failed (${signals.validationFailures} of ${signals.validationCount})`
          : signals.validationState === "partial"
            ? "Validation partial"
            : changed
              ? "Changes were not verified"
              : "Nothing to verify",
    facts:
      validationFacts.length > 0
        ? validationFacts
        : [
            changed
              ? "No validation command was recorded after the change"
              : "No changes, so no validation was required",
          ],
    href: link("validation", "activity"),
  })

  stages.push({
    key: "decided",
    title: "Decided",
    question: "Is it safe to accept?",
    state: assessment.readiness === "blocked" || assessment.readiness === "needs_review" ? "attention" : "derived",
    headline: `${readiness(assessment.readiness)} · ${assessment.level} risk (${assessment.score}/100)`,
    facts: [
      `Confidence ${Math.round(assessment.confidence * 100)}%`,
      "Computed by AX Code from the recorded signals above",
      ...input.risk.drivers.slice(0, 2),
    ],
    href: link("verdict", "summary"),
  })

  const latest = input.rollback.at(-1)
  stages.push({
    key: "reversible",
    title: "Reversible",
    question: "Can it be undone?",
    state: input.rollback.length > 0 ? "recorded" : changed ? "gap" : "na",
    headline:
      input.rollback.length > 0
        ? `${input.rollback.length} rollback ${input.rollback.length === 1 ? "point" : "points"}`
        : changed
          ? "No rollback point recorded"
          : "Nothing to roll back",
    facts: latest ? [`Latest at step ${latest.step}`, "Restore with the session rollback command"] : [],
    href: link("activity", "evidence"),
  })

  const counts: Record<EvidenceState, number> = { recorded: 0, derived: 0, gap: 0, attention: 0, na: 0 }
  for (const stage of stages) counts[stage.state]++
  const gaps = stages.filter((stage) => stage.state === "gap")
  const headline =
    gaps.length > 0
      ? `${gaps.length} evidence ${gaps.length === 1 ? "gap" : "gaps"}: ${gaps.map((stage) => stage.title.toLowerCase()).join(", ")}`
      : counts.attention > 0
        ? "Chain complete, but a step needs attention"
        : "Evidence chain complete"
  return { stages, gaps, counts, headline }
}

export function evidenceSection(input: {
  sessionID: string
  directory: string
  chain: EvidenceChain
  readiness: string
}) {
  const { chain } = input
  const query = `directory=${encodeURIComponent(input.directory)}`
  const raw = `/graph/${encodeURIComponent(input.sessionID)}?${query}`
  return [
    `<section class="band evidence" id="evidence">`,
    `<div class="wrap">`,
    `<div class="evidence-head">`,
    `<div>`,
    `<h2>Evidence chain</h2>`,
    `<p class="evidence-sub">Every link from request to rollback, and whether it is on record.</p>`,
    `</div>`,
    `<div class="evidence-summary ${chain.gaps.length > 0 ? "has-gaps" : chain.counts.attention > 0 ? "has-attention" : "complete"}">`,
    `<strong>${esc(chain.headline)}</strong>`,
    `<span>${chain.counts.recorded} recorded · ${chain.counts.derived} derived · ${chain.gaps.length} ${chain.gaps.length === 1 ? "gap" : "gaps"}${chain.counts.attention ? ` · ${chain.counts.attention} to review` : ""}</span>`,
    `</div>`,
    `</div>`,
    `<ol class="chain">`,
    chain.stages
      .map((stage, index) =>
        [
          `<li class="stage ${esc(stage.state)}">`,
          `<a class="stage-link" href="${esc(stage.href)}" aria-label="${esc(`${stage.title}: ${stage.headline}. ${STATE_LABEL[stage.state]}`)}">`,
          `<span class="stage-top"><span class="stage-no">${index + 1}</span><span class="stage-title">${esc(stage.title)}</span>`,
          `<span class="stage-state">${esc(STATE_LABEL[stage.state])}</span></span>`,
          `<span class="stage-q">${esc(stage.question)}</span>`,
          `<strong class="stage-headline">${esc(stage.headline)}</strong>`,
          stage.facts.length
            ? `<ul class="stage-facts">${stage.facts.map((fact) => `<li>${esc(fact)}</li>`).join("")}</ul>`
            : "",
          `</a>`,
          `</li>`,
        ].join(""),
      )
      .join(""),
    `</ol>`,
    `<div class="provenance">`,
    `<span class="prov-title">Trace this run</span>`,
    chip({ label: `session ${input.sessionID}` }),
    `<a class="prov-link" href="${esc(raw)}">Raw trace (JSON)</a>`,
    `<a class="prov-link" href="${esc(`${raw}&format=markdown`)}">Markdown report</a>`,
    `<code class="prov-cmd">ax-code replay ${esc(input.sessionID)}</code>`,
    chip({ label: readiness(input.readiness), kind: readinessTone(input.readiness) }),
    `<span class="prov-note">Local session evidence, recorded while the agent ran.</span>`,
    `</div>`,
    `</div>`,
    `</section>`,
  ].join("")
}
