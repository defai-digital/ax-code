import { describe, expect, test } from "bun:test"
import { QualityPromotionSignedArchiveAttestationPolicy } from "../../src/quality/promotion-signed-archive-attestation-policy"
import { QualityPromotionSignedArchiveTrust } from "../../src/quality/promotion-signed-archive-trust"

function trustSummary(input?: {
  overallStatus?: "pass" | "warn" | "fail"
  scope?: "global" | "project" | null
  lifecycle?: "active" | "retired" | "revoked" | null
  lifecycleStatus?: "pass" | "warn" | "fail"
}) {
  const overallStatus = input?.overallStatus ?? "pass"
  const scope = input?.scope ?? "global"
  const lifecycle = input?.lifecycle ?? "active"
  const lifecycleStatus = input?.lifecycleStatus ?? "pass"
  return QualityPromotionSignedArchiveTrust.TrustSummary.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-promotion-signed-archive-trust-summary",
    source: "test-model-v1",
    signedArchiveID: "signed-archive-1",
    promotionID: "promotion-1",
    evaluatedAt: "2026-04-21T00:00:00.000Z",
    attestedBy: "release-integrity-bot",
    keyID: "archive-key-v1",
    overallStatus,
    structuralStatus: overallStatus === "fail" ? "fail" : "pass",
    signatureStatus: overallStatus === "fail" ? "fail" : "pass",
    registryStatus: overallStatus === "fail" ? "fail" : "pass",
    lifecycleStatus,
    trusted: overallStatus !== "fail",
    resolution: {
      matched: scope !== null,
      scope,
      projectID: scope === "project" ? "project-1" : null,
      trustID: scope ? "trust-1" : null,
      lifecycle,
      registeredAt: scope ? "2026-04-20T00:00:00.000Z" : null,
      effectiveFrom: scope ? "2026-04-20T00:00:00.000Z" : null,
      retiredAt: lifecycle === "retired" ? "2026-04-22T00:00:00.000Z" : null,
      revokedAt: lifecycle === "revoked" ? "2026-04-22T00:00:00.000Z" : null,
    },
    gates: [
      { name: "trust-evaluation", status: overallStatus, detail: "trust evaluation" },
      { name: "trust-lifecycle", status: lifecycleStatus, detail: "lifecycle" },
    ],
  })
}

describe("QualityPromotionSignedArchiveAttestationPolicy", () => {
  test("passes when a global active trust satisfies the default policy", () => {
    const summary = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: trustSummary(),
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults(),
      policySource: "default",
    })

    expect(summary.overallStatus).toBe("pass")
    expect(summary.acceptedByPolicy).toBe(true)
    expect(summary.minimumScopeStatus).toBe("pass")
  })

  test("fails when policy requires project scope but only global trust is available", () => {
    const summary = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: trustSummary({ scope: "global" }),
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
        minimumTrustScope: "project",
      }),
      policySource: "explicit",
      policyProjectID: "project-1",
    })

    expect(summary.overallStatus).toBe("fail")
    expect(summary.minimumScopeStatus).toBe("fail")
    expect(summary.acceptedByPolicy).toBe(false)
  })

  test("keeps retired historical trust at warn under default policy", () => {
    const summary = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: trustSummary({ overallStatus: "warn", lifecycle: "retired", lifecycleStatus: "warn" }),
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults(),
      policySource: "default",
    })

    expect(summary.overallStatus).toBe("warn")
    expect(summary.lifecyclePolicyStatus).toBe("warn")
    expect(summary.acceptedByPolicy).toBe(true)
  })

  test("fails revoked historical trust by default but can allow it explicitly", () => {
    const failed = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: trustSummary({ overallStatus: "warn", lifecycle: "revoked", lifecycleStatus: "warn" }),
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults(),
      policySource: "default",
    })
    expect(failed.overallStatus).toBe("fail")
    expect(failed.acceptedByPolicy).toBe(false)

    const allowed = QualityPromotionSignedArchiveAttestationPolicy.evaluate({
      trust: trustSummary({ overallStatus: "warn", lifecycle: "revoked", lifecycleStatus: "warn" }),
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults({
        allowRevokedHistorical: true,
      }),
      policySource: "explicit",
    })
    expect(allowed.overallStatus).toBe("warn")
    expect(allowed.acceptedByPolicy).toBe(true)
  })
})
