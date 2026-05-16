import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionReleaseDecisionRecord } from "./promotion-release-decision-record"
import { QualityPromotionReleasePacket } from "./promotion-release-packet"

export namespace QualityPromotionAuditManifest {
  export const PromotionSnapshot = z.object({
    promotionID: z.string(),
    source: z.string(),
    promotedAt: z.string(),
    previousActiveSource: z.string().nullable(),
    decision: z.enum(["pass", "warn_override", "force"]),
    decisionBundleCreatedAt: z.string().nullable().optional(),
    boardDecision: z
      .object({
        decisionID: z.string(),
        decidedAt: z.string(),
        decider: z.string(),
        role: z.string().nullable(),
        team: z.string().nullable().default(null),
        reportingChain: z.string().nullable().default(null),
        disposition: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.disposition),
        overrideAccepted: z.boolean(),
        dossierID: z.string(),
        recommendation: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.recommendation),
        requiredOverride: z.enum(["none", "allow_warn", "force"]),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    releaseDecisionRecord: z
      .object({
        recordID: z.string(),
        recordedAt: z.string(),
        decisionID: z.string(),
        disposition: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.disposition),
        overrideAccepted: z.boolean(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    releasePacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        recordID: z.string(),
        decisionID: z.string(),
        authorizedPromotion: z.boolean(),
        promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    reviewDossier: z
      .object({
        dossierID: z.string(),
        createdAt: z.string(),
        submissionID: z.string(),
        submissionCreatedAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        approvalPacketID: z.string(),
        overallStatus: z.enum(["pass", "fail"]),
        recommendation: z.lazy(() => QualityPromotionReleaseDecisionRecord.RecordSummary.shape.recommendation),
      })
      .optional(),
    submissionBundle: z
      .object({
        submissionID: z.string(),
        createdAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        approvalPacketID: z.string(),
        overallStatus: z.enum(["pass", "fail"]),
        eligibilityDecision: z.enum(["go", "review", "no_go"]),
        requiredOverride: z.enum(["none", "allow_warn", "force"]),
      })
      .optional(),
    approvalPacket: z
      .object({
        packetID: z.string(),
        createdAt: z.string(),
        decisionBundleCreatedAt: z.string(),
        decisionBundleDigest: z.string(),
        adoptionStatus: z.enum(["accepted", "partially_accepted", "diverged", "no_effective_policy"]),
        approvalCount: z.number().int().nonnegative(),
        adoptionReviewCount: z.number().int().nonnegative(),
        hasDissentHandling: z.boolean(),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    signedArchive: z
      .object({
        signedArchiveID: z.string(),
        createdAt: z.string(),
        archiveID: z.string(),
        exportID: z.string(),
        promotionID: z.string(),
        keyID: z.string(),
        attestedBy: z.string(),
        algorithm: z.literal("hmac-sha256"),
        overallStatus: z.enum(["pass", "fail"]),
      })
      .optional(),
    signedArchiveTrust: z
      .object({
        overallStatus: z.enum(["pass", "warn", "fail"]),
        trusted: z.boolean(),
        signatureStatus: z.enum(["pass", "fail"]),
        registryStatus: z.enum(["pass", "fail"]),
        lifecycleStatus: z.enum(["pass", "warn", "fail"]),
        resolution: z.object({
          matched: z.boolean(),
          scope: z.enum(["global", "project"]).nullable(),
          projectID: z.string().nullable(),
          trustID: z.string().nullable(),
          lifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
          registeredAt: z.string().nullable(),
          effectiveFrom: z.string().nullable(),
          retiredAt: z.string().nullable(),
          revokedAt: z.string().nullable(),
        }),
      })
      .optional(),
    signedArchiveAttestation: z
      .object({
        overallStatus: z.enum(["pass", "warn", "fail"]),
        policySource: z.enum(["explicit", "project", "global", "default"]),
        policyProjectID: z.string().nullable(),
        policyDigest: z.string(),
        acceptedByPolicy: z.boolean(),
        trustStatus: z.enum(["pass", "warn", "fail"]),
        minimumScopeStatus: z.enum(["pass", "fail"]),
        lifecyclePolicyStatus: z.enum(["pass", "warn", "fail"]),
        effectiveTrustScope: z.enum(["global", "project"]).nullable(),
        effectiveTrustLifecycle: z.enum(["active", "retired", "revoked"]).nullable(),
      })
      .optional(),
  })
  export type PromotionSnapshot = z.output<typeof PromotionSnapshot>

  export const ManifestSummary = z.object({
    overallStatus: z.enum(["pass", "fail"]),
    releasePacketStatus: z.enum(["pass", "fail"]),
    promotionRecorded: z.boolean(),
    promotionDecision: z.enum(["pass", "warn_override", "force"]),
    promotionMode: z.lazy(() => QualityPromotionReleaseDecisionRecord.PromotionMode),
    authorizedPromotion: z.boolean(),
    boardDecisionStatus: z.enum(["pass", "fail"]),
    releaseDecisionRecordStatus: z.enum(["pass", "fail"]),
    previousActiveSource: z.string().nullable(),
    gates: z.array(
      z.object({
        name: z.string(),
        status: z.enum(["pass", "fail"]),
        detail: z.string(),
      }),
    ),
  })
  export type ManifestSummary = z.output<typeof ManifestSummary>

  export const ManifestArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-audit-manifest"),
    manifestID: z.string(),
    source: z.string(),
    createdAt: z.string(),
    releasePacket: z.lazy(() => QualityPromotionReleasePacket.PacketArtifact),
    promotion: PromotionSnapshot,
    summary: ManifestSummary,
  })
  export type ManifestArtifact = z.output<typeof ManifestArtifact>

  export const ManifestRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-audit-manifest-record"),
    manifest: ManifestArtifact,
  })
  export type ManifestRecord = z.output<typeof ManifestRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, manifestID: string) {
    return ["quality_model_audit_manifest", encode(source), manifestID]
  }

  function sortManifests(manifests: ManifestArtifact[]) {
    return [...manifests].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.manifestID.localeCompare(b.manifestID)
    })
  }

  function matchesPromotion(promotion: PromotionSnapshot, manifest: ManifestArtifact) {
    return manifest.promotion.promotionID === promotion.promotionID && manifest.promotion.source === promotion.source
  }

  function evaluateSummary(input: {
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    promotion: PromotionSnapshot
  }) {
    const expectedMode = input.releasePacket.summary.promotionMode
    const gates = [
      {
        name: "release-packet-readiness",
        status: input.releasePacket.summary.overallStatus,
        detail:
          input.releasePacket.summary.overallStatus === "pass"
            ? `release packet ${input.releasePacket.packetID} is ready`
            : (input.releasePacket.summary.gates.find((gate) => gate.status === "fail")?.detail ??
              "release packet not ready"),
      },
      {
        name: "promotion-source-alignment",
        status: input.promotion.source === input.releasePacket.source ? "pass" : "fail",
        detail: `promotion source=${input.promotion.source} release packet source=${input.releasePacket.source}`,
      },
      {
        name: "promotion-mode-alignment",
        status: input.promotion.decision === expectedMode ? "pass" : "fail",
        detail: `promotion decision=${input.promotion.decision} release packet mode=${expectedMode}`,
      },
      {
        name: "release-packet-provenance",
        status: input.promotion.releasePacket?.packetID === input.releasePacket.packetID ? "pass" : "fail",
        detail: `promotion record packet=${input.promotion.releasePacket?.packetID ?? "n/a"} release packet=${input.releasePacket.packetID}`,
      },
    ] as const

    return ManifestSummary.parse({
      overallStatus: gates.every((gate) => gate.status === "pass") ? "pass" : "fail",
      releasePacketStatus: input.releasePacket.summary.overallStatus,
      promotionRecorded: true,
      promotionDecision: input.promotion.decision,
      promotionMode: input.releasePacket.summary.promotionMode,
      authorizedPromotion: input.releasePacket.summary.authorizedPromotion,
      boardDecisionStatus: input.releasePacket.releaseDecisionRecord.boardDecision.summary.overallStatus,
      releaseDecisionRecordStatus: input.releasePacket.releaseDecisionRecord.summary.overallStatus,
      previousActiveSource: input.promotion.previousActiveSource,
      gates,
    })
  }

  export function create(input: {
    releasePacket: QualityPromotionReleasePacket.PacketArtifact
    promotion: PromotionSnapshot
  }) {
    const createdAt = new Date().toISOString()
    const manifestID = `${input.promotion.promotionID}-audit-manifest`
    const packetReasons = QualityPromotionReleasePacket.verify(
      input.releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      input.releasePacket,
    )
    if (packetReasons.length > 0) {
      throw new Error(
        `Cannot create promotion audit manifest for ${input.releasePacket.source}: invalid release packet (${packetReasons[0]})`,
      )
    }
    const summary = evaluateSummary(input)
    return ManifestArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-audit-manifest",
      manifestID,
      source: input.releasePacket.source,
      createdAt,
      releasePacket: input.releasePacket,
      promotion: input.promotion,
      summary,
    })
  }

  export function verify(releasePacket: QualityPromotionReleasePacket.PacketArtifact, manifest: ManifestArtifact) {
    const reasons: string[] = []
    if (manifest.source !== releasePacket.source) {
      reasons.push(`audit manifest source mismatch: ${manifest.source} vs ${releasePacket.source}`)
    }
    if (JSON.stringify(manifest.releasePacket) !== JSON.stringify(releasePacket)) {
      reasons.push(`audit manifest release packet mismatch for ${releasePacket.source}`)
    }
    const packetReasons = QualityPromotionReleasePacket.verify(
      releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
      manifest.releasePacket,
    )
    if (packetReasons.length > 0) {
      reasons.push(`audit manifest embedded release packet mismatch for ${releasePacket.source} (${packetReasons[0]})`)
    }
    const expectedSummary = evaluateSummary({
      releasePacket,
      promotion: manifest.promotion,
    })
    if (JSON.stringify(manifest.summary) !== JSON.stringify(expectedSummary)) {
      reasons.push(`audit manifest summary mismatch for ${releasePacket.source}`)
    }
    return reasons
  }

  export async function resolveForPromotion(promotion: PromotionSnapshot, manifests: ManifestArtifact[] = []) {
    const persisted = (await list(promotion.source)).filter((manifest) => matchesPromotion(promotion, manifest))
    const deduped = new Map<string, ManifestArtifact>()
    for (const manifest of [...persisted, ...manifests]) {
      if (!matchesPromotion(promotion, manifest)) continue
      if (verify(manifest.releasePacket, manifest).length > 0) continue
      deduped.set(manifest.manifestID, manifest)
    }
    return sortManifests([...deduped.values()])
  }

  export async function get(input: { source: string; manifestID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.manifestID))
    return ManifestRecord.parse(record)
  }

  export async function append(manifest: ManifestArtifact) {
    await QualityPromotionReleasePacket.append(manifest.releasePacket)
    const next = ManifestRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-audit-manifest-record",
      manifest,
    })
    try {
      const existing = await get({ source: manifest.source, manifestID: manifest.manifestID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Promotion audit manifest ${manifest.manifestID} already exists for source ${manifest.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(manifest.source, manifest.manifestID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_audit_manifest", encode(source)]] : [["quality_model_audit_manifest"]]
    const manifests: ManifestArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const manifestID = parts[parts.length - 1]
        if (!encodedSource || !manifestID) continue
        const record = await get({ source: decode(encodedSource), manifestID })
        manifests.push(record.manifest)
      }
    }

    return sortManifests(manifests)
  }

  export async function assertPersisted(manifest: ManifestArtifact) {
    await QualityPromotionReleasePacket.assertPersisted(manifest.releasePacket)
    const persisted = await get({ source: manifest.source, manifestID: manifest.manifestID })
    const prev = JSON.stringify(persisted.manifest)
    const curr = JSON.stringify(manifest)
    if (prev !== curr) {
      throw new Error(`Persisted promotion audit manifest ${manifest.manifestID} does not match the provided artifact`)
    }
    return persisted
  }

  export function renderReport(manifest: ManifestArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion audit manifest")
    lines.push("")
    lines.push(`- source: ${manifest.source}`)
    lines.push(`- manifest id: ${manifest.manifestID}`)
    lines.push(`- created at: ${manifest.createdAt}`)
    lines.push(`- promotion id: ${manifest.promotion.promotionID}`)
    lines.push(`- promoted at: ${manifest.promotion.promotedAt}`)
    lines.push(`- release packet id: ${manifest.releasePacket.packetID}`)
    lines.push(`- decision: ${manifest.summary.promotionDecision}`)
    lines.push(`- promotion mode: ${manifest.summary.promotionMode}`)
    lines.push(`- authorized promotion: ${manifest.summary.authorizedPromotion}`)
    lines.push(`- overall status: ${manifest.summary.overallStatus}`)
    if (manifest.promotion.signedArchiveTrust) {
      lines.push(`- signed archive trust: ${manifest.promotion.signedArchiveTrust.overallStatus}`)
      lines.push(`- signed archive trust scope: ${manifest.promotion.signedArchiveTrust.resolution.scope ?? "n/a"}`)
      lines.push(`- signed archive trusted: ${manifest.promotion.signedArchiveTrust.trusted}`)
    }
    if (manifest.promotion.signedArchiveAttestation) {
      lines.push(`- signed archive attestation: ${manifest.promotion.signedArchiveAttestation.overallStatus}`)
      lines.push(`- signed archive accepted by policy: ${manifest.promotion.signedArchiveAttestation.acceptedByPolicy}`)
      lines.push(
        `- signed archive attestation policy source: ${manifest.promotion.signedArchiveAttestation.policySource}`,
      )
      lines.push(
        `- signed archive attestation policy project id: ${manifest.promotion.signedArchiveAttestation.policyProjectID ?? "n/a"}`,
      )
    }
    lines.push("")
    for (const gate of manifest.summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderSummary(summary: ManifestSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion audit manifest summary")
    lines.push("")
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- release packet status: ${summary.releasePacketStatus}`)
    lines.push(`- promotion recorded: ${summary.promotionRecorded}`)
    lines.push(`- promotion decision: ${summary.promotionDecision}`)
    lines.push(`- promotion mode: ${summary.promotionMode}`)
    lines.push(`- authorized promotion: ${summary.authorizedPromotion}`)
    lines.push(`- board decision status: ${summary.boardDecisionStatus}`)
    lines.push(`- release decision record status: ${summary.releaseDecisionRecordStatus}`)
    lines.push(`- previous active source: ${summary.previousActiveSource ?? "n/a"}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
