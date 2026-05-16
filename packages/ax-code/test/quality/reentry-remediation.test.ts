import { describe, expect, test } from "bun:test"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityReentryContext } from "../../src/quality/reentry-context"
import { QualityReentryRemediation } from "../../src/quality/reentry-remediation"
import { Storage } from "../../src/storage/storage"

async function clearReentryRemediations() {
  const keys = await Storage.list(["quality_model_reentry_remediation"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

function contextArtifact() {
  const policy = QualityPromotionReleasePolicy.defaults()
  return QualityReentryContext.ContextArtifact.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-model-reentry-context",
    contextID: "rollback-ctx-1",
    source: "candidate-v2",
    rollbackID: "rollback-1",
    promotionID: "promotion-1",
    createdAt: "2026-04-20T12:00:00.000Z",
    promotedAt: "2026-04-20T10:00:00.000Z",
    rolledBackAt: "2026-04-20T11:00:00.000Z",
    previousActiveSource: "candidate-v1",
    rollbackTargetSource: "candidate-v1",
    watch: {
      overallStatus: "fail",
      releasePolicySource: "project",
      releasePolicyDigest: QualityPromotionReleasePolicy.digest(policy),
      totalRecords: 8,
      sessionsCovered: 6,
      gates: [
        {
          name: "candidate-coverage",
          status: "fail",
          detail: "coverage missing",
        },
      ],
    },
    stability: {
      cooldownUntil: "2026-04-21T12:00:00.000Z",
      repeatFailureWindowHours: 168,
      repeatFailureThreshold: 2,
      recentRollbackCount: 1,
    },
  })
}

describe("QualityReentryRemediation", () => {
  test("creates, persists, and resolves the latest remediation for a reentry context", async () => {
    await clearReentryRemediations()
    try {
      const policy = QualityPromotionReleasePolicy.defaults()
      const context = contextArtifact()
      const remediation = QualityReentryRemediation.create({
        context,
        author: "staff@example.com",
        summary: "Added replay validation and narrowed the retry path.",
        evidence: [
          {
            kind: "validation",
            detail: "Replayed failing session with updated thresholds.",
          },
          {
            kind: "change",
            detail: "Restricted re-promotion to the validated candidate subset.",
          },
        ],
        currentReleasePolicyDigest: QualityPromotionReleasePolicy.digest(policy),
      })

      await QualityReentryRemediation.append(remediation)
      const latest = await QualityReentryRemediation.latestForContext({
        source: context.source,
        contextID: context.contextID,
      })
      expect(latest?.remediationID).toBe(remediation.remediationID)
      expect(latest?.evidence).toHaveLength(2)

      const listed = await QualityReentryRemediation.list({ source: context.source })
      expect(listed).toHaveLength(1)
      expect(listed[0]?.author).toBe("staff@example.com")

      const report = QualityReentryRemediation.renderReport(remediation)
      expect(report).toContain("## ax-code quality model reentry remediation")
      expect(report).toContain("- remediation id:")
      expect(report).toContain("[validation] Replayed failing session with updated thresholds.")
    } finally {
      await clearReentryRemediations()
    }
  })
})
