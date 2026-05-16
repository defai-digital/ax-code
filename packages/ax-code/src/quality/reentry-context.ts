import z from "zod"
import { Storage } from "../storage/storage"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"

export namespace QualityReentryContext {
  export const ContextArtifact = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-reentry-context"),
    contextID: z.string(),
    source: z.string(),
    rollbackID: z.string(),
    promotionID: z.string(),
    createdAt: z.string(),
    promotedAt: z.string(),
    rolledBackAt: z.string(),
    previousActiveSource: z.string().nullable(),
    rollbackTargetSource: z.string().nullable(),
    watch: z.object({
      overallStatus: z.enum(["pass", "warn", "fail"]),
      releasePolicySource: z.enum(["explicit", "project", "global", "default"]).nullable(),
      releasePolicyDigest: z.string().nullable(),
      totalRecords: z.number().int().nonnegative(),
      sessionsCovered: z.number().int().nonnegative(),
      gates: z.array(
        z.object({
          name: z.string(),
          status: z.enum(["pass", "warn", "fail"]),
          detail: z.string(),
        }),
      ),
    }),
    stability: z.object({
      cooldownUntil: z.string().nullable(),
      repeatFailureWindowHours: z.number().positive(),
      repeatFailureThreshold: z.number().int().positive(),
      recentRollbackCount: z.number().int().nonnegative(),
    }),
  })
  export type ContextArtifact = z.output<typeof ContextArtifact>

  export const ContextRecord = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-model-reentry-context-record"),
    context: ContextArtifact,
  })
  export type ContextRecord = z.output<typeof ContextRecord>

  type RollbackLike = {
    rollbackID: string
    source: string
    rolledBackAt: string
    promotionID: string
    promotedAt: string
    previousActiveSource: string | null
    rollbackTargetSource: string | null
    stability?: {
      cooldownUntil: string | null
      repeatFailureWindowHours: number
      repeatFailureThreshold: number
      recentRollbackCount: number
    }
  }

  type WatchLike = {
    overallStatus: "pass" | "warn" | "fail"
    releasePolicy?: {
      policy: QualityPromotionReleasePolicy.Policy
      provenance: QualityPromotionReleasePolicy.PolicyProvenance
    }
    window: {
      totalRecords: number
      sessionsCovered: number
    }
    gates: Array<{
      name: string
      status: "pass" | "warn" | "fail"
      detail: string
    }>
  }

  function encode(input: string) {
    return encodeURIComponent(input)
  }

  function decode(input: string) {
    return decodeURIComponent(input)
  }

  function key(source: string, contextID: string) {
    return ["quality_model_reentry_context", encode(source), contextID]
  }

  function sort(contexts: ContextArtifact[]) {
    return [...contexts].sort((a, b) => {
      const byRolledBackAt = a.rolledBackAt.localeCompare(b.rolledBackAt)
      if (byRolledBackAt !== 0) return byRolledBackAt
      return a.contextID.localeCompare(b.contextID)
    })
  }

  export function create(input: { rollback: RollbackLike; watch: WatchLike }): ContextArtifact {
    const contextID = input.rollback.rollbackID
    return ContextArtifact.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-context",
      contextID,
      source: input.rollback.source,
      rollbackID: input.rollback.rollbackID,
      promotionID: input.rollback.promotionID,
      createdAt: new Date().toISOString(),
      promotedAt: input.rollback.promotedAt,
      rolledBackAt: input.rollback.rolledBackAt,
      previousActiveSource: input.rollback.previousActiveSource,
      rollbackTargetSource: input.rollback.rollbackTargetSource,
      watch: {
        overallStatus: input.watch.overallStatus,
        releasePolicySource: input.watch.releasePolicy?.provenance.policySource ?? null,
        releasePolicyDigest: input.watch.releasePolicy?.provenance.digest ?? null,
        totalRecords: input.watch.window.totalRecords,
        sessionsCovered: input.watch.window.sessionsCovered,
        gates: input.watch.gates,
      },
      stability: {
        cooldownUntil: input.rollback.stability?.cooldownUntil ?? null,
        repeatFailureWindowHours: input.rollback.stability?.repeatFailureWindowHours ?? 24 * 7,
        repeatFailureThreshold: input.rollback.stability?.repeatFailureThreshold ?? 2,
        recentRollbackCount: input.rollback.stability?.recentRollbackCount ?? 0,
      },
    })
  }

  export async function get(input: { source: string; contextID: string }) {
    const record = await Storage.read<unknown>(key(input.source, input.contextID))
    return ContextRecord.parse(record)
  }

  export async function append(context: ContextArtifact) {
    const next = ContextRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-reentry-context-record",
      context,
    })
    try {
      const existing = await get({ source: context.source, contextID: context.contextID })
      const prev = JSON.stringify(existing)
      const curr = JSON.stringify(next)
      if (prev === curr) return existing
      throw new Error(
        `Reentry context ${context.contextID} already exists for source ${context.source} with different content`,
      )
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(key(context.source, context.contextID), next)
      return next
    }
  }

  export async function list(source?: string) {
    const prefixes = source ? [["quality_model_reentry_context", encode(source)]] : [["quality_model_reentry_context"]]
    const contexts: ContextArtifact[] = []

    for (const prefix of prefixes) {
      const keys = await Storage.list(prefix)
      for (const parts of keys) {
        const encodedSource = parts[parts.length - 2]
        const contextID = parts[parts.length - 1]
        if (!encodedSource || !contextID) continue
        const record = await get({ source: decode(encodedSource), contextID })
        contexts.push(record.context)
      }
    }

    return sort(contexts)
  }

  export async function latest(source: string) {
    const contexts = await list(source)
    return contexts[contexts.length - 1]
  }

  export function renderReport(context: ContextArtifact) {
    const lines: string[] = []
    lines.push("## ax-code quality model reentry context")
    lines.push("")
    lines.push(`- source: ${context.source}`)
    lines.push(`- context id: ${context.contextID}`)
    lines.push(`- rollback id: ${context.rollbackID}`)
    lines.push(`- promotion id: ${context.promotionID}`)
    lines.push(`- rolled back at: ${context.rolledBackAt}`)
    lines.push(`- watch status: ${context.watch.overallStatus}`)
    lines.push(`- watch release policy source: ${context.watch.releasePolicySource ?? "n/a"}`)
    lines.push(`- watch release policy digest: ${context.watch.releasePolicyDigest ?? "n/a"}`)
    lines.push(`- rollback target source: ${context.rollbackTargetSource ?? "none"}`)
    lines.push(`- cooldown until: ${context.stability.cooldownUntil ?? "n/a"}`)
    lines.push(`- recent rollback count: ${context.stability.recentRollbackCount}`)
    lines.push("")
    lines.push("Watch Gates:")
    for (const gate of context.watch.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
