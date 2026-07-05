import { Storage } from "../../storage/storage"
import { QualityPromotionWatch } from "../promotion-watch"
import { QualityReentryContext } from "../reentry-context"
import { QualityStabilityGuard } from "../stability-guard"
import { QualityStorageKey } from "../storage-key"
import { QualityModelRegistry } from "./index"

type PromotionRecord = QualityModelRegistry.PromotionRecord

const encode = QualityStorageKey.encode

export async function rollbackPromotion(
  promotion: PromotionRecord,
  watch: QualityPromotionWatch.WatchSummary,
  options?: { allowWarn?: boolean; force?: boolean },
) {
  if (promotion.source !== watch.source) {
    throw new Error(`Rollback watch source mismatch: promotion=${promotion.source} watch=${watch.source}`)
  }
  if (promotion.promotedAt !== watch.promotedAt) {
    throw new Error(`Rollback watch timestamp mismatch for model ${promotion.source}`)
  }

  const status = watch.overallStatus
  if (status === "pass" && !options?.force) {
    throw new Error(`Cannot rollback model ${promotion.source}: watch status is pass`)
  }
  if (status === "warn" && !options?.allowWarn && !options?.force) {
    throw new Error(`Cannot rollback model ${promotion.source}: watch status is warn (use allowWarn or force)`)
  }

  const currentActive = await QualityModelRegistry.getActive()
  if (currentActive?.source !== promotion.source && !options?.force) {
    throw new Error(
      `Cannot rollback model ${promotion.source}: current active model is ${currentActive?.source ?? "none"}`,
    )
  }

  const resultingActive = promotion.previousActiveSource
    ? await QualityModelRegistry.activate(promotion.previousActiveSource)
    : undefined
  if (!promotion.previousActiveSource) {
    await QualityModelRegistry.clearActive()
  }

  const decision = options?.force ? "force" : status === "warn" ? "warn_override" : "fail_guard"
  const rolledBackAt = new Date().toISOString()
  const rollbackID = `${Date.now()}-${encode(promotion.source)}`
  const priorRollbacks = await QualityModelRegistry.listRollbacks(promotion.source)
  const stability = QualityStabilityGuard.summarize({
    source: promotion.source,
    rollbacks: [...priorRollbacks, { source: promotion.source, rolledBackAt }],
  })
  const record = QualityModelRegistry.RollbackRecord.parse({
    schemaVersion: 1,
    kind: "ax-code-quality-model-rollback",
    rollbackID,
    source: promotion.source,
    rolledBackAt,
    promotionID: promotion.promotionID,
    promotedAt: promotion.promotedAt,
    previousActiveSource: promotion.previousActiveSource,
    rollbackTargetSource: promotion.previousActiveSource,
    resultingActiveSource: resultingActive?.source ?? null,
    decision,
    reentryContextID: rollbackID,
    watch: {
      overallStatus: status,
      totalRecords: watch.window.totalRecords,
      sessionsCovered: watch.window.sessionsCovered,
      releasePolicy: watch.releasePolicy
        ? {
            policySource: watch.releasePolicy.provenance.policySource,
            policyProjectID: watch.releasePolicy.provenance.policyProjectID,
            compatibilityApprovalSource: watch.releasePolicy.provenance.compatibilityApprovalSource,
            resolvedAt: watch.releasePolicy.provenance.resolvedAt,
            persistedScope: watch.releasePolicy.provenance.persistedScope,
            persistedUpdatedAt: watch.releasePolicy.provenance.persistedUpdatedAt,
            digest: watch.releasePolicy.provenance.digest,
          }
        : undefined,
      gates: watch.gates,
    },
    stability,
  })
  await Storage.write(["quality_model_rollback", rollbackID], record)
  await QualityReentryContext.append(
    QualityReentryContext.create({
      rollback: record,
      watch,
    }),
  )
  return { active: resultingActive ?? null, record, stability }
}
