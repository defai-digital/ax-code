import z from "zod"
import { Installation } from "../installation"
import { Instance } from "../project/instance"
import { FindingSchema } from "../quality/finding"
import { applyPolicyFilter } from "../quality/policy-filter"
import { Policy } from "../quality/policy"
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
    return envelopes
      .filter((item) => item.envelope.workflow === "review")
      .map((item) => ({ envelopeId: item.envelopeId, envelope: item.envelope }))
  }
  return ids.map((id) => {
    const item = byId.get(id)
    if (!item) {
      throw new Error(`verificationEnvelopeIds references an unknown verification envelope id: ${id}`)
    }
    if (item.envelope.workflow !== "review") {
      throw new Error(
        `verificationEnvelopeIds references a ${item.envelope.workflow} envelope id: ${id}. review_complete only accepts review workflow envelopes; run verify_project with workflow: "review".`,
      )
    }
    return { envelopeId: item.envelopeId, envelope: item.envelope }
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function runPolicyFailed(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false
  const policy = metadata.policy
  if (!isRecord(policy)) return false
  return policy.requiredChecksPassed === false
}

function selectedVerificationPolicyFailed(sessionID: SessionID, ids: string[] | undefined): boolean {
  const selected = ids ? new Set(ids) : undefined
  for (const run of SessionVerifications.loadRunsWithIds(sessionID)) {
    const hasSelectedReviewEnvelope = run.envelopes.some((item) => {
      if (item.envelope.workflow !== "review") return false
      return !selected || selected.has(item.envelopeId)
    })
    if (hasSelectedReviewEnvelope && runPolicyFailed(run.metadata)) return true
  }
  return false
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
    throw new Error(
      "Cannot approve review without a successful verification set: cite at least one passed envelope and no failed, error, or timeout envelopes.",
    )
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
    const selectedFindings = selectFindings(sessionID, args.findingIds)
    const policyRules = await Policy.loadReviewRules({ worktree: Instance.worktree, cwd: Instance.directory })
    const policyFilter = applyPolicyFilter(selectedFindings, policyRules)
    const findings = policyFilter.kept
    const verificationEnvelopes = selectEnvelopes(sessionID, args.verificationEnvelopeIds)
    const verificationPolicyFailed = selectedVerificationPolicyFailed(sessionID, args.verificationEnvelopeIds)
    const draft = createReviewResult({
      sessionID,
      summary: args.summary,
      findings,
      verificationEnvelopes,
      verificationPolicyFailed,
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
        draft.missingVerification ? " (verification not fully passing)" : ""
      }`,
      ...(verificationPolicyFailed ? ["Verification policy: failed"] : []),
      ...(policyRules
        ? [
            `Policy findings: ${policyFilter.kept.length} kept, ${policyFilter.dropped.length} dropped`,
            ...policyFilter.warnings.map((warning) => `Policy warning: ${warning}`),
          ]
        : []),
      ...(draft.missingVerification
        ? ['Next: run verify_project with workflow: "review", then cite the passed envelope ids in review_complete.']
        : []),
      `Review id: ${draft.reviewId}`,
    ]

    return {
      title: `review_complete ${draft.decision}`,
      output: lines.join("\n"),
      metadata: {
        reviewId: draft.reviewId,
        reviewResult: draft,
        verificationPolicyFailed,
        policy: policyRules
          ? {
              rules: policyRules,
              keptFindingIds: policyFilter.kept.map((finding) => finding.findingId),
              droppedFindings: policyFilter.dropped.map((item) => ({
                findingId: item.finding.findingId,
                reasons: item.reasons,
              })),
              warnings: policyFilter.warnings,
            }
          : undefined,
      },
    }
  },
})
