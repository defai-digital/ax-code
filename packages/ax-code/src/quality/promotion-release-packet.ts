import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"

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

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, packetID: string) {
    return ["quality_model_release_packet", encode(source), packetID]
  }

  function sortPackets(packets: PacketArtifact[]) {
    return [...packets].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.packetID.localeCompare(b.packetID)
    })
  }

  function matchesDecisionBundle(
    decisionBundle: QualityPromotionReleaseDecisionRecord.RecordArtifact["boardDecision"]["reviewDossier"]["submissionBundle"]["decisionBundle"],
    packet: PacketArtifact,
  ) {
    return (
      packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.createdAt ===
        decisionBundle.createdAt &&
      packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.source ===
        decisionBundle.source &&
      JSON.stringify(packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle) ===
        JSON.stringify(decisionBundle)
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
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
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
      JSON.stringify(packet.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle) !==
      JSON.stringify(decisionBundle)
    ) {
      reasons.push(`release packet decision bundle mismatch for ${decisionBundle.source}`)
    }
    const recordReasons = QualityPromotionReleaseDecisionRecord.verify(decisionBundle, packet.releaseDecisionRecord)
    if (recordReasons.length > 0) {
      reasons.push(`release packet release decision record mismatch for ${decisionBundle.source} (${recordReasons[0]})`)
    }
    const expectedSummary = evaluateSummary(packet.releaseDecisionRecord)
    if (JSON.stringify(packet.summary) !== JSON.stringify(expectedSummary)) {
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
    const deduped = new Map<string, PacketArtifact>()
    for (const packet of [...persisted, ...packets]) {
      if (!matchesDecisionBundle(decisionBundle, packet)) continue
      if (verify(decisionBundle, packet).length > 0) continue
      deduped.set(packet.packetID, packet)
    }
    return sortPackets([...deduped.values()])
  }

  export async function get(input: { source: string; packetID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.packetID))
    return PacketRecord.parse(record)
  }

  export async function append(packet: PacketArtifact) {
    await QualityPromotionReleaseDecisionRecord.append(packet.releaseDecisionRecord)
    const next = PacketRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-packet-record",
      packet,
    })
    try {
      const existing = await get({ source: packet.source, packetID: packet.packetID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion release packet ${packet.packetID} already exists for source ${packet.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(packet.source, packet.packetID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_release_packet", encode(source)]] : [["quality_model_release_packet"]]
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
    await QualityPromotionReleaseDecisionRecord.assertPersisted(packet.releaseDecisionRecord)
    const persisted = await get({ source: packet.source, packetID: packet.packetID })
    const prev = JSON.stringify(persisted.packet)
    const curr = JSON.stringify(packet)
    if (prev !== curr) {
      throw new Error(`Persisted promotion release packet ${packet.packetID} does not match the provided artifact`)
    }
    return persisted
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
    for (const gate of packet.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
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
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
