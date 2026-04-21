import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionHandoffPackage } from "./promotion-handoff-package"
import { QualityPromotionSignedArchiveGovernancePacket } from "./promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"

export namespace QualityPromotionSignedArchiveReviewDossier {
  export const DossierSummary = z.object({
    overallStatus: z.enum(["pass", "warn", "fail"]),
    governancePacketStatus: z.enum(["pass", "warn", "fail"]),
    handoffPackageStatus: z.enum(["pass", "fail"]),
    archiveManifestStatus: z.enum(["pass", "fail"]),
    exportBundleStatus: z.enum(["pass", "fail"]),
    auditManifestStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    authorizedPromotion: z.boolean(),
    promotionMode: z.lazy(() => QualityPromotionSignedArchiveGovernancePacket.PacketSummary.shape.promotionMode),
    trusted: z.boolean(),
    acceptedByPolicy: z.boolean(),
    policySource: z.lazy(() => QualityPromotionSignedArchiveGovernancePacket.PacketSummary.shape.policySource),
    policyProjectID: z.string().nullable(),
    signedArchiveID: z.string(),
    releasePacketID: z.string(),
    packageID: z.string(),
    documentCount: z.number().int().positive(),
    inventoryCount: z.number().int().positive(),
    gates: z.array(z.lazy(() => QualityPromotionSignedArchiveTrust.Gate)),
  })
  export type DossierSummary = z.output<typeof DossierSummary>

