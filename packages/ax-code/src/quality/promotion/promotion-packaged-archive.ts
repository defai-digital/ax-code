import fs from "fs/promises"
import path from "path"
import z from "zod"
import { sha256Hex } from "../digest"
import { QualityPromotionPortableExport } from "./promotion-portable-export"
import { createPromotionArtifactStore } from "./artifact-store"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { overallStatusFromGates, pushGateLines } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

export namespace QualityPromotionPackagedArchive {
  export const Entry = z.object({
    path: z.string(),
    format: z.enum(["json", "markdown"]),
    encoding: z.literal("utf8"),
    contentDigest: z.string(),
    content: z.string(),
  })
  export type Entry = z.output<typeof Entry>

  export const ArchiveSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    portableExportStatus: z.enum(["pass", "fail"]),
    handoffPackageStatus: z.enum(["pass", "fail"]),
    archiveManifestStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    entryCount: z.number().int().positive(),
    fileCount: z.number().int().positive(),
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
    kind: z.literal("ax-code-quality-promotion-packaged-archive"),
    archiveID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    packageDigest: z.string(),
    portableExport: z.lazy(() => QualityPromotionPortableExport.ExportArtifact),
    entries: z.array(Entry),
    summary: ArchiveSummary,
  })
  export type ArchiveArtifact = z.output<typeof ArchiveArtifact>

  export const ArchiveRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-packaged-archive-record"),
    archive: ArchiveArtifact,
  })
  export type ArchiveRecord = z.output<typeof ArchiveRecord>

  const digest = sha256Hex

  function sortArchives(archives: ArchiveArtifact[]) {
    return [...archives].sort((a, b) => compareStringFields(a, b, ["createdAt", "archiveID"]))
  }

  const store = createPromotionArtifactStore<ArchiveArtifact, ArchiveRecord>({
    keyPrefix: "quality_model_packaged_archive",
    recordKind: "ax-code-quality-promotion-packaged-archive-record",
    artifactField: "archive",
    idField: "archiveID",
    noun: "Promotion packaged archive",
    recordSchema: ArchiveRecord,
    sort: sortArchives,
    parent: {
      append: (archive) => QualityPromotionPortableExport.append(archive.portableExport),
      assertPersisted: (archive) => QualityPromotionPortableExport.assertPersisted(archive.portableExport),
    },
  })

  function sortEntries(entries: Entry[]) {
    return [...entries].sort((a, b) => a.path.localeCompare(b.path))
  }

  function matchesPromotion(
    promotion: QualityPromotionPortableExport.ExportArtifact["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    archive: ArchiveArtifact,
  ) {
    return (
      archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID ===
        promotion.promotionID &&
      archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.source ===
        promotion.source
    )
  }

  function buildEntries(portableExport: QualityPromotionPortableExport.ExportArtifact) {
    return sortEntries(
      Entry.array().parse(
        portableExport.files.map((file) => ({
          path: file.path,
          format: file.format,
          encoding: "utf8",
          contentDigest: file.contentDigest,
          content: file.content,
        })),
      ),
    )
  }

  function computePackageDigest(entries: Entry[]) {
    return digest(JSON.stringify(entries))
  }

  function evaluateSummary(
    portableExport: QualityPromotionPortableExport.ExportArtifact,
    entries: Entry[],
    verification: { exportReasons: string[] },
  ) {
    const { exportReasons } = verification
    const expectedEntries = buildEntries(portableExport)
    const entriesMatch = jsonEqual(entries, expectedEntries)
    const digestCoverage = entries.every((entry) => entry.contentDigest.length > 0)
    const exportReady = exportReasons.length === 0 && portableExport.summary.overallStatus === "pass"
    const gates = [
      {
        name: "portable-export-verification",
        status: exportReady ? "pass" : "fail",
        detail:
          exportReasons[0] ??
          (portableExport.summary.overallStatus === "pass"
            ? `portable export ${portableExport.exportID} is valid`
            : `portable export ${portableExport.exportID} status is ${portableExport.summary.overallStatus}`),
      },
      {
        name: "entry-coverage",
        status: entriesMatch ? "pass" : "fail",
        detail: entriesMatch
          ? `${entries.length}/${expectedEntries.length} packaged archive entrie(s) captured`
          : `packaged archive entry mismatch: expected ${expectedEntries.length} entrie(s), got ${entries.length}`,
      },
      {
        name: "entry-digest-coverage",
        status: digestCoverage ? "pass" : "fail",
        detail: digestCoverage
          ? `${entries.length} packaged archive digest(s) recorded`
          : "one or more packaged archive entry digests are missing",
      },
      {
        name: "file-linkage",
        status: portableExport.summary.fileCount === entries.length ? "pass" : "fail",
        detail: `portable export file count=${portableExport.summary.fileCount} archive entries=${entries.length}`,
      },
    ] as const

    return ArchiveSummary.parse({
      overallStatus: overallStatusFromGates(gates),
      portableExportStatus: portableExport.summary.overallStatus,
      handoffPackageStatus: portableExport.handoffPackage.summary.overallStatus,
      archiveManifestStatus: portableExport.handoffPackage.archiveManifest.summary.overallStatus,
      promotionRecorded: portableExport.summary.promotionRecorded,
      promotionDecision: portableExport.summary.promotionDecision,
      promotionMode: portableExport.summary.promotionMode,
      authorizedPromotion: portableExport.summary.authorizedPromotion,
      entryCount: entries.length,
      fileCount: portableExport.summary.fileCount,
      previousActiveSource: portableExport.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: { portableExport: QualityPromotionPortableExport.ExportArtifact }) {
    const exportReasons = QualityPromotionPortableExport.verify(input.portableExport)
    if (exportReasons.length > 0) {
      throw new Error(
        `Cannot create packaged archive for ${input.portableExport.source}: invalid portable export (${exportReasons[0]})`,
      )
    }
    const createdAt = new Date().toISOString()
    const archiveID = `${input.portableExport.exportID}-packaged-archive`
    const entries = buildEntries(input.portableExport)
    const summary = evaluateSummary(input.portableExport, entries, { exportReasons })
    return ArchiveArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-packaged-archive",
      archiveID,
      source: input.portableExport.source,
      createdAt,
      packageDigest: computePackageDigest(entries),
      portableExport: input.portableExport,
      entries,
      summary,
    })
  }

  export function verify(archive: ArchiveArtifact) {
    const reasons: string[] = []
    if (archive.source !== archive.portableExport.source) {
      reasons.push(`packaged archive source mismatch: ${archive.source} vs ${archive.portableExport.source}`)
    }
    const exportReasons = QualityPromotionPortableExport.verify(archive.portableExport)
    if (exportReasons.length > 0) {
      reasons.push(`packaged archive portable export mismatch for ${archive.source} (${exportReasons[0]})`)
    }
    const expectedEntries = buildEntries(archive.portableExport)
    if (!jsonEqual(archive.entries, expectedEntries)) {
      reasons.push(`packaged archive entries mismatch for ${archive.source}`)
    }
    const expectedDigest = computePackageDigest(archive.entries)
    if (archive.packageDigest !== expectedDigest) {
      reasons.push(`packaged archive digest mismatch for ${archive.source}`)
    }
    const expectedSummary = evaluateSummary(archive.portableExport, archive.entries, { exportReasons })
    if (!jsonEqual(archive.summary, expectedSummary)) {
      reasons.push(`packaged archive summary mismatch for ${archive.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionPortableExport.ExportArtifact["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
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

  export async function materialize(archive: ArchiveArtifact, filePath: string) {
    const reasons = verify(archive)
    if (reasons.length > 0) {
      throw new Error(`Cannot materialize packaged archive for ${archive.source}: invalid archive (${reasons[0]})`)
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = JSON.stringify(archive, null, 2) + "\n"
    await fs.writeFile(filePath, content)
    return {
      filePath,
      byteLength: Buffer.byteLength(content),
    }
  }

  export async function extract(archive: ArchiveArtifact, directory: string) {
    const reasons = verify(archive)
    if (reasons.length > 0) {
      throw new Error(`Cannot extract packaged archive for ${archive.source}: invalid archive (${reasons[0]})`)
    }
    await fs.mkdir(directory, { recursive: true })
    for (const entry of archive.entries) {
      const target = path.join(directory, entry.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, entry.content)
    }
    return {
      directory,
      entryCount: archive.entries.length,
    }
  }

  export function renderReport(archive: ArchiveArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion packaged archive")
    lines.push("")
    lines.push(`- source: ${archive.source}`)
    lines.push(`- archive id: ${archive.archiveID}`)
    lines.push(`- created at: ${archive.createdAt}`)
    lines.push(`- portable export id: ${archive.portableExport.exportID}`)
    lines.push(
      `- promotion id: ${archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID}`,
    )
    lines.push(`- promotion mode: ${archive.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${archive.summary.authorizedPromotion}`)
    lines.push(`- package digest: ${archive.packageDigest}`)
    lines.push(`- entry count: ${archive.summary.entryCount}`)
    lines.push(`- file count: ${archive.summary.fileCount}`)
    lines.push(`- overall status: ${archive.summary.overallStatus}`)
    lines.push("")
    lines.push("### Entries")
    lines.push("")
    for (const entry of archive.entries) {
      lines.push(`- ${entry.path}: ${entry.format} · digest=${entry.contentDigest}`)
    }
    lines.push("")
    pushGateLines(lines, archive.summary.gates)
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ArchiveSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion packaged archive summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- portable export status: ${summary.portableExportStatus}`)
    lines.push(`- handoff package status: ${summary.handoffPackageStatus}`)
    lines.push(`- archive manifest status: ${summary.archiveManifestStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- entry count: ${summary.entryCount}`)
    lines.push(`- file count: ${summary.fileCount}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    pushGateLines(lines, summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
