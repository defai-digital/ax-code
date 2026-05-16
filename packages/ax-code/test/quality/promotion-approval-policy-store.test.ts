import { describe, expect, test } from "bun:test"
import { QualityPromotionApprovalPolicy } from "../../src/quality/promotion-approval-policy"
import { QualityPromotionApprovalPolicyStore } from "../../src/quality/promotion-approval-policy-store"
import { Storage } from "../../src/storage/storage"

async function clearPolicyStore() {
  const keys = await Storage.list(["quality_model_approval_policy"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionApprovalPolicyStore", () => {
  test("stores and resolves a global policy", async () => {
    await clearPolicyStore()
    try {
      const policy = QualityPromotionApprovalPolicy.defaults({
        allowWarn: {
          minimumApprovals: 2,
          minimumRole: "principal-engineer",
        },
      })
      const record = await QualityPromotionApprovalPolicyStore.setGlobal(policy)
      expect(record.scope).toBe("global")

      const stored = await QualityPromotionApprovalPolicyStore.getGlobal()
      expect(stored?.policy.rules.allow_warn.minimumApprovals).toBe(2)

      const resolved = await QualityPromotionApprovalPolicyStore.resolve()
      expect(resolved.source).toBe("global")
      expect(resolved.policy.rules.allow_warn.minimumRole).toBe("principal-engineer")
    } finally {
      await clearPolicyStore()
    }
  })

  test("prefers project policy over global policy", async () => {
    await clearPolicyStore()
    try {
      await QualityPromotionApprovalPolicyStore.setGlobal(
        QualityPromotionApprovalPolicy.defaults({
          force: { minimumApprovals: 2, minimumRole: "manager" },
        }),
      )
      await QualityPromotionApprovalPolicyStore.setProject(
        "project-policy-1",
        QualityPromotionApprovalPolicy.defaults({
          force: { minimumApprovals: 3, minimumRole: "director" },
        }),
      )

      const resolved = await QualityPromotionApprovalPolicyStore.resolve({ projectID: "project-policy-1" })
      expect(resolved.source).toBe("project")
      expect(resolved.policy.rules.force.minimumApprovals).toBe(3)
      expect(resolved.policy.rules.force.minimumRole).toBe("director")
    } finally {
      await clearPolicyStore()
    }
  })

  test("falls back from explicit to project to global to defaults", async () => {
    await clearPolicyStore()
    try {
      await QualityPromotionApprovalPolicyStore.setGlobal(
        QualityPromotionApprovalPolicy.defaults({
          force: { minimumApprovals: 2, minimumRole: "manager" },
        }),
      )
      await QualityPromotionApprovalPolicyStore.setProject(
        "project-policy-2",
        QualityPromotionApprovalPolicy.defaults({
          allowWarn: { minimumApprovals: 2, minimumRole: "staff-engineer" },
        }),
      )

      const explicitPolicy = QualityPromotionApprovalPolicy.merge(QualityPromotionApprovalPolicy.defaults(), {
        force: { minimumApprovals: 4, minimumRole: "vp" },
      })
      const explicit = await QualityPromotionApprovalPolicyStore.resolve({
        projectID: "project-policy-2",
        policy: explicitPolicy,
      })
      expect(explicit.source).toBe("explicit")
      expect(explicit.policy.rules.force.minimumApprovals).toBe(4)

      await QualityPromotionApprovalPolicyStore.clearProject("project-policy-2")
      const globalFallback = await QualityPromotionApprovalPolicyStore.resolve({ projectID: "project-policy-2" })
      expect(globalFallback.source).toBe("global")

      await QualityPromotionApprovalPolicyStore.clearGlobal()
      const defaultFallback = await QualityPromotionApprovalPolicyStore.resolve({ projectID: "project-policy-2" })
      expect(defaultFallback.source).toBe("default")
      expect(defaultFallback.policy.rules.force.minimumApprovals).toBe(2)
    } finally {
      await clearPolicyStore()
    }
  })
})
