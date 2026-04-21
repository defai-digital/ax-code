import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionHandoffPackage } from "./promotion-handoff-package"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"

export namespace QualityPromotionPortableExport {
  export const File = z.object({
    path: z.string(),
    format: z.enum(["json", "markdown"]),
    contentDigest: z.string(),
    content: z.string(),
  })
  export type File = z.output<typeof File>

  export const ExportSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    handoffPackageStatus: z.enum(["pass", "fail"]),
    archiveManifestStatus: z.enum(["pass", "fail"]),
    exportBundleStatus: z.enum(["pass", "fail"]),
    auditManifestStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    fileCount: z.number().int().positive(),
    documentCount: z.number().int().positive(),
    previousActiveSource: z.string().nullable(),
    gates: z.array(z.object({
      name: z.string(),
      status: z.enum(["pass", "fail"]),
      detail: z.string(),
    })),
  })
  export type ExportSummary = z.output<typeof ExportSummary>

  export const ExportArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-portable-export"),
    exportID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    handoffPackage: z.lazy(() => QualityPromotionHandoffPackage.PackageArtifact),
    files: z.array(File),
    summary: ExportSummary,
  })
  export type ExportArtifact = z.output<typeof ExportArtifact>

  export const ExportRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-portable-export-record"),
    export: ExportArtifact,
  })
  export type ExportRecord = z.output<typeof ExportRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, exportID: string) {
    return ["quality_model_portable_export", encode(source), exportID]
  }

  function digest(input: string) {
    return createHash("sha256").update(input).digest("hex")
  }

  function sortExports(exports: ExportArtifact[]) {
    return [...exports].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.exportID.localeCompare(b.exportID)
    })
  }

  function sortFiles(files: File[]) {
    return [...files].sort((a, b) => a.path.localeCompare(b.path))
  }

  function matchesPromotion(
    promotion: QualityPromotionHandoffPackage.PackageArtifact["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    exportArtifact: ExportArtifact,
  ) {
    return exportArtifact.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID === promotion.promotionID
      && exportArtifact.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.source === promotion.source
  }

  function jsonFile(filePath: string, value: unknown) {
    const content = JSON.stringify(value, null, 2) + "\n"
    return File.parse({
      path: filePath,
      format: "json",
      contentDigest: digest(content),
      content,
    })
  }

  function markdownFile(filePath: string, content: string) {
    const normalized = content.endsWith("\n") ? content : content + "\n"
    return File.parse({
      path: filePath,
      format: "markdown",
      contentDigest: digest(normalized),
      content: normalized,
    })
  }

  function renderReadme(handoffPackage: QualityPromotionHandoffPackage.PackageArtifact) {
    const archiveManifest = handoffPackage.archiveManifest
    const exportBundle = archiveManifest.exportBundle
    const auditManifest = exportBundle.auditManifest
    const lines: string[] = []
    lines.push("## ax-code quality promotion portable export")
    lines.push("")
    lines.push(`- source: ${handoffPackage.source}`)
    lines.push(`- promotion id: ${auditManifest.promotion.promotionID}`)
    lines.push(`- decision: ${handoffPackage.summary.promotionDecision}`)
    lines.push(`- promotion mode: ${handoffPackage.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${handoffPackage.summary.authorizedPromotion}`)
    lines.push(`- handoff package id: ${handoffPackage.packageID}`)
    lines.push(`- archive manifest id: ${archiveManifest.archiveID}`)
    lines.push(`- export bundle id: ${exportBundle.bundleID}`)
    lines.push(`- release packet id: ${auditManifest.releasePacket.packetID}`)
    lines.push(`- document count: ${handoffPackage.summary.documentCount}`)
    lines.push(`- inventory count: ${handoffPackage.summary.inventoryCount}`)
    lines.push(`- overall status: ${handoffPackage.summary.overallStatus}`)
    lines.push("")
    lines.push("### Included Documents")
    lines.push("")
    for (const document of handoffPackage.documents) {
      lines.push(`- ${document.name}: ${document.kind} · digest=${document.contentDigest}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  function buildFiles(handoffPackage: QualityPromotionHandoffPackage.PackageArtifact) {
    const files = [
      markdownFile("README.md", renderReadme(handoffPackage)),
      jsonFile("manifest/handoff-package.json", handoffPackage),
      jsonFile("manifest/handoff-package-summary.json", handoffPackage.summary),
      jsonFile("manifest/archive-manifest.json", handoffPackage.archiveManifest),
      jsonFile("manifest/archive-manifest-summary.json", handoffPackage.archiveManifest.summary),
      ...handoffPackage.documents.map((document) => markdownFile(path.posix.join("docs", document.name), document.content)),
    ]
    return sortFiles(files)
  }

  function evaluateSummary(handoffPackage: QualityPromotionHandoffPackage.PackageArtifact, files: File[]) {
    const packageReasons = QualityPromotionHandoffPackage.verify(handoffPackage)
    const expectedFiles = buildFiles(handoffPackage)
    const filesMatch = JSON.stringify(files) === JSON.stringify(expectedFiles)
    const digestCoverage = files.every((file) => file.contentDigest.length > 0)
    const gates = [
      {
        name: "handoff-package-verification",
        status: packageReasons.length === 0 ? "pass" : "fail",
        detail: packageReasons[0] ?? `handoff package ${handoffPackage.packageID} is valid`,
      },
      {
        name: "file-coverage",
        status: filesMatch ? "pass" : "fail",
        detail: filesMatch
          ? `${files.length}/${expectedFiles.length} portable export file(s) captured`
          : `portable export file mismatch: expected ${expectedFiles.length} file(s), got ${files.length}`,
      },
      {
        name: "file-digest-coverage",
        status: digestCoverage ? "pass" : "fail",
        detail: digestCoverage
          ? `${files.length} portable export file digest(s) recorded`
          : "one or more portable export file digests are missing",
      },
      {
        name: "document-linkage",
        status: handoffPackage.summary.documentCount === handoffPackage.documents.length ? "pass" : "fail",
        detail: `handoff document count=${handoffPackage.summary.documentCount} linked documents=${handoffPackage.documents.length}`,
      },
    ] as const

    return ExportSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      handoffPackageStatus: handoffPackage.summary.overallStatus,
      archiveManifestStatus: handoffPackage.archiveManifest.summary.overallStatus,
      exportBundleStatus: handoffPackage.archiveManifest.exportBundle.summary.overallStatus,
      auditManifestStatus: handoffPackage.archiveManifest.exportBundle.auditManifest.summary.overallStatus,
      releasePacketStatus: handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket.summary.overallStatus,
      promotionRecorded: handoffPackage.summary.promotionRecorded,
      promotionDecision: handoffPackage.summary.promotionDecision,
      promotionMode: handoffPackage.summary.promotionMode,
      authorizedPromotion: handoffPackage.summary.authorizedPromotion,
      fileCount: files.length,
      documentCount: handoffPackage.summary.documentCount,
      previousActiveSource: handoffPackage.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: {
    handoffPackage: QualityPromotionHandoffPackage.PackageArtifact
  }) {
    const packageReasons = QualityPromotionHandoffPackage.verify(input.handoffPackage)
    if (packageReasons.length > 0) {
      throw new Error(`Cannot create promotion portable export for ${input.handoffPackage.source}: invalid handoff package (${packageReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const exportID = `${input.handoffPackage.packageID}-portable-export`
    const files = buildFiles(input.handoffPackage)
    const summary = evaluateSummary(input.handoffPackage, files)
    return ExportArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-portable-export",
      exportID,
      source: input.handoffPackage.source,
      createdAt,
      handoffPackage: input.handoffPackage,
      files,
      summary,
    })
  }

  export function verify(exportArtifact: ExportArtifact) {
    const reasons: string[] = []
    if (exportArtifact.source !== exportArtifact.handoffPackage.source) {
      reasons.push(`portable export source mismatch: ${exportArtifact.source} vs ${exportArtifact.handoffPackage.source}`)
    }
    const packageReasons = QualityPromotionHandoffPackage.verify(exportArtifact.handoffPackage)
    if (packageReasons.length > 0) {
      reasons.push(`portable export handoff package mismatch for ${exportArtifact.source} (${packageReasons[0]})`)
    }
    const expectedFiles = buildFiles(exportArtifact.handoffPackage)
    if (JSON.stringify(exportArtifact.files) !== JSON.stringify(expectedFiles)) {
      reasons.push(`portable export files mismatch for ${exportArtifact.source}`)
    }
    const expectedSummary = evaluateSummary(exportArtifact.handoffPackage, exportArtifact.files)
    if (JSON.stringify(exportArtifact.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`portable export summary mismatch for ${exportArtifact.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionHandoffPackage.PackageArtifact["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    exports: ExportArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((exportArtifact) => matchesPromotion(promotion, exportArtifact))
    const deduped = new Map<string, ExportArtifact>()
    for (const exportArtifact of [...persisted, ...exports]) {
      if (!matchesPromotion(promotion, exportArtifact)) continue
      if (verify(exportArtifact).length > 0) continue
      deduped.set(exportArtifact.exportID, exportArtifact)
    }
    return sortExports([...deduped.values()])
  }

  export async function get(input: { source: string; exportID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.exportID))
    return ExportRecord.parse(record)
  }

  export async function append(exportArtifact: ExportArtifact) {
    await QualityPromotionHandoffPackage.append(exportArtifact.handoffPackage)
    const next = ExportRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-portable-export-record",
      export: exportArtifact,
    })
    try {
      const existing = await get({ source: exportArtifact.source, exportID: exportArtifact.exportID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Promotion portable export ${exportArtifact.exportID} already exists for source ${exportArtifact.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(exportArtifact.source, exportArtifact.exportID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_portable_export", encode(source)]] : [["quality_model_portable_export"]]
    const exports: ExportArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const exportID = parts[parts.length - 1]
        if (!encodedSource || !exportID) continue
        const record = await get({ source: decode(encodedSource), exportID })
        exports.push(record.export)
      }
    }

    return sortExports(exports)
  }

  export async function assertPersisted(exportArtifact: ExportArtifact) {
    await QualityPromotionHandoffPackage.assertPersisted(exportArtifact.handoffPackage)
    const persisted = await get({ source: exportArtifact.source, exportID: exportArtifact.exportID })
    const prev = JSON.stringify(persisted.export)
    const curr = JSON.stringify(exportArtifact)
    if (prev !== curr) {
      throw new Error(`Persisted promotion portable export ${exportArtifact.exportID} does not match the provided artifact`)
    }
    return persisted
  }

  export async function materialize(exportArtifact: ExportArtifact, directory: string) {
    const reasons = verify(exportArtifact)
    if (reasons.length > 0) {
      throw new Error(`Cannot materialize portable export for ${exportArtifact.source}: invalid export (${reasons[0]})`)
    }
    await fs.mkdir(directory, { recursive: true })
    for (const file of exportArtifact.files) {
      const target = path.join(directory, file.path)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await Bun.write(target, file.content)
    }
    return {
      directory,
      fileCount: exportArtifact.files.length,
    }
  }

  export function renderReport(exportArtifact: ExportArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion portable export")
    lines.push("")
    lines.push(`- source: ${exportArtifact.source}`)
    lines.push(`- export id: ${exportArtifact.exportID}`)
    lines.push(`- created at: ${exportArtifact.createdAt}`)
    lines.push(`- handoff package id: ${exportArtifact.handoffPackage.packageID}`)
    lines.push(`- archive manifest id: ${exportArtifact.handoffPackage.archiveManifest.archiveID}`)
    lines.push(`- promotion id: ${exportArtifact.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID}`)
    lines.push(`- promotion mode: ${exportArtifact.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${exportArtifact.summary.authorizedPromotion}`)
    lines.push(`- file count: ${exportArtifact.summary.fileCount}`)
    lines.push(`- document count: ${exportArtifact.summary.documentCount}`)
    lines.push(`- overall status: ${exportArtifact.summary.overallStatus}`)
    lines.push("")
    lines.push("### Files")
    lines.push("")
    for (const file of exportArtifact.files) {
      lines.push(`- ${file.path}: ${file.format} · digest=${file.contentDigest}`)
    }
    lines.push("")
    for (const gate of exportArtifact.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ExportSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion portable export summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- handoff package status: ${summary.handoffPackageStatus}`)
    lines.push(`- archive manifest status: ${summary.archiveManifestStatus}`)
    lines.push(`- export bundle status: ${summary.exportBundleStatus}`)
    lines.push(`- audit manifest status: ${summary.auditManifestStatus}`)
    lines.push(`- release packet status: ${summary.releasePacketStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- file count: ${summary.fileCount}`)
    lines.push(`- document count: ${summary.documentCount}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
