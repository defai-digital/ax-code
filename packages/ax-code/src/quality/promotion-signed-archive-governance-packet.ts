import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionReleasePacket } from "./promotion-release-packet"
import { QualityPromotionSignedArchiveAttestationPacket } from "./promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"

export namespace QualityPromotionSignedArchiveGovernancePacket {
  export const PromotionReference = z.lazy(() => QualityPromotionSignedArchiveAttestationPacket.PromotionReference)
  export type PromotionReference = z.output<typeof PromotionReference>

  export const PacketSummary = z.object({
    overallStatus: z.enum(["pass", "warn", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    attestationPacketStatus: z.enum(["pass", "warn", "fail"]),
    trustStatus: z.enum(["pass", "warn", "fail"]),
    attestationStatus: z.enum(["pass", "warn", "fail"]),
    trusted: z.boolean(),
    acceptedByPolicy: z.boolean(),
    authorizedPromotion: z.boolean(),
    promotionMode: z.lazy(() => QualityPromotionReleasePacket.PacketSummary.shape.promotionMode),
    policySource: z.lazy(() => QualityPromotionSignedArchiveAttestationPacket.PacketSummary.shape.policySource),
    policyProjectID: z.string().nullable(),
    releasePacketID: z.string(),
    signedArchiveID: z.string(),
    gates: z.array(z.lazy(() => QualityPromotionSignedArchiveTrust.Gate)),
  })
  export type PacketSummary = z.output<typeof PacketSummary>

  export const PacketArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-governance-packet"),
    packetID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    promotion: PromotionReference,
    releasePacket: z.lazy(() => QualityPromotionReleasePacket.PacketArtifact),
    attestationPacket: z.lazy(() => QualityPromotionSignedArchiveAttestationPacket.PacketArtifact),
    summary: PacketSummary,
  })
  export type PacketArtifact = z.output<typeof PacketArtifact>

