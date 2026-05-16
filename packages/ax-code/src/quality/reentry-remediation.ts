import z from "zod"
import { Storage } from "../storage/storage"
import { QualityReentryContext } from "./reentry-context"

export namespace QualityReentryRemediation {
  export const EvidenceKind = z.enum(["change", "validation", "finding", "note"])
  export type EvidenceKind = z.output<typeof EvidenceKind>

  export const EvidenceItem = z.object({
    kind: EvidenceKind,
    detail: z.string().min(1),
  })
  export type EvidenceItem = z.output<typeof EvidenceItem>

  export const RemediationArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-reentry-remediation"),
    remediationID: z.string(),
    source: z.string(),
    contextID: z.string(),
    rollbackID: z.string(),
    rolledBackAt: z.string(),
    createdAt: z.string(),
    author: z.string(),
    summary: z.string(),
    evidence: EvidenceItem.array().min(1),
    currentReleasePolicyDigest: z.string().nullable(),
  })
  export type RemediationArtifact = z.output<typeof RemediationArtifact>

  export const RemediationRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-reentry-remediation-record"),
    remediation: RemediationArtifact,
  })
  export type RemediationRecord = z.output<typeof RemediationRecord>

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, contextID: string, remediationID: string) {
    return ["quality_model_reentry_remediation", encode(source), contextID, remediationID]
  }

  function sort(remediations: RemediationArtifact[]) {
    return [...remediations].sort((a, b) => {
      const byCreatedAt = a.createdAt.localeCompare(b.createdAt)
      if (byCreatedAt !== 0) return byCreatedAt
      return a.remediationID.localeCompare(b.remediationID)
    })
  }

  export function create(input: {
    context: QualityReentryContext.ContextArtifact
    author: string
    summary: string
    evidence: EvidenceItem[]
    currentReleasePolicyDigest?: string | null
  }): RemediationArtifact {
    const createdAt = new Date().toISOString()
    const remediationID = `${Date.now()}-${encode(input.context.source)}-${encode(input.author)}`
    return RemediationArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-remediation",
      remediationID,
      source: input.context.source,
      contextID: input.context.contextID,
      rollbackID: input.context.rollbackID,
      rolledBackAt: input.context.rolledBackAt,
      createdAt,
      author: input.author,
      summary: input.summary,
      evidence: input.evidence,
      currentReleasePolicyDigest: input.currentReleasePolicyDigest ?? null,
    })
  }

  export async function get(input: { source: string; contextID: string; remediationID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.contextID, input.remediationID))
    return RemediationRecord.parse(record)
  }

  export async function append(remediation: RemediationArtifact) {
    const next = RemediationRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-remediation-record",
      remediation,
    })
    try {
      const existing = await get({
        source: remediation.source,
        contextID: remediation.contextID,
        remediationID: remediation.remediationID,
      })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Reentry remediation ${remediation.remediationID} already exists for source ${remediation.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(remediation.source, remediation.contextID, remediation.remediationID), next)
      return next
    }
  }

  export async function list(input?: { source?: string; contextID?: string }) {
    if (input?.contextID && !input.source) {
      throw new Error("source is required when filtering reentry remediations by contextID")
    }

    const prefix = input?.source
      ? input.contextID
        ? ["quality_model_reentry_remediation", encode(input.source), input.contextID]
        : ["quality_model_reentry_remediation", encode(input.source)]
      : ["quality_model_reentry_remediation"]

    const remediations: RemediationArtifact[] = []
    const keys = await Storage.list(prefix)
    for (const parts of keys) {
      const encodedSource = parts[parts.length - 3]
      const contextID = parts[parts.length - 2]
      const remediationID = parts[parts.length - 1]
      if (!encodedSource || !contextID || !remediationID) continue
      const record = await get({ source: decode(encodedSource), contextID, remediationID })
      remediations.push(record.remediation)
    }

    return sort(remediations)
  }

  export async function latestForContext(input: { source: string; contextID: string }) {
    const remediations = await list(input)
    return remediations[remediations.length - 1]
  }

  export async function latestForSource(source: string) {
    const remediations = await list({ source })
    return remediations[remediations.length - 1]
  }

  export function renderReport(remediation: RemediationArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality model reentry remediation")
    lines.push("")
    lines.push(`- source: ${remediation.source}`)
    lines.push(`- remediation id: ${remediation.remediationID}`)
    lines.push(`- context id: ${remediation.contextID}`)
    lines.push(`- rollback id: ${remediation.rollbackID}`)
    lines.push(`- rolled back at: ${remediation.rolledBackAt}`)
    lines.push(`- created at: ${remediation.createdAt}`)
    lines.push(`- author: ${remediation.author}`)
    lines.push(`- summary: ${remediation.summary}`)
    lines.push(`- release policy digest: ${remediation.currentReleasePolicyDigest ?? "n/a"}`)
    lines.push("")
    lines.push("Evidence:")
    for (const item of remediation.evidence) {
      lines.push(`- [${item.kind}] ${item.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
