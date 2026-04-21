import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionApprovalPacket } from "./promotion-approval-packet"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionSubmissionBundle {
  export const SubmissionSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    approvalPacketStatus: z.enum(["pass", "fail"]),
    eligibilityDecision: z.enum(["go", "review", "no_go"]),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    benchmarkStatus: z.enum(["pass", "warn", "fail"]),
    stabilityStatus: z.enum(["pass", "warn", "fail"]),
    approvalCount: z.number().int().nonnegative(),
    adoptionReviewCount: z.number().int().nonnegative(),
    hasDissentHandling: z.boolean(),
    gates: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      detail: z.string(),
    })),
  })
  export type SubmissionSummary = z.output<typeof SubmissionSummary>

  export const BundleArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-submission-bundle"),
    submissionID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    decisionBundle: z.lazy(() => QualityPromotionDecisionBundle.DecisionBundle),
    approvalPacket: z.lazy(() => QualityPromotionApprovalPacket.PacketArtifact),
    summary: SubmissionSummary,
  })
  export type BundleArtifact = z.output<typeof BundleArtifact>

  export const BundleRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-submission-bundle-record"),
    submission: BundleArtifact,
  })
  export type BundleRecord = z.output<typeof BundleRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, submissionID: string) {
    return ["quality_model_submission_bundle", encode(source), submissionID]
  }

  function sortBundles(bundles: BundleArtifact[]) {
    return [...bundles].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.submissionID.localeCompare(b.submissionID)
    })
  }

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    submission: BundleArtifact,
  ) {
    return (
      submission.decisionBundle.createdAt === decisionBundle.createdAt &&
      submission.decisionBundle.source === decisionBundle.source &&
      JSON.stringify(submission.decisionBundle) === JSON.stringify(decisionBundle)
    )
  }

  function evaluateSummary(input: {
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle
    approvalPacket: QualityPromotionApprovalPacket.PacketArtifact
  }) {
    const gates = [
      {
        name: "approval-packet-readiness",
        status: input.approvalPacket.readiness.overallStatus,
        detail: input.approvalPacket.readiness.overallStatus === "pass"
          ? `approval packet ${input.approvalPacket.packetID} is ready`
          : input.approvalPacket.readiness.gates.find((gate) => gate.status === "fail")?.detail ?? "approval packet not ready",
      },
      {
        name: "decision-bundle-alignment",
        status: "pass" as const,
        detail: `decision=${input.decisionBundle.eligibility.decision} requiredOverride=${input.decisionBundle.eligibility.requiredOverride}`,
      },
    ] as const

    return SubmissionSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      approvalPacketStatus: input.approvalPacket.readiness.overallStatus,
      eligibilityDecision: input.decisionBundle.eligibility.decision,
      requiredOverride: input.decisionBundle.eligibility.requiredOverride,
      benchmarkStatus: input.decisionBundle.eligibility.benchmarkStatus,
      stabilityStatus: input.decisionBundle.eligibility.stabilityStatus,
      approvalCount: input.approvalPacket.approvals.length,
      adoptionReviewCount: input.approvalPacket.adoptionReviews.length,
      hasDissentHandling: !!input.approvalPacket.dissentHandling,
      gates,
    })
  }

  export function create(input: {
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle
    approvalPacket: QualityPromotionApprovalPacket.PacketArtifact
  }) {
    const createdAt = new Date().toISOString()
    const submissionID = `${Date.now()}-${encode(input.decisionBundle.source)}-submission`
    const packetReasons = QualityPromotionApprovalPacket.verify(input.decisionBundle, input.approvalPacket)
    if (packetReasons.length > 0) {
      throw new Error(`Cannot create promotion submission bundle for ${input.decisionBundle.source}: invalid approval packet (${packetReasons[0]})`)
    }
    const summary = evaluateSummary(input)
    return BundleArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-submission-bundle",
      submissionID,
      source: input.decisionBundle.source,
      createdAt,
      decisionBundle: input.decisionBundle,
      approvalPacket: input.approvalPacket,
      summary,
    })
  }

  export function verify(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    submission: BundleArtifact,
  ) {
    const reasons: string[] = []
    if (submission.source !== decisionBundle.source) {
      reasons.push(`submission bundle source mismatch: ${submission.source} vs ${decisionBundle.source}`)
    }
    if (JSON.stringify(submission.decisionBundle) !== JSON.stringify(decisionBundle)) {
      reasons.push(`submission bundle decision bundle mismatch for ${decisionBundle.source}`)
    }
    const packetReasons = QualityPromotionApprovalPacket.verify(decisionBundle, submission.approvalPacket)
    if (packetReasons.length > 0) {
      reasons.push(`submission bundle approval packet mismatch for ${decisionBundle.source} (${packetReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      decisionBundle,
      approvalPacket: submission.approvalPacket,
    })
    if (JSON.stringify(submission.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`submission bundle summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    submissions: BundleArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((submission) => matchesDecisionBundle(decisionBundle, submission))
    const deduped = new Map<string, BundleArtifact>()
    for (const submission of [...persisted, ...submissions]) {
      if (!matchesDecisionBundle(decisionBundle, submission)) continue
      if (verify(decisionBundle, submission).length > 0) continue
      deduped.set(submission.submissionID, submission)
    }
    return sortBundles([...deduped.values()])
  }

  export async function get(input: { source: string; submissionID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.submissionID))
    return BundleRecord.parse(record)
  }

  export async function append(submission: BundleArtifact) {
    await QualityPromotionApprovalPacket.append(submission.approvalPacket)
    const next = BundleRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-submission-bundle-record",
      submission,
    })
    try {
      const existing = await get({ source: submission.source, submissionID: submission.submissionID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion submission bundle ${submission.submissionID} already exists for source ${submission.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(submission.source, submission.submissionID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_submission_bundle", encode(source)]] : [["quality_model_submission_bundle"]]
    const submissions: BundleArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const submissionID = parts[parts.length - 1]
        if (!encodedSource || !submissionID) continue
        const record = await get({ source: decode(encodedSource), submissionID })
        submissions.push(record.submission)
      }
    }

    return sortBundles(submissions)
  }

  export async function assertPersisted(submission: BundleArtifact) {
    await QualityPromotionApprovalPacket.assertPersisted(submission.approvalPacket)
    const persisted = await get({ source: submission.source, submissionID: submission.submissionID })
    const prev = JSON.stringify(persisted.submission)
    const curr = JSON.stringify(submission)
    if (prev !== curr) {
      throw new Error(`Persisted promotion submission bundle ${submission.submissionID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(submission: BundleArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion submission bundle")
    lines.push("")
    lines.push(`- source: ${submission.source}`)
    lines.push(`- submission id: ${submission.submissionID}`)
    lines.push(`- created at: ${submission.createdAt}`)
    lines.push(`- decision bundle created at: ${submission.decisionBundle.createdAt}`)
    lines.push(`- approval packet id: ${submission.approvalPacket.packetID}`)
    lines.push(`- eligibility decision: ${submission.summary.eligibilityDecision}`)
    lines.push(`- required override: ${submission.summary.requiredOverride}`)
    lines.push(`- benchmark status: ${submission.summary.benchmarkStatus}`)
    lines.push(`- stability status: ${submission.summary.stabilityStatus}`)
    lines.push(`- approval count: ${submission.summary.approvalCount}`)
    lines.push(`- adoption review count: ${submission.summary.adoptionReviewCount}`)
    lines.push(`- dissent handling included: ${submission.summary.hasDissentHandling}`)
    lines.push(`- overall status: ${submission.summary.overallStatus}`)
    lines.push("")
    for (const gate of submission.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: SubmissionSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion submission readiness")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- approval packet status: ${summary.approvalPacketStatus}`)
    lines.push(`- eligibility decision: ${summary.eligibilityDecision}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- benchmark status: ${summary.benchmarkStatus}`)
    lines.push(`- stability status: ${summary.stabilityStatus}`)
    lines.push(`- approval count: ${summary.approvalCount}`)
    lines.push(`- adoption review count: ${summary.adoptionReviewCount}`)
    lines.push(`- dissent handling included: ${summary.hasDissentHandling}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
