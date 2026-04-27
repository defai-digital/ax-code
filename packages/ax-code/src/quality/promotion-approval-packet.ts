import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAdoptionDissentHandling } from "./promotion-adoption-dissent-handling"
import { QualityPromotionAdoptionReview } from "./promotion-adoption-review"
import { QualityPromotionApproval } from "./promotion-approval"
import { QualityPromotionApprovalPolicy } from "./promotion-approval-policy"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"

export namespace QualityPromotionApprovalPacket {
  export const ReadinessSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    totalApprovals: z.number().int().nonnegative(),
    totalAdoptionReviews: z.number().int().nonnegative(),
    approvalPolicyStatus: z.enum(["pass", "fail"]),
    adoptionReviewConsensusStatus: z.enum(["pass", "fail"]),
    dissentHandlingStatus: z.enum(["pass", "fail"]),
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
  export type ReadinessSummary = z.output<typeof ReadinessSummary>

  export const PacketArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval-packet"),
    packetID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    decisionBundle: z.object({
      source: z.string(),
      createdAt: z.string(),
      digest: z.string(),
      decision: z.enum(["go", "review", "no_go"]),
      requiredOverride: z.enum(["none", "allow_warn", "force"]),
    }),
    suggestion: z.object({
      source: z.literal("decision-bundle-contextual"),
      digest: z.string(),
      adoptionStatus: z.lazy(() => QualityPromotionDecisionBundle.ApprovalPolicyAdoptionSnapshot.shape.status),
    }),
    releasePolicy: z.lazy(() => QualityPromotionDecisionBundle.ReleasePolicySnapshot).optional(),
    approvals: z.array(z.lazy(() => QualityPromotionApproval.ApprovalArtifact)),
    adoptionReviews: z.array(z.lazy(() => QualityPromotionAdoptionReview.ReviewArtifact)),
    dissentHandling: z.lazy(() => QualityPromotionAdoptionDissentHandling.HandlingArtifact).optional(),
    approvalEvaluation: z.lazy(() => QualityPromotionApprovalPolicy.EvaluationSummary),
    adoptionReviewConsensus: z.lazy(() => QualityPromotionAdoptionReview.ConsensusSummary),
    readiness: ReadinessSummary,
  })
  export type PacketArtifact = z.output<typeof PacketArtifact>

  export const PacketRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-approval-packet-record"),
    packet: PacketArtifact,
  })
  export type PacketRecord = z.output<typeof PacketRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, packetID: string) {
    return ["quality_model_approval_packet", encode(source), packetID]
  }

  function sortPackets(artifacts: PacketArtifact[]) {
    return [...artifacts].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.packetID.localeCompare(b.packetID)
    })
  }

  function matchesBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle, packet: PacketArtifact) {
    return (
      packet.decisionBundle.digest === QualityPromotionApproval.digest(bundle) &&
      packet.decisionBundle.createdAt === bundle.createdAt &&
      packet.suggestion.digest === QualityPromotionAdoptionReview.suggestionDigest(bundle)
    )
  }

  function approvalPolicyForBundle(bundle: QualityPromotionDecisionBundle.DecisionBundle) {
    return {
      policy: bundle.releasePolicy?.policy.approval,
      policySource: bundle.releasePolicy?.provenance.policySource ?? "default",
      policyProjectID: bundle.releasePolicy?.provenance.policyProjectID ?? null,
    } as const
  }

  function evaluateReadiness(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    approvals: QualityPromotionApproval.ApprovalArtifact[]
    adoptionReviews: QualityPromotionAdoptionReview.ReviewArtifact[]
    approvalEvaluation: QualityPromotionApprovalPolicy.EvaluationSummary
    adoptionReviewConsensus: QualityPromotionAdoptionReview.ConsensusSummary
    dissentHandling: QualityPromotionAdoptionDissentHandling.HandlingSummary
  }) {
    const blockingConsensusGate = input.adoptionReviewConsensus.gates.find(
      (gate) => gate.status === "fail" && gate.name !== "qualified-rejection-veto",
    )
    const gates = [
      {
        name: "approval-policy",
        status: input.approvalEvaluation.overallStatus,
        detail:
          input.approvalEvaluation.overallStatus === "pass"
            ? `${input.approvalEvaluation.qualifiedApprovals}/${input.approvalEvaluation.requirement.minimumApprovals} qualifying approval(s) present`
            : (input.approvalEvaluation.gates.find((gate) => gate.status === "fail")?.detail ??
              "approval policy not satisfied"),
      },
      {
        name: "adoption-review-consensus",
        status: blockingConsensusGate ? "fail" : "pass",
        detail:
          blockingConsensusGate?.detail ??
          `${input.adoptionReviewConsensus.qualifyingReviews}/${input.adoptionReviewConsensus.requirement.minimumReviews} qualifying adoption review(s) present`,
      },
      {
        name: "adoption-dissent-handling",
        status: input.dissentHandling.overallStatus,
        detail:
          input.dissentHandling.gates.find((gate) => gate.status === "fail")?.detail ??
          `${input.dissentHandling.coveredQualifiedRejectingReviews}/${input.dissentHandling.totalQualifiedRejectingReviews} qualified rejecting review(s) covered`,
      },
    ] as const

    return ReadinessSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      adoptionStatus: input.adoptionReviewConsensus.adoptionStatus,
      totalApprovals: input.approvals.length,
      totalAdoptionReviews: input.adoptionReviews.length,
      approvalPolicyStatus: input.approvalEvaluation.overallStatus,
      adoptionReviewConsensusStatus: blockingConsensusGate ? "fail" : "pass",
      dissentHandlingStatus: input.dissentHandling.overallStatus,
      qualifiedRejectingReviews: input.adoptionReviewConsensus.qualifiedRejectingReviews,
      coveredQualifiedRejectingReviews: input.dissentHandling.coveredQualifiedRejectingReviews,
      gates,
    })
  }

  export async function resolveApprovalsForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    approvals: QualityPromotionApproval.ApprovalArtifact[] = [],
  ) {
    const persisted = (await QualityPromotionApproval.list(bundle.source)).filter(
      (approval) =>
        approval.decisionBundle.createdAt === bundle.createdAt &&
        approval.decisionBundle.digest === QualityPromotionApproval.digest(bundle) &&
        approval.decisionBundle.source === bundle.source,
    )
    const deduped = new Map<string, QualityPromotionApproval.ApprovalArtifact>()
    for (const approval of [...persisted, ...approvals]) {
      const reasons = QualityPromotionApproval.verify(bundle, approval)
      if (reasons.length > 0) continue
      deduped.set(approval.approvalID, approval)
    }
    return [...deduped.values()].sort((a, b) => {
      const byApprovedAt = a.approvedAt.localeCompare(b.approvedAt)
      if (byApprovedAt !== 0) return byApprovedAt
      return a.approvalID.localeCompare(b.approvalID)
    })
  }

  export function create(input: {
    bundle: QualityPromotionDecisionBundle.DecisionBundle
    approvals: QualityPromotionApproval.ApprovalArtifact[]
    adoptionReviews?: QualityPromotionAdoptionReview.ReviewArtifact[]
    dissentHandling?: QualityPromotionAdoptionDissentHandling.HandlingArtifact
  }) {
    const createdAt = new Date().toISOString()
    const packetID = `${Date.now()}-${encode(input.bundle.source)}-approval-packet`
    const suggestion =
      input.bundle.approvalPolicySuggestion ??
      QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(input.bundle)
    for (const approval of input.approvals) {
      const reasons = QualityPromotionApproval.verify(input.bundle, approval)
      if (reasons.length > 0) {
        throw new Error(
          `Cannot create approval packet for ${input.bundle.source}: invalid approval artifact (${reasons[0]})`,
        )
      }
    }
    const adoptionReviews = input.adoptionReviews ?? []
    for (const review of adoptionReviews) {
      const reasons = QualityPromotionAdoptionReview.verify(input.bundle, review)
      if (reasons.length > 0) {
        throw new Error(
          `Cannot create approval packet for ${input.bundle.source}: invalid adoption review artifact (${reasons[0]})`,
        )
      }
    }
    if (input.dissentHandling) {
      const reasons = QualityPromotionAdoptionDissentHandling.verify(
        input.bundle,
        adoptionReviews,
        input.dissentHandling,
      )
      if (reasons.length > 0) {
        throw new Error(
          `Cannot create approval packet for ${input.bundle.source}: invalid dissent handling bundle (${reasons[0]})`,
        )
      }
    }
    const policyResolution = approvalPolicyForBundle(input.bundle)
    const approvalEvaluation = QualityPromotionApprovalPolicy.evaluate({
      bundle: input.bundle,
      approvals: input.approvals,
      policy: policyResolution.policy,
      policySource: policyResolution.policySource,
      policyProjectID: policyResolution.policyProjectID,
    })
    const adoptionReviewConsensus = QualityPromotionAdoptionReview.evaluate(input.bundle, adoptionReviews)
    const dissentHandling =
      input.dissentHandling?.summary ??
      QualityPromotionAdoptionDissentHandling.evaluate(input.bundle, adoptionReviews, [], [])
    const readiness = evaluateReadiness({
      bundle: input.bundle,
      approvals: input.approvals,
      adoptionReviews,
      approvalEvaluation,
      adoptionReviewConsensus,
      dissentHandling,
    })

    return PacketArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-packet",
      packetID,
      source: input.bundle.source,
      createdAt,
      decisionBundle: {
        source: input.bundle.source,
        createdAt: input.bundle.createdAt,
        digest: QualityPromotionApproval.digest(input.bundle),
        decision: input.bundle.eligibility.decision,
        requiredOverride: input.bundle.eligibility.requiredOverride,
      },
      suggestion: {
        source: suggestion.source,
        digest: QualityPromotionAdoptionReview.suggestionDigest(input.bundle),
        adoptionStatus: suggestion.adoption.status,
      },
      releasePolicy: input.bundle.releasePolicy,
      approvals: input.approvals,
      adoptionReviews,
      dissentHandling: input.dissentHandling,
      approvalEvaluation,
      adoptionReviewConsensus,
      readiness,
    })
  }

  export function verify(bundle: QualityPromotionDecisionBundle.DecisionBundle, packet: PacketArtifact) {
    const reasons: string[] = []
    const suggestion =
      bundle.approvalPolicySuggestion ?? QualityPromotionDecisionBundle.deriveApprovalPolicySuggestion(bundle)
    if (packet.source !== bundle.source) {
      reasons.push(`approval packet source mismatch: ${packet.source} vs ${bundle.source}`)
    }
    if (packet.decisionBundle.source !== bundle.source) {
      reasons.push(
        `approval packet decision bundle source mismatch: ${packet.decisionBundle.source} vs ${bundle.source}`,
      )
    }
    if (packet.decisionBundle.createdAt !== bundle.createdAt) {
      reasons.push(
        `approval packet decision bundle createdAt mismatch: ${packet.decisionBundle.createdAt} vs ${bundle.createdAt}`,
      )
    }
    if (packet.decisionBundle.digest !== QualityPromotionApproval.digest(bundle)) {
      reasons.push(`approval packet decision bundle digest mismatch for ${bundle.source}`)
    }
    if (packet.decisionBundle.decision !== bundle.eligibility.decision) {
      reasons.push(
        `approval packet decision mismatch: ${packet.decisionBundle.decision} vs ${bundle.eligibility.decision}`,
      )
    }
    if (packet.decisionBundle.requiredOverride !== bundle.eligibility.requiredOverride) {
      reasons.push(
        `approval packet required override mismatch: ${packet.decisionBundle.requiredOverride} vs ${bundle.eligibility.requiredOverride}`,
      )
    }
    if (packet.suggestion.digest !== QualityPromotionAdoptionReview.suggestionDigest(bundle)) {
      reasons.push(`approval packet suggestion digest mismatch for ${bundle.source}`)
    }
    if (packet.suggestion.adoptionStatus !== suggestion.adoption.status) {
      reasons.push(
        `approval packet adoption status mismatch: ${packet.suggestion.adoptionStatus} vs ${suggestion.adoption.status}`,
      )
    }
    if (bundle.releasePolicy && !packet.releasePolicy) {
      reasons.push(`approval packet release policy snapshot missing for ${bundle.source}`)
    }
    if (!bundle.releasePolicy && packet.releasePolicy) {
      reasons.push(`approval packet unexpectedly includes release policy snapshot for ${bundle.source}`)
    }
    if (bundle.releasePolicy && packet.releasePolicy) {
      if (packet.releasePolicy.provenance.digest !== bundle.releasePolicy.provenance.digest) {
        reasons.push(
          `approval packet release policy digest mismatch: ${packet.releasePolicy.provenance.digest} vs ${bundle.releasePolicy.provenance.digest}`,
        )
      }
      if (packet.releasePolicy.provenance.policySource !== bundle.releasePolicy.provenance.policySource) {
        reasons.push(
          `approval packet release policy source mismatch: ${packet.releasePolicy.provenance.policySource} vs ${bundle.releasePolicy.provenance.policySource}`,
        )
      }
    }

    for (const approval of packet.approvals) {
      const approvalReasons = QualityPromotionApproval.verify(bundle, approval)
      if (approvalReasons.length > 0) {
        reasons.push(`approval packet contains invalid approval ${approval.approvalID} (${approvalReasons[0]})`)
      }
    }
    for (const review of packet.adoptionReviews) {
      const reviewReasons = QualityPromotionAdoptionReview.verify(bundle, review)
      if (reviewReasons.length > 0) {
        reasons.push(`approval packet contains invalid adoption review ${review.reviewID} (${reviewReasons[0]})`)
      }
    }
    if (packet.dissentHandling) {
      const handlingReasons = QualityPromotionAdoptionDissentHandling.verify(
        bundle,
        packet.adoptionReviews,
        packet.dissentHandling,
      )
      if (handlingReasons.length > 0) {
        reasons.push(
          `approval packet contains invalid dissent handling bundle ${packet.dissentHandling.handlingID} (${handlingReasons[0]})`,
        )
      }
    }

    const policyResolution = approvalPolicyForBundle(bundle)
    const expectedApprovalEvaluation = QualityPromotionApprovalPolicy.evaluate({
      bundle,
      approvals: packet.approvals,
      policy: policyResolution.policy,
      policySource: policyResolution.policySource,
      policyProjectID: policyResolution.policyProjectID,
    })
    if (JSON.stringify(packet.approvalEvaluation) !== JSON.stringify(expectedApprovalEvaluation)) {
      reasons.push(`approval packet approval evaluation mismatch for ${bundle.source}`)
    }

    const expectedConsensus = QualityPromotionAdoptionReview.evaluate(bundle, packet.adoptionReviews)
    if (JSON.stringify(packet.adoptionReviewConsensus) !== JSON.stringify(expectedConsensus)) {
      reasons.push(`approval packet adoption review consensus mismatch for ${bundle.source}`)
    }

    const expectedDissentHandling =
      packet.dissentHandling?.summary ??
      QualityPromotionAdoptionDissentHandling.evaluate(bundle, packet.adoptionReviews, [], [])
    const expectedReadiness = evaluateReadiness({
      bundle,
      approvals: packet.approvals,
      adoptionReviews: packet.adoptionReviews,
      approvalEvaluation: expectedApprovalEvaluation,
      adoptionReviewConsensus: expectedConsensus,
      dissentHandling: expectedDissentHandling,
    })
    if (JSON.stringify(packet.readiness) !== JSON.stringify(expectedReadiness)) {
      reasons.push(`approval packet readiness summary mismatch for ${bundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    bundle: QualityPromotionDecisionBundle.DecisionBundle,
    packets: PacketArtifact[] = [],
  ) {
    const persisted = (await list(bundle.source)).filter((packet) => matchesBundle(bundle, packet))
    const deduped = new Map<string, PacketArtifact>()
    for (const packet of [...persisted, ...packets]) {
      if (!matchesBundle(bundle, packet)) continue
      if (verify(bundle, packet).length > 0) continue
      deduped.set(packet.packetID, packet)
    }
    return sortPackets([...deduped.values()])
  }

  export async function get(input: { source: string; packetID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.packetID))
    return PacketRecord.parse(record)
  }

  export async function append(packet: PacketArtifact) {
    const next = PacketRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-approval-packet-record",
      packet,
    })
    try {
      const existing = await get({ source: packet.source, packetID: packet.packetID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Approval packet ${packet.packetID} already exists for source ${packet.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(packet.source, packet.packetID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_approval_packet", encode(source)]] : [["quality_model_approval_packet"]]
    const packets: PacketArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const packetID = parts[parts.length - 1]
        if (!encodedSource || !packetID) continue
        const record = await get({ source: decode(encodedSource), packetID })
        packets.push(record.packet)
      }
    }

    return sortPackets(packets)
  }

  export async function assertPersisted(packet: PacketArtifact) {
    const persisted = await get({ source: packet.source, packetID: packet.packetID })
    const prev = JSON.stringify(persisted.packet)
    const curr = JSON.stringify(packet)
    if (prev !== curr) {
      throw new Error(`Persisted approval packet ${packet.packetID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(packet: PacketArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval packet")
    lines.push("")
    lines.push(`- source: ${packet.source}`)
    lines.push(`- packet id: ${packet.packetID}`)
    lines.push(`- created at: ${packet.createdAt}`)
    lines.push(`- decision bundle created at: ${packet.decisionBundle.createdAt}`)
    lines.push(`- decision bundle digest: ${packet.decisionBundle.digest}`)
    lines.push(`- decision: ${packet.decisionBundle.decision}`)
    lines.push(`- required override: ${packet.decisionBundle.requiredOverride}`)
    lines.push(`- suggestion adoption status: ${packet.suggestion.adoptionStatus}`)
    lines.push(`- approval count: ${packet.approvals.length}`)
    lines.push(`- adoption review count: ${packet.adoptionReviews.length}`)
    lines.push(`- dissent handling bundle: ${packet.dissentHandling?.handlingID ?? "none"}`)
    lines.push(`- readiness: ${packet.readiness.overallStatus}`)
    lines.push("")
    for (const gate of packet.readiness.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ReadinessSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion approval packet readiness")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- adoption status: ${summary.adoptionStatus}`)
    lines.push(`- total approvals: ${summary.totalApprovals}`)
    lines.push(`- total adoption reviews: ${summary.totalAdoptionReviews}`)
    lines.push(`- approval policy status: ${summary.approvalPolicyStatus}`)
    lines.push(`- adoption review consensus status: ${summary.adoptionReviewConsensusStatus}`)
    lines.push(`- dissent handling status: ${summary.dissentHandlingStatus}`)
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
