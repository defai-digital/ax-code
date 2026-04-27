import z from "zod"
import { Instance } from "../project/instance"
import { ReplayCompare } from "../replay/compare"
import { EventQuery } from "../replay/query"
import { Replay } from "../replay/replay"
import { Risk } from "../risk/score"
import { Session } from "."
import { SessionID } from "./schema"
import { SessionSemanticDiff } from "./semantic-diff"

export namespace SessionBranchRank {
  export const SessionInfo = z
    .object({
      id: z.string(),
      title: z.string(),
    })
    .meta({
      ref: "SessionBranchSession",
    })
  export type SessionInfo = z.output<typeof SessionInfo>

  export const RiskFactor = z.object({
    kind: z.enum(["files", "lines", "tests", "api", "module", "security", "validation", "tools", "semantic"]),
    label: z.string(),
    points: z.number(),
    detail: z.string(),
  })
  export type RiskFactor = z.output<typeof RiskFactor>

  const ValidationState = z.enum(["not_run", "passed", "failed", "partial"])
  const DiffState = z.enum(["recorded", "derived", "missing"])

  export const RiskSignals = z.object({
    filesChanged: z.number(),
    linesChanged: z.number(),
    testCoverage: z.number(),
    apiEndpointsAffected: z.number(),
    crossModule: z.boolean(),
    securityRelated: z.boolean(),
    validationPassed: z.boolean().optional(),
    validationState: ValidationState,
    validationCount: z.number(),
    validationFailures: z.number(),
    validationCommands: z.string().array(),
    toolFailures: z.number(),
    totalTools: z.number(),
    diffState: DiffState,
    semanticRisk: z.enum(["low", "medium", "high"]).nullable(),
    primaryChange: SessionSemanticDiff.Kind.nullable(),
  })
  export type RiskSignals = z.output<typeof RiskSignals>

  export const RiskAssessment = z
    .object({
      level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
      score: z.number(),
      confidence: z.number(),
      readiness: z.enum(["ready", "needs_validation", "needs_review", "blocked"]),
      signals: RiskSignals,
      summary: z.string(),
      breakdown: RiskFactor.array(),
      evidence: z.string().array(),
      unknowns: z.string().array(),
      mitigations: z.string().array(),
    })
    .meta({
      ref: "SessionBranchRisk",
    })
  export type RiskAssessment = z.output<typeof RiskAssessment>

  export const ScorePart = z.object({
    key: z.enum(["correctness", "safety", "simplicity", "validation"]),
    label: z.string(),
    value: z.number(),
    detail: z.string(),
  })
  export type ScorePart = z.output<typeof ScorePart>

  export const Scorecard = z
    .object({
      total: z.number(),
      breakdown: ScorePart.array(),
    })
    .meta({
      ref: "SessionBranchScorecard",
    })
  export type Scorecard = z.output<typeof Scorecard>

  export const Route = z.object({
    from: z.string(),
    to: z.string(),
    confidence: z.number(),
  })
  export type Route = z.output<typeof Route>

  export const View = z
    .object({
      tools: z.string().array(),
      routes: Route.array(),
      counts: z.record(z.string(), z.number()),
      plan: z.string(),
      notes: z.string().array(),
    })
    .meta({
      ref: "SessionBranchView",
    })
  export type View = z.output<typeof View>

  export const Item = z
    .object({
      id: z.string(),
      title: z.string(),
      risk: RiskAssessment,
      view: View,
      decision: Scorecard,
      headline: z.string(),
      semantic: SessionSemanticDiff.Summary.nullable(),
      current: z.boolean(),
      recommended: z.boolean(),
    })
    .meta({
      ref: "SessionBranchItem",
    })
  export type Item = z.output<typeof Item>

  export const Detail = z
    .object({
      currentID: z.string(),
      recommendedID: z.string(),
      confidence: z.number(),
      reasons: z.string().array(),
      items: Item.array(),
    })
    .meta({
      ref: "SessionBranchDetail",
    })
  export type Detail = z.output<typeof Detail>

  export const Family = Detail.extend({
    root: z.lazy(() => Session.Info),
    current: z.lazy(() => Session.Info),
    recommended: Item,
  }).meta({
    ref: "SessionBranchFamily",
  })
  export type Family = z.output<typeof Family>

  export function detail(input: {
    currentID: string
    sessions: SessionInfo[]
    deep?: boolean
    semantic?: Record<string, SessionSemanticDiff.Summary | null | undefined>
  }) {
    const seen = new Set<string>()
    const list = input.sessions.filter((item) => {
      if (seen.has(item.id)) return false
      seen.add(item.id)
      return true
    })
    if (list.length === 0) return

    const ranked = ReplayCompare.rank(
      list.map((item) => {
        const sid = item.id as Parameters<typeof Risk.fromSession>[0]
        const risk = Risk.fromSession(sid)
        const deep = input.deep ? Replay.compare(sid) : undefined
        return {
          id: item.id,
          title: item.title,
          risk,
          view: ReplayCompare.view(EventQuery.bySession(sid), risk, deep),
          deep,
          semantic: input.semantic?.[item.id] ?? null,
        }
      }),
    )

    return {
      currentID: input.currentID,
      recommendedID: ranked.recommended.id,
      confidence: ranked.confidence,
      reasons: ranked.reasons,
      items: ranked.items.map((item) => ({
        ...item,
        semantic: input.semantic?.[item.id] ?? null,
        current: item.id === input.currentID,
        recommended: item.id === ranked.recommended.id,
      })),
    } satisfies Detail
  }

  export async function family(sessionID: SessionID, input?: { deep?: boolean }) {
    const current = await Session.get(sessionID)
    return Instance.provide({
      directory: current.directory,
      async fn() {
        const rootID = current.parentID ?? sessionID
        const root = rootID === sessionID ? current : await Session.get(rootID)
        const kids = await Session.children(rootID)
        const list = [root, ...kids].map((item) => ({ id: item.id, title: item.title }))
        const semantic = Object.fromEntries(
          await Promise.all(
            list.map(async (item) => [item.id, (await SessionSemanticDiff.load(SessionID.make(item.id))) ?? null]),
          ),
        )
        const ranked = detail({
          currentID: sessionID,
          sessions: list,
          deep: input?.deep,
          semantic,
        })
        if (!ranked) throw new Error("no branch family recorded")
        const recommended = ranked.items.find((item) => item.recommended)
        if (!recommended) throw new Error("no recommended branch")

        return {
          ...ranked,
          root,
          current,
          recommended,
        } satisfies Family
      },
    })
  }
}
