import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionAdoptionDissentSupersession {
  export const Disposition = z.enum(["withdrawn", "re_reviewed_accept", "superseded_by_new_evidence"])
  export type Disposition = z.output<typeof Disposition>

  export const TargetReview = z.object({
    reviewID: z.string(),
    reviewer: z.string(),
    role: z.string().nullable(),
    reviewedAt: z.string(),
    disposition: z.literal("rejected"),
    decisionBundleCreatedAt: z.string(),
    decisionBundleDigest: z.string(),
    suggestionDigest: z.string(),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
  })
  export type TargetReview = z.output<typeof TargetReview>

  export const SupersessionArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-supersession"),
    supersessionID: z.string(),
    source: z.string(),
    supersededAt: z.string(),
    superseder: z.string(),
    role: z.string().nullable(),
    disposition: Disposition,
    rationale: z.string(),
    decisionBundle: z.object({
      source: z.string(),
      createdAt: z.string(),
      digest: z.string(),
    }),
    suggestion: z.object({
      source: z.literal("decision-bundle-contextual"),
      digest: z.string(),
      adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    }),
    targetReviews: z.array(TargetReview).min(1),
  })
  export type SupersessionArtifact = z.output<typeof SupersessionArtifact>

  export const SupersessionRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-supersession-record"),
    supersession: SupersessionArtifact,
  })
  export type SupersessionRecord = z.output<typeof SupersessionRecord>

  export const SupersessionSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    requiredRole: QualityPromotionApprovalPolicy.ApprovalRole.nullable(),
    totalSupersessions: z.number().int().nonnegative(),
    qualifyingSupersessions: z.number().int().nonnegative(),
    distinctQualifyingSuperseders: z.number().int().nonnegative(),
    totalQualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
    unresolvedQualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredByReviewerRereview: z.number().int().nonnegative(),
    coveredByEvidenceSupersession: z.number().int().nonnegative(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type SupersessionSummary = z.output<typeof SupersessionSummary>

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

  function key(source: string, supersessionID: string) {
    return ["quality_model_adoption_dissent_supersession", encode(source), supersessionID]
  }

  function sort(artifacts: SupersessionArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const bySupersededAt = a.supersededAt.localeCompare(b.supersededAt)
      if (bySupersededAt !== 0) return bySupersededAt
      return a.supersessionID.localeCompare(b.supersessionID)
    })
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

  function matchesBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle, supersession: SupersessionArtifact) {
    return (
      supersession.decisionBundle.digest === QualityPromotionAdoptionReview.decisionBundleDigest(bundle) &&
      supersession.decisionBundle.createdAt === bundle.createdAt &&
      supersession.suggestion.digest === QualityPromotionAdoptionReview.suggestionDigest(bundle)
    )
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    targetReviews: QualityPromotionAdoptionReview.ReviewArtifact[]
    superseder: string
    role?: string | null
    disposition: Disposition
    rationale: string
  }): SupersessionArtifact {
    const supersededAt = new Date().toISOString()
    const supersessionID = `${Date.now()}-${encode(input.bundle.source)}-${encode(input.superseder)}`
    const suggestion =
      input.bundle.approvalPolicySuggestion ??
      QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle)
    const rationale = input.rationale.trim()
    if (!rationale) {
      throw new Error(`Adoption dissent supersession for ${input.bundle.source} requires rationale`)
    }
    if (input.targetReviews.length === 0) {
      throw new Error(
        `Adoption dissent supersession for ${input.bundle.source} requires at least one rejected adoption review`,
      )
    }
    if (input.disposition !== "superseded_by_new_evidence" && input.targetReviews.length !== 1) {
      throw new Error(
        `Adoption dissent supersession for ${input.bundle.source} may only target one review for disposition ${input.disposition}`,
      )
    }
    for (const review of input.targetReviews) {
      const reviewReasons = QualityPromotionAdoptionReview.verify(input.bundle, review)
      if (reviewReasons.length > 0) {
        throw new Error(
          `Cannot create dissent supersession for ${input.bundle.source}: invalid target adoption review (${reviewReasons[0]})`,
        )
      }
      if (review.disposition !== "rejected") {
        throw new Error(
          `Cannot create dissent supersession for ${input.bundle.source}: target review ${review.reviewID} is not rejected`,
        )
      }
    }
    if (input.disposition !== "superseded_by_new_evidence" && input.targetReviews[0]!.reviewer !== input.superseder) {
      throw new Error(
        `Adoption dissent supersession for ${input.bundle.source} requires the original dissent reviewer to file disposition ${input.disposition}`,
      )
    }

    return SupersessionArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-supersession",
      supersessionID,
      source: input.bundle.source,
      supersededAt,
      superseder: input.superseder,
      role: input.role ?? null,
      disposition: input.disposition,
      rationale,
      decisionBundle: {
        source: input.bundle.source,
        createdAt: input.bundle.createdAt,
        digest: QualityPromotionAdoptionReview.decisionBundleDigest(input.bundle),
      },
      suggestion: {
        source: suggestion.source,
        digest: QualityPromotionAdoptionReview.suggestionDigest(input.bundle),
        adoptionStatus: suggestion.adoption.status,
      },
      targetReviews: input.targetReviews.map((review) => ({
        reviewID: review.reviewID,
        reviewer: review.reviewer,
        role: review.role,
        reviewedAt: review.reviewedAt,
        disposition: "rejected",
        decisionBundleCreatedAt: review.decisionBundle.createdAt,
        decisionBundleDigest: review.decisionBundle.digest,
        suggestionDigest: review.suggestion.digest,
        adoptionStatus: review.suggestion.adoptionStatus,
      })),
    })
  }

  export function verify(bundle: QualityPromotionDecisionBundle.DecisionBundle, supersession: SupersessionArtifact) {
    const reasons: string[] = []
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (supersession.source !== bundle.source) {
      reasons.push(`dissent supersession source mismatch: ${supersession.source} vs ${bundle.source}`)
    }
    if (supersession.decisionBundle.source !== bundle.source) {
      reasons.push(
        `dissent supersession decision bundle source mismatch: ${supersession.decisionBundle.source} vs ${bundle.source}`,
      )
    }
    if (supersession.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(
        `dissent supersession decision bundle createdAt mismatch: ${supersession.decisionBundle.createdAt} vs ${bundle.createdAt}`,
      )
    }
    if (supersession.decisionBundle.digest !== QualityPromotionAdoptionReview.decisionBundleDigest(bundle)) {
      reasons.push(`dissent supersession decision bundle digest mismatch for ${bundle.source}`)
    }
    if (supersession.suggestion.digest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
      reasons.push(`dissent supersession suggestion digest mismatch for ${bundle.source}`)
    }
    if (supersession.suggestion.adoptionStatus !== suggestion.adoption.status) {
      reasons.push(
        `dissent supersession adoption status mismatch: ${supersession.suggestion.adoptionStatus} vs ${suggestion.adoption.status}`,
      )
    }
    if (supersession.targetReviews.length === 0) {
      reasons.push(`dissent supersession for ${bundle.source} has no target reviews`)
    }
    if (supersession.disposition !== "superseded_by_new_evidence" && supersession.targetReviews.length !== 1) {
      reasons.push(
        `dissent supersession for ${bundle.source} may only target one review for disposition ${supersession.disposition}`,
      )
    }
    const seenReviewIDs = new Set<string>()
    for (const review of supersession.targetReviews) {
      if (review.disposition !== "rejected") {
        reasons.push(`dissent supersession target review ${review.reviewID} must be rejected`)
      }
      if (review.decisionBundleCreatedAt !== bundle.createdAt) {
        reasons.push(`dissent supersession target review ${review.reviewID} createdAt mismatch`)
      }
      if (review.decisionBundleDigest !== QualityPromotionAdoptionReview.decisionBundleDigest(bundle)) {
        reasons.push(`dissent supersession target review ${review.reviewID} digest mismatch`)
      }
      if (review.suggestionDigest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
        reasons.push(`dissent supersession target review ${review.reviewID} suggestion digest mismatch`)
      }
      if (seenReviewIDs.has(review.reviewID)) {
        reasons.push(`dissent supersession target review ${review.reviewID} is duplicated`)
      }
      seenReviewIDs.add(review.reviewID)
    }
    if (
      supersession.disposition !== "superseded_by_new_evidence" &&
      supersession.targetReviews[0]?.reviewer !== supersession.superseder
    ) {
      reasons.push(`dissent supersession ${supersession.supersessionID} must be filed by the original dissent reviewer`)
    }
    return reasons
  }

  export function coveredQualifiedRejectingReviewIDs(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    supersessions: SupersessionArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    const qualifiedRejectingReviews = reviews.filter(
      (review) => review.disposition === "rejected" && qualifiesRole(review.role, consensus.requirement.minimumRole),
    )
    const qualifiedRejectingReviewIDSet = new Set(qualifiedRejectingReviews.map((review) => review.reviewID))
    const coveredByReviewerRereview = new Set<string>()
    const coveredByEvidenceSupersession = new Set<string>()
    const qualifyingSupersessions: SupersessionArtifact[] = []

    for (const supersession of supersessions) {
      const targetQualifiedRejectingReviewIDs = supersession.targetReviews
        .map((review) => review.reviewID)
        .filter((reviewID) => qualifiedRejectingReviewIDSet.has(reviewID))
      if (targetQualifiedRejectingReviewIDs.length === 0) continue

      if (supersession.disposition === "superseded_by_new_evidence") {
        if (!qualifiesRole(supersession.role, consensus.requirement.minimumRole)) continue
        const targetRejectingReviewers = new Set(supersession.targetReviews.map((review) => review.reviewer))
        if (targetRejectingReviewers.has(supersession.superseder)) continue
        qualifyingSupersessions.push(supersession)
        for (const reviewID of targetQualifiedRejectingReviewIDs) {
          coveredByEvidenceSupersession.add(reviewID)
        }
        continue
      }

      const target = supersession.targetReviews[0]
      if (!target || target.reviewer !== supersession.superseder) continue
      qualifyingSupersessions.push(supersession)
      coveredByReviewerRereview.add(target.reviewID)
    }

    return {
      qualifyingSupersessions,
      coveredReviewIDs: new Set([...coveredByReviewerRereview, ...coveredByEvidenceSupersession]),
      coveredByReviewerRereview,
      coveredByEvidenceSupersession,
      totalQualifiedRejectingReviews: qualifiedRejectingReviews.length,
    }
  }

  export function evaluate(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    supersessions: SupersessionArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    const analysis = coveredQualifiedRejectingReviewIDs(bundle, reviews, supersessions)
    const coverageSatisfied = analysis.coveredReviewIDs.size === analysis.totalQualifiedRejectingReviews
    const gates = [
      {
        name: "qualified-rejection-supersession-coverage",
        status: coverageSatisfied ? "pass" : "fail",
        detail:
          analysis.totalQualifiedRejectingReviews === 0
            ? "no qualified rejecting reviews present"
            : `${analysis.coveredReviewIDs.size}/${analysis.totalQualifiedRejectingReviews} qualified rejecting review(s) superseded`,
      },
    ] as const

    return SupersessionSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      adoptionStatus: consensus.adoptionStatus,
      requiredRole: consensus.requirement.minimumRole,
      totalSupersessions: supersessions.length,
      qualifyingSupersessions: analysis.qualifyingSupersessions.length,
      distinctQualifyingSuperseders: new Set(
        analysis.qualifyingSupersessions.map((supersession) => supersession.superseder),
      ).size,
      totalQualifiedRejectingReviews: analysis.totalQualifiedRejectingReviews,
      coveredQualifiedRejectingReviews: analysis.coveredReviewIDs.size,
      unresolvedQualifiedRejectingReviews: Math.max(
        0,
        analysis.totalQualifiedRejectingReviews - analysis.coveredReviewIDs.size,
      ),
      coveredByReviewerRereview: analysis.coveredByReviewerRereview.size,
      coveredByEvidenceSupersession: analysis.coveredByEvidenceSupersession.size,
      gates,
    })
  }

  export async function resolveForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    supersessions: SupersessionArtifact[] = [],
  ) {
    const persisted = (await list(bundle.source)).filter((supersession) => matchesBundle(bundle, supersession))
    const deduped = new Map<string, SupersessionArtifact>()
    for (const supersession of [...persisted, ...supersessions]) {
      if (!matchesBundle(bundle, supersession)) continue
      deduped.set(supersession.supersessionID, supersession)
    }
    return sort([...deduped.values()])
  }

  export async function get(input: { source: string; supersessionID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.supersessionID))
    return SupersessionRecord.parse(record)
  }

  export async function append(supersession: SupersessionArtifact) {
    const next = SupersessionRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-supersession-record",
      supersession,
    })
    try {
      const existing = await get({ source: supersession.source, supersessionID: supersession.supersessionID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Adoption dissent supersession ${supersession.supersessionID} already exists for source ${supersession.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(supersession.source, supersession.supersessionID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source
      ? [["quality_model_adoption_dissent_supersession", encode(source)]]
      : [["quality_model_adoption_dissent_supersession"]]
    const supersessions: SupersessionArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const supersessionID = parts[parts.length - 1]
        if (!encodedSource || !supersessionID) continue
        const record = await get({ source: decode(encodedSource), supersessionID })
        supersessions.push(record.supersession)
      }
    }

    return sort(supersessions)
  }

  export async function assertPersisted(supersession: SupersessionArtifact) {
    const persisted = await get({ source: supersession.source, supersessionID: supersession.supersessionID })
    const prev = JSON.stringify(persisted.supersession)
    const curr = JSON.stringify(supersession)
    if (prev !== curr) {
      throw new Error(
        `Persisted adoption dissent supersession ${supersession.supersessionID} does not match the provided artifact`,
      )
    }
    return persisted
  }

  export function renderReport(supersession: SupersessionArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent supersession")
    lines.push("")
    lines.push(`- source: ${supersession.source}`)
    lines.push(`- supersession id: ${supersession.supersessionID}`)
    lines.push(`- superseded at: ${supersession.supersededAt}`)
    lines.push(`- superseder: ${supersession.superseder}`)
    lines.push(`- role: ${supersession.role ?? "n/a"}`)
    lines.push(`- disposition: ${supersession.disposition}`)
    lines.push(`- rationale: ${supersession.rationale}`)
    lines.push(`- decision bundle created at: ${supersession.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${supersession.decisionBundle.digest}`)
    lines.push(`- suggestion digest: ${supersession.suggestion.digest}`)
    lines.push(`- suggestion adoption status: ${supersession.suggestion.adoptionStatus}`)
    lines.push(`- target reviews: ${supersession.targetReviews.length}`)
    lines.push("")
    for (const target of supersession.targetReviews) {
      lines.push(`- target review: ${target.reviewID} · ${target.reviewer} · ${target.reviewedAt}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: SupersessionSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent supersession")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- adoption status: ${summary.adoptionStatus}`)
    lines.push(`- required role: ${summary.requiredRole ?? "none"}`)
    lines.push(`- total supersessions considered: ${summary.totalSupersessions}`)
    lines.push(`- qualifying supersessions: ${summary.qualifyingSupersessions}`)
    lines.push(`- distinct qualifying superseders: ${summary.distinctQualifyingSuperseders}`)
    lines.push(`- qualified rejecting reviews: ${summary.totalQualifiedRejectingReviews}`)
    lines.push(`- covered qualified rejecting reviews: ${summary.coveredQualifiedRejectingReviews}`)
    lines.push(`- unresolved qualified rejecting reviews: ${summary.unresolvedQualifiedRejectingReviews}`)
    lines.push(`- covered by reviewer re-review: ${summary.coveredByReviewerRereview}`)
    lines.push(`- covered by evidence supersession: ${summary.coveredByEvidenceSupersession}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
