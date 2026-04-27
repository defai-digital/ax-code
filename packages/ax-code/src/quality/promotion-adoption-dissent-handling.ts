import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAdoptionDissentResolution } from "./promotion-adoption-dissent-resolution"
import { QualityPromotionAdoptionDissentSupersession } from "./promotion-adoption-dissent-supersession"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionAdoptionDissentHandling {
  export const QualifiedRejectingReview = z.object({
    reviewID: z.string(),
    reviewer: z.string(),
    role: z.string().nullable(),
    reviewedAt: z.string(),
  })
  export type QualifiedRejectingReview = z.output<typeof QualifiedRejectingReview>

  export const HandlingSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    requiredRole: QualityPromotionApprovalPolicy.ApprovalRole.nullable(),
    totalQualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
    unresolvedQualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredByResolution: z.number().int().nonnegative(),
    coveredBySupersession: z.number().int().nonnegative(),
    coveredByBoth: z.number().int().nonnegative(),
    totalResolutions: z.number().int().nonnegative(),
    qualifyingResolutions: z.number().int().nonnegative(),
    totalSupersessions: z.number().int().nonnegative(),
    qualifyingSupersessions: z.number().int().nonnegative(),
    resolutionSummary: z.lazy(() => QualityPromotionAdoptionDissentResolution.ResolutionSummary),
    supersessionSummary: z.lazy(() => QualityPromotionAdoptionDissentSupersession.SupersessionSummary),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type HandlingSummary = z.output<typeof HandlingSummary>

  export const HandlingArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-handling"),
    handlingID: z.string(),
    source: z.string(),
    handledAt: z.string(),
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
    qualifiedRejectingReviews: z.array(QualifiedRejectingReview),
    resolutions: z.array(z.lazy(() => QualityPromotionAdoptionDissentResolution.ResolutionArtifact)),
    supersessions: z.array(z.lazy(() => QualityPromotionAdoptionDissentSupersession.SupersessionArtifact)),
    summary: HandlingSummary,
  })
  export type HandlingArtifact = z.output<typeof HandlingArtifact>

  export const HandlingRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-adoption-dissent-handling-record"),
    handling: HandlingArtifact,
  })
  export type HandlingRecord = z.output<typeof HandlingRecord>

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

  function key(source: string, handlingID: string) {
    return ["quality_model_adoption_dissent_handling", encode(source), handlingID]
  }

  function sortArtifacts(artifacts: HandlingArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const byHandledAt = a.handledAt.localeCompare(b.handledAt)
      if (byHandledAt !== 0) return byHandledAt
      return a.handlingID.localeCompare(b.handlingID)
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

  function matchesBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle, handling: HandlingArtifact) {
    return (
      handling.decisionBundle.digest === QualityPromotionAdoptionReview.decisionBundleDigest(bundle) &&
      handling.decisionBundle.createdAt === bundle.createdAt &&
      handling.suggestion.digest === QualityPromotionAdoptionReview.suggestionDigest(bundle)
    )
  }

  export function qualifiedRejectingReviews(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    return [...reviews]
      .filter(
        (review) => review.disposition === "rejected" && qualifiesRole(review.role, consensus.requirement.minimumRole),
      )
      .map((review) =>
        QualifiedRejectingReview.parse({
          reviewID: review.reviewID,
          reviewer: review.reviewer,
          role: review.role,
          reviewedAt: review.reviewedAt,
        }),
      )
      .sort((a, b) => {
        const byReviewedAt = a.reviewedAt.localeCompare(b.reviewedAt)
        if (byReviewedAt !== 0) return byReviewedAt
        return a.reviewID.localeCompare(b.reviewID)
      })
  }

  export function evaluate(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    resolutions: QualityPromotionAdoptionDissentResolution.ResolutionArtifact[],
    supersessions: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[],
  ) {
    const consensus = QualityPromotionAdoptionReview.evaluate(bundle, reviews)
    const resolutionSummary = QualityPromotionAdoptionDissentResolution.evaluate(bundle, reviews, resolutions)
    const supersessionSummary = QualityPromotionAdoptionDissentSupersession.evaluate(bundle, reviews, supersessions)
    const coveredByResolution = QualityPromotionAdoptionDissentResolution.coveredQualifiedRejectingReviewIDs(
      bundle,
      reviews,
      resolutions,
    ).coveredReviewIDs
    const coveredBySupersession = QualityPromotionAdoptionDissentSupersession.coveredQualifiedRejectingReviewIDs(
      bundle,
      reviews,
      supersessions,
    ).coveredReviewIDs
    const coveredQualifiedRejectingReviews = new Set([...coveredByResolution, ...coveredBySupersession])
    const coverageSatisfied = coveredQualifiedRejectingReviews.size === consensus.qualifiedRejectingReviews
    const hasHandlingArtifacts =
      consensus.qualifiedRejectingReviews === 0 ||
      resolutionSummary.qualifyingResolutions > 0 ||
      supersessionSummary.qualifyingSupersessions > 0
    const overlapCount = [...coveredByResolution].filter((reviewID) => coveredBySupersession.has(reviewID)).length
    const gates = [
      {
        name: "qualified-rejection-dissent-handling-coverage",
        status: coverageSatisfied ? "pass" : "fail",
        detail:
          consensus.qualifiedRejectingReviews === 0
            ? "no qualified rejecting reviews present"
            : `${coveredQualifiedRejectingReviews.size}/${consensus.qualifiedRejectingReviews} qualified rejecting review(s) resolved or superseded`,
      },
      {
        name: "dissent-handling-artifacts-present",
        status: hasHandlingArtifacts ? "pass" : "fail",
        detail:
          consensus.qualifiedRejectingReviews === 0
            ? "no dissent-handling artifacts required"
            : hasHandlingArtifacts
              ? `${resolutionSummary.qualifyingResolutions} qualifying resolution(s) and ${supersessionSummary.qualifyingSupersessions} qualifying supersession(s) present`
              : "no qualifying dissent-handling artifacts present",
      },
    ] as const

    return HandlingSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      adoptionStatus: consensus.adoptionStatus,
      requiredRole: consensus.requirement.minimumRole,
      totalQualifiedRejectingReviews: consensus.qualifiedRejectingReviews,
      coveredQualifiedRejectingReviews: coveredQualifiedRejectingReviews.size,
      unresolvedQualifiedRejectingReviews: Math.max(
        0,
        consensus.qualifiedRejectingReviews - coveredQualifiedRejectingReviews.size,
      ),
      coveredByResolution: coveredByResolution.size,
      coveredBySupersession: coveredBySupersession.size,
      coveredByBoth: overlapCount,
      totalResolutions: resolutions.length,
      qualifyingResolutions: resolutionSummary.qualifyingResolutions,
      totalSupersessions: supersessions.length,
      qualifyingSupersessions: supersessionSummary.qualifyingSupersessions,
      resolutionSummary,
      supersessionSummary,
      gates,
    })
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[]
    resolutions?: QualityPromotionAdoptionDissentResolution.ResolutionArtifact[]
    supersessions?: QualityPromotionAdoptionDissentSupersession.SupersessionArtifact[]
  }) {
    const handledAt = new Date().toISOString()
    const handlingID = `${Date.now()}-${encode(input.bundle.source)}-dissent-handling`
    const suggestion =
      input.bundle.approvalPolicySuggestion ??
      QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle)
    const resolutions = input.resolutions ?? []
    const supersessions = input.supersessions ?? []
    for (const resolution of resolutions) {
      const reasons = QualityPromotionAdoptionDissentResolution.verify(input.bundle, resolution)
      if (reasons.length > 0) {
        throw new Error(
          `Cannot create dissent handling bundle for ${input.bundle.source}: invalid dissent resolution (${reasons[0]})`,
        )
      }
    }
    for (const supersession of supersessions) {
      const reasons = QualityPromotionAdoptionDissentSupersession.verify(input.bundle, supersession)
      if (reasons.length > 0) {
        throw new Error(
          `Cannot create dissent handling bundle for ${input.bundle.source}: invalid dissent supersession (${reasons[0]})`,
        )
      }
    }
    const summary = evaluate(input.bundle, input.reviews, resolutions, supersessions)

    return HandlingArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-handling",
      handlingID,
      source: input.bundle.source,
      handledAt,
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
      qualifiedRejectingReviews: qualifiedRejectingReviews(input.bundle, input.reviews),
      resolutions,
      supersessions,
      summary,
    })
  }

  export function verify(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    handling: HandlingArtifact,
  ) {
    const reasons: string[] = []
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (handling.source !== bundle.source) {
      reasons.push(`dissent handling source mismatch: ${handling.source} vs ${bundle.source}`)
    }
    if (handling.decisionBundle.source !== bundle.source) {
      reasons.push(
        `dissent handling decision bundle source mismatch: ${handling.decisionBundle.source} vs ${bundle.source}`,
      )
    }
    if (handling.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(
        `dissent handling decision bundle createdAt mismatch: ${handling.decisionBundle.createdAt} vs ${bundle.createdAt}`,
      )
    }
    if (handling.decisionBundle.digest !== QualityPromotionAdoptionReview.decisionBundleDigest(bundle)) {
      reasons.push(`dissent handling decision bundle digest mismatch for ${bundle.source}`)
    }
    if (handling.suggestion.digest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
      reasons.push(`dissent handling suggestion digest mismatch for ${bundle.source}`)
    }
    if (handling.suggestion.adoptionStatus !== suggestion.adoption.status) {
      reasons.push(
        `dissent handling adoption status mismatch: ${handling.suggestion.adoptionStatus} vs ${suggestion.adoption.status}`,
      )
    }
    for (const resolution of handling.resolutions) {
      const resolutionReasons = QualityPromotionAdoptionDissentResolution.verify(bundle, resolution)
      if (resolutionReasons.length > 0) {
        reasons.push(
          `dissent handling contains invalid resolution ${resolution.resolutionID} (${resolutionReasons[0]})`,
        )
      }
    }
    for (const supersession of handling.supersessions) {
      const supersessionReasons = QualityPromotionAdoptionDissentSupersession.verify(bundle, supersession)
      if (supersessionReasons.length > 0) {
        reasons.push(
          `dissent handling contains invalid supersession ${supersession.supersessionID} (${supersessionReasons[0]})`,
        )
      }
    }
    const expectedQualifiedRejectingReviews = qualifiedRejectingReviews(bundle, reviews)
    if (JSON.stringify(handling.qualifiedRejectingReviews) !== JSON.stringify(expectedQualifiedRejectingReviews)) {
      reasons.push(`dissent handling qualified rejecting review snapshot mismatch for ${bundle.source}`)
    }
    const expectedSummary = evaluate(bundle, reviews, handling.resolutions, handling.supersessions)
    if (JSON.stringify(handling.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`dissent handling summary mismatch for ${bundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    reviews: QualityPromotionAdoptionReview.ReviewArtifact[],
    handlings: HandlingArtifact[] = [],
  ) {
    const persisted = (await list(bundle.source)).filter((handling) => matchesBundle(bundle, handling))
    const deduped = new Map<string, HandlingArtifact>()
    for (const handling of [...persisted, ...handlings]) {
      if (!matchesBundle(bundle, handling)) continue
      if (verify(bundle, reviews, handling).length > 0) continue
      deduped.set(handling.handlingID, handling)
    }
    return sortArtifacts([...deduped.values()])
  }

  export async function get(input: { source: string; handlingID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.handlingID))
    return HandlingRecord.parse(record)
  }

  export async function append(handling: HandlingArtifact) {
    const next = HandlingRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-adoption-dissent-handling-record",
      handling,
    })
    try {
      const existing = await get({ source: handling.source, handlingID: handling.handlingID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Adoption dissent handling ${handling.handlingID} already exists for source ${handling.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(handling.source, handling.handlingID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source
      ? [["quality_model_adoption_dissent_handling", encode(source)]]
      : [["quality_model_adoption_dissent_handling"]]
    const handlings: HandlingArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const handlingID = parts[parts.length - 1]
        if (!encodedSource || !handlingID) continue
        const record = await get({ source: decode(encodedSource), handlingID })
        handlings.push(record.handling)
      }
    }

    return sortArtifacts(handlings)
  }

  export async function assertPersisted(handling: HandlingArtifact) {
    const persisted = await get({ source: handling.source, handlingID: handling.handlingID })
    const prev = JSON.stringify(persisted.handling)
    const curr = JSON.stringify(handling)
    if (prev !== curr) {
      throw new Error(`Persisted adoption dissent handling ${handling.handlingID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(handling: HandlingArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent handling")
    lines.push("")
    lines.push(`- source: ${handling.source}`)
    lines.push(`- handling id: ${handling.handlingID}`)
    lines.push(`- handled at: ${handling.handledAt}`)
    lines.push(`- decision bundle created at: ${handling.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${handling.decisionBundle.digest}`)
    lines.push(`- suggestion digest: ${handling.suggestion.digest}`)
    lines.push(`- suggestion adoption status: ${handling.suggestion.adoptionStatus}`)
    lines.push(`- qualified rejecting reviews: ${handling.qualifiedRejectingReviews.length}`)
    lines.push(`- dissent resolutions: ${handling.resolutions.length}`)
    lines.push(`- dissent supersessions: ${handling.supersessions.length}`)
    lines.push(`- overall status: ${handling.summary.overallStatus}`)
    lines.push(
      `- covered qualified rejecting reviews: ${handling.summary.coveredQualifiedRejectingReviews}/${handling.summary.totalQualifiedRejectingReviews}`,
    )
    lines.push("")
    for (const review of handling.qualifiedRejectingReviews) {
      lines.push(`- qualified rejecting review: ${review.reviewID} · ${review.reviewer} · ${review.reviewedAt}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: HandlingSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion adoption dissent handling")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- adoption status: ${summary.adoptionStatus}`)
    lines.push(`- required role: ${summary.requiredRole ?? "none"}`)
    lines.push(`- qualified rejecting reviews: ${summary.totalQualifiedRejectingReviews}`)
    lines.push(`- covered qualified rejecting reviews: ${summary.coveredQualifiedRejectingReviews}`)
    lines.push(`- unresolved qualified rejecting reviews: ${summary.unresolvedQualifiedRejectingReviews}`)
    lines.push(`- covered by resolution: ${summary.coveredByResolution}`)
    lines.push(`- covered by supersession: ${summary.coveredBySupersession}`)
    lines.push(`- covered by both paths: ${summary.coveredByBoth}`)
    lines.push(`- qualifying resolutions: ${summary.qualifyingResolutions}/${summary.totalResolutions}`)
    lines.push(`- qualifying supersessions: ${summary.qualifyingSupersessions}/${summary.totalSupersessions}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
