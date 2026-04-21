import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionSignedArchive } from "./promotion-signed-archive"
import { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"

export namespace QualityPromotionSignedArchiveAttestationRecord {
  export const RecordSummary = z.object({
    overallStatus: z.enum(["pass", "warn", "fail"]),
    signedArchiveStatus: z.enum(["pass", "fail"]),
    trustStatus: z.enum(["pass", "warn", "fail"]),
    attestationStatus: z.enum(["pass", "warn", "fail"]),
    trusted: z.boolean(),
    acceptedByPolicy: z.boolean(),
    policySource: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.PolicySource),
    policyProjectID: z.string().nullable(),
    policyDigest: z.string(),
    effectiveTrustScope: z.lazy(() => QualityPromotionSignedArchiveTrust.Scope).nullable(),
    effectiveTrustLifecycle: z.lazy(() => QualityPromotionSignedArchiveTrust.Lifecycle).nullable(),
    gates: z.array(z.lazy(() => QualityPromotionSignedArchiveTrust.Gate)),
  })
  export type RecordSummary = z.output<typeof RecordSummary>

  export const RecordArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-record"),
    recordID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    promotionID: z.string(),
    signedArchive: z.lazy(() => QualityPromotionSignedArchive.ArchiveArtifact),
    trust: z.lazy(() => QualityPromotionSignedArchiveTrust.TrustSummary),
    attestation: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.Summary),
    summary: RecordSummary,
  })
  export type RecordArtifact = z.output<typeof RecordArtifact>

  export const StoredRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-record-record"),
    record: RecordArtifact,
  })
  export type StoredRecord = z.output<typeof StoredRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, recordID: string) {
    return ["quality_model_signed_archive_attestation_record", encode(source), recordID]
  }

  function sortRecords(records: RecordArtifact[]) {
    return [...records].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.recordID.localeCompare(b.recordID)
    })
  }

  function severity(status: QualityPromotionSignedArchiveTrust.Gate["status"]) {
    return status === "fail" ? 2 : status === "warn" ? 1 : 0
  }

  function summarizeOverall(gates: QualityPromotionSignedArchiveTrust.Gate[]) {
    const highest = gates.reduce((max, gate) => Math.max(max, severity(gate.status)), 0)
    return highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"
  }

  function evaluateSummary(input: {
    signedArchive: QualityPromotionSignedArchive.ArchiveArtifact
    trust: QualityPromotionSignedArchiveTrust.TrustSummary
    attestation: QualityPromotionSignedArchiveAttestationPolicy.Summary
  }) {
    const signedArchiveReasons = QualityPromotionSignedArchive.verify(input.signedArchive)
    const trustIdentityPass = input.trust.attestedBy === input.signedArchive.attestation.attestedBy
      && input.trust.keyID === input.signedArchive.attestation.keyID
    const attestationTrustConsistencyPass = input.attestation.trustStatus === input.trust.overallStatus
      && input.attestation.effectiveTrustScope === input.trust.resolution.scope
      && input.attestation.effectiveTrustLifecycle === input.trust.resolution.lifecycle
    const linkagePass = input.trust.source === input.signedArchive.source
      && input.trust.signedArchiveID === input.signedArchive.signedArchiveID
      && input.attestation.source === input.signedArchive.source
      && input.attestation.signedArchiveID === input.signedArchive.signedArchiveID
      && input.attestation.promotionID === input.signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID
      && input.trust.promotionID === input.attestation.promotionID

    const gates: QualityPromotionSignedArchiveTrust.Gate[] = [
      {
        name: "signed-archive-verification",
        status: signedArchiveReasons.length === 0 ? "pass" : "fail",
        detail: signedArchiveReasons[0] ?? `signed archive ${input.signedArchive.signedArchiveID} is valid`,
      },
      {
        name: "trust-summary",
        status: input.trust.overallStatus,
        detail: `trust summary status=${input.trust.overallStatus}`,
      },
      {
        name: "trust-identity-alignment",
        status: trustIdentityPass ? "pass" : "fail",
        detail: trustIdentityPass
          ? `trust attestor ${input.trust.attestedBy}/${input.trust.keyID} matches signed archive attestation`
          : `trust attestor ${input.trust.attestedBy}/${input.trust.keyID} does not match signed archive attestation ${input.signedArchive.attestation.attestedBy}/${input.signedArchive.attestation.keyID}`,
      },
      {
        name: "attestation-trust-consistency",
        status: attestationTrustConsistencyPass ? "pass" : "fail",
        detail: attestationTrustConsistencyPass
          ? `attestation trust snapshot matches trust summary (${input.attestation.trustStatus})`
          : `attestation trust snapshot (${input.attestation.trustStatus}, scope=${input.attestation.effectiveTrustScope ?? "n/a"}, lifecycle=${input.attestation.effectiveTrustLifecycle ?? "n/a"}) does not match trust summary (${input.trust.overallStatus}, scope=${input.trust.resolution.scope ?? "n/a"}, lifecycle=${input.trust.resolution.lifecycle ?? "n/a"})`,
      },
      {
        name: "attestation-policy",
        status: input.attestation.acceptedByPolicy ? input.attestation.overallStatus : "fail",
        detail: input.attestation.acceptedByPolicy
          ? `attestation accepted by ${input.attestation.policySource} policy`
          : `attestation rejected by ${input.attestation.policySource} policy`,
      },
      {
        name: "promotion-linkage",
        status: linkagePass ? "pass" : "fail",
        detail: linkagePass
          ? `promotion ${input.attestation.promotionID} is linked across signed archive, trust, and attestation`
          : "signed archive, trust, and attestation promotion linkage does not match",
      },
    ]

    return RecordSummary.parse({
      overallStatus: summarizeOverall(gates),
      signedArchiveStatus: input.signedArchive.summary.overallStatus,
      trustStatus: input.trust.overallStatus,
      attestationStatus: input.attestation.overallStatus,
      trusted: input.trust.trusted,
      acceptedByPolicy: input.attestation.acceptedByPolicy,
      policySource: input.attestation.policySource,
      policyProjectID: input.attestation.policyProjectID ?? null,
      policyDigest: input.attestation.policyDigest,
      effectiveTrustScope: input.attestation.effectiveTrustScope,
      effectiveTrustLifecycle: input.attestation.effectiveTrustLifecycle,
      gates,
    })
  }

  export function create(input: {
    signedArchive: QualityPromotionSignedArchive.ArchiveArtifact
    trust: QualityPromotionSignedArchiveTrust.TrustSummary
    attestation: QualityPromotionSignedArchiveAttestationPolicy.Summary
  }) {
    const signedArchiveReasons = QualityPromotionSignedArchive.verify(input.signedArchive)
    if (signedArchiveReasons.length > 0) {
      throw new Error(`Cannot create signed archive attestation record for ${input.signedArchive.source}: invalid signed archive (${signedArchiveReasons[0]})`)
    }
    const createdAt = new Date().toISOString()
    const recordID = `${input.signedArchive.signedArchiveID}-attestation-record`
    const summary = evaluateSummary(input)
    return RecordArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-record",
      recordID,
      source: input.signedArchive.source,
      createdAt,
      promotionID: input.attestation.promotionID,
      signedArchive: input.signedArchive,
      trust: input.trust,
      attestation: input.attestation,
      summary,
    })
  }

  export function verify(record: RecordArtifact) {
    const reasons: string[] = []
    if (record.source !== record.signedArchive.source) {
      reasons.push(`signed archive attestation record source mismatch: ${record.source} vs ${record.signedArchive.source}`)
    }
    if (record.promotionID !== record.attestation.promotionID) {
      reasons.push(`signed archive attestation record promotion mismatch: ${record.promotionID} vs ${record.attestation.promotionID}`)
    }
    const signedArchiveReasons = QualityPromotionSignedArchive.verify(record.signedArchive)
    if (signedArchiveReasons.length > 0) {
      reasons.push(`signed archive attestation record signed archive mismatch for ${record.source} (${signedArchiveReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      signedArchive: record.signedArchive,
      trust: record.trust,
      attestation: record.attestation,
    })
    if (JSON.stringify(record.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`signed archive attestation record summary mismatch for ${record.source}`)
    }
    return reasons
  }

  export async function get(input: { source: string; recordID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.recordID))
    return StoredRecord.parse(record)
  }

  export async function append(record: RecordArtifact) {
    await QualityPromotionSignedArchive.append(record.signedArchive)
    const next = StoredRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-record-record",
      record,
    })
    try {
      const existing = await get({ source: record.source, recordID: record.recordID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(`Signed archive attestation record ${record.recordID} already exists for source ${record.source} with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(record.source, record.recordID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_signed_archive_attestation_record", encode(source)]] : [["quality_model_signed_archive_attestation_record"]]
    const records: RecordArtifact[] = []
    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const recordID = parts[parts.length - 1]
        if (!encodedSource || !recordID) continue
        const record = await get({ source: decode(encodedSource), recordID })
        records.push(record.record)
      }
    }
    return sortRecords(records)
  }

  export async function assertPersisted(record: RecordArtifact) {
    await QualityPromotionSignedArchive.assertPersisted(record.signedArchive)
    const persisted = await get({ source: record.source, recordID: record.recordID })
    const prev = JSON.stringify(persisted.record)
    const curr = JSON.stringify(record)
    if (prev !== curr) {
      throw new Error(`Persisted signed archive attestation record ${record.recordID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(record: RecordArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive attestation record")
    lines.push("")
    lines.push(`- source: ${record.source}`)
    lines.push(`- record id: ${record.recordID}`)
    lines.push(`- created at: ${record.createdAt}`)
    lines.push(`- promotion id: ${record.promotionID}`)
    lines.push(`- signed archive id: ${record.signedArchive.signedArchiveID}`)
    lines.push(`- trust status: ${record.summary.trustStatus}`)
    lines.push(`- attestation status: ${record.summary.attestationStatus}`)
    lines.push(`- trusted: ${record.summary.trusted}`)
    lines.push(`- accepted by policy: ${record.summary.acceptedByPolicy}`)
    lines.push(`- policy source: ${record.summary.policySource}`)
    lines.push(`- policy project id: ${record.summary.policyProjectID ?? "n/a"}`)
    lines.push(`- policy digest: ${record.summary.policyDigest}`)
    lines.push(`- effective trust scope: ${record.summary.effectiveTrustScope ?? "n/a"}`)
    lines.push(`- effective trust lifecycle: ${record.summary.effectiveTrustLifecycle ?? "n/a"}`)
    lines.push(`- overall status: ${record.summary.overallStatus}`)
    lines.push("")
    for (const gate of record.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
