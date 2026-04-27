import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionAdoptionReview {
  export const Disposition = z.enum(["accepted", "accepted_override", "rejected"])
  export type Disposition = z.output<typeof Disposition>

  export const ReviewArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-review"),
    reviewID: z.string(),
    source: z.string(),
    reviewedAt: z.string(),
    reviewer: z.string(),
    role: z.string().nullable(),
    disposition: Disposition,
    rationale: z.string().nullable(),
    decisionBundle: z.object({
      source: z.string(),
      createdAt: z.string(),
      digest: z.string(),
    }),
    suggestion: z.object({
      source: z.literal("decision-bundle-contextual"),
      digest: z.string(),
      adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
      differingFields: z.number().int().nonnegative(),
      missingEffectiveFields: z.number().int().nonnegative(),
    }),
  })
  export type ReviewArtifact = z.output<typeof ReviewArtifact>

  export const ReviewRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-review-record"),
    review: ReviewArtifact,
  })
  export type ReviewRecord = z.output<typeof ReviewRecord>

  export const OverrideRequirement = z.object({
    minimumReviews: z.number().int().nonnegative(),
    minimumRole: QualityPromotionApprovalPolicy.ApprovalRole.nullable(),
    requireDistinctReviewers: z.boolean(),
  })
  export type OverrideRequirement = z.output<typeof OverrideRequirement>

  export const ConsensusSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    qualifyingDisposition: Disposition,
    requirement: OverrideRequirement,
    totalReviews: z.number().int().nonnegative(),
    qualifyingReviews: z.number().int().nonnegative(),
    distinctQualifiedReviewers: z.number().int().nonnegative(),
    qualifiedRejectingReviews: z.number().int().nonnegative(),
    distinctQualifiedRejectingReviewers: z.number().int().nonnegative(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type ConsensusSummary = z.output<typeof ConsensusSummary>

  const ROLE_RANK: Record<QualityPromotionApprovalPolicy.ApprovalRole, number> = {
    engineer: 1,
    "senior-engineer": 2,
    "staff-engineer": 3,
    "principal-engineer": 4,
    manager: 5,
    director: 6,
    vp: 7,
  }

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, reviewID: string) {
    return ["quality_model_adoption_review", encode(source), reviewID]
  }

  function sort(artifacts: ReviewArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const byReviewedAt = a.reviewedAt.localeCompare(b.reviewedAt)
      if (byReviewedAt !== 0) return byReviewedAt
      return a.reviewID.localeCompare(b.reviewID)
    })
  }

  export function decisionBundleDigest(bundle: QualityPromotionDecisionBundle.DecisionBundle) {
    return createHash("sha256").update(JSON.stringify(bundle)).digest("hex")
  }

  export function suggestionDigest(bundle: QualityPromotionDecisionBundle.DecisionBundle) {
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    return createHash("sha256").update(JSON.stringify(suggestion)).digest("hex")
  }

  function matchesBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle, review: ReviewArtifact) {
    return (
      review.decisionBundle.digest === decisionBundleDigest(bundle) &&
      review.decisionBundle.createdAt === bundle.createdAt &&
      review.suggestion.digest === suggestionDigest(bundle)
    )
  }

  function normalizeRole(role: string | null | undefined): QualityPromotionApprovalPolicy.ApprovalRole | null {
    if (!role) return null
    const normalized = role.trim().toLowerCase()
    return QualityPromotionApprovalPolicy.ApprovalRole.safeParse(normalized).success
      ? QualityPromotionApprovalPolicy.ApprovalRole.parse(normalized)
      : null
  }

  function qualifiesRole(
    role: string | null | undefined,
    minimumRole: QualityPromotionApprovalPolicy.ApprovalRole | null,
  ) {
    if (!minimumRole) return true
    const normalized = normalizeRole(role)
    if (!normalized) return false
    return ROLE_RANK[normalized] >= ROLE_RANK[minimumRole]
  }

  export function defaultRequirement(
    adoptionStatus: QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot["status"],
  ): OverrideRequirement {
    switch (adoptionStatus) {
      case "accepted":
        return OverrideRequirement.parse({
          minimumReviews: 0,
          minimumRole: null,
          requireDistinctReviewers: false,
        })
      case "partially_accepted":
        return OverrideRequirement.parse({
          minimumReviews: 1,
          minimumRole: "staff-engineer",
          requireDistinctReviewers: true,
        })
      case "diverged":
        return OverrideRequirement.parse({
          minimumReviews: 2,
          minimumRole: "staff-engineer",
          requireDistinctReviewers: true,
        })
      case "no_effective_policy":
        return OverrideRequirement.parse({
          minimumReviews: 0,
          minimumRole: null,
          requireDistinctReviewers: false,
        })
    }
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    reviewer: string
    role?: string | null
    disposition?: Disposition
    rationale?: string | null
  }): ReviewArtifact {
    const reviewedAt = new Date().toISOString()
    const reviewID = `${Date.now()}-${encode(input.bundle.source)}-${encode(input.reviewer)}`
    const suggestion =
      input.bundle.approvalPolicySuggestion ??
      QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle)
    const disposition =
      input.disposition ?? (suggestion.adoption.status === "accepted" ? "accepted" : "accepted_override")
    const rationale = input.rationale?.trim() || null

    if (suggestion.adoption.status === "accepted" && disposition !== "accepted") {
      throw new Error(
        `Adoption review for ${input.bundle.source} cannot use ${disposition} when suggestion adoption is accepted`,
      )
    }
    if (suggestion.adoption.status !== "accepted" && disposition === "accepted") {
      throw new Error(`Adoption review for ${input.bundle.source} must explicitly acknowledge override or rejection`)
    }
    if ((disposition === "accepted_override" || disposition === "rejected") && !rationale) {
      throw new Error(`Adoption review for ${input.bundle.source} requires rationale for disposition ${disposition}`)
    }

    return ReviewArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-review",
      reviewID,
      source: input.bundle.source,
      reviewedAt,
      reviewer: input.reviewer,
      role: input.role ?? null,
      disposition,
      rationale,
      decisionBundle: {
        source: input.bundle.source,
        createdAt: input.bundle.createdAt,
        digest: decisionBundleDigest(input.bundle),
      },
      suggestion: {
        source: suggestion.source,
        digest: suggestionDigest(input.bundle),
        adoptionStatus: suggestion.adoption.status,
        differingFields: suggestion.adoption.differingFields,
        missingEffectiveFields: suggestion.adoption.missingEffectiveFields,
      },
    })
  }

  export function verify(bundle: QualityPromotionDecisionBundle.DecisionBundle, review: ReviewArtifact) {
    const reasons: string[] = []
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (review.source !== bundle.source) {
      reasons.push(`adoption review source mismatch: ${review.source} vs ${bundle.source}`)
    }
    if (review.decisionBundle.source !== bundle.source) {
      reasons.push(
        `adoption review decision bundle source mismatch: ${review.decisionBundle.source} vs ${bundle.source}`,
      )
    }
    if (review.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(
        `adoption review decision bundle createdAt mismatch: ${review.decisionBundle.createdAt} vs ${bundle.createdAt}`,
      )
    }
    if (review.decisionBundle.digest !== decisionBundleDigest(bundle)) {
      reasons.push(`adoption review decision bundle digest mismatch for ${bundle.source}`)
    }
    if (review.suggestion.digest !== suggestionDigest(bundle)) {
      reasons.push(`adoption review suggestion digest mismatch for ${bundle.source}`)
    }
    if (review.suggestion.adoptionStatus !== suggestion.adoption.status) {
      reasons.push(
        `adoption review status mismatch: ${review.suggestion.adoptionStatus} vs ${suggestion.adoption.status}`,
      )
    }
    if (review.disposition === "accepted" && suggestion.adoption.status !== "accepted") {
      reasons.push(
        `adoption review disposition accepted is invalid for suggestion status ${suggestion.adoption.status}`,
      )
    }
    if (review.disposition !== "accepted" && suggestion.adoption.status === "accepted") {
      reasons.push(`adoption review override disposition is invalid for accepted suggestion status`)
    }
    return reasons
  }

  export function evaluate(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: ReviewArtifact[],
    requirementOverride?: Partial<OverrideRequirement>,
  ) {
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    const qualifyingDisposition: Disposition =
      suggestion.adoption.status === "accepted" ? "accepted" : "accepted_override"
    const requirement = OverrideRequirement.parse({
      ...defaultRequirement(suggestion.adoption.status),
      ...requirementOverride,
    })
    const qualifyingReviews = reviews.filter(
      (review) => review.disposition === qualifyingDisposition && qualifiesRole(review.role, requirement.minimumRole),
    )
    const distinctQualifiedReviewers = new Set(qualifyingReviews.map((review) => review.reviewer)).size
    const qualifiedRejectingReviews = reviews.filter(
      (review) => review.disposition === "rejected" && qualifiesRole(review.role, requirement.minimumRole),
    )
    const distinctQualifiedRejectingReviewers = new Set(qualifiedRejectingReviews.map((review) => review.reviewer)).size
    const meetsCount = qualifyingReviews.length >= requirement.minimumReviews
    const meetsDistinct =
      !requirement.requireDistinctReviewers || distinctQualifiedReviewers >= requirement.minimumReviews
    const vetoedByQualifiedRejection = qualifiedRejectingReviews.length > 0
    const gates = [
      {
        name: "override-review-count",
        status: meetsCount ? "pass" : "fail",
        detail: `${qualifyingReviews.length} qualifying review(s); required ${requirement.minimumReviews}`,
      },
      {
        name: "override-review-distinctness",
        status: meetsDistinct ? "pass" : "fail",
        detail: requirement.requireDistinctReviewers
          ? `${distinctQualifiedReviewers} distinct qualifying reviewer(s); required ${requirement.minimumReviews}`
          : "distinct reviewers not required",
      },
      {
        name: "qualified-rejection-veto",
        status: vetoedByQualifiedRejection ? "fail" : "pass",
        detail: vetoedByQualifiedRejection
          ? `${qualifiedRejectingReviews.length} qualified rejection review(s) present`
          : "no qualified rejection reviews present",
      },
    ] as const
    return ConsensusSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      adoptionStatus: suggestion.adoption.status,
      qualifyingDisposition,
      requirement,
      totalReviews: reviews.length,
      qualifyingReviews: qualifyingReviews.length,
      distinctQualifiedReviewers,
      qualifiedRejectingReviews: qualifiedRejectingReviews.length,
      distinctQualifiedRejectingReviewers,
      gates,
    })
  }

  export async function resolveForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: ReviewArtifact[] = [],
  ) {
    const persisted = (await list(bundle.source)).filter((review) => matchesBundle(bundle, review))
    const deduped = new Map<string, ReviewArtifact>()
    for (const review of [...persisted, ...reviews]) {
      if (!matchesBundle(bundle, review)) continue
      deduped.set(review.reviewID, review)
    }
    return sort([...deduped.values()])
  }

  export async function get(input: { source: string; reviewID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.reviewID))
    return ReviewRecord.parse(record)
  }

  export async function append(review: ReviewArtifact) {
    const next = ReviewRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-review-record",
      review,
    })
    try {
      const existing = await get({ source: review.source, reviewID: review.reviewID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Adoption review ${review.reviewID} already exists for source ${review.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(review.source, review.reviewID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_adoption_review", encode(source)]] : [["quality_model_adoption_review"]]
    const reviews: ReviewArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const reviewID = parts[parts.length - 1]
        if (!encodedSource || !reviewID) continue
        const record = await get({ source: decode(encodedSource), reviewID })
        reviews.push(record.review)
      }
    }

    return sort(reviews)
  }

  export async function assertPersisted(review: ReviewArtifact) {
    const persisted = await get({ source: review.source, reviewID: review.reviewID })
    const prev = JSON.stringify(persisted.review)
    const curr = JSON.stringify(review)
    if (prev !== curr) {
      throw new Error(`Persisted adoption review ${review.reviewID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(review: ReviewArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption review")
    lines.push("")
    lines.push(`- source: ${review.source}`)
    lines.push(`- review id: ${review.reviewID}`)
    lines.push(`- reviewed at: ${review.reviewedAt}`)
    lines.push(`- reviewer: ${review.reviewer}`)
    lines.push(`- role: ${review.role ?? "n/a"}`)
    lines.push(`- disposition: ${review.disposition}`)
    lines.push(`- rationale: ${review.rationale ?? "n/a"}`)
    lines.push(`- decision bundle created at: ${review.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${review.decisionBundle.digest}`)
    lines.push(`- suggestion source: ${review.suggestion.source}`)
    lines.push(`- suggestion digest: ${review.suggestion.digest}`)
    lines.push(`- suggestion adoption status: ${review.suggestion.adoptionStatus}`)
    lines.push(`- suggestion differing fields: ${review.suggestion.differingFields}`)
    lines.push(`- suggestion missing effective fields: ${review.suggestion.missingEffectiveFields}`)
    lines.push("")
    return lines.join("\n")
  }

  export function renderConsensus(summary: ConsensusSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption review consensus")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- adoption status: ${summary.adoptionStatus}`)
    lines.push(`- qualifying disposition: ${summary.qualifyingDisposition}`)
    lines.push(`- minimum reviews: ${summary.requirement.minimumReviews}`)
    lines.push(`- minimum role: ${summary.requirement.minimumRole ?? "none"}`)
    lines.push(`- distinct reviewers required: ${summary.requirement.requireDistinctReviewers}`)
    lines.push(`- total reviews considered: ${summary.totalReviews}`)
    lines.push(`- qualifying reviews: ${summary.qualifyingReviews}`)
    lines.push(`- distinct qualified reviewers: ${summary.distinctQualifiedReviewers}`)
    lines.push(`- qualified rejecting reviews: ${summary.qualifiedRejectingReviews}`)
    lines.push(`- distinct qualified rejecting reviewers: ${summary.distinctQualifiedRejectingReviewers}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
