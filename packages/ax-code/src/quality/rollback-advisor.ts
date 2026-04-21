import z from "zod"
import { QualityModelRegistry } from "./model-registry"
import { QualityPromotionWatch } from "./promotion-watch"

export namespace QualityRollbackAdvisor {
  export const RollbackAction = z.enum(["keep", "observe", "rollback"])
  export type RollbackAction = z.output<typeof RollbackAction>

  export const RollbackRecommendation = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-rollback-recommendation"),
    source: z.string(),
    promotionID: z.string(),
    promotedAt: z.string(),
    currentActiveSource: z.string().nullable(),
    previousActiveSource: z.string().nullable(),
    rollbackTargetSource: z.string().nullable(),
    watchOverallStatus: z.enum(["pass", "warn", "fail"]),
    action: RollbackAction,
    rationale: z.array(z.string()),
    watch: z.object({
      releasePolicySource: z.enum(["explicit", "project", "global", "default"]).nullable(),
      releasePolicyDigest: z.string().nullable(),
      totalRecords: z.number().int().nonnegative(),
      sessionsCovered: z.number().int().nonnegative(),
      missingCandidateItems: z.number().int().nonnegative(),
      abstentionChangedRate: z.number().nullable(),
      predictionChangedRate: z.number().nullable(),
      maxAbsConfidenceDelta: z.number().nullable(),
    }),
  })
  export type RollbackRecommendation = z.output<typeof RollbackRecommendation>

  export function recommend(input: {
    promotion: QualityModelRegistry.PromotionRecord
    watch: QualityPromotionWatch.WatchSummary
    currentActiveSource?: string | null
  }): RollbackRecommendation {
    if (input.promotion.source !== input.watch.source) {
      throw new Error(
        `Rollback recommendation source mismatch: promotion=${input.promotion.source} watch=${input.watch.source}`,
      )
    }

    const currentActiveSource = input.currentActiveSource ?? null
    const rationale: string[] = []
    let action: RollbackAction = "keep"

    if (input.watch.overallStatus === "pass") {
      action = "keep"
      rationale.push("Post-promotion watch status is pass; keep the active model in place.")
    } else if (currentActiveSource && currentActiveSource !== input.promotion.source) {
      action = "observe"
      rationale.push(
        `Promotion source ${input.promotion.source} is not the current active model (${currentActiveSource}); do not rollback automatically.`,
      )
    } else if (input.watch.overallStatus === "fail") {
      action = "rollback"
      rationale.push("Post-promotion watch status is fail; rollback is recommended.")
    } else {
      action = "observe"
      rationale.push("Post-promotion watch status is warn; continue observation before changing the active model.")
    }

    for (const gate of input.watch.gates) {
      if (gate.status === "pass") continue
      rationale.push(`[${gate.status}] ${gate.name}: ${gate.detail}`)
    }

    return RollbackRecommendation.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-rollback-recommendation",
      source: input.promotion.source,
      promotionID: input.promotion.promotionID,
      promotedAt: input.promotion.promotedAt,
      currentActiveSource,
      previousActiveSource: input.promotion.previousActiveSource,
      rollbackTargetSource: action === "rollback" ? input.promotion.previousActiveSource : null,
      watchOverallStatus: input.watch.overallStatus,
      action,
      rationale,
      watch: {
        releasePolicySource: input.watch.releasePolicy?.provenance.policySource ?? null,
        releasePolicyDigest: input.watch.releasePolicy?.provenance.digest ?? null,
        totalRecords: input.watch.window.totalRecords,
        sessionsCovered: input.watch.window.sessionsCovered,
        missingCandidateItems: input.watch.shadow.missingCandidateItems,
        abstentionChangedRate: input.watch.abstentionChangedRate,
        predictionChangedRate: input.watch.predictionChangedRate,
        maxAbsConfidenceDelta: input.watch.shadow.maxAbsConfidenceDelta,
      },
    })
  }

  export function renderRecommendationReport(recommendation: RollbackRecommendation) {
    const lines: string[] = []
    lines.push("## ax-code quality rollback recommendation")
    lines.push("")
    lines.push(`- source: ${recommendation.source}`)
    lines.push(`- promotion id: ${recommendation.promotionID}`)
    lines.push(`- promoted at: ${recommendation.promotedAt}`)
    lines.push(`- watch status: ${recommendation.watchOverallStatus}`)
    lines.push(`- recommended action: ${recommendation.action}`)
    lines.push(`- current active source: ${recommendation.currentActiveSource ?? "none"}`)
    lines.push(`- previous active source: ${recommendation.previousActiveSource ?? "none"}`)
    lines.push(`- rollback target source: ${recommendation.rollbackTargetSource ?? "none"}`)
    lines.push("")
    lines.push("Watch:")
    lines.push(`- release policy source: ${recommendation.watch.releasePolicySource ?? "n/a"}`)
    lines.push(`- release policy digest: ${recommendation.watch.releasePolicyDigest ?? "n/a"}`)
    lines.push(`- records: ${recommendation.watch.totalRecords}`)
    lines.push(`- sessions covered: ${recommendation.watch.sessionsCovered}`)
    lines.push(`- missing candidate items: ${recommendation.watch.missingCandidateItems}`)
    lines.push(`- prediction changed rate: ${recommendation.watch.predictionChangedRate ?? "n/a"}`)
    lines.push(`- abstention changed rate: ${recommendation.watch.abstentionChangedRate ?? "n/a"}`)
    lines.push(`- max abs confidence delta: ${recommendation.watch.maxAbsConfidenceDelta ?? "n/a"}`)
    lines.push("")
    lines.push("Rationale:")
    for (const item of recommendation.rationale) {
      lines.push(`- ${item}`)
    }
    lines.push("")
    return lines.join("\n")
  }
}
