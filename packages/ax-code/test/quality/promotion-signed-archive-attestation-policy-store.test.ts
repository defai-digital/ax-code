import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../../src/quality/promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveAttestationPolicyStore } from "../../src/quality/promotion-signed-archive-attestation-policy-store"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"

async function clearPolicies() {
  const keys = await Storage.list(["quality_model_signed_archive_attestation_policy"])
  for (const parts of keys) {
    await Storage.remove(parts)
  }
}

describe("QualityPromotionSignedArchiveAttestationPolicyStore", () => {
  test("resolves explicit, project, global, then default in order", async () => {
    await clearPolicies()
    try {
      const globalPolicy = QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "global",
      })
      const projectPolicy = QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "project",
      })

      await QualityPromotionSignedArchiveAttestationPolicyStore.setGlobal(globalPolicy)
      await QualityPromotionSignedArchiveAttestationPolicyStore.setProject("project-1", projectPolicy)

      const projectResolved = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: "project-1",
      })
      expect(projectResolved.source).toBe("project")
      expect(projectResolved.policy.minimumTrustScope).toBe("project")

      const globalResolved = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: "project-2",
      })
      expect(globalResolved.source).toBe("global")
      expect(globalResolved.policy.minimumTrustScope).toBe("global")

      const explicitResolved = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
        projectID: "project-1",
        policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
          allowRevokedHistorical: true,
        }),
      })
      expect(explicitResolved.source).toBe("explicit")
      expect(explicitResolved.policy.allowRevokedHistorical).toBe(true)
    } finally {
      await clearPolicies()
    }
  })

  test("skips malformed encoded project policy keys while listing", async () => {
    const malformedPath = path.join(
      Global.Path.data,
      "storage",
      "quality_model_signed_archive_attestation_policy",
      "project",
      "%E0%A4%A.json",
    )

    await clearPolicies()
    try {
      await QualityPromotionSignedArchiveAttestationPolicyStore.setProject(
        "signed-attestation-project-malformed-key",
        QualityPromotionSignedArchiveAttestationPolicy.defaults(),
      )
      await fs.mkdir(path.dirname(malformedPath), { recursive: true })
      await fs.writeFile(malformedPath, JSON.stringify({ corrupt: true }), "utf8")

      const records = await QualityPromotionSignedArchiveAttestationPolicyStore.list()
      expect(records.map((record) => record.projectID)).toEqual(["signed-attestation-project-malformed-key"])
    } finally {
      await clearPolicies()
    }
  })

  test("falls back to defaults when no stored policy exists", async () => {
    await clearPolicies()
    const resolved = await QualityPromotionSignedArchiveAttestationPolicyStore.resolve({
      projectID: "project-1",
    })
    expect(resolved.source).toBe("default")
    expect(resolved.policy.minimumTrustScope).toBe("global")
    expect(resolved.policy.allowRetiredHistorical).toBe(true)
    expect(resolved.policy.allowRevokedHistorical).toBe(false)
  })
})
