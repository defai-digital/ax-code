import { describe, expect, test } from "bun:test"
import { QualityModelRegistry } from "../../src/quality/model-registry"

function basePromotionRecord(overrides: Record<string, unknown> = {}) {
  return QualityModelRegistry.PromotionRecord.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-model-promotion",
    promotionID: "promotion-1",
    source: "quality-source",
    promotedAt: "2026-04-21T00:00:00.000Z",
    previousActiveSource: null,
    decision: "pass",
    benchmark: {
      baselineSource: "baseline",
      overallStatus: "pass",
      trainSessions: 1,
      evalSessions: 1,
      labeledTrainingItems: 1,
      gates: [
        {
          name: "dataset-consistency",
          status: "pass",
          detail: "ok",
        },
      ],
    },
    ...overrides,
  })
}

describe("QualityModelRegistry canonical promotion summary", () => {
  test("summarizes a fully signed and post-signing-reviewed promotion as canonical post-signing state", () => {
    const record = basePromotionRecord({
      reviewDossier: {
        dossierID: "pre-release-review-dossier",
        createdAt: "2026-04-21T00:01:00.000Z",
        submissionID: "submission-1",
        submissionCreatedAt: "2026-04-21T00:00:30.000Z",
        decisionBundleCreatedAt: "2026-04-21T00:00:10.000Z",
        approvalPacketID: "approval-packet-1",
        overallStatus: "pass",
        recommendation: "approve_promotion",
      },
      releasePacket: {
        packetID: "release-packet-1",
        createdAt: "2026-04-21T00:02:00.000Z",
        recordID: "release-record-1",
        decisionID: "board-decision-1",
        authorizedPromotion: true,
        promotionMode: "pass",
        overallStatus: "pass",
      },
      handoffPackage: {
        packageID: "handoff-package-1",
        createdAt: "2026-04-21T00:03:00.000Z",
        archiveID: "archive-manifest-1",
        bundleID: "export-bundle-1",
        manifestID: "audit-manifest-1",
        packetID: "release-packet-1",
        promotionID: "promotion-1",
        documentCount: 11,
        overallStatus: "pass",
      },
      packagedArchive: {
        archiveID: "packaged-archive-1",
        createdAt: "2026-04-21T00:03:30.000Z",
        exportID: "portable-export-1",
        packageID: "handoff-package-1",
        promotionID: "promotion-1",
        entryCount: 14,
        overallStatus: "pass",
      },
      signedArchive: {
        signedArchiveID: "signed-archive-1",
        createdAt: "2026-04-21T00:04:00.000Z",
        archiveID: "packaged-archive-1",
        exportID: "portable-export-1",
        promotionID: "promotion-1",
        keyID: "archive-key-v1",
        attestedBy: "release-integrity-bot",
        algorithm: "hmac-sha256",
        overallStatus: "pass",
      },
      signedArchiveAttestationRecord: {
        recordID: "attestation-record-1",
        createdAt: "2026-04-21T00:04:30.000Z",
        signedArchiveID: "signed-archive-1",
        promotionID: "promotion-1",
        trustStatus: "pass",
        attestationStatus: "pass",
        trusted: true,
        acceptedByPolicy: true,
        policySource: "project",
        policyProjectID: "project-1",
        overallStatus: "pass",
      },
      signedArchiveReviewDossier: {
        dossierID: "signed-review-dossier-1",
        createdAt: "2026-04-21T00:05:00.000Z",
        promotionID: "promotion-1",
        governancePacketID: "governance-packet-1",
        packageID: "handoff-package-1",
        releasePacketID: "release-packet-1",
        signedArchiveID: "signed-archive-1",
        authorizedPromotion: true,
        promotionMode: "pass",
        policySource: "project",
        policyProjectID: "project-1",
        overallStatus: "pass",
      },
    })

    const summary = QualityModelRegistry.summarizeCanonicalPromotion(record)

    expect(summary.currentStage).toBe("post_signing_reviewed")
    expect(summary.canonicalArtifactKind).toBe("signed_archive_review_dossier")
    expect(summary.canonicalArtifactID).toBe("signed-review-dossier-1")
    expect(summary.policyProjectID).toBe("project-1")
    expect(summary.nextAction).toBeNull()
    expect(summary.gaps).toEqual([])
  })

  test("surfaces the missing signed archive as the next canonical action after release authorization", () => {
    const record = basePromotionRecord({
      reviewDossier: {
        dossierID: "pre-release-review-dossier",
        createdAt: "2026-04-21T00:01:00.000Z",
        submissionID: "submission-1",
        submissionCreatedAt: "2026-04-21T00:00:30.000Z",
        decisionBundleCreatedAt: "2026-04-21T00:00:10.000Z",
        approvalPacketID: "approval-packet-1",
        overallStatus: "pass",
        recommendation: "approve_promotion",
      },
      releasePacket: {
        packetID: "release-packet-1",
        createdAt: "2026-04-21T00:02:00.000Z",
        recordID: "release-record-1",
        decisionID: "board-decision-1",
        authorizedPromotion: true,
        promotionMode: "pass",
        overallStatus: "pass",
      },
    })

    const summary = QualityModelRegistry.summarizeCanonicalPromotion(record)

    expect(summary.currentStage).toBe("release_authorized")
    expect(summary.canonicalArtifactKind).toBe("release_packet")
    expect(summary.canonicalArtifactID).toBe("release-packet-1")
    expect(summary.nextAction).toContain("signed archive")
    expect(summary.gaps).toContain("Signed archive is missing.")
  })
})