  export const PacketRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-governance-packet-record"),
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
    return ["quality_model_signed_archive_governance_packet", encode(source), packetID]
  }

  function sortPackets(packets: PacketArtifact[]) {
    return [...packets].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.packetID.localeCompare(b.packetID)
    })
  }

  function severity(status: QualityPromotionSignedArchiveTrust.Gate["status"]) {
    return status === "fail" ? 2 : status === "warn" ? 1 : 0
  }

  function summarizeOverall(gates: QualityPromotionSignedArchiveTrust.Gate[]) {
    const highest = gates.reduce((max, gate) => Math.max(max, severity(gate.status)), 0)
    return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
  }

  function matchesPromotion(promotion: PromotionReference, packet: PacketArtifact) {
    return packet.promotion.source === promotion.source
      && packet.promotion.promotionID === promotion.promotionID
  }

  function evaluateSummary(input: {
    promotion: PromotionReference
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    attestationPacket: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact
  }) {
    const decisionBundle = input.releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle
    const releasePacketReasons = QualityPromotionReleasePacket.verify(decisionBundle, input.releasePacket)
    const attestationPacketReasons = QualityPromotionSignedArchiveAttestationPacket.verify(input.attestationPacket)

    const releasePacketLinkagePass = input.promotion.releasePacketID === input.releasePacket.packetID
      && input.attestationPacket.promotion.releasePacketID === input.releasePacket.packetID
    const promotionReferencePass = JSON.stringify(input.promotion) === JSON.stringify(input.attestationPacket.promotion)
    const sourceLinkagePass = input.releasePacket.source === input.attestationPacket.source
      && input.attestationPacket.source === input.promotion.source
    const signedArchiveLinkagePass = input.promotion.signedArchiveID === input.attestationPacket.summary.signedArchiveID

    const gates: QualityPromotionSignedArchiveTrust.Gate[] = [
      {
        name: "release-packet-verification",
        status: releasePacketReasons.length === 0 ? "pass" : "fail",
        detail: releasePacketReasons[0] ?? `release packet ${input.releasePacket.packetID} is valid`,
      },
      {
        name: "attestation-packet-verification",
        status: attestationPacketReasons.length === 0 ? "pass" : "fail",
        detail: attestationPacketReasons[0] ?? `attestation packet ${input.attestationPacket.packetID} is valid`,
      },
      {
        name: "source-linkage",
        status: sourceLinkagePass ? "pass" : "fail",
        detail: sourceLinkagePass
          ? `source ${input.promotion.source} matches release and attestation packets`
          : `source mismatch between promotion=${input.promotion.source}, release packet=${input.releasePacket.source}, attestation packet=${input.attestationPacket.source}`,
      },
      {
        name: "promotion-reference-alignment",
        status: promotionReferencePass ? "pass" : "fail",
        detail: promotionReferencePass
          ? `promotion reference matches attestation packet ${input.attestationPacket.packetID}`
          : `promotion reference does not match attestation packet ${input.attestationPacket.packetID}`,
      },
      {
        name: "release-packet-linkage",
        status: releasePacketLinkagePass ? "pass" : "fail",
        detail: releasePacketLinkagePass
          ? `release packet ${input.releasePacket.packetID} matches governance promotion reference`
          : `promotion release packet ${input.promotion.releasePacketID ?? "n/a"} does not match release packet ${input.releasePacket.packetID}`,
      },
      {
        name: "promotion-authorization",
        status: input.releasePacket.summary.authorizedPromotion ? "pass" : "fail",
        detail: input.releasePacket.summary.authorizedPromotion
          ? `release packet authorizes promotion mode ${input.releasePacket.summary.promotionMode}`
          : "release packet does not authorize promotion",
      },
      {
        name: "signed-archive-linkage",
        status: signedArchiveLinkagePass ? "pass" : "fail",
        detail: signedArchiveLinkagePass
          ? `signed archive ${input.attestationPacket.summary.signedArchiveID} matches promotion reference`
          : `promotion signed archive ${input.promotion.signedArchiveID ?? "n/a"} does not match attestation packet archive ${input.attestationPacket.summary.signedArchiveID}`,
      },
      {
        name: "attestation-policy-acceptance",
        status: input.attestationPacket.summary.acceptedByPolicy
          ? input.attestationPacket.summary.attestationStatus
          : "fail",
        detail: input.attestationPacket.summary.acceptedByPolicy
          ? `attestation accepted by ${input.attestationPacket.summary.policySource} policy`
          : `attestation rejected by ${input.attestationPacket.summary.policySource} policy`,
      },
    ]

    return PacketSummary.parse({
      overallStatus: summarizeOverall(gates),
      releasePacketStatus: input.releasePacket.summary.overallStatus,
      attestationPacketStatus: input.attestationPacket.summary.overallStatus,
      trustStatus: input.attestationPacket.summary.trustStatus,
      attestationStatus: input.attestationPacket.summary.attestationStatus,
      trusted: input.attestationPacket.summary.trusted,
      acceptedByPolicy: input.attestationPacket.summary.acceptedByPolicy,
      authorizedPromotion: input.releasePacket.summary.authorizedPromotion,
      promotionMode: input.releasePacket.summary.promotionMode,
      policySource: input.attestationPacket.summary.policySource,
      policyProjectID: input.attestationPacket.summary.policyProjectID,
      releasePacketID: input.releasePacket.packetID,
      signedArchiveID: input.attestationPacket.summary.signedArchiveID,
      gates,
    })
  }

  export function create(input: {
    promotion: PromotionReference
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    attestationPacket: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact
  }) {
    const decisionBundle = input.releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle
    const releasePacketReasons = QualityPromotionReleasePacket.verify(decisionBundle, input.releasePacket)
    if (releasePacketReasons.length > 0) {
      throw new Error(`Cannot create signed archive governance packet for ${input.releasePacket.source}: invalid release packet (${releasePacketReasons[0]})`)
    }
    const attestationPacketReasons = QualityPromotionSignedArchiveAttestationPacket.verify(input.attestationPacket)
    if (attestationPacketReasons.length > 0) {
      throw new Error(`Cannot create signed archive governance packet for ${input.attestationPacket.source}: invalid attestation packet (${attestationPacketReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const packetID = `${input.attestationPacket.packetID}-governance`
    const summary = evaluateSummary(input)
    return PacketArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-governance-packet",
      packetID,
      source: input.attestationPacket.source,
      createdAt,
      promotion: input.promotion,
      releasePacket: input.releasePacket,
      attestationPacket: input.attestationPacket,
      summary,
    })
  }

  export function verify(packet: PacketArtifact) {
    const reasons: string[] = []
    if (packet.source !== packet.releasePacket.source) {
      reasons.push(`signed archive governance packet release packet source mismatch: ${packet.source} vs ${packet.releasePacket.source}`)
    }
    if (packet.source !== packet.attestationPacket.source) {
      reasons.push(`signed archive governance packet attestation packet source mismatch: ${packet.source} vs ${packet.attestationPacket.source}`)
    }
    if (packet.promotion.promotionID !== packet.attestationPacket.promotion.promotionID) {
      reasons.push(`signed archive governance packet promotion mismatch: ${packet.promotion.promotionID} vs ${packet.attestationPacket.promotion.promotionID}`)
    }
    const decisionBundle = packet.releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle
    const releasePacketReasons = QualityPromotionReleasePacket.verify(decisionBundle, packet.releasePacket)
    if (releasePacketReasons.length > 0) {
      reasons.push(`signed archive governance packet release packet mismatch for ${packet.source} (${releasePacketReasons[0]})`)
    }
    const attestationPacketReasons = QualityPromotionSignedArchiveAttestationPacket.verify(packet.attestationPacket)
    if (attestationPacketReasons.length > 0) {
      reasons.push(`signed archive governance packet attestation packet mismatch for ${packet.source} (${attestationPacketReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      promotion: packet.promotion,
      releasePacket: packet.releasePacket,
      attestationPacket: packet.attestationPacket,
    })
    if (JSON.stringify(packet.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`signed archive governance packet summary mismatch for ${packet.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: PromotionReference,
    packets: PacketArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((packet) => matchesPromotion(promotion, packet))
    const deduped = new Map<string, PacketArtifact>()
    for (const packet of [...persisted, ...packets]) {
      if (!matchesPromotion(promotion, packet)) continue
      if (verify(packet).length > 0) continue
      deduped.set(packet.packetID, packet)
    }
    return sortPackets([...deduped.values()])
  }

  export async function get(input: { source: string; packetID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.packetID))
    return PacketRecord.parse(record)
  }

  export async function append(packet: PacketArtifact) {
    await QualityPromotionReleasePacket.append(packet.releasePacket)
    await QualityPromotionSignedArchiveAttestationPacket.append(packet.attestationPacket)
    const next = PacketRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-governance-packet-record",
      packet,
    })
    try {
      const existing = await get({ source: packet.source, packetID: packet.packetID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Signed archive governance packet ${packet.packetID} already exists for source ${packet.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(packet.source, packet.packetID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_signed_archive_governance_packet", encode(source)]] : [["quality_model_signed_archive_governance_packet"]]
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
    await QualityPromotionReleasePacket.assertPersisted(packet.releasePacket)
    await QualityPromotionSignedArchiveAttestationPacket.assertPersisted(packet.attestationPacket)
    const persisted = await get({ source: packet.source, packetID: packet.packetID })
    const prev = JSON.stringify(persisted.packet)
    const curr = JSON.stringify(packet)
    if (prev !== curr) {
      throw new Error(`Persisted signed archive governance packet ${packet.packetID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(packet: PacketArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive governance packet")
    lines.push("")
    lines.push(`- source: ${packet.source}`)
    lines.push(`- packet id: ${packet.packetID}`)
    lines.push(`- created at: ${packet.createdAt}`)
    lines.push(`- promotion id: ${packet.promotion.promotionID}`)
    lines.push(`- release packet id: ${packet.summary.releasePacketID}`)
    lines.push(`- signed archive id: ${packet.summary.signedArchiveID}`)
    lines.push(`- promotion mode: ${packet.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${packet.summary.authorizedPromotion}`)
    lines.push(`- trust status: ${packet.summary.trustStatus}`)
    lines.push(`- attestation status: ${packet.summary.attestationStatus}`)
    lines.push(`- accepted by policy: ${packet.summary.acceptedByPolicy}`)
    lines.push(`- policy source: ${packet.summary.policySource}`)
    lines.push(`- policy project id: ${packet.summary.policyProjectID ?? "n/a"}`)
    lines.push(`- overall status: ${packet.summary.overallStatus}`)
    lines.push("")
    for (const gate of packet.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
