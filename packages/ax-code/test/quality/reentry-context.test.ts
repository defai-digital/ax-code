import { describe, expect, test } from "bun:test"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityReentryContext } from "../../src/quality/reentry-context"
import { Storage } from "../../src/storage/storage"

async function clearReentryContexts() {
  const keys = await Storage.list(["quality_model_reentry_context"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityReentryContext", () => {
  test("creates, persists, and resolves the latest reentry context", async () => {
    await clearReentryContexts()
    try {
      const policy = QualityPromotionReleasePolicy.defaults()
      const context = QualityReentryContext.create({
        rollback: {
          rollbackID: "rollback-1",
          source: "candidate-v2",
          rolledBackAt: "2026-04-20T12:00:00.000Z",
          promotionID: "promotion-1",
          promotedAt: "2026-04-20T10:00:00.000Z",
          previousActiveSource: "candidate-v1",
          rollbackTargetSource: "candidate-v1",
          stability: {
            cooldownUntil: "2026-04-21T12:00:00.000Z",
            repeatFailureWindowHours: 168,
            repeatFailureThreshold: 2,
            recentRollbackCount: 1,
          },
        },
        watch: {
          overallStatus: "fail",
          releasePolicy: {
            policy,
            provenance: {
              policySource: "project",
              policyProjectID: "reentry-project-1",
              compatibilityApprovalSource: null,
              resolvedAt: "2026-04-20T12:00:00.000Z",
              persistedScope: "project",
              persistedUpdatedAt: "2026-04-20T11:00:00.000Z",
              digest: QualityPromotionReleasePolicy.digest(policy),
            },
          },
          window: {
            totalRecords: 8,
            sessionsCovered: 6,
          },
          gates: [
            {
              name: "candidate-coverage",
              status: "fail",
              detail: "coverage missing",
            },
          ],
        },
      })

      await QualityReentryContext.append(context)
      const latest = await QualityReentryContext.latest("candidate-v2")
      expect(latest?.rollbackID).toBe("rollback-1")
      expect(latest?.watch.releasePolicyDigest).toBe(QualityPromotionReleasePolicy.digest(policy))

      const report = QualityReentryContext.renderReport(context)
      expect(report).toContain("## ax-code quality model reentry context")
      expect(report).toContain("- rollback id: rollback-1")
    } finally {
      await clearReentryContexts()
    }
  })
})
