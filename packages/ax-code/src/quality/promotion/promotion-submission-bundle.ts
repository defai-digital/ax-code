import z from "zod"
import { QualityStorageKey } from "../storage-key"
import { QualityPromotionApprovalPacket } from "./promotion-approval-packet"
import { createPromotionArtifactStore } from "./artifact-store"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"
import { overallStatusFromGates } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

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
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
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

  const encode = QualityStorageKey.encode

  function sortBundles(bundles: BundleArtifact[]) {
    return [...bundles].sort((a, b) => compareStringFields(a, b, ["createdAt", "submissionID"]))
  }

  const store = createPromotionArtifactStore<BundleArtifact, BundleRecord>({
    keyPrefix: "quality_model_submission_bundle",
    recordKind: "ax-code-quality-promotion-submission-bundle-record",
    artifactField: "submission",
    idField: "submissionID",
    noun: "Promotion submission bundle",
    recordSchema: BundleRecord,
    sort: sortBundles,
    parent: {
      append: (submission) => QualityPromotionApprovalPacket.append(submission.approvalPacket),
      assertPersisted: (submission) => QualityPromotionApprovalPacket.assertPersisted(submission.approvalPacket),
    },
  })

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    submission: BundleArtifact,
  ) {
    return (
      submission.decisionBundle.createdAt === decisionBundle.createdAt &&
      submission.decisionBundle.source === decisionBundle.source &&
      jsonEqual(submission.decisionBundle, decisionBundle)
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
        detail:
          input.approvalPacket.readiness.overallStatus === "pass"
            ? `approval packet ${input.approvalPacket.packetID} is ready`
            : (input.approvalPacket.readiness.gates.find((gate) => gate.status === "fail")?.detail ??
              "approval packet not ready"),
      },
      {
        name: "decision-bundle-alignment",
        status: "pass" as const,
        detail: `decision=${input.decisionBundle.eligibility.decision} requiredOverride=${input.decisionBundle.eligibility.requiredOverride}`,
      },
    ] as const

    return SubmissionSummary.parse({
      overallStatus: overallStatusFromGates(gates),
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
      throw new Error(
        `Cannot create promotion submission bundle for ${input.decisionBundle.source}: invalid approval packet (${packetReasons[0]})`,
      )
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

  export function verify(decisionBundle: QualityPromotionDecisionBundle.DecisionBundle, submission: BundleArtifact) {
    const reasons: string[] = []
    if (submission.source !== decisionBundle.source) {
      reasons.push(`submission bundle source mismatch: ${submission.source} vs ${decisionBundle.source}`)
    }
    if (!jsonEqual(submission.decisionBundle, decisionBundle)) {
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
    if (!jsonEqual(submission.summary, expectedSummary)) {
      reasons.push(`submission bundle summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionDecisionBundle.DecisionBundle,
    submissions: BundleArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((submission) =>
      matchesDecisionBundle(decisionBundle, submission),
    )
    const validSubmissions = [...persisted, ...submissions].filter(
      (submission) =>
        matchesDecisionBundle(decisionBundle, submission) && verify(decisionBundle, submission).length === 0,
    )
    return sortBundles(uniqueBy(validSubmissions, (submission) => submission.submissionID))
  }

  export async function get(input: { source: string; submissionID: string }) {
    return store.get({ source: input.source, id: input.submissionID })
  }

  export function append(submission: BundleArtifact) {
    return store.append(submission)
  }

  export function list(source?: string) {
    return store.list(source)
  }

  export function assertPersisted(submission: BundleArtifact) {
    return store.assertPersisted(submission)
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
