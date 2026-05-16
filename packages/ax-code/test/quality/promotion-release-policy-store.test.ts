import { describe, expect, test } from "bun:test"
import { QualityPromotionApprovalPolicy } from "../../src/quality/promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "../../src/quality/promotion-approval-policy-store"
import { QualityPromotionReleasePolicy } from "../../src/quality/promotion-release-policy"
import { QualityPromotionReleasePolicyStore } from "../../src/quality/promotion-release-policy-store"
import { Storage } from "../../src/storage/storage"

async function clearPolicyStores() {
  for (const prefix of [["quality_model_release_policy"], ["quality_model_approval_policy"]] as const) {
    const keys = await Storage.list([...prefix])
    for (const parts of keys) {
      await Storage.remove(parts)
    }
  }
}

describe("QualityPromotionReleasePolicyStore", () => {
  test("stores and resolves a global release policy", async () => {
    await clearPolicyStores()
    try {
      const policy = QualityPromotionReleasePolicy.defaults({
        stability: { cooldownHours: 48 },
        watch: { minRecords: 30, abstentionWarnRate: 0.2 },
      })
      const record = await QualityPromotionReleasePolicyStore.setGlobal(policy)
      expect(record.scope).toBe("global")

      const resolved = await QualityPromotionReleasePolicyStore.resolve()
      expect(resolved.source).toBe("global")
      expect(resolved.policy.stability.cooldownHours).toBe(48)
      expect(resolved.policy.watch.minRecords).toBe(30)
      expect(resolved.compatibilityApprovalSource).toBeNull()
    } finally {
      await clearPolicyStores()
    }
  })

  test("prefers project release policy over global release policy", async () => {
    await clearPolicyStores()
    try {
      await QualityPromotionReleasePolicyStore.setGlobal(
        QualityPromotionReleasePolicy.defaults({
          watch: { minRecords: 10 },
        }),
      )
      await QualityPromotionReleasePolicyStore.setProject(
        "release-project-1",
        QualityPromotionReleasePolicy.defaults({
          watch: { minRecords: 40 },
        }),
      )

      const resolved = await QualityPromotionReleasePolicyStore.resolve({ projectID: "release-project-1" })
      expect(resolved.source).toBe("project")
      expect(resolved.policy.watch.minRecords).toBe(40)
    } finally {
      await clearPolicyStores()
    }
  })

  test("falls back to the legacy approval policy store when no release policy is stored", async () => {
    await clearPolicyStores()
    try {
      await QualityPromotionApprovalPolicyStore.setProject(
        "release-project-compat",
        QualityPromotionApprovalPolicy.defaults({
          force: { minimumApprovals: 3, minimumRole: "director" },
        }),
      )

      const resolved = await QualityPromotionReleasePolicyStore.resolve({ projectID: "release-project-compat" })
      expect(resolved.source).toBe("project")
      expect(resolved.compatibilityApprovalSource).toBe("project")
      expect(resolved.policy.approval.rules.force.minimumApprovals).toBe(3)
      expect(resolved.policy.approval.rules.force.minimumRole).toBe("director")
      expect(resolved.policy.watch.minRecords).toBe(QualityPromotionReleasePolicy.DEFAULT_WATCH_MIN_RECORDS)
    } finally {
      await clearPolicyStores()
    }
  })
})
