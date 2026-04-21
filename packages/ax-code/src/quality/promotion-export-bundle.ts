import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionAuditManifest } from "./promotion-audit-manifest"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"

export namespace QualityPromotionExportBundle {
  export const ExportSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    auditManifestStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
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
    kind: z.literal("ax-code-quality-promotion-export-bundle"),
    bundleID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    auditManifest: z.lazy(() => QualityPromotionAuditManifest.ManifestArtifact),
    summary: ExportSummary,
  })
  export type ExportArtifact = z.output<typeof ExportArtifact>

  export const ExportRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-export-bundle-record"),
    bundle: ExportArtifact,
  })
  export type ExportRecord = z.output<typeof ExportRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, bundleID: string) {
    return ["quality_model_export_bundle", encode(source), bundleID]
  }

  function sortBundles(bundles: ExportArtifact[]) {
    return [...bundles].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.bundleID.localeCompare(b.bundleID)
    })
  }

  function matchesPromotion(
    promotion: QualityPromotionAuditManifest.PromotionSnapshot,
    bundle: ExportArtifact,
  ) {
    return bundle.auditManifest.promotion.promotionID === promotion.promotionID
      && bundle.auditManifest.promotion.source === promotion.source
  }

  function evaluateSummary(auditManifest: QualityPromotionAuditManifest.ManifestArtifact) {
    const manifestReasons = QualityPromotionAuditManifest.verify(auditManifest.releasePacket, auditManifest)
    const gates = [
      {
        name: "audit-manifest-verification",
        status: manifestReasons.length === 0 ? "pass" : "fail",
        detail: manifestReasons[0] ?? `audit manifest ${auditManifest.manifestID} is valid`,
      },
      {
        name: "release-packet-readiness",
        status: auditManifest.releasePacket.summary.overallStatus,
        detail: auditManifest.releasePacket.summary.overallStatus === "pass"
          ? `release packet ${auditManifest.releasePacket.packetID} is ready`
          : auditManifest.releasePacket.summary.gates.find((gate) => gate.status === "fail")?.detail ?? "release packet not ready",
      },
      {
        name: "promotion-recorded",
        status: auditManifest.summary.promotionRecorded ? "pass" : "fail",
        detail: auditManifest.summary.promotionRecorded
          ? `promotion ${auditManifest.promotion.promotionID} is embedded in the export bundle`
          : "promotion snapshot is missing",
      },
      {
        name: "promotion-authorization",
        status: auditManifest.summary.authorizedPromotion ? "pass" : "fail",
        detail: auditManifest.summary.authorizedPromotion
          ? `promotion mode ${auditManifest.summary.promotionMode} is authorized`
          : "promotion is not authorized by the release packet",
      },
      {
        name: "promotion-release-packet-linkage",
        status: auditManifest.promotion.releasePacket?.packetID === auditManifest.releasePacket.packetID ? "pass" : "fail",
        detail: `promotion packet=${auditManifest.promotion.releasePacket?.packetID ?? "n/a"} export packet=${auditManifest.releasePacket.packetID}`,
      },
    ] as const

    return ExportSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      auditManifestStatus: auditManifest.summary.overallStatus,
      releasePacketStatus: auditManifest.releasePacket.summary.overallStatus,
      promotionRecorded: auditManifest.summary.promotionRecorded,
      promotionDecision: auditManifest.summary.promotionDecision,
      promotionMode: auditManifest.summary.promotionMode,
      authorizedPromotion: auditManifest.summary.authorizedPromotion,
      previousActiveSource: auditManifest.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: {
    auditManifest: QualityPromotionAuditManifest.ManifestArtifact
  }) {
    const manifestReasons = QualityPromotionAuditManifest.verify(input.auditManifest.releasePacket, input.auditManifest)
    if (manifestReasons.length > 0) {
      throw new Error(`Cannot create promotion export bundle for ${input.auditManifest.source}: invalid audit manifest (${manifestReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const bundleID = `${input.auditManifest.manifestID}-export-bundle`
    const summary = evaluateSummary(input.auditManifest)
    return ExportArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-export-bundle",
      bundleID,
      source: input.auditManifest.source,
      createdAt,
      auditManifest: input.auditManifest,
      summary,
    })
  }

  export function verify(bundle: ExportArtifact) {
    const reasons: string[] = []
    if (bundle.source !== bundle.auditManifest.source) {
      reasons.push(`export bundle source mismatch: ${bundle.source} vs ${bundle.auditManifest.source}`)
    }
    const manifestReasons = QualityPromotionAuditManifest.verify(bundle.auditManifest.releasePacket, bundle.auditManifest)
    if (manifestReasons.length > 0) {
      reasons.push(`export bundle audit manifest mismatch for ${bundle.source} (${manifestReasons[0]})`)
    }
    const expectedSummary = evaluateSummary(bundle.auditManifest)
    if (JSON.stringify(bundle.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`export bundle summary mismatch for ${bundle.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionAuditManifest.PromotionSnapshot,
    bundles: ExportArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((bundle) => matchesPromotion(promotion, bundle))
    const deduped = new Map<string, ExportArtifact>()
    for (const bundle of [...persisted, ...bundles]) {
      if (!matchesPromotion(promotion, bundle)) continue
      if (verify(bundle).length > 0) continue
      deduped.set(bundle.bundleID, bundle)
    }
    return sortBundles([...deduped.values()])
  }

  export async function get(input: { source: string; bundleID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.bundleID))
    return ExportRecord.parse(record)
  }

  export async function append(bundle: ExportArtifact) {
    await QualityPromotionAuditManifest.append(bundle.auditManifest)
    const next = ExportRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-export-bundle-record",
      bundle,
    })
    try {
      const existing = await get({ source: bundle.source, bundleID: bundle.bundleID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Promotion export bundle ${bundle.bundleID} already exists for source ${bundle.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(bundle.source, bundle.bundleID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_export_bundle", encode(source)]] : [["quality_model_export_bundle"]]
    const bundles: ExportArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const bundleID = parts[parts.length - 1]
        if (!encodedSource || !bundleID) continue
        const record = await get({ source: decode(encodedSource), bundleID })
        bundles.push(record.bundle)
      }
    }

    return sortBundles(bundles)
  }

  export async function assertPersisted(bundle: ExportArtifact) {
    await QualityPromotionAuditManifest.assertPersisted(bundle.auditManifest)
    const persisted = await get({ source: bundle.source, bundleID: bundle.bundleID })
    const prev = JSON.stringify(persisted.bundle)
    const curr = JSON.stringify(bundle)
    if (prev !== curr) {
      throw new Error(`Persisted promotion export bundle ${bundle.bundleID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(bundle: ExportArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion export bundle")
    lines.push("")
    lines.push(`- source: ${bundle.source}`)
    lines.push(`- bundle id: ${bundle.bundleID}`)
    lines.push(`- created at: ${bundle.createdAt}`)
    lines.push(`- audit manifest id: ${bundle.auditManifest.manifestID}`)
    lines.push(`- promotion id: ${bundle.auditManifest.promotion.promotionID}`)
    lines.push(`- release packet id: ${bundle.auditManifest.releasePacket.packetID}`)
    lines.push(`- decision: ${bundle.summary.promotionDecision}`)
    lines.push(`- promotion mode: ${bundle.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${bundle.summary.authorizedPromotion}`)
    lines.push(`- overall status: ${bundle.summary.overallStatus}`)
    lines.push("")
    for (const gate of bundle.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ExportSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion export bundle summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- audit manifest status: ${summary.auditManifestStatus}`)
    lines.push(`- release packet status: ${summary.releasePacketStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
