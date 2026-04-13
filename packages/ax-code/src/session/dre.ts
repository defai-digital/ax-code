import z from "zod"
import { ExecutionGraph } from "../graph"
import { GraphFormat } from "../graph/format"
import { ReplayCompare } from "../replay/compare"
import { EventQuery } from "../replay/query"
import { Risk } from "../risk/score"
import { SessionBranchRank } from "./branch"
import { SessionSemanticDiff } from "./semantic-diff"
import type { SessionID } from "./schema"

export namespace SessionDre {
  export const Summary = z
    .object({
      level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      score: z.number(),
      confidence: z.number(),
      readiness: z.enum(["ready", "needs_validation", "needs_review", "blocked"]),
      summary: z.string(),
      stats: z.string(),
      decision: z.string(),
      plan: z.string(),
      notes: z.string().array(),
      drivers: z.string().array(),
    })
    .meta({
      ref: "SessionDreSummary",
    })
  export type Summary = z.output<typeof Summary>

  export const Count = z.object({
    type: z.string(),
    count: z.number(),
  })
  export type Count = z.output<typeof Count>

  export const Detail = Summary.extend({
    scorecard: SessionBranchRank.Scorecard,
    breakdown: SessionBranchRank.RiskFactor.array(),
    evidence: z.string().array(),
    unknowns: z.string().array(),
    mitigations: z.string().array(),
    duration: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
    }),
    routes: SessionBranchRank.Route.array(),
    tools: z.string().array(),
    counts: Count.array(),
    semantic: SessionSemanticDiff.Summary.nullable(),
  }).meta({
    ref: "SessionDreDetail",
  })
  export type Detail = z.output<typeof Detail>

  export const TimelineLine = z
    .object({
      kind: z.enum(["heading", "meta", "step", "route", "tool", "llm", "error"]),
      text: z.string(),
    })
    .meta({
      ref: "SessionDreTimelineLine",
    })
  export type TimelineLine = z.output<typeof TimelineLine>

  export const Snapshot = z
    .object({
      detail: Detail.nullable(),
      timeline: TimelineLine.array(),
    })
    .meta({
      ref: "SessionDreSnapshot",
    })
  export type Snapshot = z.output<typeof Snapshot>

  export function summarize(input: {
    graph: ExecutionGraph.Graph
    risk: Risk.Assessment
    view: ReplayCompare.View
    semantic?: SessionSemanticDiff.Summary | null
  }): Summary | undefined {
    if (input.graph.nodes.length === 0) return
    const scorecard = ReplayCompare.score({ risk: input.risk, view: input.view, semantic: input.semantic })
    const stats = [
      `${input.graph.metadata.steps} step${input.graph.metadata.steps === 1 ? "" : "s"}`,
      `${input.view.routes.length} route${input.view.routes.length === 1 ? "" : "s"}`,
      `${input.view.tools.length} tool call${input.view.tools.length === 1 ? "" : "s"}`,
      ...(input.graph.metadata.errors > 0
        ? [`${input.graph.metadata.errors} error${input.graph.metadata.errors === 1 ? "" : "s"}`]
        : []),
    ].join(" · ")

    return {
      level: input.risk.level,
      score: input.risk.score,
      confidence: input.risk.confidence,
      readiness: input.risk.readiness,
      summary: input.risk.summary,
      stats,
      decision: ReplayCompare.headline(scorecard),
      plan: input.view.plan,
      notes: input.view.notes,
      drivers: Risk.top(input.risk, 2).map((item) => `${item.label} · ${item.detail}`),
    }
  }

  export function detail(input: {
    graph: ExecutionGraph.Graph
    risk: Risk.Assessment
    view: ReplayCompare.View
    semantic?: SessionSemanticDiff.Summary | null
  }): Detail | undefined {
    const summary = summarize(input)
    if (!summary) return
    const scorecard = ReplayCompare.score({ risk: input.risk, view: input.view, semantic: input.semantic })

    return {
      ...summary,
      scorecard,
      breakdown: input.risk.breakdown,
      evidence: input.risk.evidence,
      unknowns: input.risk.unknowns,
      mitigations: input.risk.mitigations,
      duration: input.graph.metadata.duration,
      tokens: input.graph.metadata.tokens,
      routes: input.view.routes,
      tools: input.view.tools,
      counts: Object.entries(input.view.counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
        .slice(0, 8),
      semantic: input.semantic ?? null,
    }
  }

  export function timeline(graph: ExecutionGraph.Graph): TimelineLine[] {
    return GraphFormat.timeline(graph).map((line) => ({
      ...line,
      text: line.text.replaceAll(" | ", " · ").replaceAll(" -> ", " \u2192 "),
    }))
  }

  export function load(sessionID: SessionID) {
    if (EventQuery.count(sessionID) === 0) return
    const risk = Risk.fromSession(sessionID)
    const evts = EventQuery.bySession(sessionID)
    const graph = ExecutionGraph.build(sessionID)
    const view = ReplayCompare.view(evts, risk)
    return summarize({ graph, risk, view })
  }

  export function loadDetail(sessionID: SessionID) {
    if (EventQuery.count(sessionID) === 0) return
    const risk = Risk.fromSession(sessionID)
    const evts = EventQuery.bySession(sessionID)
    const graph = ExecutionGraph.build(sessionID)
    const view = ReplayCompare.view(evts, risk)
    return detail({ graph, risk, view })
  }

  export async function loadDetailFull(sessionID: SessionID) {
    if (EventQuery.count(sessionID) === 0) return
    const risk = Risk.fromSession(sessionID)
    const evts = EventQuery.bySession(sessionID)
    const graph = ExecutionGraph.build(sessionID)
    const view = ReplayCompare.view(evts, risk)
    const semantic = (await SessionSemanticDiff.load(sessionID)) ?? null
    return detail({ graph, risk, view, semantic })
  }

  export function loadTimeline(sessionID: SessionID) {
    if (EventQuery.count(sessionID) === 0)
      return [{ kind: "meta", text: "No execution graph recorded." }] satisfies TimelineLine[]
    return timeline(ExecutionGraph.build(sessionID))
  }

  export async function snapshot(sessionID: SessionID): Promise<Snapshot> {
    return {
      detail: (await loadDetailFull(sessionID)) ?? null,
      timeline: loadTimeline(sessionID),
    }
  }
}