  export const DossierArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-review-dossier"),
    dossierID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    governancePacket: z.lazy(() => QualityPromotionSignedArchiveGovernancePacket.PacketArtifact),
    handoffPackage: z.lazy(() => QualityPromotionHandoffPackage.PackageArtifact),
    summary: DossierSummary,
  })
  export type DossierArtifact = z.output<typeof DossierArtifact>

  export const DossierRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-review-dossier-record"),
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
    return ["quality_model_signed_archive_review_dossier", encode(source), dossierID]
  }

  function sortDossiers(dossiers: DossierArtifact[]) {
    return [...dossiers].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.dossierID.localeCompare(b.dossierID)
    })
  }

  function severity(status: QualityPromotionSignedArchiveTrust.Gate["status"]) {
    return status === "fail" ? 2 : status === "warn" ? 1 : 0
  }

  function summarizeOverall(gates: QualityPromotionSignedArchiveTrust.Gate[]) {
    const highest = gates.reduce((max, gate) => Math.max(max, severity(gate.status)), 0)
    return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
  }

  function matchesPromotion(
    promotion: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact["promotion"],
    dossier: DossierArtifact,
  ) {
    return dossier.governancePacket.promotion.source === promotion.source
      && dossier.governancePacket.promotion.promotionID === promotion.promotionID
  }

  function evaluateSummary(input: {
    governancePacket: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact
    handoffPackage: QualityPromotionHandoffPackage.PackageArtifact
  }) {
    const governanceReasons = QualityPromotionSignedArchiveGovernancePacket.verify(input.governancePacket)
    const handoffReasons = QualityPromotionHandoffPackage.verify(input.handoffPackage)
    const handoffPromotion = input.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
    const handoffReleasePacket = input.handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket

    const sourceLinkagePass = input.governancePacket.source === input.handoffPackage.source
    const promotionLinkagePass = input.governancePacket.promotion.promotionID === handoffPromotion.promotionID
      && input.governancePacket.promotion.source === handoffPromotion.source
    const releasePacketLinkagePass = input.governancePacket.summary.releasePacketID === handoffReleasePacket.packetID
    const authorizationLinkagePass = input.governancePacket.summary.authorizedPromotion === input.governancePacket.promotion.authorizedPromotion
      && input.governancePacket.summary.promotionMode === input.governancePacket.promotion.promotionMode

    const gates: QualityPromotionSignedArchiveTrust.Gate[] = [
      {
        name: "governance-packet-verification",
        status: governanceReasons.length === 0 ? "pass" : "fail",
        detail: governanceReasons[0] ?? `governance packet ${input.governancePacket.packetID} is valid`,
      },
      {
        name: "handoff-package-verification",
        status: handoffReasons.length === 0 ? "pass" : "fail",
        detail: handoffReasons[0] ?? `handoff package ${input.handoffPackage.packageID} is valid`,
      },
      {
        name: "source-linkage",
        status: sourceLinkagePass ? "pass" : "fail",
        detail: sourceLinkagePass
          ? `source ${input.governancePacket.source} matches handoff package`
          : `source mismatch between governance packet=${input.governancePacket.source} and handoff package=${input.handoffPackage.source}`,
      },
      {
        name: "promotion-linkage",
        status: promotionLinkagePass ? "pass" : "fail",
        detail: promotionLinkagePass
          ? `promotion ${input.governancePacket.promotion.promotionID} matches handoff package`
          : `promotion mismatch between governance packet=${input.governancePacket.promotion.promotionID} and handoff package=${handoffPromotion.promotionID}`,
      },
      {
        name: "release-packet-linkage",
        status: releasePacketLinkagePass ? "pass" : "fail",
        detail: releasePacketLinkagePass
          ? `release packet ${input.governancePacket.summary.releasePacketID} matches handoff package`
          : `release packet mismatch between governance packet=${input.governancePacket.summary.releasePacketID} and handoff package=${handoffReleasePacket.packetID}`,
      },
      {
        name: "promotion-authorization",
        status: authorizationLinkagePass && input.governancePacket.summary.authorizedPromotion ? "pass" : "fail",
        detail: authorizationLinkagePass && input.governancePacket.summary.authorizedPromotion
          ? `promotion mode ${input.governancePacket.summary.promotionMode} remains authorized after signing`
          : "promotion authorization is missing or inconsistent after signing",
      },
      {
        name: "attestation-policy-acceptance",
        status: input.governancePacket.summary.acceptedByPolicy
          ? input.governancePacket.summary.attestationStatus
          : "fail",
        detail: input.governancePacket.summary.acceptedByPolicy
          ? `signed archive accepted by ${input.governancePacket.summary.policySource} policy`
          : `signed archive rejected by ${input.governancePacket.summary.policySource} policy`,
      },
    ]

    return DossierSummary.parse({
      overallStatus: summarizeOverall(gates),
      governancePacketStatus: input.governancePacket.summary.overallStatus,
      handoffPackageStatus: input.handoffPackage.summary.overallStatus,
      archiveManifestStatus: input.handoffPackage.summary.archiveManifestStatus,
      exportBundleStatus: input.handoffPackage.summary.exportBundleStatus,
      auditManifestStatus: input.handoffPackage.summary.auditManifestStatus,
      releasePacketStatus: input.handoffPackage.summary.releasePacketStatus,
      authorizedPromotion: input.governancePacket.summary.authorizedPromotion,
      promotionMode: input.governancePacket.summary.promotionMode,
      trusted: input.governancePacket.summary.trusted,
      acceptedByPolicy: input.governancePacket.summary.acceptedByPolicy,
      policySource: input.governancePacket.summary.policySource,
      policyProjectID: input.governancePacket.summary.policyProjectID,
      signedArchiveID: input.governancePacket.summary.signedArchiveID,
      releasePacketID: input.governancePacket.summary.releasePacketID,
      packageID: input.handoffPackage.packageID,
      documentCount: input.handoffPackage.summary.documentCount,
      inventoryCount: input.handoffPackage.summary.inventoryCount,
      gates,
    })
  }

  export function create(input: {
    governancePacket: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact
    handoffPackage: QualityPromotionHandoffPackage.PackageArtifact
  }) {
    const governanceReasons = QualityPromotionSignedArchiveGovernancePacket.verify(input.governancePacket)
    if (governanceReasons.length > 0) {
      throw new Error(`Cannot create signed archive review dossier for ${input.governancePacket.source}: invalid governance packet (${governanceReasons[0]})`)
    }
    const handoffReasons = QualityPromotionHandoffPackage.verify(input.handoffPackage)
    if (handoffReasons.length > 0) {
      throw new Error(`Cannot create signed archive review dossier for ${input.handoffPackage.source}: invalid handoff package (${handoffReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const dossierID = `${input.governancePacket.packetID}-review-dossier`
    const summary = evaluateSummary(input)
    return DossierArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-review-dossier",
      dossierID,
      source: input.governancePacket.source,
      createdAt,
      governancePacket: input.governancePacket,
      handoffPackage: input.handoffPackage,
      summary,
    })
  }

  export function verify(dossier: DossierArtifact) {
    const reasons: string[] = []
    if (dossier.source !== dossier.governancePacket.source) {
      reasons.push(`signed archive review dossier governance source mismatch: ${dossier.source} vs ${dossier.governancePacket.source}`)
    }
    if (dossier.source !== dossier.handoffPackage.source) {
      reasons.push(`signed archive review dossier handoff source mismatch: ${dossier.source} vs ${dossier.handoffPackage.source}`)
    }
    const governanceReasons = QualityPromotionSignedArchiveGovernancePacket.verify(dossier.governancePacket)
    if (governanceReasons.length > 0) {
      reasons.push(`signed archive review dossier governance packet mismatch for ${dossier.source} (${governanceReasons[0]})`)
    }
    const handoffReasons = QualityPromotionHandoffPackage.verify(dossier.handoffPackage)
    if (handoffReasons.length > 0) {
      reasons.push(`signed archive review dossier handoff package mismatch for ${dossier.source} (${handoffReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      governancePacket: dossier.governancePacket,
      handoffPackage: dossier.handoffPackage,
    })
    if (JSON.stringify(dossier.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`signed archive review dossier summary mismatch for ${dossier.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact["promotion"],
    dossiers: DossierArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((dossier) => matchesPromotion(promotion, dossier))
    const deduped = new Map<string, DossierArtifact>()
    for (const dossier of [...persisted, ...dossiers]) {
      if (!matchesPromotion(promotion, dossier)) continue
      if (verify(dossier).length > 0) continue
      deduped.set(dossier.dossierID, dossier)
    }
    return sortDossiers([...deduped.values()])
  }

  export async function get(input: { source: string; dossierID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.dossierID))
    return DossierRecord.parse(record)
  }

  export async function append(dossier: DossierArtifact) {
    await QualityPromotionSignedArchiveGovernancePacket.append(dossier.governancePacket)
    await QualityPromotionHandoffPackage.append(dossier.handoffPackage)
    const next = DossierRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-review-dossier-record",
      dossier,
    })
    try {
      const existing = await get({ source: dossier.source, dossierID: dossier.dossierID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Signed archive review dossier ${dossier.dossierID} already exists for source ${dossier.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(dossier.source, dossier.dossierID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_signed_archive_review_dossier", encode(source)]] : [["quality_model_signed_archive_review_dossier"]]
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
    await QualityPromotionSignedArchiveGovernancePacket.assertPersisted(dossier.governancePacket)
    await QualityPromotionHandoffPackage.assertPersisted(dossier.handoffPackage)
    const persisted = await get({ source: dossier.source, dossierID: dossier.dossierID })
    const prev = JSON.stringify(persisted.dossier)
    const curr = JSON.stringify(dossier)
    if (prev !== curr) {
      throw new Error(`Persisted signed archive review dossier ${dossier.dossierID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(dossier: DossierArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive review dossier")
    lines.push("")
    lines.push(`- source: ${dossier.source}`)
    lines.push(`- dossier id: ${dossier.dossierID}`)
    lines.push(`- created at: ${dossier.createdAt}`)
    lines.push(`- promotion id: ${dossier.governancePacket.promotion.promotionID}`)
    lines.push(`- governance packet id: ${dossier.governancePacket.packetID}`)
    lines.push(`- handoff package id: ${dossier.handoffPackage.packageID}`)
    lines.push(`- release packet id: ${dossier.summary.releasePacketID}`)
    lines.push(`- signed archive id: ${dossier.summary.signedArchiveID}`)
    lines.push(`- authorized promotion: ${dossier.summary.authorizedPromotion}`)
    lines.push(`- promotion mode: ${dossier.summary.promotionMode}`)
    lines.push(`- trusted: ${dossier.summary.trusted}`)
    lines.push(`- accepted by policy: ${dossier.summary.acceptedByPolicy}`)
    lines.push(`- policy source: ${dossier.summary.policySource}`)
    lines.push(`- policy project id: ${dossier.summary.policyProjectID ?? "n/a"}`)
    lines.push(`- overall status: ${dossier.summary.overallStatus}`)
    lines.push(`- document count: ${dossier.summary.documentCount}`)
    lines.push(`- inventory count: ${dossier.summary.inventoryCount}`)
    lines.push("")
    for (const gate of dossier.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
