import { QualityPromotionArchiveManifest } from "../promotion-archive-manifest"
import { QualityPromotionAuditManifest } from "../promotion-audit-manifest"
import { QualityPromotionExportBundle } from "../promotion-export-bundle"
import { QualityPromotionHandoffPackage } from "../promotion-handoff-package"
import { QualityPromotionPackagedArchive } from "../promotion-packaged-archive"
import { QualityPromotionPortableExport } from "../promotion-portable-export"
import { QualityPromotionReleasePacket } from "../promotion-release-packet"
import { QualityPromotionReleasePolicyStore } from "../promotion-release-policy-store"
import { QualityPromotionSignedArchive } from "../promotion-signed-archive"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationPolicyStore } from "../promotion-signed-archive-attestation-policy-store"
import { QualityPromotionSignedArchiveAttestationRecord } from "../promotion-signed-archive-attestation-record"
import { QualityPromotionSignedArchiveAttestationPacket } from "../promotion-signed-archive-attestation-packet"
import { QualityPromotionSignedArchiveGovernancePacket } from "../promotion-signed-archive-governance-packet"
import { QualityPromotionSignedArchiveReviewDossier } from "../promotion-signed-archive-review-dossier"
import { QualityPromotionSignedArchiveTrust } from "../promotion-signed-archive-trust"
import { QualityStorageKey } from "../storage-key"
import {
  archiveManifestRecordSummary,
  auditManifestRecordSummary,
  exportBundleRecordSummary,
  handoffPackageRecordSummary,
  packagedArchiveRecordSummary,
  portableExportRecordSummary,
  signedArchiveAttestationPacketRecordSummary,
  signedArchiveAttestationPolicyRecordSummary,
  signedArchiveAttestationRecordSummary,
  signedArchiveGovernancePacketRecordSummary,
  signedArchiveRecordSummary,
  signedArchiveReviewDossierRecordSummary,
  signedArchiveTrustRecordSummary,
} from "../model-registry-artifact-summary"
import {
  boardDecisionRecordSummary,
  releaseDecisionRecordSummary,
  releasePacketRecordSummary,
  reviewDossierRecordSummary,
  submissionBundleRecordSummary,
} from "../model-registry-record-summary"
import { QualityModelRegistry } from "./index"
import { promoteReleaseDecisionRecord } from "./promote-bundle"

type PromotionMetadata = QualityModelRegistry.PromotionMetadata

function encode(input: string) {
  return QualityStorageKey.encode(input)
}

function firstFailureDetail(gates: readonly { status: string; detail?: string | null }[], fallback = "unknown failure") {
  return gates.find((gate) => gate.status === "fail")?.detail ?? fallback
}

function assertPromotionSummaryPass(
  source: string,
  reason: string,
  summary: { overallStatus: string; gates: readonly { status: string; detail?: string | null }[] },
) {
  if (summary.overallStatus === "pass") return
  throw new Error(`Cannot promote model ${source}: ${reason} (${firstFailureDetail(summary.gates)})`)
}

function createPromotionMetadata(source: string): PromotionMetadata {
  return QualityModelRegistry.PromotionMetadata.parse({
    promotionID: `${Date.now()}-${encode(source)}`,
    promotedAt: new Date().toISOString(),
  })
}

function auditManifestPromotionSnapshot(record: QualityModelRegistry.PromotionRecord) {
  return QualityPromotionAuditManifest.PromotionSnapshot.parse({
    promotionID: record.promotionID,
    source: record.source,
    promotedAt: record.promotedAt,
    previousActiveSource: record.previousActiveSource,
    decision: record.decision,
    decisionBundleCreatedAt: record.decisionBundleCreatedAt ?? null,
    boardDecision: record.boardDecision,
    releaseDecisionRecord: record.releaseDecisionRecord,
    releasePacket: record.releasePacket,
    reviewDossier: record.reviewDossier,
    submissionBundle: record.submissionBundle,
    approvalPacket: record.approvalPacket,
    signedArchiveTrust: record.signedArchiveTrust,
    signedArchiveAttestation: record.signedArchiveAttestation,
  })
}

