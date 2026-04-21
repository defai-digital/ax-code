import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionApprovalPacket } from "./promotion-approval-packet"
import { QualityPromotionArchiveManifest } from "./promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "./promotion-audit-manifest"
import { QualityPromotionBoardDecision } from "./promotion-board-decision"
import { QualityPromotionDecisionBundle } from "./promotion-decision-bundle"
import { QualityPromotionExportBundle } from "./promotion-export-bundle"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "./promotion-release-packet"
import { QualityPromotionReviewDossier } from "./promotion-review-dossier"
import { QualityPromotionSubmissionBundle } from "./promotion-submission-bundle"

export namespace QualityPromotionHandoffPackage {
  export const DocumentKind = z.enum([
    "index",
    "decision_bundle",
    "approval_packet",
    "submission_bundle",
    "review_dossier",
    "board_decision",
    "release_decision_record",
    "release_packet",
    "audit_manifest",
    "export_bundle",
    "archive_manifest",
  ])
  export type DocumentKind = z.output<typeof DocumentKind>

  export const Document = z.object({
    kind: DocumentKind,
    name: z.string(),
    format: z.literal("markdown"),
    artifactID: z.string().nullable(),
    artifactDigest: z.string().nullable(),
    contentDigest: z.string(),
    content: z.string(),
  })
  export type Document = z.output<typeof Document>

