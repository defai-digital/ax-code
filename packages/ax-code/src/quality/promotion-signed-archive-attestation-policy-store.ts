import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionSignedArchiveAttestationPolicy } from "./promotion-signed-archive-attestation-policy"

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

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function requireProjectID(projectID: string | null | undefined) {
    const normalized = projectID?.trim()
    if (!normalized) throw new Error("projectID is required for project-scoped signed archive attestation policies")
    return normalized
  }

  function globalKey() {
    return ["quality_model_signed_archive_attestation_policy", "global"]
  }

  function projectKey(projectID: string) {
    return ["quality_model_signed_archive_attestation_policy", "project", encode(projectID)]
  }

  async function writeRecord(
    scope: Scope,
    policy: QualityPromotionSignedArchiveAttestationPolicy.Policy,
    projectID?: string | null,
  ) {
    const normalizedProjectID = scope === "project" ? requireProjectID(projectID) : null
    const next = PolicyRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-signed-archive-attestation-policy-record",
      scope,
      projectID: normalizedProjectID,
      updatedAt: new Date().toISOString(),
      policy,
    })
    const targetKey = scope === "project" ? projectKey(requireProjectID(normalizedProjectID)) : globalKey()
    await Storage.write(targetKey, next)
    return next
  }

  export async function getGlobal() {
    try {
      return PolicyRecord.parse(await Storage.read<unknown>(globalKey()))
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function getProject(projectID: string) {
    try {
      return PolicyRecord.parse(await Storage.read<unknown>(projectKey(requireProjectID(projectID))))
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function setGlobal(policy: QualityPromotionSignedArchiveAttestationPolicy.Policy) {
    return writeRecord("global", policy, null)
  }

  export async function setProject(projectID: string, policy: QualityPromotionSignedArchiveAttestationPolicy.Policy) {
    return writeRecord("project", policy, projectID)
  }

  export async function clearGlobal() {
    await Storage.remove(globalKey())
  }

  export async function clearProject(projectID: string) {
    await Storage.remove(projectKey(requireProjectID(projectID)))
  }

  export async function list() {
    const keys = await Storage.list(["quality_model_signed_archive_attestation_policy"])
    const records: PolicyRecord[] = []
    for (const parts of keys) {
      if (parts[1] === "global") {
        const record = await getGlobal()
        if (record) records.push(record)
        continue
      }
      if (parts[1] !== "project") continue
      const encodedProjectID = parts[2]
      if (!encodedProjectID) continue
      const record = await getProject(decode(encodedProjectID))
      if (record) records.push(record)
    }
    return records.sort((a, b) => {
      const byScope = a.scope.localeCompare(b.scope)
      if (byScope !== 0) return byScope
      const byProject = (a.projectID ?? "").localeCompare(b.projectID ?? "")
      if (byProject !== 0) return byProject
      return a.updatedAt.localeCompare(b.updatedAt)
    })
  }

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
