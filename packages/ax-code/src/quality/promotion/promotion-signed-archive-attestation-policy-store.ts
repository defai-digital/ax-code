import z from "zod"
import { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"
import { QualityScopedPolicyStore } from "./policy-store"

export namespace QualityPromotionSignedArchiveAttestationPolicyStore {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.output<typeof Scope>

  export const PolicyRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-policy-record"),
    scope: Scope,
    projectID: z.string().nullable(),
    updatedAt: z.string(),
    policy: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.Policy),
  })
  export type PolicyRecord = z.output<typeof PolicyRecord>

  export const Resolution = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-signed-archive-attestation-policy-resolution"),
    source: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.PolicySource),
    projectID: z.string().nullable(),
    resolvedAt: z.string(),
    policy: z.lazy(() => QualityPromotionSignedArchiveAttestationPolicy.Policy),
    record: PolicyRecord.nullable(),
  })
  export type Resolution = z.output<typeof Resolution>

  const store = QualityScopedPolicyStore.create<PolicyRecord, QualityPromotionSignedArchiveAttestationPolicy.Policy>({
    keyPrefix: "quality_model_signed_archive_attestation_policy",
    scopeNoun: "signed archive attestation policies",
    parseRecord: (raw) => PolicyRecord.parse(raw),
    buildRecord: (scope, projectID, policy) =>
      PolicyRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-signed-archive-attestation-policy-record",
        scope,
        projectID,
        updatedAt: new Date().toISOString(),
        policy,
      }),
  })

  export const getGlobal = store.getGlobal
  export const getProject = store.getProject
  export const setGlobal = store.setGlobal
  export const setProject = store.setProject
  export const clearGlobal = store.clearGlobal
  export const clearProject = store.clearProject
  export const list = store.list

  export async function resolve(input?: {
    projectID?: string | null
    policy?: QualityPromotionSignedArchiveAttestationPolicy.Policy
  }): Promise<Resolution> {
    const resolvedAt = new Date().toISOString()
    const projectID = input?.projectID?.trim() || null
    if (input?.policy) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-signed-archive-attestation-policy-resolution",
        source: "explicit",
        projectID,
        resolvedAt,
        policy: input.policy,
        record: null,
      })
    }
    if (projectID) {
      const projectRecord = await getProject(projectID)
      if (projectRecord) {
        return Resolution.parse({
          schemaVersion: 1,
          kind: "ax-code-quality-promotion-signed-archive-attestation-policy-resolution",
          source: "project",
          projectID,
          resolvedAt,
          policy: projectRecord.policy,
          record: projectRecord,
        })
      }
    }
    const globalRecord = await getGlobal()
    if (globalRecord) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-signed-archive-attestation-policy-resolution",
        source: "global",
        projectID,
        resolvedAt,
        policy: globalRecord.policy,
        record: globalRecord,
      })
    }
    return Resolution.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-policy-resolution",
      source: "default",
      projectID,
      resolvedAt,
      policy: QualityPromotionSignedArchiveAttestationPolicy.defaults(),
      record: null,
    })
  }

  export function renderStoredPolicy(record: PolicyRecord) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive attestation policy record")
    lines.push("")
    lines.push(`- scope: ${record.scope}`)
    lines.push(`- project id: ${record.projectID ?? "n/a"}`)
    lines.push(`- updated at: ${record.updatedAt}`)
    lines.push("")
    lines.push(QualityPromotionSignedArchiveAttestationPolicy.renderPolicy(record.policy))
    lines.push("")
    return lines.join("\n")
  }

  export function renderResolutionReport(resolution: Resolution) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion signed archive attestation policy resolution")
    lines.push("")
    lines.push(`- source: ${resolution.source}`)
    lines.push(`- project id: ${resolution.projectID ?? "n/a"}`)
    lines.push(`- resolved at: ${resolution.resolvedAt}`)
    lines.push(`- persisted record: ${resolution.record ? "yes" : "no"}`)
    lines.push("")
    lines.push(QualityPromotionSignedArchiveAttestationPolicy.renderPolicy(resolution.policy))
    lines.push("")
    return lines.join("\n")
  }
}
