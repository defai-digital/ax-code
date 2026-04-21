import { createHash } from "crypto"
import z from "zod"
import { QualityPromotionSignedArchiveTrust } from "./promotion-signed-archive-trust"

export namespace QualityPromotionSignedArchiveAttestationPolicy {
  export const MinimumTrustScope = z.enum(["global", "project"])
  export type MinimumTrustScope = z.output<typeof MinimumTrustScope>

  export const PolicySource = z.enum(["explicit", "project", "global", "default"])
  export type PolicySource = z.output<typeof PolicySource>

  export const Policy = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-policy"),
    minimumTrustScope: MinimumTrustScope,
    allowRetiredHistorical: z.boolean(),
    allowRevokedHistorical: z.boolean(),
  })
  export type Policy = z.output<typeof Policy>

  export type PolicyOverrides = Partial<Pick<Policy, "minimumTrustScope" | "allowRetiredHistorical" | "allowRevokedHistorical">>

  export const Summary = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-summary"),
    source: z.string(),
    signedArchiveID: z.string(),
    promotionID: z.string(),
    evaluatedAt: z.string(),
    policySource: PolicySource,
    policyProjectID: z.string().nullable(),
    policyDigest: z.string(),
    trustStatus: z.enum(["pass", "warn", "fail"]),
    minimumScopeStatus: z.enum(["pass", "fail"]),
    lifecyclePolicyStatus: z.enum(["pass", "warn", "fail"]),
    overallStatus: z.enum(["pass", "warn", "fail"]),
    acceptedByPolicy: z.boolean(),
    effectiveTrustScope: z.lazy(() => QualityPromotionSignedArchiveTrust.Scope).nullable(),
    effectiveTrustLifecycle: z.lazy(() => QualityPromotionSignedArchiveTrust.Lifecycle).nullable(),
    gates: z.array(z.lazy(() => QualityPromotionSignedArchiveTrust.Gate)),
  })
  export type Summary = z.output<typeof Summary>

  function severity(status: QualityPromotionSignedArchiveTrust.Gate["status"]) {
    return status === "fail" ? 2 : status === "warn" ? 1 : 0
  }

  export function merge(base: Policy, overrides?: PolicyOverrides): Policy {
    return Policy.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-policy",
      minimumTrustScope: overrides?.minimumTrustScope ?? base.minimumTrustScope,
      allowRetiredHistorical: overrides?.allowRetiredHistorical ?? base.allowRetiredHistorical,
      allowRevokedHistorical: overrides?.allowRevokedHistorical ?? base.allowRevokedHistorical,
    })
  }

  export function defaults(overrides?: PolicyOverrides): Policy {
    return merge({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-policy",
      minimumTrustScope: "global",
      allowRetiredHistorical: true,
      allowRevokedHistorical: false,
    }, overrides)
  }

  export function digest(policy: Policy) {
    return createHash("sha256").update(JSON.stringify(policy)).digest("hex")
  }

  export function evaluate(input: {
    trust: QualityPromotionSignedArchiveTrust.TrustSummary
    policy: Policy
    policySource: PolicySource
    policyProjectID?: string | null
  }) {
    const gates: QualityPromotionSignedArchiveTrust.Gate[] = [
      {
        name: "trust-evaluation",
        status: input.trust.overallStatus,
        detail: `trust evaluation status=${input.trust.overallStatus}`,
      },
    ]

    const minimumScopePass = input.policy.minimumTrustScope === "global"
      ? input.trust.resolution.matched
      : input.trust.resolution.scope === "project"
    gates.push({
      name: "minimum-trust-scope",
      status: minimumScopePass ? "pass" : "fail",
      detail: minimumScopePass
        ? `effective trust scope ${input.trust.resolution.scope} satisfies minimum scope ${input.policy.minimumTrustScope}`
        : `effective trust scope ${input.trust.resolution.scope ?? "none"} does not satisfy minimum scope ${input.policy.minimumTrustScope}`,
    })

    let lifecyclePolicyStatus: QualityPromotionSignedArchiveTrust.Gate["status"] = "pass"
    let lifecyclePolicyDetail = `trust lifecycle ${input.trust.resolution.lifecycle ?? "none"} accepted by policy`
    const lifecycle = input.trust.resolution.lifecycle

    if (lifecycle === "retired" && input.trust.lifecycleStatus === "warn") {
      lifecyclePolicyStatus = input.policy.allowRetiredHistorical ? "warn" : "fail"
      lifecyclePolicyDetail = input.policy.allowRetiredHistorical
        ? "retired historical trust is allowed by attestation policy"
        : "retired historical trust is not allowed by attestation policy"
    } else if (lifecycle === "revoked" && input.trust.lifecycleStatus === "warn") {
      lifecyclePolicyStatus = input.policy.allowRevokedHistorical ? "warn" : "fail"
      lifecyclePolicyDetail = input.policy.allowRevokedHistorical
        ? "revoked historical trust is allowed by attestation policy"
        : "revoked historical trust is not allowed by attestation policy"
    } else if (input.trust.lifecycleStatus === "fail") {
      lifecyclePolicyStatus = "fail"
      lifecyclePolicyDetail = input.trust.gates.find((gate) => gate.name === "trust-lifecycle")?.detail
        ?? "trust lifecycle is not acceptable"
    }

    gates.push({
      name: "lifecycle-policy",
      status: lifecyclePolicyStatus,
      detail: lifecyclePolicyDetail,
    })

    const highest = gates.reduce((max, gate) => Math.max(max, severity(gate.status)), 0)
    const overallStatus = highest === 2 ? "fail" : highest === 1 ? "warn" : "pass"

    return Summary.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-summary",
      source: input.trust.source,
      signedArchiveID: input.trust.signedArchiveID,
      promotionID: input.trust.promotionID,
      evaluatedAt: new Date().toISOString(),
      policySource: input.policySource,
      policyProjectID: input.policyProjectID?.trim() || null,
      policyDigest: digest(input.policy),
      trustStatus: input.trust.overallStatus,
      minimumScopeStatus: minimumScopePass ? "pass" : "fail",
      lifecyclePolicyStatus,
      overallStatus,
      acceptedByPolicy: overallStatus !== "fail",
      effectiveTrustScope: input.trust.resolution.scope,
      effectiveTrustLifecycle: input.trust.resolution.lifecycle,
      gates,
    })
  }

  export function renderReport(summary: Summary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive attestation")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- signed archive id: ${summary.signedArchiveID}`)
    lines.push(`- promotion id: ${summary.promotionID}`)
    lines.push(`- evaluated at: ${summary.evaluatedAt}`)
    lines.push(`- policy source: ${summary.policySource}`)
    lines.push(`- policy project id: ${summary.policyProjectID ?? "n/a"}`)
    lines.push(`- policy digest: ${summary.policyDigest}`)
    lines.push(`- trust status: ${summary.trustStatus}`)
    lines.push(`- minimum scope status: ${summary.minimumScopeStatus}`)
    lines.push(`- lifecycle policy status: ${summary.lifecyclePolicyStatus}`)
    lines.push(`- effective trust scope: ${summary.effectiveTrustScope ?? "none"}`)
    lines.push(`- effective trust lifecycle: ${summary.effectiveTrustLifecycle ?? "none"}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- accepted by policy: ${summary.acceptedByPolicy}`)
    lines.push("")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function renderPolicy(policy: Policy) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive attestation policy")
    lines.push("")
    lines.push(`- minimum trust scope: ${policy.minimumTrustScope}`)
    lines.push(`- allow retired historical: ${policy.allowRetiredHistorical}`)
    lines.push(`- allow revoked historical: ${policy.allowRevokedHistorical}`)
    lines.push("")
    return lines.join("\n")
  }
}