function buildReleasePacketPromotionSnapshot(input: {
  releasePacket: QualityPromotionReleasePacket.PacketArtifact
  promotionMetadata: PromotionMetadata
  previousActiveSource: string | null
  decision: "pass" | "warn_override" | "force"
}) {
  const boardDecision = input.releasePacket.releaseDecisionRecord.boardDecision
  const reviewDossier = boardDecision.reviewDossier
  const submissionBundle = reviewDossier.submissionBundle
  const approvalPacket = submissionBundle.approvalPacket
  return QualityPromotionAuditManifest.PromotionSnapshot.parse({
    promotionID: input.promotionMetadata.promotionID,
    source: input.releasePacket.source,
    promotedAt: input.promotionMetadata.promotedAt,
    previousActiveSource: input.previousActiveSource,
    decision: input.decision,
    decisionBundleCreatedAt: submissionBundle.decisionBundle.createdAt,
    boardDecision: boardDecisionRecordSummary(boardDecision),
    releaseDecisionRecord: releaseDecisionRecordSummary(input.releasePacket.releaseDecisionRecord),
    releasePacket: releasePacketRecordSummary(input.releasePacket),
    reviewDossier: reviewDossierRecordSummary(reviewDossier),
    submissionBundle: submissionBundleRecordSummary(submissionBundle),
    approvalPacket: {
      packetID: approvalPacket.packetID,
      createdAt: approvalPacket.createdAt,
      decisionBundleCreatedAt: approvalPacket.decisionBundle.createdAt,
      decisionBundleDigest: approvalPacket.decisionBundle.digest,
      adoptionStatus: approvalPacket.readiness.adoptionStatus,
      approvalCount: approvalPacket.readiness.totalApprovals,
      adoptionReviewCount: approvalPacket.readiness.totalAdoptionReviews,
      hasDissentHandling: !!approvalPacket.dissentHandling,
      overallStatus: approvalPacket.readiness.overallStatus,
    },
  })
}

function releasePacketAttestationProjectID(releasePacket: QualityPromotionReleasePacket.PacketArtifact) {
  return (
    releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle.releasePolicy?.provenance.policyProjectID?.trim() ||
    null
  )
}

async function preflightReleasePacketArtifacts(input: {
  releasePacket: QualityPromotionReleasePacket.PacketArtifact
  promotionMetadata: PromotionMetadata
  archiveSigning: QualityPromotionSignedArchive.SigningInput
  attestationPolicyResolution: QualityPromotionSignedArchiveAttestationPolicyStore.Resolution
}) {
  const decision = input.releasePacket.summary.promotionMode
  const currentActive = await QualityModelRegistry.getActive()
  const baseSnapshot = buildReleasePacketPromotionSnapshot({
    releasePacket: input.releasePacket,
    promotionMetadata: input.promotionMetadata,
    previousActiveSource: currentActive?.source ?? null,
    decision,
  })
  const auditManifest = QualityPromotionAuditManifest.create({
    releasePacket: input.releasePacket,
    promotion: baseSnapshot,
  })
  const exportBundle = QualityPromotionExportBundle.create({ auditManifest })
  const archiveManifest = QualityPromotionArchiveManifest.create({ exportBundle })
  const handoffPackage = QualityPromotionHandoffPackage.create({ archiveManifest })
  const portableExport = QualityPromotionPortableExport.create({ handoffPackage })
  const packagedArchive = QualityPromotionPackagedArchive.create({ portableExport })
  const signedArchive = QualityPromotionSignedArchive.create({
    packagedArchive,
    signing: input.archiveSigning,
  })
  const signedArchiveTrust = await QualityPromotionSignedArchiveTrust.evaluate({
    archive: signedArchive,
    keyMaterial: input.archiveSigning.keyMaterial,
    projectID: input.attestationPolicyResolution.projectID ?? undefined,
  })
  const signedArchiveAttestation = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
    trust: signedArchiveTrust,
    policy: input.attestationPolicyResolution.policy,
    policySource: input.attestationPolicyResolution.source,
    policyProjectID: input.attestationPolicyResolution.projectID,
  })
  if (!signedArchiveAttestation.acceptedByPolicy) {
    throw new Error(
      `Cannot promote model ${input.releasePacket.source}: signed archive attestation policy not satisfied (${firstFailureDetail(signedArchiveAttestation.gates)})`,
    )
  }
  return {
    promotion: baseSnapshot,
    previousActiveSource: currentActive?.source ?? null,
    decision,
    auditManifest,
    exportBundle,
    archiveManifest,
    handoffPackage,
    portableExport,
    packagedArchive,
    signedArchive,
    signedArchiveTrust,
    signedArchiveAttestation,
  }
}

