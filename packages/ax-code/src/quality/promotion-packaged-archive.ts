import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionPortableExport } from "./promotion-portable-export"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"

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
    gates: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      detail: z.string(),
    })),
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

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, archiveID: string) {
    return ["quality_model_packaged_archive", encode(source), archiveID]
  }

  function digest(input: string) {
    return createHash("sha256").update(input).digest("hex")
  }

  function sortArchives(archives: ArchiveArtifact[]) {
    return [...archives].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.archiveID.localeCompare(b.archiveID)
    })
  }

  function sortEntries(entries: Entry[]) {
    return [...entries].sort((a, b) => a.path.localeCompare(b.path))
  }

  function matchesPromotion(
    promotion: QualityPromotionPortableExport.ExportArtifact["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    archive: ArchiveArtifact,
  ) {
    return archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID === promotion.promotionID
      && archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.source === promotion.source
  }

  function buildEntries(portableExport: QualityPromotionPortableExport.ExportArtifact) {
    return sortEntries(Entry.array().parse(portableExport.files.map((file) => ({
      path: file.path,
      format: file.format,
      encoding: "utf8",
      contentDigest: file.contentDigest,
      content: file.content,
    }))))
  }

  function computePackageDigest(entries: Entry[]) {
    return digest(JSON.stringify(entries))
  }

  function evaluateSummary(portableExport: QualityPromotionPortableExport.ExportArtifact, entries: Entry[]) {
    const exportReasons = QualityPromotionPortableExport.verify(portableExport)
    const expectedEntries = buildEntries(portableExport)
    const entriesMatch = JSON.stringify(entries) === JSON.stringify(expectedEntries)
    const digestCoverage = entries.every((entry) => entry.contentDigest.length > 0)
    const gates = [
      {
        name: "portable-export-verification",
        status: exportReasons.length === 0 ? "pass" : "fail",
        detail: exportReasons[0] ?? `portable export ${portableExport.exportID} is valid`,
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
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
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

  export function create(input: {
    portableExport: QualityPromotionPortableExport.ExportArtifact
  }) {
    const exportReasons = QualityPromotionPortableExport.verify(input.portableExport)
    if (exportReasons.length > 0) {
      throw new Error(`Cannot create packaged archive for ${input.portableExport.source}: invalid portable export (${exportReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const archiveID = `${input.portableExport.exportID}-packaged-archive`
    const entries = buildEntries(input.portableExport)
    const summary = evaluateSummary(input.portableExport, entries)
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
    if (JSON.stringify(archive.entries) !== JSON.stringify(expectedEntries)) {
      reasons.push(`packaged archive entries mismatch for ${archive.source}`)
    }
    const expectedDigest = computePackageDigest(archive.entries)
    if (archive.packageDigest !== expectedDigest) {
      reasons.push(`packaged archive digest mismatch for ${archive.source}`)
    }
    const expectedSummary = evaluateSummary(archive.portableExport, archive.entries)
    if (JSON.stringify(archive.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`packaged archive summary mismatch for ${archive.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionPortableExport.ExportArtifact["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
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
    await QualityPromotionPortableExport.append(archive.portableExport)
    const next = ArchiveRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-packaged-archive-record",
      archive,
    })
    try {
      const existing = await get({ source: archive.source, archiveID: archive.archiveID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Promotion packaged archive ${archive.archiveID} already exists for source ${archive.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(archive.source, archive.archiveID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_packaged_archive", encode(source)]] : [["quality_model_packaged_archive"]]
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
    await QualityPromotionPortableExport.assertPersisted(archive.portableExport)
    const persisted = await get({ source: archive.source, archiveID: archive.archiveID })
    const prev = JSON.stringify(persisted.archive)
    const curr = JSON.stringify(archive)
    if (prev !== curr) {
      throw new Error(`Persisted promotion packaged archive ${archive.archiveID} does not match the provided artifact`)
    }
    return persisted
  }

  export async function materialize(archive: ArchiveArtifact, filePath: string) {
    const reasons = verify(archive)
    if (reasons.length > 0) {
      throw new Error(`Cannot materialize packaged archive for ${archive.source}: invalid archive (${reasons[0]})`)
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = JSON.stringify(archive, null, 2) + "\n"
    await Bun.write(filePath, content)
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
      await Bun.write(target, entry.content)
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
    lines.push(`- promotion id: ${archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID}`)
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
    for (const gate of archive.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
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
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
