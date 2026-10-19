import { createHmac, timingSafeEqual } from "crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { QualityStorageKey } from "../storage-key"
import { sha256Hex } from "../digest"
import { QualityPromotionPackagedArchive } from "./promotion-packaged-archive"
import { createPromotionArtifactStore } from "./artifact-store"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { overallStatusFromGates, pushGateLines } from "./promotion-summary"
import { jsonEqual } from "../json"
import { compareStringFields, uniqueBy } from "../sort"

export namespace QualityPromotionSignedArchive {
  export const SignatureAlgorithm = z.literal("hmac-sha256")
  export type SignatureAlgorithm = z.output<typeof SignatureAlgorithm>

  export const KeySource = z.enum(["env", "file"])
  export type KeySource = z.output<typeof KeySource>

  export const Attestation = z.object({
    algorithm: SignatureAlgorithm,
    attestedBy: z.string(),
    keyID: z.string(),
    keySource: KeySource,
    keyLocator: z.string(),
    signedAt: z.string(),
    payloadDigest: z.string(),
    signatureEncoding: z.literal("hex"),
    signature: z.string(),
  })
  export type Attestation = z.output<typeof Attestation>

  export const ArchiveSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    packagedArchiveStatus: z.enum(["pass", "fail"]),
    portableExportStatus: z.enum(["pass", "fail"]),
    attestationStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    attestedBy: z.string(),
    keyID: z.string(),
    keySource: KeySource,
    keyLocator: z.string(),
    signatureAlgorithm: SignatureAlgorithm,
    signatureEncoding: z.literal("hex"),
    payloadDigest: z.string(),
    signatureLength: z.number().int().positive(),
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
    kind: z.literal("ax-code-quality-promotion-signed-archive"),
    signedArchiveID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    packagedArchive: z.lazy(() => QualityPromotionPackagedArchive.ArchiveArtifact),
    attestation: Attestation,
    summary: ArchiveSummary,
  })
  export type ArchiveArtifact = z.output<typeof ArchiveArtifact>

  export const ArchiveRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-record"),
    archive: ArchiveArtifact,
  })
  export type ArchiveRecord = z.output<typeof ArchiveRecord>

  export type SigningInput = {
    attestedBy: string
    keyID: string
    keySource: KeySource
    keyLocator: string
    keyMaterial: string
  }

  const encode = QualityStorageKey.encode

  const digest = sha256Hex

  function canonicalAttestation(attestation: Omit<Attestation, "signature">) {
    return JSON.stringify({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation",
      algorithm: attestation.algorithm,
      attestedBy: attestation.attestedBy,
      keyID: attestation.keyID,
      keySource: attestation.keySource,
      keyLocator: attestation.keyLocator,
      signedAt: attestation.signedAt,
      payloadDigest: attestation.payloadDigest,
      signatureEncoding: attestation.signatureEncoding,
    })
  }

  // The signature must bind the whole attestation envelope, not only the
  // payload digest: trust resolution reads signedAt, attestedBy, and keyID
  // from the envelope, so leaving them unsigned lets a holder rewrite the
  // attestation without invalidating the signature.
  function sign(attestation: Omit<Attestation, "signature">, keyMaterial: string) {
    return createHmac("sha256", keyMaterial).update(canonicalAttestation(attestation)).digest("hex")
  }

  function sortArchives(archives: ArchiveArtifact[]) {
    return [...archives].sort((a, b) => compareStringFields(a, b, ["createdAt", "signedArchiveID"]))
  }

  const store = createPromotionArtifactStore<ArchiveArtifact, ArchiveRecord>({
    keyPrefix: "quality_model_signed_archive",
    recordKind: "ax-code-quality-promotion-signed-archive-record",
    artifactField: "archive",
    idField: "signedArchiveID",
    noun: "Promotion signed archive",
    recordSchema: ArchiveRecord,
    sort: sortArchives,
    parent: {
      append: (archive) => QualityPromotionPackagedArchive.append(archive.packagedArchive),
      assertPersisted: (archive) => QualityPromotionPackagedArchive.assertPersisted(archive.packagedArchive),
    },
  })

  function canonicalPayload(archive: QualityPromotionPackagedArchive.ArchiveArtifact) {
    const promotion = archive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
    return JSON.stringify({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-payload",
      source: archive.source,
      archiveID: archive.archiveID,
      createdAt: archive.createdAt,
      packageDigest: archive.packageDigest,
      portableExportID: archive.portableExport.exportID,
      handoffPackageID: archive.portableExport.handoffPackage.packageID,
      promotionID: promotion.promotionID,
      promotionDecision: archive.summary.promotionDecision,
      promotionMode: archive.summary.promotionMode,
      authorizedPromotion: archive.summary.authorizedPromotion,
      entryCount: archive.summary.entryCount,
      fileCount: archive.summary.fileCount,
      entries: archive.entries.map((entry) => ({
        path: entry.path,
        format: entry.format,
        encoding: entry.encoding,
        contentDigest: entry.contentDigest,
      })),
    })
  }

  function computePayloadDigest(archive: QualityPromotionPackagedArchive.ArchiveArtifact) {
    return digest(canonicalPayload(archive))
  }

  function matchesPromotion(
    promotion: QualityPromotionPackagedArchive.ArchiveArtifact["portableExport"]["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    archive: ArchiveArtifact,
  ) {
    return (
      archive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
        .promotionID === promotion.promotionID &&
      archive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
        .source === promotion.source
    )
  }

  function evaluateSummary(
    packagedArchive: QualityPromotionPackagedArchive.ArchiveArtifact,
    attestation: Attestation,
    verification: { archiveReasons: string[] },
  ) {
    const { archiveReasons } = verification
    const expectedPayloadDigest = computePayloadDigest(packagedArchive)
    const payloadMatches = attestation.payloadDigest === expectedPayloadDigest
    const attestationRecorded =
      attestation.attestedBy.length > 0 &&
      attestation.keyID.length > 0 &&
      attestation.keyLocator.length > 0 &&
      attestation.signature.length > 0
    const archiveReady = archiveReasons.length === 0 && packagedArchive.summary.overallStatus === "pass"

    const gates = [
      {
        name: "packaged-archive-verification",
        status: archiveReady ? "pass" : "fail",
        detail:
          archiveReasons[0] ??
          (packagedArchive.summary.overallStatus === "pass"
            ? `packaged archive ${packagedArchive.archiveID} is valid`
            : `packaged archive ${packagedArchive.archiveID} status is ${packagedArchive.summary.overallStatus}`),
      },
      {
        name: "payload-digest-consistency",
        status: payloadMatches ? "pass" : "fail",
        detail: payloadMatches
          ? `payload digest ${attestation.payloadDigest} matches packaged archive`
          : `payload digest mismatch: expected ${expectedPayloadDigest}, got ${attestation.payloadDigest}`,
      },
      {
        name: "attestation-envelope",
        status: attestationRecorded ? "pass" : "fail",
        detail: attestationRecorded
          ? `${attestation.algorithm} attestation recorded for key ${attestation.keyID}`
          : "attestation metadata is incomplete",
      },
      {
        name: "promotion-linkage",
        status: packagedArchive.summary.promotionRecorded ? "pass" : "fail",
        detail: packagedArchive.summary.promotionRecorded
          ? `promotion ${packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID} recorded`
          : "packaged archive is not linked to a persisted promotion",
      },
    ] as const

    return ArchiveSummary.parse({
      overallStatus: overallStatusFromGates(gates),
      packagedArchiveStatus: packagedArchive.summary.overallStatus,
      portableExportStatus: packagedArchive.portableExport.summary.overallStatus,
      attestationStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      promotionRecorded: packagedArchive.summary.promotionRecorded,
      promotionDecision: packagedArchive.summary.promotionDecision,
      promotionMode: packagedArchive.summary.promotionMode,
      authorizedPromotion: packagedArchive.summary.authorizedPromotion,
      attestedBy: attestation.attestedBy,
      keyID: attestation.keyID,
      keySource: attestation.keySource,
      keyLocator: attestation.keyLocator,
      signatureAlgorithm: attestation.algorithm,
      signatureEncoding: attestation.signatureEncoding,
      payloadDigest: attestation.payloadDigest,
      signatureLength: attestation.signature.length,
      entryCount: packagedArchive.summary.entryCount,
      fileCount: packagedArchive.summary.fileCount,
      previousActiveSource: packagedArchive.summary.previousActiveSource,
      gates,
    })
  }

  export function create(input: {
    packagedArchive: QualityPromotionPackagedArchive.ArchiveArtifact
    signing: SigningInput
  }) {
    const archiveReasons = QualityPromotionPackagedArchive.verify(input.packagedArchive)
    if (archiveReasons.length > 0) {
      throw new Error(
        `Cannot create signed archive for ${input.packagedArchive.source}: invalid packaged archive (${archiveReasons[0]})`,
      )
    }
    const createdAt = new Date().toISOString()
    const signedArchiveID = `${Date.now()}-${input.packagedArchive.archiveID}-${encode(input.signing.keyID)}-signed`
    const payloadDigest = computePayloadDigest(input.packagedArchive)
    const envelope = {
      algorithm: "hmac-sha256" as const,
      attestedBy: input.signing.attestedBy,
      keyID: input.signing.keyID,
      keySource: input.signing.keySource,
      keyLocator: input.signing.keyLocator,
      signedAt: createdAt,
      payloadDigest,
      signatureEncoding: "hex" as const,
    }
    const attestation = Attestation.parse({
      ...envelope,
      signature: sign(envelope, input.signing.keyMaterial),
    })
    const summary = evaluateSummary(input.packagedArchive, attestation, { archiveReasons })
    return ArchiveArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive",
      signedArchiveID,
      source: input.packagedArchive.source,
      createdAt,
      packagedArchive: input.packagedArchive,
      attestation,
      summary,
    })
  }

  export function verify(archive: ArchiveArtifact) {
    const reasons: string[] = []
    if (archive.source !== archive.packagedArchive.source) {
      reasons.push(`signed archive source mismatch: ${archive.source} vs ${archive.packagedArchive.source}`)
    }
    const archiveReasons = QualityPromotionPackagedArchive.verify(archive.packagedArchive)
    if (archiveReasons.length > 0) {
      reasons.push(`signed archive packaged archive mismatch for ${archive.source} (${archiveReasons[0]})`)
    }
    const expectedPayloadDigest = computePayloadDigest(archive.packagedArchive)
    if (archive.attestation.payloadDigest !== expectedPayloadDigest) {
      reasons.push(`signed archive payload digest mismatch for ${archive.source}`)
    }
    if (archive.attestation.signature.length === 0) {
      reasons.push(`signed archive signature is missing for ${archive.source}`)
    }
    const expectedSummary = evaluateSummary(archive.packagedArchive, archive.attestation, { archiveReasons })
    if (!jsonEqual(archive.summary, expectedSummary)) {
      reasons.push(`signed archive summary mismatch for ${archive.source}`)
    }
    return reasons
  }

  export function verifySignature(archive: ArchiveArtifact, keyMaterial: string) {
    const reasons = verify(archive)
    const expectedSignature = sign(archive.attestation, keyMaterial)
    const current = Buffer.from(archive.attestation.signature, "hex")
    const expected = Buffer.from(expectedSignature, "hex")
    if (current.length !== expected.length || !timingSafeEqual(current, expected)) {
      reasons.push(`signed archive signature mismatch for ${archive.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(
    promotion: QualityPromotionPackagedArchive.ArchiveArtifact["portableExport"]["handoffPackage"]["archiveManifest"]["exportBundle"]["auditManifest"]["promotion"],
    archives: ArchiveArtifact[] = [],
  ) {
    const persisted = (await list(promotion.source)).filter((archive) => matchesPromotion(promotion, archive))
    const validArchives = [...persisted, ...archives].filter(
      (archive) => matchesPromotion(promotion, archive) && verify(archive).length === 0,
    )
    return sortArchives(uniqueBy(validArchives, (archive) => archive.signedArchiveID))
  }

  export async function get(input: { source: string; signedArchiveID: string }) {
    return store.get({ source: input.source, id: input.signedArchiveID })
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
      throw new Error(`Cannot materialize signed archive for ${archive.source}: invalid archive (${reasons[0]})`)
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const content = JSON.stringify(archive, null, 2) + "\n"
    await fs.writeFile(filePath, content)
    return {
      filePath,
      byteLength: Buffer.byteLength(content),
    }
  }

  export function renderReport(archive: ArchiveArtifact, signatureReasons: string[] = []) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive")
    lines.push("")
    lines.push(`- source: ${archive.source}`)
    lines.push(`- signed archive id: ${archive.signedArchiveID}`)
    lines.push(`- created at: ${archive.createdAt}`)
    lines.push(`- packaged archive id: ${archive.packagedArchive.archiveID}`)
    lines.push(
      `- promotion id: ${archive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID}`,
    )
    lines.push(`- promotion mode: ${archive.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${archive.summary.authorizedPromotion}`)
    lines.push(`- attested by: ${archive.attestation.attestedBy}`)
    lines.push(`- key id: ${archive.attestation.keyID}`)
    lines.push(`- key source: ${archive.attestation.keySource}`)
    lines.push(`- key locator: ${archive.attestation.keyLocator}`)
    lines.push(`- algorithm: ${archive.attestation.algorithm}`)
    lines.push(`- payload digest: ${archive.attestation.payloadDigest}`)
    lines.push(`- signature length: ${archive.summary.signatureLength}`)
    lines.push(`- overall status: ${archive.summary.overallStatus}`)
    if (signatureReasons.length === 0) {
      lines.push(`- signature verification: not run`)
    } else if (signatureReasons.length === 1 && signatureReasons[0] === "__signature_ok__") {
      lines.push(`- signature verification: pass`)
    } else {
      lines.push(`- signature verification: fail`)
    }
    lines.push("")
    pushGateLines(lines, archive.summary.gates)
    if (signatureReasons.length > 0 && !(signatureReasons.length === 1 && signatureReasons[0] === "__signature_ok__")) {
      lines.push("")
      lines.push("### Signature Verification")
      lines.push("")
      for (const reason of signatureReasons) {
        lines.push(`- ${reason}`)
      }
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ArchiveSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- packaged archive status: ${summary.packagedArchiveStatus}`)
    lines.push(`- portable export status: ${summary.portableExportStatus}`)
    lines.push(`- attestation status: ${summary.attestationStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- attested by: ${summary.attestedBy}`)
    lines.push(`- key id: ${summary.keyID}`)
    lines.push(`- key source: ${summary.keySource}`)
    lines.push(`- key locator: ${summary.keyLocator}`)
    lines.push(`- signature algorithm: ${summary.signatureAlgorithm}`)
    lines.push(`- payload digest: ${summary.payloadDigest}`)
    lines.push(`- signature length: ${summary.signatureLength}`)
    lines.push(`- entry count: ${summary.entryCount}`)
    lines.push(`- file count: ${summary.fileCount}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    pushGateLines(lines, summary.gates)
    lines.push("")
    return lines.join("\n")
  }
}
