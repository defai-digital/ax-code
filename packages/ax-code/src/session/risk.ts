import z from "zod"
import { Risk } from "../risk/score"
import { Session } from "."
import { SessionBranchRank } from "./branch"
import { SessionSemanticDiff } from "./semantic-diff"
import type { SessionID } from "./schema"

export namespace SessionRisk {
  export const Detail = z
    .object({
      id: z.string(),
      title: z.string(),
      assessment: SessionBranchRank.RiskAssessment,
      drivers: z.string().array(),
      semantic: SessionSemanticDiff.Summary.nullable(),
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
  }) {
    return {
      id: input.id,
      title: input.title,
      assessment: input.assessment,
      drivers: Risk.explain(input.assessment),
      semantic: input.semantic ?? null,
    } satisfies Detail
  }

  export async function load(sessionID: SessionID) {
    const [session, semantic] = await Promise.all([Session.get(sessionID), SessionSemanticDiff.load(sessionID)])
    return detail({
      id: sessionID,
      title: session.title,
      assessment: Risk.fromSession(sessionID),
      semantic,
    })
  }
}
