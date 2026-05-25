import type { QualityModelRegistry } from "./model-registry"
import type { QualityPromotionArchiveManifest } from "./promotion-archive-manifest"
import type { QualityPromotionAuditManifest } from "./promotion-audit-manifest"
import type { QualityPromotionExportBundle } from "./promotion-export-bundle"
import type { QualityPromotionHandoffPackage } from "./promotion-handoff-package"
import type { QualityPromotionPackagedArchive } from "./promotion-packaged-archive"
import type { QualityPromotionPortableExport } from "./promotion-portable-export"
import type { QualityPromotionSignedArchive } from "./promotion-signed-archive"
import type { QualityPromotionSignedArchiveAttestationPacket } from "./promotion-signed-archive-attestation-packet"
import type { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"
import type { QualityPromotionSignedArchiveAttestationRecord } from "./promotion-signed-archive-attestation-record"
import type { QualityPromotionSignedArchiveGovernancePacket } from "./promotion-signed-archive-governance-packet"
import type { QualityPromotionSignedArchiveReviewDossier } from "./promotion-signed-archive-review-dossier"
import type { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"

type PromotionRecord = QualityModelRegistry.PromotionRecord

export function auditManifestRecordSummary(
  auditManifest: QualityPromotionAuditManifest.ManifestArtifact,
): NonNullable<PromotionRecord["auditManifest"]> {
  return {
    manifestID: auditManifest.manifestID,
    createdAt: auditManifest.createdAt,
    packetID: auditManifest.releasePacket.packetID,
    promotionID: auditManifest.promotion.promotionID,
    decision: auditManifest.summary.promotionDecision,
    promotionMode: auditManifest.summary.promotionMode,
    overallStatus: auditManifest.summary.overallStatus,
  }
}

export function exportBundleRecordSummary(
  exportBundle: QualityPromotionExportBundle.ExportArtifact,
): NonNullable<PromotionRecord["exportBundle"]> {
  return {
    bundleID: exportBundle.bundleID,
    createdAt: exportBundle.createdAt,
    manifestID: exportBundle.auditManifest.manifestID,
    packetID: exportBundle.auditManifest.releasePacket.packetID,
    promotionID: exportBundle.auditManifest.promotion.promotionID,
    decision: exportBundle.summary.promotionDecision,
    promotionMode: exportBundle.summary.promotionMode,
    overallStatus: exportBundle.summary.overallStatus,
  }
}

export function archiveManifestRecordSummary(
  archiveManifest: QualityPromotionArchiveManifest.ArchiveArtifact,
): NonNullable<PromotionRecord["archiveManifest"]> {
  return {
    archiveID: archiveManifest.archiveID,
    createdAt: archiveManifest.createdAt,
    bundleID: archiveManifest.exportBundle.bundleID,
    manifestID: archiveManifest.exportBundle.auditManifest.manifestID,
    packetID: archiveManifest.exportBundle.auditManifest.releasePacket.packetID,
    promotionID: archiveManifest.exportBundle.auditManifest.promotion.promotionID,
    inventoryCount: archiveManifest.summary.inventoryCount,
    promotionMode: archiveManifest.summary.promotionMode,
    overallStatus: archiveManifest.summary.overallStatus,
  }
}

export function handoffPackageRecordSummary(
  handoffPackage: QualityPromotionHandoffPackage.PackageArtifact,
): NonNullable<PromotionRecord["handoffPackage"]> {
  return {
    packageID: handoffPackage.packageID,
    createdAt: handoffPackage.createdAt,
    archiveID: handoffPackage.archiveManifest.archiveID,
    bundleID: handoffPackage.archiveManifest.exportBundle.bundleID,
    manifestID: handoffPackage.archiveManifest.exportBundle.auditManifest.manifestID,
    packetID: handoffPackage.archiveManifest.exportBundle.auditManifest.releasePacket.packetID,
    promotionID: handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
    documentCount: handoffPackage.summary.documentCount,
    overallStatus: handoffPackage.summary.overallStatus,
  }
}

export function portableExportRecordSummary(
  portableExport: QualityPromotionPortableExport.ExportArtifact,
): NonNullable<PromotionRecord["portableExport"]> {
  return {
    exportID: portableExport.exportID,
    createdAt: portableExport.createdAt,
    packageID: portableExport.handoffPackage.packageID,
    archiveID: portableExport.handoffPackage.archiveManifest.archiveID,
    bundleID: portableExport.handoffPackage.archiveManifest.exportBundle.bundleID,
    promotionID: portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
    fileCount: portableExport.summary.fileCount,
    overallStatus: portableExport.summary.overallStatus,
  }
}

export function packagedArchiveRecordSummary(
  packagedArchive: QualityPromotionPackagedArchive.ArchiveArtifact,
): NonNullable<PromotionRecord["packagedArchive"]> {
  return {
    archiveID: packagedArchive.archiveID,
    createdAt: packagedArchive.createdAt,
    exportID: packagedArchive.portableExport.exportID,
    packageID: packagedArchive.portableExport.handoffPackage.packageID,
    promotionID:
      packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion.promotionID,
    entryCount: packagedArchive.summary.entryCount,
    overallStatus: packagedArchive.summary.overallStatus,
  }
}

export function signedArchiveRecordSummary(
  signedArchive: QualityPromotionSignedArchive.ArchiveArtifact,
): NonNullable<PromotionRecord["signedArchive"]> {
  return {
    signedArchiveID: signedArchive.signedArchiveID,
    createdAt: signedArchive.createdAt,
    archiveID: signedArchive.packagedArchive.archiveID,
    exportID: signedArchive.packagedArchive.portableExport.exportID,
    promotionID:
      signedArchive.packagedArchive.portableExport.handoffPackage.archiveManifest.exportBundle.auditManifest.promotion
        .promotionID,
    keyID: signedArchive.attestation.keyID,
    attestedBy: signedArchive.attestation.attestedBy,
    algorithm: signedArchive.attestation.algorithm,
    overallStatus: signedArchive.summary.overallStatus,
  }
}

export function signedArchiveTrustRecordSummary(
  trust: QualityPromotionSignedArchiveTrust.TrustSummary,
): NonNullable<PromotionRecord["signedArchiveTrust"]> {
  return {
    overallStatus: trust.overallStatus,
    trusted: trust.trusted,
    signatureStatus: trust.signatureStatus,
    registryStatus: trust.registryStatus,
    lifecycleStatus: trust.lifecycleStatus,
    resolution: trust.resolution,
  }
}

export function signedArchiveAttestationPolicyRecordSummary(
  attestation: QualityPromotionSignedArchiveAttestationPolicy.Summary,
): NonNullable<PromotionRecord["signedArchiveAttestation"]> {
  return {
    overallStatus: attestation.overallStatus,
    policySource: attestation.policySource,
    policyProjectID: attestation.policyProjectID,
    policyDigest: attestation.policyDigest,
    acceptedByPolicy: attestation.acceptedByPolicy,
    trustStatus: attestation.trustStatus,
    minimumScopeStatus: attestation.minimumScopeStatus,
    lifecyclePolicyStatus: attestation.lifecyclePolicyStatus,
    effectiveTrustScope: attestation.effectiveTrustScope,
    effectiveTrustLifecycle: attestation.effectiveTrustLifecycle,
  }
}

export function signedArchiveAttestationRecordSummary(
  signedArchiveAttestationRecord: QualityPromotionSignedArchiveAttestationRecord.RecordArtifact,
): NonNullable<PromotionRecord["signedArchiveAttestationRecord"]> {
  return {
    recordID: signedArchiveAttestationRecord.recordID,
    createdAt: signedArchiveAttestationRecord.createdAt,
    signedArchiveID: signedArchiveAttestationRecord.signedArchive.signedArchiveID,
    promotionID: signedArchiveAttestationRecord.promotionID,
    trustStatus: signedArchiveAttestationRecord.summary.trustStatus,
    attestationStatus: signedArchiveAttestationRecord.summary.attestationStatus,
    trusted: signedArchiveAttestationRecord.summary.trusted,
    acceptedByPolicy: signedArchiveAttestationRecord.summary.acceptedByPolicy,
    policySource: signedArchiveAttestationRecord.summary.policySource,
    policyProjectID: signedArchiveAttestationRecord.summary.policyProjectID,
    overallStatus: signedArchiveAttestationRecord.summary.overallStatus,
  }
}

export function signedArchiveAttestationPacketRecordSummary(
  signedArchiveAttestationPacket: QualityPromotionSignedArchiveAttestationPacket.PacketArtifact,
): NonNullable<PromotionRecord["signedArchiveAttestationPacket"]> {
  return {
    packetID: signedArchiveAttestationPacket.packetID,
    createdAt: signedArchiveAttestationPacket.createdAt,
    promotionID: signedArchiveAttestationPacket.promotion.promotionID,
    signedArchiveID: signedArchiveAttestationPacket.summary.signedArchiveID,
    trustStatus: signedArchiveAttestationPacket.summary.trustStatus,
    attestationStatus: signedArchiveAttestationPacket.summary.attestationStatus,
    acceptedByPolicy: signedArchiveAttestationPacket.summary.acceptedByPolicy,
    policySource: signedArchiveAttestationPacket.summary.policySource,
    policyProjectID: signedArchiveAttestationPacket.summary.policyProjectID,
    overallStatus: signedArchiveAttestationPacket.summary.overallStatus,
  }
}

export function signedArchiveGovernancePacketRecordSummary(
  signedArchiveGovernancePacket: QualityPromotionSignedArchiveGovernancePacket.PacketArtifact,
): NonNullable<PromotionRecord["signedArchiveGovernancePacket"]> {
  return {
    packetID: signedArchiveGovernancePacket.packetID,
    createdAt: signedArchiveGovernancePacket.createdAt,
    promotionID: signedArchiveGovernancePacket.promotion.promotionID,
    releasePacketID: signedArchiveGovernancePacket.summary.releasePacketID,
    signedArchiveID: signedArchiveGovernancePacket.summary.signedArchiveID,
    authorizedPromotion: signedArchiveGovernancePacket.summary.authorizedPromotion,
    promotionMode: signedArchiveGovernancePacket.summary.promotionMode,
    policySource: signedArchiveGovernancePacket.summary.policySource,
    policyProjectID: signedArchiveGovernancePacket.summary.policyProjectID,
    overallStatus: signedArchiveGovernancePacket.summary.overallStatus,
  }
}

export function signedArchiveReviewDossierRecordSummary(
  signedArchiveReviewDossier: QualityPromotionSignedArchiveReviewDossier.DossierArtifact,
): NonNullable<PromotionRecord["signedArchiveReviewDossier"]> {
  return {
    dossierID: signedArchiveReviewDossier.dossierID,
    createdAt: signedArchiveReviewDossier.createdAt,
    promotionID: signedArchiveReviewDossier.governancePacket.promotion.promotionID,
    governancePacketID: signedArchiveReviewDossier.governancePacket.packetID,
    packageID: signedArchiveReviewDossier.handoffPackage.packageID,
    releasePacketID: signedArchiveReviewDossier.summary.releasePacketID,
    signedArchiveID: signedArchiveReviewDossier.summary.signedArchiveID,
    authorizedPromotion: signedArchiveReviewDossier.summary.authorizedPromotion,
    promotionMode: signedArchiveReviewDossier.summary.promotionMode,
    policySource: signedArchiveReviewDossier.summary.policySource,
    policyProjectID: signedArchiveReviewDossier.summary.policyProjectID,
    overallStatus: signedArchiveReviewDossier.summary.overallStatus,
  }
}
