import z from "zod"
import { sha256JsonHex } from "../digest"
import { QualityPromotionExportBundle } from "./promotion-export-bundle"
import { createPromotionArtifactStore } from "./artifact-store"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { overallStatusFromGates, pushGateLines } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

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

  const digest = sha256JsonHex

  function sortArchives(archives: ArchiveArtifact[]) {
    return [...archives].sort((a, b) => compareStringFields(a, b, ["createdAt", "archiveID"]))
  }

  const store = createPromotionArtifactStore<ArchiveArtifact, ArchiveRecord>({
    keyPrefix: "quality_model_archive_manifest",
    recordKind: "ax-code-quality-promotion-archive-manifest-record",
    artifactField: "archive",
    idField: "archiveID",
    noun: "Promotion archive manifest",
    recordSchema: ArchiveRecord,
    sort: sortArchives,
    parent: {
      append: (archive) => QualityPromotionExportBundle.append(archive.exportBundle),
      assertPersisted: (archive) => QualityPromotionExportBundle.assertPersisted(archive.exportBundle),
    },
  })

  function sortInventory(items: InventoryItem[]) {
    return [...items].sort((a, b) => compareStringFields(a, b, ["createdAt", "kind", "artifactID"]))
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

  function evaluateSummary(
    exportBundle: QualityPromotionExportBundle.ExportArtifact,
    inventory: InventoryItem[],
    verification: { exportReasons: string[] },
  ) {
    const { exportReasons } = verification
    const expectedInventory = buildInventory(exportBundle)
    const inventoryMatches = jsonEqual(inventory, expectedInventory)
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
      overallStatus: overallStatusFromGates(gates),
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
    const summary = evaluateSummary(input.exportBundle, inventory, { exportReasons })
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
    if (!jsonEqual(archive.inventory, expectedInventory)) {
      reasons.push(`archive manifest inventory mismatch for ${archive.source}`)
    }
    const expectedSummary = evaluateSummary(archive.exportBundle, archive.inventory, { exportReasons })
    if (!jsonEqual(archive.summary, expectedSummary)) {
      reasons.push(`archive manifest summary mismatch for ${archive.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionExportBundle.ExportArtifact["auditManifest"]["promotion"],
    archives: ArchiveArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((archive) => matchesPromotion(promotion, archive))
    const validArchives = [...persisted, ...archives].filter(
      (archive) => matchesPromotion(promotion, archive) && verify(archive).length === 0,
    )
    return sortArchives(uniqueBy(validArchives, (archive) => archive.archiveID))
  }

  export async function get(input: { source: string; archiveID: string }) {
    return store.get({ source: input.source, id: input.archiveID })
  }

  export function append(archive: ArchiveArtifact) {
    return store.append(archive)
  }

  export function list(source?: string) {
    return store.list(source)
  }

  export function assertPersisted(archive: ArchiveArtifact) {
    return store.assertPersisted(archive)
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
    pushGateLines(lines, archive.summary.gates)
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
    pushGateLines(lines, summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
