import z from "zod"
import { ReplayCompare } from "../replay/compare"
import { EventQuery } from "../replay/query"
import { Replay } from "../replay/replay"
import { Risk } from "../risk/score"
import { Session } from "."
import { SessionBranchRank } from "./branch"
import { SessionSemanticDiff } from "./semantic-diff"
import type { SessionID } from "./schema"

export namespace SessionCompare {
  export const Summary = z
    .object({
      id: z.string(),
      title: z.string(),
      risk: SessionBranchRank.RiskAssessment,
      decision: SessionBranchRank.Scorecard,
      events: z.number(),
      plan: z.string(),
      headline: z.string(),
      semantic: SessionSemanticDiff.Summary.nullable(),
    })
    .meta({
      ref: "SessionCompareSummary",
    })
  export type Summary = z.output<typeof Summary>

  export const Analysis = SessionBranchRank.View.extend({
    decision: SessionBranchRank.Scorecard,
    headline: z.string(),
  }).meta({
    ref: "SessionCompareAnalysis",
  })
  export type Analysis = z.output<typeof Analysis>

  export const Differences = z
    .object({
      toolChainDiffers: z.boolean(),
      routeDiffers: z.boolean(),
      eventCountDelta: z.number(),
    })
    .meta({
      ref: "SessionCompareDifferences",
    })
  export type Differences = z.output<typeof Differences>

  export const Advisory = z
    .object({
      winner: z.enum(["A", "B", "tie"]),
      confidence: z.number(),
      reasons: z.string().array(),
    })
    .meta({
      ref: "SessionCompareAdvisory",
    })
  export type Advisory = z.output<typeof Advisory>

  export const DecisionSession = z
    .object({
      title: z.string(),
      plan: z.string(),
      headline: z.string(),
      change: z.string().nullable(),
      validation: z.string(),
    })
    .meta({
      ref: "SessionCompareDecisionSession",
    })
  export type DecisionSession = z.output<typeof DecisionSession>

  export const Decision = z
    .object({
      winner: z.enum(["A", "B", "tie"]),
      confidence: z.number(),
      recommendation: z.string(),
      reasons: z.string().array(),
      differences: z.string().array(),
      session1: DecisionSession,
      session2: DecisionSession,
    })
    .meta({
      ref: "SessionCompareDecision",
    })
  export type Decision = z.output<typeof Decision>

  export const ReplayInfo = z
    .object({
      stepsCompared: z.number(),
      divergences: z.number(),
      reasons: z.string().array(),
    })
    .meta({
      ref: "SessionCompareReplay",
    })
  export type ReplayInfo = z.output<typeof ReplayInfo>

  export const Result = z
    .object({
      session1: Summary,
      session2: Summary,
      differences: Differences,
      advisory: Advisory,
      decision: Decision,
      analysis: z.object({
        session1: Analysis,
        session2: Analysis,
      }),
      replay: z
        .object({
          session1: ReplayInfo,
          session2: ReplayInfo,
        })
        .optional(),
    })
    .meta({
      ref: "SessionCompareResult",
    })
  export type Result = z.output<typeof Result>

  function validation(input: Summary["risk"]) {
    const state = input.signals.validationState
    if (state === "passed") return "validation passed"
    if (state === "failed") return "validation failed"
    if (state === "partial") return "partial validation"
    return "validation not recorded"
  }

  export function decision(input: {
    session1: Summary
    session2: Summary
    analysis: {
      session1: Analysis
      session2: Analysis
    }
    advisory: Advisory
    differences: Differences
    replay?: {
      session1: ReplayInfo
      session2: ReplayInfo
    }
  }) {
    const out = [] as string[]

    if (input.analysis.session1.plan !== input.analysis.session2.plan) {
      out.push(`strategy: ${input.analysis.session1.plan} vs ${input.analysis.session2.plan}`)
    }

    if ((input.session1.semantic?.headline ?? null) !== (input.session2.semantic?.headline ?? null)) {
      out.push(`change: ${input.session1.semantic?.headline ?? "none"} vs ${input.session2.semantic?.headline ?? "none"}`)
    }

    if (input.session1.decision.total !== input.session2.decision.total) {
      out.push(`decision score: ${input.session1.decision.total.toFixed(2)} vs ${input.session2.decision.total.toFixed(2)}`)
    }

    if (input.session1.risk.score !== input.session2.risk.score) {
      out.push(`risk: ${input.session1.risk.score}/100 vs ${input.session2.risk.score}/100`)
    }

    if (input.differences.routeDiffers) out.push("routing diverged")
    if (input.differences.toolChainDiffers) out.push("tool chain diverged")
    if (input.differences.eventCountDelta !== 0) {
      out.push(`${input.differences.eventCountDelta > 0 ? "+" : ""}${input.differences.eventCountDelta} event delta`)
    }

    if (input.replay && input.replay.session1.divergences !== input.replay.session2.divergences) {
      out.push(`replay divergences: ${input.replay.session1.divergences} vs ${input.replay.session2.divergences}`)
    }

    const recommendation =
      input.advisory.winner === "tie"
        ? `${input.session1.title} and ${input.session2.title} are materially similar`
        : `Prefer ${input.advisory.winner === "A" ? input.session1.title : input.session2.title}`

    return {
      winner: input.advisory.winner,
      confidence: input.advisory.confidence,
      recommendation,
      reasons: input.advisory.reasons,
      differences: out.length > 0 ? out : ["signals are materially similar"],
      session1: {
        title: input.session1.title,
        plan: input.analysis.session1.plan,
        headline: input.analysis.session1.headline,
        change: input.session1.semantic?.headline ?? null,
        validation: validation(input.session1.risk),
      },
      session2: {
        title: input.session2.title,
        plan: input.analysis.session2.plan,
        headline: input.analysis.session2.headline,
        change: input.session2.semantic?.headline ?? null,
        validation: validation(input.session2.risk),
      },
    } satisfies Decision
  }

