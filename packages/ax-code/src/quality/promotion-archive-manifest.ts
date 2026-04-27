import { createHash } from "crypto"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionExportBundle } from "./promotion-export-bundle"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"

export namespace QualityPromotionArchiveManifest {
  export const InventoryKind = z.enum([
    "decision_bundle",
    "approval_packet",
    "submission_bundle",
    "review_dossier",
    "board_decision",
    "release_decision_record",
    "release_packet",
    "audit_manifest",
    "export_bundle",
  ])
  export type InventoryKind = z.output<typeof InventoryKind>

  export const InventoryItem = z.object({
    kind: InventoryKind,
    artifactID: z.string(),
    createdAt: z.string(),
    digest: z.string(),
  })
  export type InventoryItem = z.output<typeof InventoryItem>

  export const ArchiveSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    exportBundleStatus: z.enum(["pass", "fail"]),
    auditManifestStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    inventoryCount: z.number().int().positive(),
    previousActiveSource: z.string().nullable(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type ArchiveSummary = z.output<typeof ArchiveSummary>

  export const ArchiveArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-archive-manifest"),
    archiveID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    exportBundle: z.lazy(() => QualityPromotionExportBundle.ExportArtifact),
    inventory: z.array(InventoryItem),
    summary: ArchiveSummary,
  })
  export type ArchiveArtifact = z.output<typeof ArchiveArtifact>

  export const ArchiveRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-archive-manifest-record"),
    archive: ArchiveArtifact,
  })
  export type ArchiveRecord = z.output<typeof ArchiveRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, archiveID: string) {
    return ["quality_model_archive_manifest", encode(source), archiveID]
  }

  function digest(input: unknown) {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex")
  }

  function sortArchives(archives: ArchiveArtifact[]) {
    return [...archives].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.archiveID.localeCompare(b.archiveID)
    })
  }

  function sortInventory(items: InventoryItem[]) {
    return [...items].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      const byKind = a.kind.localeCompare(b.kind)
      if (byKind !== 0) return byKind
      return a.artifactID.localeCompare(b.artifactID)
    })
  }

  function matchesPromotion(
    promotion: QualityPromotionExportBundle.ExportArtifact["auditManifest"]["promotion"],
    archive: ArchiveArtifact,
  ) {
    return (
      archive.exportBundle.auditManifest.promotion.promotionID === promotion.promotionID &&
      archive.exportBundle.auditManifest.promotion.source === promotion.source
    )
  }

  function buildInventory(exportBundle: QualityPromotionExportBundle.ExportArtifact) {
    const auditManifest = exportBundle.auditManifest
    const releasePacket = auditManifest.releasePacket
    const releaseDecisionRecord = releasePacket.releaseDecisionRecord
    const boardDecision = releaseDecisionRecord.boardDecision
    const reviewDossier = boardDecision.reviewDossier
    const submissionBundle = reviewDossier.submissionBundle
    const approvalPacket = submissionBundle.approvalPacket
    const decisionBundle = submissionBundle.decisionBundle

    return sortInventory(
      InventoryItem.array().parse([
        {
          kind: "decision_bundle",
          artifactID: `${decisionBundle.source}:${decisionBundle.createdAt}`,
          createdAt: decisionBundle.createdAt,
          digest: digest(decisionBundle),
        },
        {
          kind: "approval_packet",
          artifactID: approvalPacket.packetID,
          createdAt: approvalPacket.createdAt,
          digest: digest(approvalPacket),
        },
        {
          kind: "submission_bundle",
          artifactID: submissionBundle.submissionID,
          createdAt: submissionBundle.createdAt,
          digest: digest(submissionBundle),
        },
        {
          kind: "review_dossier",
          artifactID: reviewDossier.dossierID,
          createdAt: reviewDossier.createdAt,
          digest: digest(reviewDossier),
        },
        {
          kind: "board_decision",
          artifactID: boardDecision.decisionID,
          createdAt: boardDecision.decidedAt,
          digest: digest(boardDecision),
        },
        {
          kind: "release_decision_record",
          artifactID: releaseDecisionRecord.recordID,
          createdAt: releaseDecisionRecord.recordedAt,
          digest: digest(releaseDecisionRecord),
        },
        {
          kind: "release_packet",
          artifactID: releasePacket.packetID,
          createdAt: releasePacket.createdAt,
          digest: digest(releasePacket),
        },
        {
          kind: "audit_manifest",
          artifactID: auditManifest.manifestID,
          createdAt: auditManifest.createdAt,
          digest: digest(auditManifest),
        },
        {
          kind: "export_bundle",
          artifactID: exportBundle.bundleID,
          createdAt: exportBundle.createdAt,
          digest: digest(exportBundle),
        },
      ]),
    )
  }

  function evaluateSummary(exportBundle: QualityPromotionExportBundle.ExportArtifact, inventory: InventoryItem[]) {
    const exportReasons = QualityPromotionExportBundle.verify(exportBundle)
    const expectedInventory = buildInventory(exportBundle)
    const inventoryMatches = JSON.stringify(inventory) === JSON.stringify(expectedInventory)
    const digestsPresent = inventory.every((item) => item.digest.length > 0)
    const gates = [
      {
        name: "export-bundle-verification",
        status: exportReasons.length === 0 ? "pass" : "fail",
        detail: exportReasons[0] ?? `export bundle ${exportBundle.bundleID} is valid`,
      },
      {
        name: "inventory-completeness",
        status: inventoryMatches ? "pass" : "fail",
        detail: inventoryMatches
          ? `${inventory.length}/${expectedInventory.length} archive inventory item(s) captured`
          : `archive inventory mismatch: expected ${expectedInventory.length} item(s), got ${inventory.length}`,
      },
      {
        name: "inventory-digest-coverage",
        status: digestsPresent ? "pass" : "fail",
        detail: digestsPresent
          ? `${inventory.length} archive inventory digest(s) recorded`
          : "one or more archive inventory digests are missing",
      },
      {
        name: "promotion-linkage",
        status:
          exportBundle.auditManifest.promotion.releasePacket?.packetID ===
          exportBundle.auditManifest.releasePacket.packetID
            ? "pass"
            : "fail",
        detail: `promotion packet=${exportBundle.auditManifest.promotion.releasePacket?.packetID ?? "n/a"} archive packet=${exportBundle.auditManifest.releasePacket.packetID}`,
      },
    ] as const

    return ArchiveSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      exportBundleStatus: exportBundle.summary.overallStatus,
      auditManifestStatus: exportBundle.auditManifest.summary.overallStatus,
      releasePacketStatus: exportBundle.auditManifest.releasePacket.summary.overallStatus,
      promotionRecorded: exportBundle.summary.promotionRecorded,
      promotionDecision: exportBundle.summary.promotionDecision,
      promotionMode: exportBundle.summary.promotionMode,
      authorizedPromotion: exportBundle.summary.authorizedPromotion,
      inventoryCount: inventory.length,
      previousActiveSource: exportBundle.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: { exportBundle: QualityPromotionExportBundle.ExportArtifact }) {
    const exportReasons = QualityPromotionExportBundle.verify(input.exportBundle)
    if (exportReasons.length > 0) {
      throw new Error(
        `Cannot create promotion archive manifest for ${input.exportBundle.source}: invalid export bundle (${exportReasons[0]})`,
      )
    }
    const createdAt = new Date().toISOString()
    const archiveID = `${input.exportBundle.bundleID}-archive-manifest`
    const inventory = buildInventory(input.exportBundle)
    const summary = evaluateSummary(input.exportBundle, inventory)
    return ArchiveArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-archive-manifest",
      archiveID,
      source: input.exportBundle.source,
      createdAt,
      exportBundle: input.exportBundle,
      inventory,
      summary,
    })
  }

  export function verify(archive: ArchiveArtifact) {
    const reasons: string[] = []
    if (archive.source !== archive.exportBundle.source) {
      reasons.push(`archive manifest source mismatch: ${archive.source} vs ${archive.exportBundle.source}`)
    }
    const exportReasons = QualityPromotionExportBundle.verify(archive.exportBundle)
    if (exportReasons.length > 0) {
      reasons.push(`archive manifest export bundle mismatch for ${archive.source} (${exportReasons[0]})`)
    }
    const expectedInventory = buildInventory(archive.exportBundle)
    if (JSON.stringify(archive.inventory) !== JSON.stringify(expectedInventory)) {
      reasons.push(`archive manifest inventory mismatch for ${archive.source}`)
    }
    const expectedSummary = evaluateSummary(archive.exportBundle, archive.inventory)
    if (JSON.stringify(archive.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`archive manifest summary mismatch for ${archive.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionExportBundle.ExportArtifact["auditManifest"]["promotion"],
    archives: ArchiveArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((archive) => matchesPromotion(promotion, archive))
    const deduped = new Map<string, ArchiveArtifact>()
    for (const archive of [...persisted, ...archives]) {
      if (!matchesPromotion(promotion, archive)) continue
      if (verify(archive).length > 0) continue
      deduped.set(archive.archiveID, archive)
    }
    return sortArchives([...deduped.values()])
  }

  export async function get(input: { source: string; archiveID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.archiveID))
    return ArchiveRecord.parse(record)
  }

  export async function append(archive: ArchiveArtifact) {
    await QualityPromotionExportBundle.append(archive.exportBundle)
    const next = ArchiveRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-archive-manifest-record",
      archive,
    })
    try {
      const existing = await get({ source: archive.source, archiveID: archive.archiveID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion archive manifest ${archive.archiveID} already exists for source ${archive.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(archive.source, archive.archiveID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source
      ? [["quality_model_archive_manifest", encode(source)]]
      : [["quality_model_archive_manifest"]]
    const archives: ArchiveArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const archiveID = parts[parts.length - 1]
        if (!encodedSource || !archiveID) continue
        const record = await get({ source: decode(encodedSource), archiveID })
        archives.push(record.archive)
      }
    }

    return sortArchives(archives)
  }

  export async function assertPersisted(archive: ArchiveArtifact) {
    await QualityPromotionExportBundle.assertPersisted(archive.exportBundle)
    const persisted = await get({ source: archive.source, archiveID: archive.archiveID })
    const prev = JSON.stringify(persisted.archive)
    const curr = JSON.stringify(archive)
    if (prev !== curr) {
      throw new Error(`Persisted promotion archive manifest ${archive.archiveID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(archive: ArchiveArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion archive manifest")
    lines.push("")
    lines.push(`- source: ${archive.source}`)
    lines.push(`- archive id: ${archive.archiveID}`)
    lines.push(`- created at: ${archive.createdAt}`)
    lines.push(`- export bundle id: ${archive.exportBundle.bundleID}`)
    lines.push(`- audit manifest id: ${archive.exportBundle.auditManifest.manifestID}`)
    lines.push(`- promotion id: ${archive.exportBundle.auditManifest.promotion.promotionID}`)
    lines.push(`- promotion mode: ${archive.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${archive.summary.authorizedPromotion}`)
    lines.push(`- inventory count: ${archive.summary.inventoryCount}`)
    lines.push(`- overall status: ${archive.summary.overallStatus}`)
    lines.push("")
    lines.push("### Inventory")
    lines.push("")
    for (const item of archive.inventory) {
      lines.push(`- ${item.kind}: ${item.artifactID} · ${item.createdAt} · digest=${item.digest}`)
    }
    lines.push("")
    for (const gate of archive.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ArchiveSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion archive manifest summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- export bundle status: ${summary.exportBundleStatus}`)
    lines.push(`- audit manifest status: ${summary.auditManifestStatus}`)
    lines.push(`- release packet status: ${summary.releasePacketStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
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
