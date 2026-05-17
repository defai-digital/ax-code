import type { Session } from "../session"
import type { SessionBranchRank } from "../session/branch"
import type { SessionDre } from "../session/dre"
import type { SessionGraph } from "../session/graph"
import type { SessionRisk } from "../session/risk"
import type { SessionRollback } from "../session/rollback"

export function indexFingerprint(list: Array<Pick<Session.Info, "id" | "parentID" | "time" | "title">>) {
  return list.map((item) => ({
    id: item.id,
    updated: item.time.updated,
    title: item.title,
    parentID: item.parentID ?? null,
  }))
}

export function sessionFingerprint(input: {
  session: Pick<Session.Info, "id" | "time" | "title">
  graph: SessionGraph.Snapshot
  dre: SessionDre.Snapshot
  risk: SessionRisk.Detail
  rank?: SessionBranchRank.Family
  rollback: SessionRollback.Point[]
}) {
  return {
    session: {
      id: input.session.id,
      updated: input.session.time.updated,
      title: input.session.title,
    },
    graph: {
      nodes: input.graph.graph.nodes.length,
      edges: input.graph.graph.edges.length,
      steps: input.graph.graph.metadata.steps,
      errors: input.graph.graph.metadata.errors,
      duration: input.graph.graph.metadata.duration,
      tokens: input.graph.graph.metadata.tokens,
    },
    dre: {
      score: input.dre.detail?.score ?? null,
      confidence: input.dre.detail?.confidence ?? null,
      readiness: input.dre.detail?.readiness ?? null,
      stats: input.dre.detail?.stats ?? null,
      decision: input.dre.detail?.decision ?? null,
      routes: input.dre.detail?.routes.length ?? 0,
      tools: input.dre.detail?.tools.length ?? 0,
      notes: input.dre.detail?.notes.length ?? 0,
      semantic: input.dre.detail?.semantic?.headline ?? null,
      timeline: input.dre.timeline.length,
    },
    risk: {
      score: input.risk.assessment.score,
      level: input.risk.assessment.level,
      confidence: input.risk.assessment.confidence,
      readiness: input.risk.assessment.readiness,
      validation: input.risk.assessment.signals.validationState,
      files: input.risk.assessment.signals.filesChanged,
      lines: input.risk.assessment.signals.linesChanged,
      evidence: input.risk.assessment.evidence.length,
      unknowns: input.risk.assessment.unknowns.length,
      mitigations: input.risk.assessment.mitigations.length,
      quality: qualityFingerprint(input.risk.quality),
    },
    rank: input.rank
      ? {
          confidence: input.rank.confidence,
          recommended: input.rank.recommended.id,
          items: input.rank.items.map((item) => ({
            id: item.id,
            score: item.decision.total,
            risk: item.risk.score,
          })),
        }
      : null,
    rollback: input.rollback.length,
  }
}

function qualityFingerprint(input: SessionRisk.Detail["quality"]) {
  if (!input) return null
  return {
    review: qualityWorkflowFingerprint(input.review),
    debug: qualityWorkflowFingerprint(input.debug),
    qa: qualityWorkflowFingerprint(input.qa),
  }
}

function qualityWorkflowFingerprint(input: NonNullable<SessionRisk.Detail["quality"]>["review"] | undefined) {
  if (!input) return null
  return {
    status: input.overallStatus,
    ready: input.readyForBenchmark,
    resolvedLabels: input.resolvedLabeledItems,
  }
}