export async function promoteReleasePacket(
  releasePacket: QualityPromotionReleasePacket.PacketArtifact,
  options?: {
    releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    archiveSigning?: QualityPromotionSignedArchive.SigningInput
    attestationPolicyResolution?: QualityPromotionSignedArchiveAttestationPolicyStore.Resolution
  },
) {
  const packetReasons = QualityPromotionReleasePacket.verify(
    releasePacket.releaseDecisionRecord.boardDecision.reviewDossier.submissionBundle.decisionBundle,
    releasePacket,
  )
  if (packetReasons.length > 0) {
    throw new Error(`Cannot promote model ${releasePacket.source}: invalid release packet (${packetReasons[0]})`)
  }
  await QualityPromotionReleasePacket.assertPersisted(releasePacket)
  assertPromotionSummaryPass(releasePacket.source, "release packet not ready", releasePacket.summary)
  const attestationProjectID = releasePacketAttestationProjectID(releasePacket)
  if (
    options?.archiveSigning &&
    options.attestationPolicyResolution?.projectID &&
    attestationProjectID &&
    options.attestationPolicyResolution.projectID !== attestationProjectID
  ) {
    throw new Error(
      `Cannot promote model ${releasePacket.source}: attestation policy resolution project mismatch (${options.attestationPolicyResolution.projectID} vs ${attestationProjectID})`,
    )
  }
  const attestationPolicyResolution = options?.archiveSigning
    ? (options.attestationPolicyResolution ??
      (await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: attestationProjectID ?? undefined,
      })))
    : undefined
  const promotionMetadata = options?.archiveSigning ? createPromotionMetadata(releasePacket.source) : undefined
  const preflight = options?.archiveSigning
    ? await preflightReleasePacketArtifacts({
        releasePacket,
        promotionMetadata: promotionMetadata!,
        archiveSigning: options.archiveSigning,
        attestationPolicyResolution: attestationPolicyResolution!,
      })
    : undefined
  const result = await promoteReleaseDecisionRecord(releasePacket.releaseDecisionRecord, {
    releasePolicyResolution: options?.releasePolicyResolution,
    promotionMetadata,
  })
  const record = QualityModelRegistry.PromotionRecord.parse({
    ...result.record,
    releasePacket: releasePacketRecordSummary(releasePacket),
  })
  await QualityModelRegistry.writePromotionRecord(record)
  const auditManifest =
    preflight?.auditManifest ??
    QualityPromotionAuditManifest.create({
      releasePacket,
      promotion: auditManifestPromotionSnapshot(record),
    })
  await QualityPromotionAuditManifest.append(auditManifest)
  const exportBundle =
    preflight?.exportBundle ?? QualityPromotionExportBundle.create({ auditManifest })
  await QualityPromotionExportBundle.append(exportBundle)
  const archiveManifest =
    preflight?.archiveManifest ?? QualityPromotionArchiveManifest.create({ exportBundle })
  await QualityPromotionArchiveManifest.append(archiveManifest)
  const handoffPackage =
    preflight?.handoffPackage ?? QualityPromotionHandoffPackage.create({ archiveManifest })
  await QualityPromotionHandoffPackage.append(handoffPackage)
  const portableExport =
    preflight?.portableExport ?? QualityPromotionPortableExport.create({ handoffPackage })
  await QualityPromotionPortableExport.append(portableExport)
  const packagedArchive =
    preflight?.packagedArchive ?? QualityPromotionPackagedArchive.create({ portableExport })
  await QualityPromotionPackagedArchive.append(packagedArchive)
  const signedArchive =
    preflight?.signedArchive ??
    (options?.archiveSigning
      ? QualityPromotionSignedArchive.create({ packagedArchive, signing: options.archiveSigning })
      : undefined)
  if (signedArchive) {
    await QualityPromotionSignedArchive.append(signedArchive)
  }
  const signedArchiveAttestationRecord =
    signedArchive && preflight
      ? QualityPromotionSignedArchiveAttestationRecord.create({
          signedArchive,
          trust: preflight.signedArchiveTrust,
          attestation: preflight.signedArchiveAttestation,
        })
      : undefined
  if (signedArchiveAttestationRecord) {
    await QualityPromotionSignedArchiveAttestationRecord.append(signedArchiveAttestationRecord)
  }
  const signedArchiveAttestationPacket = signedArchiveAttestationRecord
    ? QualityPromotionSignedArchiveAttestationPacket.create({
        promotion: {
          promotionID: record.promotionID,
          source: record.source,
          promotedAt: record.promotedAt,
          decision: record.decision,
          previousActiveSource: record.previousActiveSource,
          releasePacketID: releasePacket.packetID,
          promotionMode: releasePacket.summary.promotionMode,
          authorizedPromotion: releasePacket.summary.authorizedPromotion,
          signedArchiveID: signedArchiveAttestationRecord.signedArchive.signedArchiveID,
        },
        attestationRecord: signedArchiveAttestationRecord,
      })
    : undefined
  if (signedArchiveAttestationPacket) {
    await QualityPromotionSignedArchiveAttestationPacket.append(signedArchiveAttestationPacket)
  }
  const signedArchiveGovernancePacket = signedArchiveAttestationPacket
    ? QualityPromotionSignedArchiveGovernancePacket.create({
        promotion: signedArchiveAttestationPacket.promotion,
        releasePacket,
        attestationPacket: signedArchiveAttestationPacket,
      })
    : undefined
  if (signedArchiveGovernancePacket) {
    await QualityPromotionSignedArchiveGovernancePacket.append(signedArchiveGovernancePacket)
  }
  const signedArchiveReviewDossier = signedArchiveGovernancePacket
    ? QualityPromotionSignedArchiveReviewDossier.create({
        governancePacket: signedArchiveGovernancePacket,
        handoffPackage,
      })
    : undefined
  if (signedArchiveReviewDossier) {
    await QualityPromotionSignedArchiveReviewDossier.append(signedArchiveReviewDossier)
  }
  const recordWithArtifacts = QualityModelRegistry.PromotionRecord.parse({
    ...record,
    auditManifest: auditManifestRecordSummary(auditManifest),
    exportBundle: exportBundleRecordSummary(exportBundle),
    archiveManifest: archiveManifestRecordSummary(archiveManifest),
    handoffPackage: handoffPackageRecordSummary(handoffPackage),
    portableExport: portableExportRecordSummary(portableExport),
    packagedArchive: packagedArchiveRecordSummary(packagedArchive),
    signedArchive: signedArchive ? signedArchiveRecordSummary(signedArchive) : undefined,
    signedArchiveTrust: preflight ? signedArchiveTrustRecordSummary(preflight.signedArchiveTrust) : undefined,
    signedArchiveAttestation: preflight
      ? signedArchiveAttestationPolicyRecordSummary(preflight.signedArchiveAttestation)
      : undefined,
    signedArchiveAttestationRecord: signedArchiveAttestationRecord
      ? signedArchiveAttestationRecordSummary(signedArchiveAttestationRecord)
      : undefined,
    signedArchiveAttestationPacket: signedArchiveAttestationPacket
      ? signedArchiveAttestationPacketRecordSummary(signedArchiveAttestationPacket)
      : undefined,
    signedArchiveGovernancePacket: signedArchiveGovernancePacket
      ? signedArchiveGovernancePacketRecordSummary(signedArchiveGovernancePacket)
      : undefined,
    signedArchiveReviewDossier: signedArchiveReviewDossier
      ? signedArchiveReviewDossierRecordSummary(signedArchiveReviewDossier)
      : undefined,
  })
  await QualityModelRegistry.writePromotionRecord(recordWithArtifacts)
  return { ...result, record: recordWithArtifacts }
}