  export const PackageSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    archiveManifestStatus: z.enum(["pass", "fail"]),
    exportBundleStatus: z.enum(["pass", "fail"]),
    auditManifestStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    documentCount: z.number().int().positive(),
    inventoryCount: z.number().int().positive(),
    previousActiveSource: z.string().nullable(),
    gates: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      detail: z.string(),
    })),
  })
  export type PackageSummary = z.output<typeof PackageSummary>

  export const PackageArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-handoff-package"),
    packageID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    archiveManifest: z.lazy(() => QualityPromotionArchiveManifest.ArchiveArtifact),
    documents: z.array(Document),
    summary: PackageSummary,
  })
  export type PackageArtifact = z.output<typeof PackageArtifact>

  export const PackageRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-handoff-package-record"),
    packet: PackageArtifact,
  })
  export type PackageRecord = z.output<typeof PackageRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, packageID: string) {
    return ["quality_model_handoff_package", encode(source), packageID]
  }

  function digest(input: unknown) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex")
  }

  function sortPackages(packets: PackageArtifact[]) {
    return [...packets].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.packageID.localeCompare(b.packageID)
    })
  }

  function sortDocuments(documents: Document[]) {
    return [...documents].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind))
  }

  function matchesPromotion(
    promotion: QualityPromotionArchiveManifest.ArchiveArtifact["exportBundle"]["auditManifest"]["promotion"],
    packet: PackageArtifact,
  ) {
    return packet.archiveManifest.exportBundle.auditManifest.promotion.promotionID === promotion.promotionID
      && packet.archiveManifest.exportBundle.auditManifest.promotion.source === promotion.source
  }

  function inventoryByKind(archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact) {
    return new Map(archiveManifest.inventory.map((item) => [item.kind, item]))
  }

  function renderIndex(archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact) {
    const exportBundle = archiveManifest.exportBundle
    const auditManifest = exportBundle.auditManifest
    const releasePacket = auditManifest.releasePacket
    const lines: string[] = []
    lines.push("## ax-code quality promotion handoff packet")
    lines.push("")
    lines.push(`- source: ${archiveManifest.source}`)
    lines.push(`- promotion id: ${auditManifest.promotion.promotionID}`)
    lines.push(`- decision: ${archiveManifest.summary.promotionDecision}`)
    lines.push(`- promotion mode: ${archiveManifest.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${archiveManifest.summary.authorizedPromotion}`)
    lines.push(`- release packet id: ${releasePacket.packetID}`)
    lines.push(`- audit manifest id: ${auditManifest.manifestID}`)
    lines.push(`- export bundle id: ${exportBundle.bundleID}`)
    lines.push(`- archive manifest id: ${archiveManifest.archiveID}`)
    lines.push(`- inventory count: ${archiveManifest.summary.inventoryCount}`)
    lines.push(`- overall status: ${archiveManifest.summary.overallStatus}`)
    lines.push("")
    lines.push("### Included Documents")
    lines.push("")
    for (const item of archiveManifest.inventory) {
      lines.push(`- ${item.kind}: ${item.artifactID} · digest=${item.digest}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  function buildDocuments(archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact) {
    const exportBundle = archiveManifest.exportBundle
    const auditManifest = exportBundle.auditManifest
    const releasePacket = auditManifest.releasePacket
    const releaseDecisionRecord = releasePacket.releaseDecisionRecord
    const boardDecision = releaseDecisionRecord.boardDecision
    const reviewDossier = boardDecision.reviewDossier
    const submissionBundle = reviewDossier.submissionBundle
    const approvalPacket = submissionBundle.approvalPacket
    const decisionBundle = submissionBundle.decisionBundle
    const inventory = inventoryByKind(archiveManifest)
    const documentInput = [
      {
        kind: "index" as const,
        name: "00-index.md",
        artifactID: null,
        artifactDigest: null,
        content: renderIndex(archiveManifest),
      },
      {
        kind: "decision_bundle" as const,
        name: "10-decision-bundle.md",
        artifactID: inventory.get("decision_bundle")?.artifactID ?? null,
        artifactDigest: inventory.get("decision_bundle")?.digest ?? null,
        content: QualityPromotionDecisionBundle.renderReport(decisionBundle),
      },
      {
        kind: "approval_packet" as const,
        name: "20-approval-packet.md",
        artifactID: inventory.get("approval_packet")?.artifactID ?? null,
        artifactDigest: inventory.get("approval_packet")?.digest ?? null,
        content: QualityPromotionApprovalPacket.renderReport(approvalPacket),
      },
      {
        kind: "submission_bundle" as const,
        name: "30-submission-bundle.md",
        artifactID: inventory.get("submission_bundle")?.artifactID ?? null,
        artifactDigest: inventory.get("submission_bundle")?.digest ?? null,
        content: QualityPromotionSubmissionBundle.renderReport(submissionBundle),
      },
      {
        kind: "review_dossier" as const,
        name: "40-review-dossier.md",
        artifactID: inventory.get("review_dossier")?.artifactID ?? null,
        artifactDigest: inventory.get("review_dossier")?.digest ?? null,
        content: QualityPromotionReviewDossier.renderReport(reviewDossier),
      },
      {
        kind: "board_decision" as const,
        name: "50-board-decision.md",
        artifactID: inventory.get("board_decision")?.artifactID ?? null,
        artifactDigest: inventory.get("board_decision")?.digest ?? null,
        content: QualityPromotionBoardDecision.renderReport(boardDecision),
      },
      {
        kind: "release_decision_record" as const,
        name: "60-release-decision-record.md",
        artifactID: inventory.get("release_decision_record")?.artifactID ?? null,
        artifactDigest: inventory.get("release_decision_record")?.digest ?? null,
        content: QualityPromotionReleaseDecisionRecord.renderReport(releaseDecisionRecord),
      },
      {
        kind: "release_packet" as const,
        name: "70-release-packet.md",
        artifactID: inventory.get("release_packet")?.artifactID ?? null,
        artifactDigest: inventory.get("release_packet")?.digest ?? null,
        content: QualityPromotionReleasePacket.renderReport(releasePacket),
      },
      {
        kind: "audit_manifest" as const,
        name: "80-audit-manifest.md",
        artifactID: inventory.get("audit_manifest")?.artifactID ?? null,
        artifactDigest: inventory.get("audit_manifest")?.digest ?? null,
        content: QualityPromotionAuditManifest.renderReport(auditManifest),
      },
      {
        kind: "export_bundle" as const,
        name: "90-export-bundle.md",
        artifactID: inventory.get("export_bundle")?.artifactID ?? null,
        artifactDigest: inventory.get("export_bundle")?.digest ?? null,
        content: QualityPromotionExportBundle.renderReport(exportBundle),
      },
      {
        kind: "archive_manifest" as const,
        name: "99-archive-manifest.md",
        artifactID: archiveManifest.archiveID,
        artifactDigest: digest(archiveManifest),
        content: QualityPromotionArchiveManifest.renderReport(archiveManifest),
      },
    ]

    return sortDocuments(Document.array().parse(documentInput.map((item) => ({
      ...item,
      format: "markdown",
      contentDigest: digest(item.content),
    }))))
  }

  function evaluateSummary(archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact, documents: Document[]) {
    const archiveReasons = QualityPromotionArchiveManifest.verify(archiveManifest)
    const expectedDocuments = buildDocuments(archiveManifest)
    const documentsMatch = JSON.stringify(documents) === JSON.stringify(expectedDocuments)
    const digestCoverage = documents.every((document) => (
      document.contentDigest.length > 0
      && (document.kind === "index" || (document.artifactDigest?.length ?? 0) > 0)
    ))
    const gates = [
      {
        name: "archive-manifest-verification",
        status: archiveReasons.length === 0 ? "pass" : "fail",
        detail: archiveReasons[0] ?? `archive manifest ${archiveManifest.archiveID} is valid`,
      },
      {
        name: "document-coverage",
        status: documentsMatch ? "pass" : "fail",
        detail: documentsMatch
          ? `${documents.length}/${expectedDocuments.length} handoff document(s) captured`
          : `handoff document mismatch: expected ${expectedDocuments.length} document(s), got ${documents.length}`,
      },
      {
        name: "document-digest-coverage",
        status: digestCoverage ? "pass" : "fail",
        detail: digestCoverage
          ? `${documents.length} handoff document digest(s) recorded`
          : "one or more handoff document digests are missing",
      },
      {
        name: "inventory-linkage",
        status: archiveManifest.summary.inventoryCount === archiveManifest.inventory.length ? "pass" : "fail",
        detail: `archive inventory count=${archiveManifest.summary.inventoryCount} linked inventory entries=${archiveManifest.inventory.length}`,
      },
    ] as const

    return PackageSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      archiveManifestStatus: archiveManifest.summary.overallStatus,
      exportBundleStatus: archiveManifest.exportBundle.summary.overallStatus,
      auditManifestStatus: archiveManifest.exportBundle.auditManifest.summary.overallStatus,
      releasePacketStatus: archiveManifest.exportBundle.auditManifest.releasePacket.summary.overallStatus,
      promotionRecorded: archiveManifest.summary.promotionRecorded,
      promotionDecision: archiveManifest.summary.promotionDecision,
      promotionMode: archiveManifest.summary.promotionMode,
      authorizedPromotion: archiveManifest.summary.authorizedPromotion,
      documentCount: documents.length,
      inventoryCount: archiveManifest.summary.inventoryCount,
      previousActiveSource: archiveManifest.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: {
    archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact
  }) {
    const archiveReasons = QualityPromotionArchiveManifest.verify(input.archiveManifest)
    if (archiveReasons.length > 0) {
      throw new Error(`Cannot create promotion handoff package for ${input.archiveManifest.source}: invalid archive manifest (${archiveReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const packageID = `${input.archiveManifest.archiveID}-handoff-package`
    const documents = buildDocuments(input.archiveManifest)
    const summary = evaluateSummary(input.archiveManifest, documents)
    return PackageArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-handoff-package",
      packageID,
      source: input.archiveManifest.source,
      createdAt,
      archiveManifest: input.archiveManifest,
      documents,
      summary,
    })
  }

  export function verify(packet: PackageArtifact) {
    const reasons: string[] = []
    if (packet.source !== packet.archiveManifest.source) {
      reasons.push(`handoff package source mismatch: ${packet.source} vs ${packet.archiveManifest.source}`)
    }
    const archiveReasons = QualityPromotionArchiveManifest.verify(packet.archiveManifest)
    if (archiveReasons.length > 0) {
      reasons.push(`handoff package archive manifest mismatch for ${packet.source} (${archiveReasons[0]})`)
    }
    const expectedDocuments = buildDocuments(packet.archiveManifest)
    if (JSON.stringify(packet.documents) !== JSON.stringify(expectedDocuments)) {
      reasons.push(`handoff package documents mismatch for ${packet.source}`)
    }
    const expectedSummary = evaluateSummary(packet.archiveManifest, packet.documents)
    if (JSON.stringify(packet.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`handoff package summary mismatch for ${packet.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionArchiveManifest.ArchiveArtifact["exportBundle"]["auditManifest"]["promotion"],
    packets: PackageArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((packet) => matchesPromotion(promotion, packet))
    const deduped = new Map<string, PackageArtifact>()
    for (const packet of [...persisted, ...packets]) {
      if (!matchesPromotion(promotion, packet)) continue
      if (verify(packet).length > 0) continue
      deduped.set(packet.packageID, packet)
    }
    return sortPackages([...deduped.values()])
  }

  export async function get(input: { source: string; packageID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.packageID))
    return PackageRecord.parse(record)
  }

  export async function append(packet: PackageArtifact) {
    await QualityPromotionArchiveManifest.append(packet.archiveManifest)
    const next = PackageRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-handoff-package-record",
      packet,
    })
    try {
      const existing = await get({ source: packet.source, packageID: packet.packageID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Promotion handoff package ${packet.packageID} already exists for source ${packet.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(packet.source, packet.packageID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_handoff_package", encode(source)]] : [["quality_model_handoff_package"]]
    const packets: PackageArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const packageID = parts[parts.length - 1]
        if (!encodedSource || !packageID) continue
        const record = await get({ source: decode(encodedSource), packageID })
        packets.push(record.packet)
      }
    }

    return sortPackages(packets)
  }

  export async function assertPersisted(packet: PackageArtifact) {
    await QualityPromotionArchiveManifest.assertPersisted(packet.archiveManifest)
    const persisted = await get({ source: packet.source, packageID: packet.packageID })
    const prev = JSON.stringify(persisted.packet)
    const curr = JSON.stringify(packet)
    if (prev !== curr) {
      throw new Error(`Persisted promotion handoff package ${packet.packageID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(packet: PackageArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion handoff package")
    lines.push("")
    lines.push(`- source: ${packet.source}`)
    lines.push(`- package id: ${packet.packageID}`)
    lines.push(`- created at: ${packet.createdAt}`)
    lines.push(`- archive manifest id: ${packet.archiveManifest.archiveID}`)
    lines.push(`- export bundle id: ${packet.archiveManifest.exportBundle.bundleID}`)
    lines.push(`- promotion id: ${packet.archiveManifest.exportBundle.auditManifest.promotion.promotionID}`)
    lines.push(`- promotion mode: ${packet.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${packet.summary.authorizedPromotion}`)
    lines.push(`- document count: ${packet.summary.documentCount}`)
    lines.push(`- inventory count: ${packet.summary.inventoryCount}`)
    lines.push(`- overall status: ${packet.summary.overallStatus}`)
    lines.push("")
    lines.push("### Documents")
    lines.push("")
    for (const document of packet.documents) {
      lines.push(`- ${document.name}: ${document.kind} · artifact=${document.artifactID ?? "n/a"} · digest=${document.contentDigest}`)
    }
    lines.push("")
    for (const gate of packet.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: PackageSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion handoff package summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- archive manifest status: ${summary.archiveManifestStatus}`)
    lines.push(`- export bundle status: ${summary.exportBundleStatus}`)
    lines.push(`- audit manifest status: ${summary.auditManifestStatus}`)
    lines.push(`- release packet status: ${summary.releasePacketStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- document count: ${summary.documentCount}`)
    lines.push(`- inventory count: ${summary.inventoryCount}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
