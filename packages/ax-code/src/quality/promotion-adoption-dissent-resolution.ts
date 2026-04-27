import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionAdoptionDissentResolution {
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

  export const ResolutionArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-resolution"),
    resolutionID: z.string(),
    source: z.string(),
    resolvedAt: z.string(),
    resolver: z.string(),
    role: z.string().nullable(),
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
  export type ResolutionArtifact = z.output<typeof ResolutionArtifact>

  export const ResolutionRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-resolution-record"),
    resolution: ResolutionArtifact,
  })
  export type ResolutionRecord = z.output<typeof ResolutionRecord>

  export const ResolutionSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    requiredRole: QualityPromotionApprovalPolicy.ApprovalRole.nullable(),
    totalResolutions: z.number().int().nonnegative(),
    qualifyingResolutions: z.number().int().nonnegative(),
    distinctQualifyingResolvers: z.number().int().nonnegative(),
    totalQualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
    unresolvedQualifiedRejectingReviews: z.number().int().nonnegative(),
    distinctQualifiedRejectingReviewers: z.number().int().nonnegative(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type ResolutionSummary = z.output<typeof ResolutionSummary>

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

  function key(source: string, resolutionID: string) {
    return ["quality_model_adoption_dissent_resolution", encode(source), resolutionID]
  }

  function sort(artifacts: ResolutionArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const byResolvedAt = a.resolvedAt.localeCompare(b.resolvedAt)
      if (byResolvedAt !== 0) return byResolvedAt
      return a.resolutionID.localeCompare(b.resolutionID)
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

  function matchesBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle, resolution: ResolutionArtifact) {
    return (
      resolution.decisionBundle.digest === QualityPromotionAdoptionReview.decisionBundleDigest(bundle) &&
      resolution.decisionBundle.createdAt === bundle.createdAt &&
      resolution.suggestion.digest === QualityPromotionAdoptionReview.suggestionDigest(bundle)
    )
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    targetReviews: QualityPromotionAdoptionReview.ReviewArtifact[]
    resolver: string
    role?: string | null
    rationale: string
  }): ResolutionArtifact {
    const resolvedAt = new Date().toISOString()
    const resolutionID = `${Date.now()}-${encode(input.bundle.source)}-${encode(input.resolver)}`
    const suggestion =
      input.bundle.approvalPolicySuggestion ??
      QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle)
    const rationale = input.rationale.trim()
    if (!rationale) {
      throw new Error(`Adoption dissent resolution for ${input.bundle.source} requires rationale`)
    }
    if (input.targetReviews.length === 0) {
      throw new Error(
        `Adoption dissent resolution for ${input.bundle.source} requires at least one rejected adoption review`,
      )
    }
    for (const review of input.targetReviews) {
      const reviewReasons = QualityPromotionAdoptionReview.verify(input.bundle, review)
      if (reviewReasons.length > 0) {
        throw new Error(
          `Cannot create dissent resolution for ${input.bundle.source}: invalid target adoption review (${reviewReasons[0]})`,
        )
      }
      if (review.disposition !== "rejected") {
        throw new Error(
          `Cannot create dissent resolution for ${input.bundle.source}: target review ${review.reviewID} is not rejected`,
        )
      }
    }

    return ResolutionArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-resolution",
      resolutionID,
      source: input.bundle.source,
      resolvedAt,
      resolver: input.resolver,
      role: input.role ?? null,
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

  export function verify(bundle: QualityPromotionDecisionBundle.DecisionBundle, resolution: ResolutionArtifact) {
    const reasons: string[] = []
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (resolution.source !== bundle.source) {
      reasons.push(`dissent resolution source mismatch: ${resolution.source} vs ${bundle.source}`)
    }
    if (resolution.decisionBundle.source !== bundle.source) {
      reasons.push(
        `dissent resolution decision bundle source mismatch: ${resolution.decisionBundle.source} vs ${bundle.source}`,
      )
    }
    if (resolution.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(
        `dissent resolution decision bundle createdAt mismatch: ${resolution.decisionBundle.createdAt} vs ${bundle.createdAt}`,
      )
    }
    if (resolution.decisionBundle.digest !== QualityPromotionAdoptionReview.decisionBundleDigest(bundle)) {
      reasons.push(`dissent resolution decision bundle digest mismatch for ${bundle.source}`)
    }
    if (resolution.suggestion.digest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
      reasons.push(`dissent resolution suggestion digest mismatch for ${bundle.source}`)
    }
    if (resolution.suggestion.adoptionStatus !== suggestion.adoption.status) {
      reasons.push(
        `dissent resolution adoption status mismatch: ${resolution.suggestion.adoptionStatus} vs ${suggestion.adoption.status}`,
      )
    }
    if (resolution.targetReviews.length === 0) {
      reasons.push(`dissent resolution for ${bundle.source} has no target reviews`)
    }
    const seenReviewIDs = new Set<string>()
    for (const review of resolution.targetReviews) {
      if (review.disposition !== "rejected") {
        reasons.push(`dissent resolution target review ${review.reviewID} must be rejected`)
      }
      if (review.decisionBundleCreatedAt !== bundle.createdAt) {
        reasons.push(`dissent resolution target review ${review.reviewID} createdAt mismatch`)
      }
      if (review.decisionBundleDigest !== QualityPromotionAdoptionReview.decisionBundleDigest(bundle)) {
        reasons.push(`dissent resolution target review ${review.reviewID} digest mismatch`)
      }
      if (review.suggestionDigest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
        reasons.push(`dissent resolution target review ${review.reviewID} suggestion digest mismatch`)
      }
      if (seenReviewIDs.has(review.reviewID)) {
        reasons.push(`dissent resolution target review ${review.reviewID} is duplicated`)
      }
      seenReviewIDs.add(review.reviewID)
    }
    return reasons
  }

  export function coveredQualifiedRejectingReviewIDs(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    resolutions: ResolutionArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    const qualifiedRejectingReviews = reviews.filter(
      (review) => review.disposition === "rejected" && qualifiesRole(review.role, consensus.requirement.minimumRole),
    )
    const qualifiedRejectingReviewers = new Set(qualifiedRejectingReviews.map((review) => review.reviewer))
    const qualifyingResolutions = resolutions.filter(
      (resolution) =>
        qualifiesRole(resolution.role, consensus.requirement.minimumRole) &&
        !qualifiedRejectingReviewers.has(resolution.resolver),
    )
    const coveredQualifiedRejectingReviewIDs = new Set<string>()
    const qualifiedRejectingReviewIDSet = new Set(qualifiedRejectingReviews.map((review) => review.reviewID))

    for (const resolution of qualifyingResolutions) {
      for (const review of resolution.targetReviews) {
        if (qualifiedRejectingReviewIDSet.has(review.reviewID)) {
          coveredQualifiedRejectingReviewIDs.add(review.reviewID)
        }
      }
    }

    return {
      qualifyingResolutions,
      coveredReviewIDs: coveredQualifiedRejectingReviewIDs,
      totalQualifiedRejectingReviews: qualifiedRejectingReviews.length,
      distinctQualifiedRejectingReviewers: new Set(qualifiedRejectingReviews.map((review) => review.reviewer)).size,
    }
  }

  export function evaluate(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    resolutions: ResolutionArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    const analysis = coveredQualifiedRejectingReviewIDs(bundle, reviews, resolutions)

    const coverageSatisfied = analysis.coveredReviewIDs.size === analysis.totalQualifiedRejectingReviews
    const hasIndependentResolver =
      analysis.totalQualifiedRejectingReviews === 0 || analysis.qualifyingResolutions.length > 0
    const gates = [
      {
        name: "qualified-rejection-coverage",
        status: coverageSatisfied ? "pass" : "fail",
        detail:
          analysis.totalQualifiedRejectingReviews === 0
            ? "no qualified rejecting reviews present"
            : `${analysis.coveredReviewIDs.size}/${analysis.totalQualifiedRejectingReviews} qualified rejecting review(s) explicitly resolved`,
      },
      {
        name: "independent-dissent-resolver",
        status: hasIndependentResolver ? "pass" : "fail",
        detail:
          analysis.totalQualifiedRejectingReviews === 0
            ? "no independent resolver required"
            : hasIndependentResolver
              ? `${new Set(analysis.qualifyingResolutions.map((resolution) => resolution.resolver)).size} independent qualifying resolver(s) present`
              : "no independent qualifying resolver present",
      },
    ] as const

    return ResolutionSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      adoptionStatus: consensus.adoptionStatus,
      requiredRole: consensus.requirement.minimumRole,
      totalResolutions: resolutions.length,
      qualifyingResolutions: analysis.qualifyingResolutions.length,
      distinctQualifyingResolvers: new Set(analysis.qualifyingResolutions.map((resolution) => resolution.resolver))
        .size,
      totalQualifiedRejectingReviews: analysis.totalQualifiedRejectingReviews,
      coveredQualifiedRejectingReviews: analysis.coveredReviewIDs.size,
      unresolvedQualifiedRejectingReviews: Math.max(
        0,
        analysis.totalQualifiedRejectingReviews - analysis.coveredReviewIDs.size,
      ),
      distinctQualifiedRejectingReviewers: analysis.distinctQualifiedRejectingReviewers,
      gates,
    })
  }

  export async function resolveForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    resolutions: ResolutionArtifact[] = [],
  ) {
    const persisted = (await list(bundle.source)).filter((resolution) => matchesBundle(bundle, resolution))
    const deduped = new Map<string, ResolutionArtifact>()
    for (const resolution of [...persisted, ...resolutions]) {
      if (!matchesBundle(bundle, resolution)) continue
      deduped.set(resolution.resolutionID, resolution)
    }
    return sort([...deduped.values()])
  }

  export async function get(input: { source: string; resolutionID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.resolutionID))
    return ResolutionRecord.parse(record)
  }

  export async function append(resolution: ResolutionArtifact) {
    const next = ResolutionRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-resolution-record",
      resolution,
    })
    try {
      const existing = await get({ source: resolution.source, resolutionID: resolution.resolutionID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Adoption dissent resolution ${resolution.resolutionID} already exists for source ${resolution.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(resolution.source, resolution.resolutionID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source
      ? [["quality_model_adoption_dissent_resolution", encode(source)]]
      : [["quality_model_adoption_dissent_resolution"]]
    const resolutions: ResolutionArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const resolutionID = parts[parts.length - 1]
        if (!encodedSource || !resolutionID) continue
        const record = await get({ source: decode(encodedSource), resolutionID })
        resolutions.push(record.resolution)
      }
    }

    return sort(resolutions)
  }

  export async function assertPersisted(resolution: ResolutionArtifact) {
    const persisted = await get({ source: resolution.source, resolutionID: resolution.resolutionID })
    const prev = JSON.stringify(persisted.resolution)
    const curr = JSON.stringify(resolution)
    if (prev !== curr) {
      throw new Error(
        `Persisted adoption dissent resolution ${resolution.resolutionID} does not match the provided artifact`,
      )
    }
    return persisted
  }

  export function renderReport(resolution: ResolutionArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent resolution")
    lines.push("")
    lines.push(`- source: ${resolution.source}`)
    lines.push(`- resolution id: ${resolution.resolutionID}`)
    lines.push(`- resolved at: ${resolution.resolvedAt}`)
    lines.push(`- resolver: ${resolution.resolver}`)
    lines.push(`- role: ${resolution.role ?? "n/a"}`)
    lines.push(`- rationale: ${resolution.rationale}`)
    lines.push(`- decision bundle created at: ${resolution.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${resolution.decisionBundle.digest}`)
    lines.push(`- suggestion digest: ${resolution.suggestion.digest}`)
    lines.push(`- suggestion adoption status: ${resolution.suggestion.adoptionStatus}`)
    lines.push(`- target reviews: ${resolution.targetReviews.length}`)
    lines.push("")
    for (const target of resolution.targetReviews) {
      lines.push(`- target review: ${target.reviewID} · ${target.reviewer} · ${target.reviewedAt}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ResolutionSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent resolution")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- adoption status: ${summary.adoptionStatus}`)
    lines.push(`- required role: ${summary.requiredRole ?? "none"}`)
    lines.push(`- total resolutions considered: ${summary.totalResolutions}`)
    lines.push(`- qualifying resolutions: ${summary.qualifyingResolutions}`)
    lines.push(`- distinct qualifying resolvers: ${summary.distinctQualifyingResolvers}`)
    lines.push(`- qualified rejecting reviews: ${summary.totalQualifiedRejectingReviews}`)
    lines.push(`- covered qualified rejecting reviews: ${summary.coveredQualifiedRejectingReviews}`)
    lines.push(`- unresolved qualified rejecting reviews: ${summary.unresolvedQualifiedRejectingReviews}`)
    lines.push(`- distinct qualified rejecting reviewers: ${summary.distinctQualifiedRejectingReviewers}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
