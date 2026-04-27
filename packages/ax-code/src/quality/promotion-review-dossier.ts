import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionSubmissionBundle } from "./promotion-submission-bundle"

export namespace QualityPromotionReviewDossier {
  export const Recommendation = z.enum(["approve_promotion", "requires_override_review", "hold"])
  export type Recommendation = z.output<typeof Recommendation>

  export const DossierSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    recommendation: Recommendation,
    submissionStatus: z.enum(["pass", "fail"]),
    approvalPacketStatus: z.enum(["pass", "fail"]),
    eligibilityDecision: z.enum(["go", "review", "no_go"]),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    benchmarkStatus: z.enum(["pass", "warn", "fail"]),
    stabilityStatus: z.enum(["pass", "warn", "fail"]),
    approvalPolicyStatus: z.enum(["pass", "fail"]),
    adoptionReviewConsensusStatus: z.enum(["pass", "fail"]),
    dissentHandlingStatus: z.enum(["pass", "fail"]),
    approvalCount: z.number().int().nonnegative(),
    adoptionReviewCount: z.number().int().nonnegative(),
    qualifiedRejectingReviews: z.number().int().nonnegative(),
    coveredQualifiedRejectingReviews: z.number().int().nonnegative(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type DossierSummary = z.output<typeof DossierSummary>

  export const DossierArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-review-dossier"),
    dossierID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    submissionBundle: z.lazy(() => QualityPromotionSubmissionBundle.BundleArtifact),
    summary: DossierSummary,
  })
  export type DossierArtifact = z.output<typeof DossierArtifact>

  export const DossierRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-review-dossier-record"),
    dossier: DossierArtifact,
  })
  export type DossierRecord = z.output<typeof DossierRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, dossierID: string) {
    return ["quality_model_review_dossier", encode(source), dossierID]
  }

  function sortDossiers(dossiers: DossierArtifact[]) {
    return [...dossiers].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.dossierID.localeCompare(b.dossierID)
    })
  }

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionSubmissionBundle.BundleArtifact["decisionBundle"],
    dossier: DossierArtifact,
  ) {
    return (
      dossier.submissionBundle.decisionBundle.createdAt === decisionBundle.createdAt &&
      dossier.submissionBundle.decisionBundle.source === decisionBundle.source &&
      JSON.stringify(dossier.submissionBundle.decisionBundle) === JSON.stringify(decisionBundle)
    )
  }

  function recommendationForSubmission(summary: QualityPromotionSubmissionBundle.SubmissionSummary): Recommendation {
    if (summary.requiredOverride === "none") return "approve_promotion"
    if (summary.requiredOverride === "allow_warn") return "requires_override_review"
    return "hold"
  }

  function evaluateSummary(submissionBundle: QualityPromotionSubmissionBundle.BundleArtifact) {
    const readiness = submissionBundle.approvalPacket.readiness
    const gates = [
      {
        name: "submission-readiness",
        status: submissionBundle.summary.overallStatus,
        detail:
          submissionBundle.summary.overallStatus === "pass"
            ? `submission bundle ${submissionBundle.submissionID} is ready`
            : (submissionBundle.summary.gates.find((gate) => gate.status === "fail")?.detail ??
              "submission bundle not ready"),
      },
      {
        name: "approval-policy",
        status: readiness.approvalPolicyStatus,
        detail:
          readiness.approvalPolicyStatus === "pass"
            ? `approval policy satisfied with ${readiness.totalApprovals} approval(s)`
            : (readiness.gates.find((gate) => gate.name === "approval-policy" && gate.status === "fail")?.detail ??
              "approval policy not satisfied"),
      },
      {
        name: "adoption-review-consensus",
        status: readiness.adoptionReviewConsensusStatus,
        detail:
          readiness.adoptionReviewConsensusStatus === "pass"
            ? `adoption review consensus satisfied with ${readiness.totalAdoptionReviews} review(s)`
            : (readiness.gates.find((gate) => gate.name === "adoption-review-consensus" && gate.status === "fail")
                ?.detail ?? "adoption review consensus not satisfied"),
      },
      {
        name: "dissent-handling",
        status: readiness.dissentHandlingStatus,
        detail:
          readiness.dissentHandlingStatus === "pass"
            ? `${readiness.coveredQualifiedRejectingReviews}/${readiness.qualifiedRejectingReviews} qualified rejecting review(s) covered`
            : (readiness.gates.find((gate) => gate.name === "adoption-dissent-handling" && gate.status === "fail")
                ?.detail ?? "dissent handling not satisfied"),
      },
    ] as const

    return DossierSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      recommendation: recommendationForSubmission(submissionBundle.summary),
      submissionStatus: submissionBundle.summary.overallStatus,
      approvalPacketStatus: submissionBundle.summary.approvalPacketStatus,
      eligibilityDecision: submissionBundle.summary.eligibilityDecision,
      requiredOverride: submissionBundle.summary.requiredOverride,
      benchmarkStatus: submissionBundle.summary.benchmarkStatus,
      stabilityStatus: submissionBundle.summary.stabilityStatus,
      approvalPolicyStatus: readiness.approvalPolicyStatus,
      adoptionReviewConsensusStatus: readiness.adoptionReviewConsensusStatus,
      dissentHandlingStatus: readiness.dissentHandlingStatus,
      approvalCount: submissionBundle.summary.approvalCount,
      adoptionReviewCount: submissionBundle.summary.adoptionReviewCount,
      qualifiedRejectingReviews: readiness.qualifiedRejectingReviews,
      coveredQualifiedRejectingReviews: readiness.coveredQualifiedRejectingReviews,
      gates,
    })
  }

  export function create(input: { submissionBundle: QualityPromotionSubmissionBundle.BundleArtifact }) {
    const createdAt = new Date().toISOString()
    const dossierID = `${Date.now()}-${encode(input.submissionBundle.source)}-review-dossier`
    const submissionReasons = QualityPromotionSubmissionBundle.verify(
      input.submissionBundle.decisionBundle,
      input.submissionBundle,
    )
    if (submissionReasons.length > 0) {
      throw new Error(
        `Cannot create promotion review dossier for ${input.submissionBundle.source}: invalid submission bundle (${submissionReasons[0]})`,
      )
    }
    const summary = evaluateSummary(input.submissionBundle)
    return DossierArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-review-dossier",
      dossierID,
      source: input.submissionBundle.source,
      createdAt,
      submissionBundle: input.submissionBundle,
      summary,
    })
  }

  export function verify(
    decisionBundle: QualityPromotionSubmissionBundle.BundleArtifact["decisionBundle"],
    dossier: DossierArtifact,
  ) {
    const reasons: string[] = []
    if (dossier.source !== decisionBundle.source) {
      reasons.push(`review dossier source mismatch: ${dossier.source} vs ${decisionBundle.source}`)
    }
    if (JSON.stringify(dossier.submissionBundle.decisionBundle) !== JSON.stringify(decisionBundle)) {
      reasons.push(`review dossier decision bundle mismatch for ${decisionBundle.source}`)
    }
    const submissionReasons = QualityPromotionSubmissionBundle.verify(decisionBundle, dossier.submissionBundle)
    if (submissionReasons.length > 0) {
      reasons.push(`review dossier submission bundle mismatch for ${decisionBundle.source} (${submissionReasons[0]})`)
    }
    const expectedSummary = evaluateSummary(dossier.submissionBundle)
    if (JSON.stringify(dossier.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`review dossier summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionSubmissionBundle.BundleArtifact["decisionBundle"],
    dossiers: DossierArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((dossier) =>
      matchesDecisionBundle(decisionBundle, dossier),
    )
    const deduped = new Map<string, DossierArtifact>()
    for (const dossier of [...persisted, ...dossiers]) {
      if (!matchesDecisionBundle(decisionBundle, dossier)) continue
      if (verify(decisionBundle, dossier).length > 0) continue
      deduped.set(dossier.dossierID, dossier)
    }
    return sortDossiers([...deduped.values()])
  }

  export async function get(input: { source: string; dossierID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.dossierID))
    return DossierRecord.parse(record)
  }

  export async function append(dossier: DossierArtifact) {
    await QualityPromotionSubmissionBundle.append(dossier.submissionBundle)
    const next = DossierRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-review-dossier-record",
      dossier,
    })
    try {
      const existing = await get({ source: dossier.source, dossierID: dossier.dossierID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion review dossier ${dossier.dossierID} already exists for source ${dossier.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(dossier.source, dossier.dossierID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_review_dossier", encode(source)]] : [["quality_model_review_dossier"]]
    const dossiers: DossierArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const dossierID = parts[parts.length - 1]
        if (!encodedSource || !dossierID) continue
        const record = await get({ source: decode(encodedSource), dossierID })
        dossiers.push(record.dossier)
      }
    }

    return sortDossiers(dossiers)
  }

  export async function assertPersisted(dossier: DossierArtifact) {
    await QualityPromotionSubmissionBundle.assertPersisted(dossier.submissionBundle)
    const persisted = await get({ source: dossier.source, dossierID: dossier.dossierID })
    const prev = JSON.stringify(persisted.dossier)
    const curr = JSON.stringify(dossier)
    if (prev !== curr) {
      throw new Error(`Persisted promotion review dossier ${dossier.dossierID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(dossier: DossierArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion review dossier")
    lines.push("")
    lines.push(`- source: ${dossier.source}`)
    lines.push(`- dossier id: ${dossier.dossierID}`)
    lines.push(`- created at: ${dossier.createdAt}`)
    lines.push(`- submission id: ${dossier.submissionBundle.submissionID}`)
    lines.push(`- approval packet id: ${dossier.submissionBundle.approvalPacket.packetID}`)
    lines.push(`- recommendation: ${dossier.summary.recommendation}`)
    lines.push(`- overall status: ${dossier.summary.overallStatus}`)
    lines.push(`- submission status: ${dossier.summary.submissionStatus}`)
    lines.push(`- approval packet status: ${dossier.summary.approvalPacketStatus}`)
    lines.push(`- eligibility decision: ${dossier.summary.eligibilityDecision}`)
    lines.push(`- required override: ${dossier.summary.requiredOverride}`)
    lines.push(`- benchmark status: ${dossier.summary.benchmarkStatus}`)
    lines.push(`- stability status: ${dossier.summary.stabilityStatus}`)
    lines.push(`- approval count: ${dossier.summary.approvalCount}`)
    lines.push(`- adoption review count: ${dossier.summary.adoptionReviewCount}`)
    lines.push("")
    for (const gate of dossier.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: DossierSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion review dossier summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- recommendation: ${summary.recommendation}`)
    lines.push(`- submission status: ${summary.submissionStatus}`)
    lines.push(`- approval packet status: ${summary.approvalPacketStatus}`)
    lines.push(`- eligibility decision: ${summary.eligibilityDecision}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- benchmark status: ${summary.benchmarkStatus}`)
    lines.push(`- stability status: ${summary.stabilityStatus}`)
    lines.push(`- approval policy status: ${summary.approvalPolicyStatus}`)
    lines.push(`- adoption review consensus status: ${summary.adoptionReviewConsensusStatus}`)
    lines.push(`- dissent handling status: ${summary.dissentHandlingStatus}`)
    lines.push(`- approval count: ${summary.approvalCount}`)
    lines.push(`- adoption review count: ${summary.adoptionReviewCount}`)
    lines.push(`- qualified rejecting reviews: ${summary.qualifiedRejectingReviews}`)
    lines.push(`- covered qualified rejecting reviews: ${summary.coveredQualifiedRejectingReviews}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
