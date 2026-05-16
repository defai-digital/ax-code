import z from "zod"
import { ProbabilisticRollout } from "./probabilistic-rollout"
import { QualityPromotionReleasePolicy } from "./promotion-release-policy"
import { QualityPromotionReleasePolicyStore } from "./promotion-release-policy-store"

export namespace QualityPromotionWatch {
  export const WatchGate = z.object({
    name: z.string(),
    status: z.enum(["pass", "warn", "fail"]),
    detail: z.string(),
  })
  export type WatchGate = z.output<typeof WatchGate>

  export const WatchSummary = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-promotion-watch-summary"),
    source: z.string(),
    baselineSource: z.string(),
    promotedAt: z.string(),
    releasePolicy: z
      .object({
        policy: z.lazy(() => QualityPromotionReleasePolicy.Policy),
        provenance: z.lazy(() => QualityPromotionReleasePolicy.PolicyProvenance),
      })
      .optional(),
    window: z.object({
      since: z.string(),
      through: z.string().nullable(),
      minRecords: z.number().int().positive(),
      maxRecords: z.number().int().positive().nullable(),
      totalRecords: z.number().int().nonnegative(),
      sessionsCovered: z.number().int().nonnegative(),
    }),
    shadow: z.lazy(() => ProbabilisticRollout.ShadowSummary),
    predictionChangedRate: z.number().nullable(),
    abstentionChangedRate: z.number().nullable(),
    missingCandidateRate: z.number().nullable(),
    overallStatus: z.enum(["pass", "warn", "fail"]),
    gates: WatchGate.array(),
  })
  export type WatchSummary = z.output<typeof WatchSummary>

  function ratio(numerator: number, denominator: number) {
    if (denominator === 0) return null
    return Number((numerator / denominator).toFixed(4))
  }

  function recordTimestamp(record: ProbabilisticRollout.ShadowRecord) {
    return record.capturedAt ?? record.createdAt
  }

  function sortRecords(records: ProbabilisticRollout.ShadowRecord[]) {
    return [...records].sort((a, b) => {
      const byCapture = recordTimestamp(a).localeCompare(recordTimestamp(b))
      if (byCapture !== 0) return byCapture
      return a.artifactID.localeCompare(b.artifactID)
    })
  }

  export function windowedRecords(input: {
    records: ProbabilisticRollout.ShadowRecord[]
    source: string
    promotedAt: string
    maxRecords?: number
  }) {
    const filtered = sortRecords(
      input.records.filter(
        (record) => record.candidate.source === input.source && recordTimestamp(record) >= input.promotedAt,
      ),
    )
    if (!input.maxRecords || filtered.length <= input.maxRecords) return filtered
    return filtered.slice(filtered.length - input.maxRecords)
  }

  export function summarize(input: {
    records: ProbabilisticRollout.ShadowRecord[]
    source: string
    promotedAt: string
    minRecords?: number
    maxRecords?: number
    policy?: Partial<QualityPromotionReleasePolicy.WatchPolicy>
    releasePolicy?: {
      policy: QualityPromotionReleasePolicy.Policy
      provenance: QualityPromotionReleasePolicy.PolicyProvenance
    }
  }): WatchSummary {
    const effectiveReleasePolicy = input.releasePolicy
      ? {
          policy: QualityPromotionReleasePolicy.merge(input.releasePolicy.policy, {
            watch: input.policy,
          }),
          provenance: input.releasePolicy.provenance,
        }
      : {
          policy: QualityPromotionReleasePolicy.defaults({
            watch: input.policy,
          }),
          provenance: QualityPromotionReleasePolicy.PolicyProvenance.parse({
            policySource: "default",
            policyProjectID: null,
            compatibilityApprovalSource: null,
            resolvedAt: new Date().toISOString(),
            persistedScope: null,
            persistedUpdatedAt: null,
            digest: QualityPromotionReleasePolicy.digest(
              QualityPromotionReleasePolicy.defaults({
                watch: input.policy,
              }),
            ),
          }),
        }
    const policy = effectiveReleasePolicy.policy.watch
    const minRecords = Math.max(1, input.minRecords ?? policy.minRecords)
    const maxRecords =
      input.maxRecords === undefined ? policy.maxRecords : input.maxRecords ? Math.max(1, input.maxRecords) : null
    const records = windowedRecords({
      records: input.records,
      source: input.source,
      promotedAt: input.promotedAt,
      maxRecords: maxRecords ?? undefined,
    })
    const through = records.length > 0 ? recordTimestamp(records[records.length - 1]!) : null
    const baselineSource = records[0]?.baseline.source ?? "baseline"
    const shadow = ProbabilisticRollout.summarizeShadowFile({
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-file",
      baselineSource,
      candidateSource: input.source,
      generatedAt: new Date().toISOString(),
      records,
    })
    const sessionsCovered = new Set(records.map((record) => record.sessionID)).size
    const predictionChangedRate = ratio(shadow.predictionChangedItems, shadow.totalItems)
    const abstentionChangedRate = ratio(shadow.abstentionChangedItems, shadow.totalItems)
    const missingCandidateRate = ratio(shadow.missingCandidateItems, shadow.totalItems)
    const gates: WatchGate[] = []

    gates.push({
      name: "watch-volume",
      status: records.length >= minRecords ? "pass" : "warn",
      detail: `${records.length} record(s) observed; target minimum is ${minRecords}`,
    })
    gates.push({
      name: "candidate-coverage",
      status: policy.requireCandidateCoverage && shadow.missingCandidateItems > 0 ? "fail" : "pass",
      detail: `${shadow.missingCandidateItems} record(s) missing candidate predictions`,
    })

    const abstentionStatus =
      abstentionChangedRate !== null && abstentionChangedRate > policy.abstentionFailRate
        ? "fail"
        : abstentionChangedRate !== null && abstentionChangedRate > policy.abstentionWarnRate
          ? "warn"
          : "pass"
    gates.push({
      name: "abstention-drift",
      status: abstentionStatus,
      detail: `abstention change rate=${abstentionChangedRate ?? "n/a"} (warn>${policy.abstentionWarnRate} fail>${policy.abstentionFailRate})`,
    })

    const avgDelta = shadow.avgConfidenceDelta === null ? null : Math.abs(shadow.avgConfidenceDelta)
    const maxDelta = shadow.maxAbsConfidenceDelta
    const confidenceStatus =
      avgDelta !== null && avgDelta > policy.avgConfidenceFailAbsDelta
        ? "fail"
        : (avgDelta !== null && avgDelta > policy.avgConfidenceWarnAbsDelta) ||
            (maxDelta !== null && maxDelta > policy.maxConfidenceWarnAbsDelta)
          ? "warn"
          : "pass"
    gates.push({
      name: "confidence-drift",
      status: confidenceStatus,
      detail:
        `avg delta=${shadow.avgConfidenceDelta ?? "n/a"}, max abs delta=${shadow.maxAbsConfidenceDelta ?? "n/a"} ` +
        `(warn>|${policy.avgConfidenceWarnAbsDelta}| fail>|${policy.avgConfidenceFailAbsDelta}| max warn>|${policy.maxConfidenceWarnAbsDelta}|)`,
    })

    const overallStatus = gates.some((gate) => gate.status === "fail")
      ? "fail"
      : gates.some((gate) => gate.status === "warn")
        ? "warn"
        : "pass"

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-promotion-watch-summary",
      source: input.source,
      baselineSource,
      promotedAt: input.promotedAt,
      releasePolicy: effectiveReleasePolicy,
      window: {
        since: input.promotedAt,
        through,
        minRecords,
        maxRecords,
        totalRecords: records.length,
        sessionsCovered,
      },
      shadow,
      predictionChangedRate,
      abstentionChangedRate,
      missingCandidateRate,
      overallStatus,
      gates,
    }
  }

  export function renderWatchReport(summary: WatchSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality promotion watch")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- baseline source: ${summary.baselineSource}`)
    lines.push(`- promoted at: ${summary.promotedAt}`)
    lines.push(`- release policy source: ${summary.releasePolicy?.provenance.policySource ?? "n/a"}`)
    lines.push(`- release policy digest: ${summary.releasePolicy?.provenance.digest ?? "n/a"}`)
    lines.push(`- overall status: ${summary.overallStatus}`)
    lines.push(`- window since: ${summary.window.since}`)
    lines.push(`- window through: ${summary.window.through ?? "n/a"}`)
    lines.push(`- records: ${summary.window.totalRecords}`)
    lines.push(`- sessions covered: ${summary.window.sessionsCovered}`)
    lines.push("")
    lines.push("Shadow:")
    lines.push(`- comparable items: ${summary.shadow.comparableItems}`)
    lines.push(`- missing candidate items: ${summary.shadow.missingCandidateItems}`)
    lines.push(`- prediction changed rate: ${summary.predictionChangedRate ?? "n/a"}`)
    lines.push(`- abstention changed rate: ${summary.abstentionChangedRate ?? "n/a"}`)
    lines.push(`- missing candidate rate: ${summary.missingCandidateRate ?? "n/a"}`)
    lines.push(`- avg confidence delta: ${summary.shadow.avgConfidenceDelta ?? "n/a"}`)
    lines.push(`- max abs confidence delta: ${summary.shadow.maxAbsConfidenceDelta ?? "n/a"}`)
    lines.push("")
    lines.push("Gates:")
    for (const gate of summary.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
