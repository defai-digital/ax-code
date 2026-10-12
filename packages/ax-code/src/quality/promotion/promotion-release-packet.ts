import z from "zod"
import { QualityStorageKey } from "../storage-key"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { createPromotionArtifactStore } from "./artifact-store"
import { overallStatusFromGates, pushGateLines } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

export namespace QualityPromotionReleasePacket {
  export const PacketSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    releaseDecisionRecordStatus: z.enum(["pass", "fail"]),
    boardDecisionStatus: z.enum(["pass", "fail"]),
    reviewDossierStatus: z.enum(["pass", "fail"]),
    submissionStatus: z.enum(["pass", "fail"]),
    approvalPacketStatus: z.enum(["pass", "fail"]),
    recommendation: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.recommendation),
    requiredOverride: z.enum(["none", "allow_warn", "force"]),
    disposition: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.disposition),
    authorizedPromotion: z.boolean(),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
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
  export type PacketSummary = z.output<typeof PacketSummary>

  export const PacketArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-packet"),
    packetID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    releaseDecisionRecord: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordArtifact),
    summary: PacketSummary,
  })
  export type PacketArtifact = z.output<typeof PacketArtifact>

  export const PacketRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-packet-record"),
    packet: PacketArtifact,
  })
  export type PacketRecord = z.output<typeof PacketRecord>

  const encode = QualityStorageKey.encode

  function sortPackets(packets: PacketArtifact[]) {
    return [...packets].sort((a, b) => compareStringFields(a, b, ["createdAt", "packetID"]))
  }

  const store = createPromotionArtifactStore<PacketArtifact, PacketRecord>({
    keyPrefix: "quality_model_release_packet",
    recordKind: "ax-code-quality-promotion-release-packet-record",
    artifactField: "packet",
    idField: "packetID",
    noun: "Promotion release packet",
    recordSchema: PacketRecord,
    sort: sortPackets,
    parent: {
      append: (packet) => QualityPromotionReleaseDecisionRecord.append(packet.releaseDecisionRecord),
      assertPersisted: (packet) => QualityPromotionReleaseDecisionRecord.assertPersisted(packet.releaseDecisionRecord),
    },
  })

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionReleaseDecisionRecord.RecordArtifact["boardDecision"]["reviewDossier"]["submissionBundle"]["decisionBundle"],
    packet: PacketArtifact,
  ) {
    return (
      packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.createdAt ===
        decisionBundle.createdAt &&
      packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.source ===
        decisionBundle.source &&
      jsonEqual(
        packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
        decisionBundle,
      )
    )
  }

  function evaluateSummary(releaseDecisionRecord: QualityPromotionReleaseDecisionRecord.RecordArtifact) {
    const boardDecision = releaseDecisionRecord.boardDecision
    const reviewDossier = boardDecision.reviewDossier
    const submissionBundle = reviewDossier.submissionBundle
    const approvalPacket = submissionBundle.approvalPacket

    const gates = [
      {
        name: "release-decision-record-readiness",
        status: releaseDecisionRecord.summary.overallStatus,
        detail:
          releaseDecisionRecord.summary.overallStatus === "pass"
            ? `release decision record ${releaseDecisionRecord.recordID} is ready`
            : (releaseDecisionRecord.summary.gates.find((gate) => gate.status === "fail")?.detail ??
              "release decision record not ready"),
      },
      {
        name: "promotion-authorization",
        status: releaseDecisionRecord.summary.authorizedPromotion ? "pass" : "fail",
        detail: releaseDecisionRecord.summary.authorizedPromotion
          ? `release packet authorizes promotion mode ${releaseDecisionRecord.summary.promotionMode}`
          : "release decision record does not authorize promotion",
      },
      {
        name: "release-mode-consistency",
        status:
          releaseDecisionRecord.summary.requiredOverride === "none"
            ? releaseDecisionRecord.summary.promotionMode === "pass"
              ? "pass"
              : "fail"
            : releaseDecisionRecord.summary.requiredOverride === "allow_warn"
              ? releaseDecisionRecord.summary.promotionMode === "warn_override"
                ? "pass"
                : "fail"
              : releaseDecisionRecord.summary.promotionMode === "force"
                ? "pass"
                : "fail",
        detail: `required override ${releaseDecisionRecord.summary.requiredOverride} maps to promotion mode ${releaseDecisionRecord.summary.promotionMode}`,
      },
    ] as const

    return PacketSummary.parse({
      overallStatus: overallStatusFromGates(gates),
      releaseDecisionRecordStatus: releaseDecisionRecord.summary.overallStatus,
      boardDecisionStatus: boardDecision.summary.overallStatus,
      reviewDossierStatus: reviewDossier.summary.overallStatus,
      submissionStatus: submissionBundle.summary.overallStatus,
      approvalPacketStatus: approvalPacket.readiness.overallStatus,
      recommendation: releaseDecisionRecord.summary.recommendation,
      requiredOverride: releaseDecisionRecord.summary.requiredOverride,
      disposition: releaseDecisionRecord.summary.disposition,
      authorizedPromotion: releaseDecisionRecord.summary.authorizedPromotion,
      promotionMode: releaseDecisionRecord.summary.promotionMode,
      approvalCount: submissionBundle.summary.approvalCount,
      adoptionReviewCount: submissionBundle.summary.adoptionReviewCount,
      hasDissentHandling: submissionBundle.summary.hasDissentHandling,
      gates,
    })
  }

  export function create(input: { releaseDecisionRecord: QualityPromotionReleaseDecisionRecord.RecordArtifact }) {
    const createdAt = new Date().toISOString()
    const packetID = `${Date.now()}-${encode(input.releaseDecisionRecord.source)}-release-packet`
    const recordReasons = QualityPromotionReleaseDecisionRecord.verify(
      input.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      input.releaseDecisionRecord,
    )
    if (recordReasons.length > 0) {
      throw new Error(
        `Cannot create promotion release packet for ${input.releaseDecisionRecord.source}: invalid release decision record (${recordReasons[0]})`,
      )
    }
    const summary = evaluateSummary(input.releaseDecisionRecord)
    return PacketArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-packet",
      packetID,
      source: input.releaseDecisionRecord.source,
      createdAt,
      releaseDecisionRecord: input.releaseDecisionRecord,
      summary,
    })
  }

  export function verify(
    decisionBundle: QualityPromotionReleaseDecisionRecord.RecordArtifact["boardDecision"]["reviewDossier"]["submissionBundle"]["decisionBundle"],
    packet: PacketArtifact,
  ) {
    const reasons: string[] = []
    if (packet.source !== decisionBundle.source) {
      reasons.push(`release packet source mismatch: ${packet.source} vs ${decisionBundle.source}`)
    }
    if (
      !jsonEqual(
        packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
        decisionBundle,
      )
    ) {
      reasons.push(`release packet decision bundle mismatch for ${decisionBundle.source}`)
    }
    const recordReasons = QualityPromotionReleaseDecisionRecord.verify(decisionBundle, packet.releaseDecisionRecord)
    if (recordReasons.length > 0) {
      reasons.push(`release packet release decision record mismatch for ${decisionBundle.source} (${recordReasons[0]})`)
    }
    const expectedSummary = evaluateSummary(packet.releaseDecisionRecord)
    if (!jsonEqual(packet.summary, expectedSummary)) {
      reasons.push(`release packet summary mismatch for ${decisionBundle.source}`)
    }
    return reasons
  }

  export async function resolveForBundle(
    decisionBundle: QualityPromotionReleaseDecisionRecord.RecordArtifact["boardDecision"]["reviewDossier"]["submissionBundle"]["decisionBundle"],
    packets: PacketArtifact[] = [],
  ) {
    const persisted = (await list(decisionBundle.source)).filter((packet) =>
      matchesDecisionBundle(decisionBundle, packet),
    )
    const validPackets = [...persisted, ...packets].filter(
      (packet) => matchesDecisionBundle(decisionBundle, packet) && verify(decisionBundle, packet).length === 0,
    )
    return sortPackets(uniqueBy(validPackets, (packet) => packet.packetID))
  }

  export async function get(input: { source: string; packetID: string }) {
    return store.get({ source: input.source, id: input.packetID })
  }

  export function append(packet: PacketArtifact) {
    return store.append(packet)
  }

  export function list(source?: string) {
    return store.list(source)
  }

  export function assertPersisted(packet: PacketArtifact) {
    return store.assertPersisted(packet)
  }

  export function renderReport(packet: PacketArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release packet")
    lines.push("")
    lines.push(`- source: ${packet.source}`)
    lines.push(`- packet id: ${packet.packetID}`)
    lines.push(`- created at: ${packet.createdAt}`)
    lines.push(`- release decision record id: ${packet.releaseDecisionRecord.recordID}`)
    lines.push(`- board decision id: ${packet.releaseDecisionRecord.boardDecision.decisionID}`)
    lines.push(`- recommendation: ${packet.summary.recommendation}`)
    lines.push(`- required override: ${packet.summary.requiredOverride}`)
    lines.push(`- disposition: ${packet.summary.disposition}`)
    lines.push(`- authorized promotion: ${packet.summary.authorizedPromotion}`)
    lines.push(`- promotion mode: ${packet.summary.promotionMode}`)
    lines.push(`- overall status: ${packet.summary.overallStatus}`)
    lines.push(`- approval count: ${packet.summary.approvalCount}`)
    lines.push(`- adoption review count: ${packet.summary.adoptionReviewCount}`)
    lines.push(`- dissent handling included: ${packet.summary.hasDissentHandling}`)
    lines.push("")
    pushGateLines(lines, packet.summary.gates)
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: PacketSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release packet summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- release decision record status: ${summary.releaseDecisionRecordStatus}`)
    lines.push(`- board decision status: ${summary.boardDecisionStatus}`)
    lines.push(`- review dossier status: ${summary.reviewDossierStatus}`)
    lines.push(`- submission status: ${summary.submissionStatus}`)
    lines.push(`- approval packet status: ${summary.approvalPacketStatus}`)
    lines.push(`- recommendation: ${summary.recommendation}`)
    lines.push(`- required override: ${summary.requiredOverride}`)
    lines.push(`- disposition: ${summary.disposition}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- approval count: ${summary.approvalCount}`)
    lines.push(`- adoption review count: ${summary.adoptionReviewCount}`)
    lines.push(`- dissent handling included: ${summary.hasDissentHandling}`)
    lines.push("")
    pushGateLines(lines, summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
