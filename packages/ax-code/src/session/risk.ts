import { QualityLabelStore } from "../quality/label-store"
import { ProbabilisticRollout } from "../quality/probabilistic-rollout"
import z from "zod"
import { Risk } from "../risk/score"
import { QualityShadow } from "../quality/shadow-runtime"
import { Log } from "../util/log"
import { Session } from "."
import { SessionBranchRank } from "./branch"
import { SessionSemanticDiff } from "./semantic-diff"
import type { SessionID } from "./schema"

export namespace SessionRisk {
  const log = Log.create({ service: "session-risk" })

  export const QualityReadiness = z.object({
    review: z.lazy(() => ProbabilisticRollout.ReplayReadinessSummary).nullable(),
    debug: z.lazy(() => ProbabilisticRollout.ReplayReadinessSummary).nullable(),
    qa: z.lazy(() => ProbabilisticRollout.ReplayReadinessSummary).nullable(),
  })
  export type QualityReadiness = z.output<typeof QualityReadiness>

  export const Detail = z
    .object({
      id: z.string(),
      title: z.string(),
      assessment: SessionBranchRank.RiskAssessment,
      drivers: z.string().array(),
      semantic: SessionSemanticDiff.Summary.nullable(),
      quality: QualityReadiness.optional(),
    })
    .meta({
      ref: "SessionRiskDetail",
    })
  export type Detail = z.output<typeof Detail>

  export function detail(input: {
    id: SessionID
    title: string
    assessment: Risk.Assessment
    semantic?: SessionSemanticDiff.Summary | null
    quality?: QualityReadiness
  }) {
    return {
      id: input.id,
      title: input.title,
      assessment: input.assessment,
      drivers: Risk.explain(input.assessment),
      semantic: input.semantic ?? null,
      quality: input.quality,
    } satisfies Detail
  }

  async function replayReadiness(sessionID: SessionID, workflow: ProbabilisticRollout.Workflow) {
    const [replay, labels] = await Promise.all([
      ProbabilisticRollout.exportReplay(sessionID, workflow),
      QualityLabelStore.list(sessionID, workflow),
    ])
    if (replay.items.length === 0) return null
    return ProbabilisticRollout.summarizeReplayReadiness({ replay, labels })
  }

  async function loadQualityReadiness(sessionID: SessionID) {
    const [review, debug, qa] = await Promise.all([
      replayReadiness(sessionID, "review"),
      replayReadiness(sessionID, "debug"),
      replayReadiness(sessionID, "qa"),
    ])
    return QualityReadiness.parse({ review, debug, qa })
  }

  export async function load(sessionID: SessionID, options?: { includeQuality?: boolean }) {
    const [session, semantic] = await Promise.all([Session.get(sessionID), SessionSemanticDiff.load(sessionID)])
    const assessment = Risk.fromSession(sessionID)
    void QualityShadow.captureSessionRisk({ session, assessment }).catch((err) => {
      log.warn("quality shadow capture failed", { sessionID, err })
    })
    const quality = options?.includeQuality ? await loadQualityReadiness(sessionID) : undefined
    return detail({
      id: sessionID,
      title: session.title,
      assessment,
      semantic,
      quality,
    })
  }
}