  function replay(input?: { divergences: Replay.DivergenceInfo[]; stepsCompared: number }) {
    if (!input) return
    return {
      stepsCompared: input.stepsCompared,
      divergences: input.divergences.length,
      reasons: input.divergences.map((item) => item.reason).slice(0, 5),
    } satisfies ReplayInfo
  }

  function inspect(input: {
    sessionID: SessionID
    title: string
    deep?: boolean
    semantic?: SessionSemanticDiff.Summary | null
  }) {
    const events = EventQuery.bySession(input.sessionID)
    const risk = Risk.fromSession(input.sessionID)
    const deep = input.deep ? Replay.compare(input.sessionID) : undefined
    const view = ReplayCompare.view(events, risk, deep)
    const dec = ReplayCompare.score({ risk, view, deep, semantic: input.semantic })
    const head = ReplayCompare.headline(dec)

    return {
      events,
      risk,
      view,
      deep,
      summary: {
        id: input.sessionID,
        title: input.title,
        risk,
        decision: dec,
        events: events.length,
        plan: view.plan,
        headline: head,
        semantic: input.semantic ?? null,
      } satisfies Summary,
      analysis: {
        ...view,
        decision: dec,
        headline: head,
      } satisfies Analysis,
    }
  }

  export function detail(input: {
    session1: { id: SessionID; title: string }
    session2: { id: SessionID; title: string }
    deep?: boolean
    semantic1?: SessionSemanticDiff.Summary | null
    semantic2?: SessionSemanticDiff.Summary | null
  }): Result {
    const left = inspect({
      sessionID: input.session1.id,
      title: input.session1.title,
      deep: input.deep,
      semantic: input.semantic1,
    })
    const right = inspect({
      sessionID: input.session2.id,
      title: input.session2.title,
      deep: input.deep,
      semantic: input.semantic2,
    })
    const replayInfo = input.deep
      ? {
          session1: replay(left.deep)!,
          session2: replay(right.deep)!,
        }
      : undefined
    const differences = ReplayCompare.delta(left.events, right.events)
    const advisory = ReplayCompare.advise({
      riskA: left.risk,
      riskB: right.risk,
      viewA: left.view,
      viewB: right.view,
      deepA: left.deep,
      deepB: right.deep,
      semanticA: input.semantic1,
      semanticB: input.semantic2,
    })

    const result = {
      session1: left.summary,
      session2: right.summary,
      differences,
      advisory,
      decision: decision({
        session1: left.summary,
        session2: right.summary,
        analysis: {
          session1: left.analysis,
          session2: right.analysis,
        },
        advisory,
        differences,
        replay: replayInfo,
      }),
      analysis: {
        session1: left.analysis,
        session2: right.analysis,
      },
    } satisfies Result

    if (!replayInfo) return result

    return {
      ...result,
      replay: replayInfo,
    } satisfies Result
  }

  export async function compare(input: { sessionID: SessionID; otherSessionID: SessionID; deep?: boolean }) {
    const [session1, session2, semantic1, semantic2] = await Promise.all([
      Session.get(input.sessionID),
      Session.get(input.otherSessionID),
      SessionSemanticDiff.load(input.sessionID),
      SessionSemanticDiff.load(input.otherSessionID),
    ])
    return detail({
      session1: { id: input.sessionID, title: session1.title },
      session2: { id: input.otherSessionID, title: session2.title },
      deep: input.deep,
      semantic1,
      semantic2,
    })
  }
}
