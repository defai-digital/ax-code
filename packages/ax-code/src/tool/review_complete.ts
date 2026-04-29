import z from "zod"
import { Installation } from "../installation"
import { FindingSchema } from "../quality/finding"
import {
  createReviewResult,
  ReviewDecisionEnum,
  type ReviewDecision,
  type VerificationEnvelopeWithId,
} from "../quality/review-result"
import { SessionFindings } from "../session/findings"
import type { SessionID } from "../session/schema"
import { SessionVerifications } from "../session/verifications"
import { Tool } from "./tool"
import DESCRIPTION from "./review_complete.txt"

function selectFindings(sessionID: SessionID, ids: string[] | undefined) {
  const findings = SessionFindings.load(sessionID).filter((finding) => finding.workflow === "review")
  const byId = new Map(findings.map((finding) => [finding.findingId, finding]))
  if (!ids) return findings
  return ids.map((id) => {
    const finding = byId.get(id)
    if (!finding) {
      throw new Error(`findingIds references an unknown review finding id: ${id}`)
    }
    return finding
  })
}

function selectEnvelopes(sessionID: SessionID, ids: string[] | undefined): VerificationEnvelopeWithId[] {
  const envelopes = SessionVerifications.loadWithIds(sessionID)
  const byId = new Map(envelopes.map((item) => [item.envelopeId, item]))
  if (!ids) {
    return envelopes.map((item) => ({ envelopeId: item.envelopeId, envelope: item.envelope }))
  }
  return ids.map((id) => {
    const item = byId.get(id)
    if (!item) {
      throw new Error(`verificationEnvelopeIds references an unknown verification envelope id: ${id}`)
    }
    return { envelopeId: item.envelopeId, envelope: item.envelope }
  })
}

function validateDecision(input: {
  decision: ReviewDecision
  recommendedDecision: ReviewDecision
  blockingFindingIds: readonly string[]
  missingVerification: boolean
  overrideReason?: string
}) {
  if (input.decision === input.recommendedDecision) return

  if (input.decision === "approve" && input.blockingFindingIds.length > 0) {
    throw new Error(
      `Cannot approve review with blocking findings: ${input.blockingFindingIds.join(", ")}. Resolve or downgrade the findings first.`,
    )
  }
  if (input.decision === "approve" && input.missingVerification) {
    throw new Error("Cannot approve review without at least one passed verification envelope.")
  }
  if (!input.overrideReason) {
    throw new Error(
      `decision ${input.decision} differs from recommended decision ${input.recommendedDecision}; provide overrideReason to finalize this review.`,
    )
  }
}

export const ReviewCompleteTool = Tool.define("review_complete", {
  description: DESCRIPTION,
  parameters: z.object({
    summary: z.string().min(1).max(1000),
    decision: ReviewDecisionEnum.optional(),
    findingIds: z.array(FindingSchema.shape.findingId).optional(),
    verificationEnvelopeIds: z.array(z.string().regex(/^[0-9a-f]{16}$/)).optional(),
    overrideReason: z.string().min(1).max(1000).optional(),
  }),
  execute: async (args, ctx) => {
    const sessionID = ctx.sessionID as SessionID
    const findings = selectFindings(sessionID, args.findingIds)
    const verificationEnvelopes = selectEnvelopes(sessionID, args.verificationEnvelopeIds)
    const draft = createReviewResult({
      sessionID,
      summary: args.summary,
      findings,
      verificationEnvelopes,
      decision: args.decision,
      overrideReason: args.overrideReason,
      source: {
        tool: "review_complete",
        version: Installation.VERSION,
        runId: sessionID,
      },
    })

    validateDecision({
      decision: draft.decision,
      recommendedDecision: draft.recommendedDecision,
      blockingFindingIds: draft.blockingFindingIds,
      missingVerification: draft.missingVerification,
      overrideReason: draft.overrideReason,
    })

    const lines = [
      `Review: ${draft.decision}`,
      `Recommended: ${draft.recommendedDecision}`,
      `Findings: ${draft.counts.total} (${draft.blockingFindingIds.length} blocking)`,
      `Verification envelopes: ${draft.verificationEnvelopeIds.length}${
        draft.missingVerification ? " (no passed verification)" : ""
      }`,
      `Review id: ${draft.reviewId}`,
    ]

    return {
      title: `review_complete ${draft.decision}`,
      output: lines.join("\n"),
      metadata: {
        reviewId: draft.reviewId,
        reviewResult: draft,
      },
    }
  },
})
