import z from "zod"
import { QualityPromotionApprovalPolicyStore } from "./promotion-approval-policy-store"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"
import { QualityScopedPolicyStore } from "./policy-store"

export namespace QualityPromotionReleasePolicyStore {
  export const Scope = z.enum(["global", "project"])
  export type Scope = z.output<typeof Scope>

  export const PolicyRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-policy-record"),
    scope: Scope,
    projectID: z.string().nullable(),
    updatedAt: z.string(),
    policy: z.lazy(() => QualityPromotionReleasePolicy.Policy),
  })
  export type PolicyRecord = z.output<typeof PolicyRecord>

  export const Resolution = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-release-policy-resolution"),
    source: z.enum(["explicit", "project", "global", "default"]),
    projectID: z.string().nullable(),
    resolvedAt: z.string(),
    policy: z.lazy(() => QualityPromotionReleasePolicy.Policy),
    record: PolicyRecord.nullable(),
    compatibilityApprovalSource: z.enum(["project", "global", "default"]).nullable(),
  })
  export type Resolution = z.output<typeof Resolution>

  const store = QualityScopedPolicyStore.create<PolicyRecord, QualityPromotionReleasePolicy.Policy>({
    keyPrefix: "quality_model_release_policy",
    scopeNoun: "release policies",
    parseRecord: (raw) => PolicyRecord.parse(raw),
    buildRecord: (scope, projectID, policy) =>
      PolicyRecord.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-release-policy-record",
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

  export function provenance(resolution: Resolution): QualityPromotionReleasePolicy.PolicyProvenance {
    return QualityPromotionReleasePolicy.PolicyProvenance.parse({
      policySource: resolution.source,
      policyProjectID: resolution.projectID,
      compatibilityApprovalSource: resolution.compatibilityApprovalSource,
      resolvedAt: resolution.resolvedAt,
      persistedScope: resolution.record?.scope ?? null,
      persistedUpdatedAt: resolution.record?.updatedAt ?? null,
      digest: QualityPromotionReleasePolicy.digest(resolution.policy),
    })
  }

  export async function resolve(input?: {
    projectID?: string | null
    policy?: QualityPromotionReleasePolicy.Policy
  }): Promise<Resolution> {
    const resolvedAt = new Date().toISOString()
    const projectID = input?.projectID?.trim() || null
    if (input?.policy) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-release-policy-resolution",
        source: "explicit",
        projectID,
        resolvedAt,
        policy: input.policy,
        record: null,
        compatibilityApprovalSource: null,
      })
    }
    if (projectID) {
      const projectRecord = await getProject(projectID)
      if (projectRecord) {
        return Resolution.parse({
          schemaVersion: 1,
          kind: "ax-code-quality-promotion-release-policy-resolution",
          source: "project",
          projectID,
          resolvedAt,
          policy: projectRecord.policy,
          record: projectRecord,
          compatibilityApprovalSource: null,
        })
      }
    }
    const globalRecord = await getGlobal()
    if (globalRecord) {
      return Resolution.parse({
        schemaVersion: 1,
        kind: "ax-code-quality-promotion-release-policy-resolution",
        source: "global",
        projectID,
        resolvedAt,
        policy: globalRecord.policy,
        record: globalRecord,
        compatibilityApprovalSource: null,
      })
    }

    const compatibilityApproval = await QualityPromotionApprovalPolicyStore.resolve({ projectID })
    const compatibilitySource = compatibilityApproval.source === "explicit" ? "default" : compatibilityApproval.source
    const compatibilityPolicy = QualityPromotionReleasePolicy.defaults({
      approval: compatibilityApproval.policy.rules,
    })
    return Resolution.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-release-policy-resolution",
      source: compatibilitySource,
      projectID,
      resolvedAt,
      policy: compatibilityPolicy,
      record: null,
      compatibilityApprovalSource: compatibilitySource === "default" ? null : compatibilitySource,
    })
  }

  export function renderStoredPolicy(record: PolicyRecord) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release policy record")
    lines.push("")
    lines.push(`- scope: ${record.scope}`)
    lines.push(`- project id: ${record.projectID ?? "n/a"}`)
    lines.push(`- updated at: ${record.updatedAt}`)
    lines.push("")
    lines.push(QualityPromotionReleasePolicy.renderReport(record.policy))
    lines.push("")
    return lines.join("\n")
  }

  export function renderResolutionReport(resolution: Resolution) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion release policy resolution")
    lines.push("")
    lines.push(`- source: ${resolution.source}`)
    lines.push(`- project id: ${resolution.projectID ?? "n/a"}`)
    lines.push(`- resolved at: ${resolution.resolvedAt}`)
    lines.push(`- persisted record: ${resolution.record ? "yes" : "no"}`)
    lines.push(`- compatibility approval source: ${resolution.compatibilityApprovalSource ?? "none"}`)
    lines.push("")
    lines.push(QualityPromotionReleasePolicy.renderReport(resolution.policy))
    lines.push("")
    return lines.join("\n")
  }
}
