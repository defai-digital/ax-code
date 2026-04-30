import { createHash } from "node:crypto"
import z from "zod"
import { FindingSource, FINDING_ID_PATTERN, type Finding } from "./finding"
import { emptySeverityCounts, type SeverityCounts } from "./finding-counts"
import { ENVELOPE_ID_PATTERN, type VerificationEnvelope } from "./verification-envelope"

export const ReviewDecisionEnum = z.enum(["approve", "request_changes", "needs_verification"])
export type ReviewDecision = z.infer<typeof ReviewDecisionEnum>

export const ReviewResultSchema = z.object({
  schemaVersion: z.literal(1),
  reviewId: z.string().regex(/^[0-9a-f]{16}$/),
  workflow: z.literal("review"),
  decision: ReviewDecisionEnum,
  recommendedDecision: ReviewDecisionEnum,
  summary: z.string().min(1).max(1000),
  findingIds: z.array(z.string().regex(FINDING_ID_PATTERN)),
  verificationEnvelopeIds: z.array(z.string().regex(ENVELOPE_ID_PATTERN)),
  counts: z.object({
    CRITICAL: z.number().int().min(0),
    HIGH: z.number().int().min(0),
    MEDIUM: z.number().int().min(0),
    LOW: z.number().int().min(0),
    INFO: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  blockingFindingIds: z.array(z.string().regex(FINDING_ID_PATTERN)),
  missingVerification: z.boolean(),
  overrideReason: z.string().min(1).max(1000).optional(),
  createdAt: z.string().datetime(),
  source: FindingSource,
})
export type ReviewResult = z.infer<typeof ReviewResultSchema>

export type VerificationEnvelopeWithId = {
  envelopeId: string
  envelope: VerificationEnvelope
}

export type CreateReviewResultInput = {
  sessionID: string
  summary: string
  findings: Finding[]
  verificationEnvelopes: VerificationEnvelopeWithId[]
  verificationPolicyFailed?: boolean
  decision?: ReviewDecision
  overrideReason?: string
  source: ReviewResult["source"]
  createdAt?: string
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]"
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalJSON(v)).join(",") + "}"
}

export function computeReviewResultId(input: {
  sessionID: string
  decision: ReviewDecision
  summary: string
  findingIds: string[]
  verificationEnvelopeIds: string[]
}): string {
  return createHash("sha256")
    .update(
      canonicalJSON({
        sessionID: input.sessionID,
        decision: input.decision,
        summary: input.summary,
        findingIds: [...input.findingIds].sort(),
        verificationEnvelopeIds: [...input.verificationEnvelopeIds].sort(),
      }),
    )
    .digest("hex")
    .slice(0, 16)
}

export function countSeverities(findings: readonly Finding[]): SeverityCounts {
  const counts = emptySeverityCounts()
  for (const finding of findings) {
    counts[finding.severity] += 1
    counts.total += 1
  }
  return counts
}

export function blockingFindingIds(findings: readonly Finding[]): string[] {
  return findings
    .filter((finding) => finding.severity === "CRITICAL" || finding.severity === "HIGH")
    .map((finding) => finding.findingId)
}

export function hasPassingVerification(envelopes: readonly VerificationEnvelopeWithId[]): boolean {
  return envelopes.some((item) => item.envelope.result.status === "passed")
}

export function hasSuccessfulVerificationSet(envelopes: readonly VerificationEnvelopeWithId[]): boolean {
  return (
    hasPassingVerification(envelopes) &&
    envelopes.every((item) => item.envelope.result.status === "passed" || item.envelope.result.status === "skipped")
  )
}

export function recommendReviewDecision(
  findings: readonly Finding[],
  verificationEnvelopes: readonly VerificationEnvelopeWithId[],
  options: { verificationPolicyFailed?: boolean } = {},
): ReviewDecision {
  if (blockingFindingIds(findings).length > 0) return "request_changes"
  if (options.verificationPolicyFailed) return "needs_verification"
  if (!hasSuccessfulVerificationSet(verificationEnvelopes)) return "needs_verification"
  return "approve"
}

export function createReviewResult(input: CreateReviewResultInput): ReviewResult {
  const findingIds = input.findings.map((finding) => finding.findingId)
  const verificationEnvelopeIds = input.verificationEnvelopes.map((item) => item.envelopeId)
  const missingVerification =
    input.verificationPolicyFailed === true || !hasSuccessfulVerificationSet(input.verificationEnvelopes)
  const recommendedDecision = recommendReviewDecision(input.findings, input.verificationEnvelopes, {
    verificationPolicyFailed: input.verificationPolicyFailed,
  })
  const decision = input.decision ?? recommendedDecision
  const reviewId = computeReviewResultId({
    sessionID: input.sessionID,
    decision,
    summary: input.summary,
    findingIds,
    verificationEnvelopeIds,
  })

  return ReviewResultSchema.parse({
    schemaVersion: 1,
    reviewId,
    workflow: "review",
    decision,
    recommendedDecision,
    summary: input.summary,
    findingIds,
    verificationEnvelopeIds,
    counts: countSeverities(input.findings),
    blockingFindingIds: blockingFindingIds(input.findings),
    missingVerification,
    overrideReason: input.overrideReason,
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: input.source,
  })
}
