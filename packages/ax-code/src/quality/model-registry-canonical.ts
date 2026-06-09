import { CanonicalPromotionSummary, type PromotionRecord } from "./model-registry-schema"

function canonicalPromotionOverallStatus(record: PromotionRecord): CanonicalPromotionSummary["overallStatus"] {
  return (
    record.signedArchiveReviewDossier?.overallStatus ??
    record.signedArchiveAttestationRecord?.overallStatus ??
    record.signedArchiveAttestation?.overallStatus ??
    record.signedArchive?.overallStatus ??
    record.releasePacket?.overallStatus ??
    record.reviewDossier?.overallStatus ??
    record.benchmark.overallStatus
  )
}

export function summarizeCanonicalPromotion(record: PromotionRecord) {
  const reviewGoverned = Boolean(record.reviewDossier || record.boardDecision || record.releaseDecisionRecord)
  const releaseAuthorized = Boolean(record.releasePacket?.authorizedPromotion)
  const signedArchivePresent = Boolean(record.signedArchive)
  const attestationAccepted =
    record.signedArchiveAttestation?.acceptedByPolicy ?? record.signedArchiveAttestationRecord?.acceptedByPolicy ?? null
  const postSigningReviewed = Boolean(record.signedArchiveReviewDossier)
  const currentStage: CanonicalPromotionSummary["currentStage"] = postSigningReviewed
    ? "post_signing_reviewed"
    : signedArchivePresent
      ? "signed_and_evaluated"
      : releaseAuthorized
        ? "release_authorized"
        : reviewGoverned
          ? "review_governed"
          : "model_promoted"
  const canonicalArtifactKind: CanonicalPromotionSummary["canonicalArtifactKind"] = postSigningReviewed
    ? "signed_archive_review_dossier"
    : record.releasePacket
      ? "release_packet"
      : record.reviewDossier
        ? "review_dossier"
        : "promotion_record"
  const canonicalArtifactID = postSigningReviewed
    ? record.signedArchiveReviewDossier!.dossierID
    : record.releasePacket
      ? record.releasePacket.packetID
      : record.reviewDossier
        ? record.reviewDossier.dossierID
        : record.promotionID

  const gaps: string[] = []
  if (!reviewGoverned) {
    gaps.push("Pre-release review governance is missing.")
  }
  if (reviewGoverned && !record.releasePacket) {
    gaps.push("Release packet is missing.")
  }
  if (record.releasePacket && !record.signedArchive) {
    gaps.push("Signed archive is missing.")
  }
  if (record.signedArchive && !record.signedArchiveAttestationRecord) {
    gaps.push("Signed archive attestation record is missing.")
  }
  if (record.signedArchive && attestationAccepted === false) {
    gaps.push("Signed archive is not accepted by the resolved attestation policy.")
  }
  if (record.signedArchive && !record.signedArchiveReviewDossier) {
    gaps.push("Post-signing review dossier is missing.")
  }

  const nextAction = !reviewGoverned
    ? "Advance this promotion through the pre-release review path before treating it as releasable."
    : !record.releasePacket
      ? "Create a release packet to freeze release authorization and operator intent."
      : !record.signedArchive
        ? "Create and verify a signed archive from the release packet."
        : attestationAccepted === false
          ? "Resolve signed archive trust or attestation policy mismatches before distribution."
          : !record.signedArchiveReviewDossier
            ? "Build the signed archive review dossier so post-signing review has a canonical entry point."
            : null

  return CanonicalPromotionSummary.parse({
    promotionID: record.promotionID,
    source: record.source,
    decision: record.decision,
    currentStage,
    overallStatus: canonicalPromotionOverallStatus(record),
    canonicalArtifactKind,
    canonicalArtifactID,
    reviewGoverned,
    releaseAuthorized,
    signedArchivePresent,
    attestationAccepted,
    postSigningReviewed,
    policySource:
      record.signedArchiveReviewDossier?.policySource ??
      record.signedArchiveAttestationRecord?.policySource ??
      record.signedArchiveAttestation?.policySource ??
      null,
    policyProjectID:
      record.signedArchiveReviewDossier?.policyProjectID ??
      record.signedArchiveAttestationRecord?.policyProjectID ??
      record.signedArchiveAttestation?.policyProjectID ??
      null,
    nextAction,
    gaps,
    artifacts: {
      reviewDossierID: record.reviewDossier?.dossierID ?? null,
      boardDecisionID: record.boardDecision?.decisionID ?? null,
      releasePacketID: record.releasePacket?.packetID ?? null,
      signedArchiveID: record.signedArchive?.signedArchiveID ?? null,
      signedArchiveAttestationRecordID: record.signedArchiveAttestationRecord?.recordID ?? null,
      signedArchiveReviewDossierID: record.signedArchiveReviewDossier?.dossierID ?? null,
      handoffPackageID: record.handoffPackage?.packageID ?? null,
      packagedArchiveID: record.packagedArchive?.archiveID ?? null,
    },
  })
}

export function renderCanonicalPromotionReport(input: PromotionRecord | CanonicalPromotionSummary) {
  const summary = "kind" in input ? summarizeCanonicalPromotion(input) : input
  const lines: string[] = []
  lines.push("## ax-code quality promotion canonical summary")
  lines.push("")
  lines.push(`- source: ${summary.source}`)
  lines.push(`- promotion id: ${summary.promotionID}`)
  lines.push(`- decision: ${summary.decision}`)
  lines.push(`- current stage: ${summary.currentStage}`)
  lines.push(`- overall status: ${summary.overallStatus}`)
  lines.push(`- canonical artifact: ${summary.canonicalArtifactKind} · ${summary.canonicalArtifactID}`)
  lines.push(`- review governed: ${summary.reviewGoverned}`)
  lines.push(`- release authorized: ${summary.releaseAuthorized}`)
  lines.push(`- signed archive present: ${summary.signedArchivePresent}`)
  lines.push(`- attestation accepted: ${summary.attestationAccepted === null ? "n/a" : summary.attestationAccepted}`)
  lines.push(`- post-signing reviewed: ${summary.postSigningReviewed}`)
  lines.push(`- policy source: ${summary.policySource ?? "n/a"}`)
  lines.push(`- policy project id: ${summary.policyProjectID ?? "n/a"}`)
  lines.push(`- next action: ${summary.nextAction ?? "none"}`)
  lines.push("")
  lines.push("### Canonical Artifacts")
  lines.push("")
  lines.push(`- review dossier: ${summary.artifacts.reviewDossierID ?? "missing"}`)
  lines.push(`- board decision: ${summary.artifacts.boardDecisionID ?? "missing"}`)
  lines.push(`- release packet: ${summary.artifacts.releasePacketID ?? "missing"}`)
  lines.push(`- signed archive: ${summary.artifacts.signedArchiveID ?? "missing"}`)
  lines.push(`- signed archive attestation record: ${summary.artifacts.signedArchiveAttestationRecordID ?? "missing"}`)
  lines.push(`- signed archive review dossier: ${summary.artifacts.signedArchiveReviewDossierID ?? "missing"}`)
  lines.push(`- handoff package: ${summary.artifacts.handoffPackageID ?? "missing"}`)
  lines.push(`- packaged archive: ${summary.artifacts.packagedArchiveID ?? "missing"}`)
  lines.push("")
  lines.push("### Gaps")
  lines.push("")
  if (summary.gaps.length === 0) {
    lines.push("- none")
  } else {
    for (const gap of summary.gaps) {
      lines.push(`- ${gap}`)
    }
  }
  lines.push("")
  return lines.join("\n")
}
