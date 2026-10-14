import z from "zod"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { createPromotionArtifactStore } from "./artifact-store"
import { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationRecord } from "./promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"
import { summarizeOverallStatus } from "../status"
import { jsonEqual } from "../json"
import { compareStringFields } from "../sort"
import { pushGateLines } from "./promotion-summary"

export namespace QualityPromotionSignedArchiveAttestationPacket {
  export const PromotionReference = z.object({
    promotionID: z.string(),
    source: z.string(),
    promotedAt: z.string(),
    decision: z.enum(["pass", "warn_override", "force"]),
    previousActiveSource: z.string().nullable(),
    releasePacketID: z.string().nullable(),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode).nullable(),
    authorizedPromotion: z.boolean().nullable(),
    signedArchiveID: z.string().nullable(),
  })
  export type PromotionReference = z.output<typeof PromotionReference>

  export const PacketSummary = z.object({
    overallStatus: z.enum(["pass", "warn", "fail"]),
    attestationRecordStatus: z.enum(["pass", "warn", "fail"]),
    trustStatus: z.enum(["pass", "warn", "fail"]),
    attestationStatus: z.enum(["pass", "warn", "fail"]),
    trusted: z.boolean(),
    acceptedByPolicy: z.boolean(),
    policySource: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.PolicySource),
    policyProjectID: z.string().nullable(),
    signedArchiveID: z.string(),
    gates: z.array(z.lazy(() => QualityPromotionSignedArchiveTrust.Gate)),
  })
  export type PacketSummary = z.output<typeof PacketSummary>

  export const PacketArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-packet"),
    packetID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    promotion: PromotionReference,
    attestationRecord: z.lazy(() => QualityPromotionSignedArchiveAttestationRecord.RecordArtifact),
    summary: PacketSummary,
  })
  export type PacketArtifact = z.output<typeof PacketArtifact>

  export const PacketRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-packet-record"),
    packet: PacketArtifact,
  })
  export type PacketRecord = z.output<typeof PacketRecord>

  function sortPackets(packets: PacketArtifact[]) {
    return [...packets].sort((a, b) => compareStringFields(a, b, ["createdAt", "packetID"]))
  }

  const store = createPromotionArtifactStore<PacketArtifact, PacketRecord>({
    keyPrefix: "quality_model_signed_archive_attestation_packet",
    recordKind: "ax-code-quality-promotion-signed-archive-attestation-packet-record",
    artifactField: "packet",
    idField: "packetID",
    noun: "Signed archive attestation packet",
    recordSchema: PacketRecord,
    sort: sortPackets,
    parent: {
      append: (packet) => QualityPromotionSignedArchiveAttestationRecord.append(packet.attestationRecord),
      assertPersisted: (packet) =>
        QualityPromotionSignedArchiveAttestationRecord.assertPersisted(packet.attestationRecord),
    },
  })

  function evaluateSummary(
    input: {
      promotion: PromotionReference
      attestationRecord: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact
    },
    verification: { attestationRecordReasons: string[] },
  ) {
    const { attestationRecordReasons } = verification
    const embeddedAuditManifest =
      input.attestationRecord.signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle
        .auditManifest
    const embeddedPromotion = embeddedAuditManifest.promotion
    const embeddedReleasePacket = embeddedAuditManifest.releasePacket
    const promotionLinkagePass =
      input.promotion.source === input.attestationRecord.source &&
      input.promotion.promotionID === input.attestationRecord.promotionID
    const promotionReferencePass =
      input.promotion.source === embeddedPromotion.source &&
      input.promotion.promotionID === embeddedPromotion.promotionID &&
      input.promotion.promotedAt === embeddedPromotion.promotedAt &&
      input.promotion.decision === embeddedPromotion.decision &&
      input.promotion.previousActiveSource === embeddedPromotion.previousActiveSource &&
      input.promotion.releasePacketID === embeddedReleasePacket.packetID &&
      input.promotion.promotionMode === embeddedReleasePacket.summary.promotionMode &&
      input.promotion.authorizedPromotion === embeddedReleasePacket.summary.authorizedPromotion
    const signedArchiveLinkagePass =
      input.promotion.signedArchiveID === input.attestationRecord.signedArchive.signedArchiveID

    const gates: QualityPromotionSignedArchiveTrust.Gate[] = [
      {
        name: "attestation-record-verification",
        status: attestationRecordReasons.length === 0 ? "pass" : "fail",
        detail: attestationRecordReasons[0] ?? `attestation record ${input.attestationRecord.recordID} is valid`,
      },
      {
        name: "promotion-linkage",
        status: promotionLinkagePass ? "pass" : "fail",
        detail: promotionLinkagePass
          ? `promotion ${input.promotion.promotionID} matches attestation record`
          : `promotion ${input.promotion.promotionID}/${input.promotion.source} does not match attestation record ${input.attestationRecord.promotionID}/${input.attestationRecord.source}`,
      },
      {
        name: "promotion-reference-alignment",
        status: promotionReferencePass ? "pass" : "fail",
        detail: promotionReferencePass
          ? `promotion reference matches embedded audit manifest promotion ${embeddedPromotion.promotionID}`
          : `promotion reference does not match embedded audit manifest promotion ${embeddedPromotion.promotionID}`,
      },
      {
        name: "signed-archive-linkage",
        status: signedArchiveLinkagePass ? "pass" : "fail",
        detail: signedArchiveLinkagePass
          ? `signed archive ${input.attestationRecord.signedArchive.signedArchiveID} matches promotion reference`
          : `promotion signed archive ${input.promotion.signedArchiveID ?? "n/a"} does not match attestation record archive ${input.attestationRecord.signedArchive.signedArchiveID}`,
      },
      {
        name: "attestation-policy-acceptance",
        status: input.attestationRecord.summary.acceptedByPolicy
          ? input.attestationRecord.summary.attestationStatus
          : "fail",
        detail: input.attestationRecord.summary.acceptedByPolicy
          ? `attestation accepted by ${input.attestationRecord.summary.policySource} policy`
          : `attestation rejected by ${input.attestationRecord.summary.policySource} policy`,
      },
    ]

    return PacketSummary.parse({
      overallStatus: summarizeOverallStatus(gates),
      attestationRecordStatus: input.attestationRecord.summary.overallStatus,
      trustStatus: input.attestationRecord.summary.trustStatus,
      attestationStatus: input.attestationRecord.summary.attestationStatus,
      trusted: input.attestationRecord.summary.trusted,
      acceptedByPolicy: input.attestationRecord.summary.acceptedByPolicy,
      policySource: input.attestationRecord.summary.policySource,
      policyProjectID: input.attestationRecord.summary.policyProjectID,
      signedArchiveID: input.attestationRecord.signedArchive.signedArchiveID,
      gates,
    })
  }

  export function create(input: {
    promotion: PromotionReference
    attestationRecord: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact
  }) {
    const attestationRecordReasons = QualityPromotionSignedArchiveAttestationRecord.verify(input.attestationRecord)
    if (attestationRecordReasons.length > 0) {
      throw new Error(
        `Cannot create signed archive attestation packet for ${input.attestationRecord.source}: invalid attestation record (${attestationRecordReasons[0]})`,
      )
    }
    const createdAt = new Date().toISOString()
    const packetID = `${input.attestationRecord.recordID}-packet`
    const summary = evaluateSummary(input, { attestationRecordReasons })
    return PacketArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-packet",
      packetID,
      source: input.attestationRecord.source,
      createdAt,
      promotion: input.promotion,
      attestationRecord: input.attestationRecord,
      summary,
    })
  }

  export function verify(packet: PacketArtifact) {
    const reasons: string[] = []
    // The packet id is derived from the attestation record it packages, and it is
    // the store's write-once key. A verifier that ignores it accepts a
    // re-identified copy of an already-accepted packet as a new artifact.
    if (packet.packetID !== `${packet.attestationRecord.recordID}-packet`) {
      reasons.push(
        `signed archive attestation packet id ${packet.packetID} does not match its attestation record ${packet.attestationRecord.recordID}`,
      )
    }
    if (packet.source !== packet.attestationRecord.source) {
      reasons.push(
        `signed archive attestation packet source mismatch: ${packet.source} vs ${packet.attestationRecord.source}`,
      )
    }
    if (packet.promotion.promotionID !== packet.attestationRecord.promotionID) {
      reasons.push(
        `signed archive attestation packet promotion mismatch: ${packet.promotion.promotionID} vs ${packet.attestationRecord.promotionID}`,
      )
    }
    const attestationRecordReasons = QualityPromotionSignedArchiveAttestationRecord.verify(packet.attestationRecord)
    if (attestationRecordReasons.length > 0) {
      reasons.push(
        `signed archive attestation packet attestation record mismatch for ${packet.source} (${attestationRecordReasons[0]})`,
      )
    }
    const expectedSummary = evaluateSummary(
      {
        promotion: packet.promotion,
        attestationRecord: packet.attestationRecord,
      },
      { attestationRecordReasons },
    )
    if (!jsonEqual(packet.summary, expectedSummary)) {
      reasons.push(`signed archive attestation packet summary mismatch for ${packet.source}`)
    }
    return reasons
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
    lines.push("## ax-code quality promotion signed archive attestation packet")
    lines.push("")
    lines.push(`- source: ${packet.source}`)
    lines.push(`- packet id: ${packet.packetID}`)
    lines.push(`- created at: ${packet.createdAt}`)
    lines.push(`- promotion id: ${packet.promotion.promotionID}`)
    lines.push(`- promoted at: ${packet.promotion.promotedAt}`)
    lines.push(`- decision: ${packet.promotion.decision}`)
    lines.push(`- signed archive id: ${packet.summary.signedArchiveID}`)
    lines.push(`- trust status: ${packet.summary.trustStatus}`)
    lines.push(`- attestation status: ${packet.summary.attestationStatus}`)
    lines.push(`- trusted: ${packet.summary.trusted}`)
    lines.push(`- accepted by policy: ${packet.summary.acceptedByPolicy}`)
    lines.push(`- policy source: ${packet.summary.policySource}`)
    lines.push(`- policy project id: ${packet.summary.policyProjectID ?? "n/a"}`)
    lines.push(`- overall status: ${packet.summary.overallStatus}`)
    lines.push("")
    pushGateLines(lines, packet.summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
