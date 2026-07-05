import z from "zod"
import { Storage } from "../../storage/storage"
import * as QualityModelRegistryCanonical from "../model-registry-canonical"
import * as QualityModelRegistrySchema from "../model-registry-schema"
import { QualityStabilityGuard } from "../stability-guard"
import { QualityStorageKey } from "../storage-key"
import { QualityCalibrationModel } from "../calibration-model"
import { QualityPromotionEligibility } from "../promotion-eligibility"
import { QualityPromotionDecisionBundle } from "../promotion-decision-bundle"
import { QualityPromotionReleasePolicyStore } from "../promotion-release-policy-store"
import { QualityReentryContext } from "../reentry-context"
import { QualityReentryRemediation } from "../reentry-remediation"
import {
  promotionApprovers,
  promotionReportingChains,
  reportingChainCarryoverHistory,
  reviewerCarryoverHistory,
  sortModelRecords,
  sortPromotionRecords,
  sortRollbackRecords,
  teamCarryoverHistory,
} from "../model-registry-selection"

export namespace QualityModelRegistry {
  export const PromotionMetadata = QualityModelRegistrySchema.PromotionMetadata
  export type PromotionMetadata = z.output<typeof PromotionMetadata>

  export const ModelRecord = QualityModelRegistrySchema.ModelRecord
  export type ModelRecord = z.output<typeof ModelRecord>

  export const ActiveRecord = QualityModelRegistrySchema.ActiveRecord
  export type ActiveRecord = z.output<typeof ActiveRecord>

  export const PromotionRecord = QualityModelRegistrySchema.PromotionRecord
  export type PromotionRecord = z.output<typeof PromotionRecord>

  export const CanonicalPromotionStage = QualityModelRegistrySchema.CanonicalPromotionStage
  export type CanonicalPromotionStage = z.output<typeof CanonicalPromotionStage>

  export const CanonicalPromotionArtifactKind = QualityModelRegistrySchema.CanonicalPromotionArtifactKind
  export type CanonicalPromotionArtifactKind = z.output<typeof CanonicalPromotionArtifactKind>

  export const CanonicalPromotionSummary = QualityModelRegistrySchema.CanonicalPromotionSummary
  export type CanonicalPromotionSummary = z.output<typeof CanonicalPromotionSummary>

  export const RollbackRecord = QualityModelRegistrySchema.RollbackRecord
  export type RollbackRecord = z.output<typeof RollbackRecord>

  export const summarizeCanonicalPromotion = QualityModelRegistryCanonical.summarizeCanonicalPromotion

  export const renderCanonicalPromotionReport = QualityModelRegistryCanonical.renderCanonicalPromotionReport

  const encode = QualityStorageKey.encode
  const decode = QualityStorageKey.decode

  function modelKey(source: string) {
    return ["quality_model", encode(source)]
  }

  function activeKey() {
    return ["quality_model_active", "current"]
  }

  function promotionKey(promotionID: string) {
    return ["quality_model_promotion", promotionID]
  }

  export function writePromotionRecord(record: PromotionRecord) {
    return Storage.write(promotionKey(record.promotionID), record)
  }

  function rollbackKey(rollbackID: string) {
    return ["quality_model_rollback", rollbackID]
  }

  export async function get(source: string) {
    const record = await Storage.read<unknown>(modelKey(source))
    return ModelRecord.parse(record)
  }

  export async function register(model: QualityCalibrationModel.ModelFile) {
    const next = ModelRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-record",
      registeredAt: new Date().toISOString(),
      model,
    })

    try {
      const existing = await get(model.source)
      const prev = JSON.stringify(existing.model)
      const curr = JSON.stringify(model)
      if (prev === curr) return existing
      throw new Error(`Model source ${model.source} already exists with different content`)
    } catch (err) {
      if (!Storage.NotFoundError.isInstance(err)) throw err
      await Storage.write(modelKey(model.source), next)
      return next
    }
  }

  export async function list() {
    const keys = await Storage.list(["quality_model"])
    const out: ModelRecord[] = []
    for (const parts of keys) {
      const encodedSource = parts[parts.length - 1]
      if (!encodedSource) continue
      const source = decode(encodedSource)
      if (!source) continue
      out.push(await get(source))
    }
    return sortModelRecords(out)
  }

  export async function getActive() {
    try {
      const record = await Storage.read<unknown>(activeKey())
      return ActiveRecord.parse(record)
    } catch (err) {
      if (Storage.NotFoundError.isInstance(err)) return
      throw err
    }
  }

  export async function activate(source: string) {
    await get(source)
    const next = ActiveRecord.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-model-active",
      source,
      activatedAt: new Date().toISOString(),
    })
    await Storage.write(activeKey(), next)
    return next
  }

  export async function clearActive() {
    await Storage.remove(activeKey())
  }

  export async function resolveActiveModel() {
    const active = await getActive()
    if (!active) return
    return (await get(active.source)).model
  }

  export async function listPromotions(source?: string) {
    const keys = await Storage.list(["quality_model_promotion"])
    const out: PromotionRecord[] = []
    for (const parts of keys) {
      const promotionID = parts[parts.length - 1]
      if (!promotionID) continue
      const record = PromotionRecord.parse(await Storage.read<unknown>(promotionKey(promotionID)))
      if (source && record.source !== source) continue
      out.push(record)
    }
    return sortPromotionRecords(out)
  }

  export async function latestPromotion(source?: string) {
    const promotions = await listPromotions(source)
    return promotions[promotions.length - 1]
  }

  export async function getPromotion(promotionID: string) {
    const record = await Storage.read<unknown>(promotionKey(promotionID))
    return PromotionRecord.parse(record)
  }

  export async function listRollbacks(source?: string) {
    const keys = await Storage.list(["quality_model_rollback"])
    const out: RollbackRecord[] = []
    for (const parts of keys) {
      const rollbackID = parts[parts.length - 1]
      if (!rollbackID) continue
      const record = RollbackRecord.parse(await Storage.read<unknown>(rollbackKey(rollbackID)))
      if (source && record.source !== source) continue
      out.push(record)
    }
    return sortRollbackRecords(out)
  }

  export async function evaluatePromotionEligibility(
    bundle: QualityCalibrationModel.BenchmarkBundle,
    options?: {
      cooldownHours?: number
      repeatFailureWindowHours?: number
      repeatFailureThreshold?: number
      releasePolicyDigest?: string | null
      reviewerCarryoverLookbackPromotions?: number | null
      teamCarryoverLookbackPromotions?: number | null
      reportingChainCarryoverLookbackPromotions?: number | null
    },
  ) {
    const [currentActive, promotions, rollbacks, reentryContext] = await Promise.all([
      getActive(),
      listPromotions(bundle.model.source),
      listRollbacks(bundle.model.source),
      QualityReentryContext.latest(bundle.model.source),
    ])
    const priorPromotion = reentryContext
      ? await getPromotion(reentryContext.promotionID).catch((err) => {
          if (Storage.NotFoundError.isInstance(err)) return undefined
          throw err
        })
      : undefined
    const priorPromotionApprovers = priorPromotion ? promotionApprovers(priorPromotion) : []
    const priorPromotionReportingChains = priorPromotion ? promotionReportingChains(priorPromotion) : []
    const reviewerCarryoverLookbackPromotions = options?.reviewerCarryoverLookbackPromotions ?? 3
    const teamCarryoverLookbackPromotions = options?.teamCarryoverLookbackPromotions ?? 3
    const reportingChainCarryoverLookbackPromotions = options?.reportingChainCarryoverLookbackPromotions ?? 3
    const normalizedReviewerCarryoverHistory = reviewerCarryoverHistory(promotions, reviewerCarryoverLookbackPromotions)
    const normalizedTeamCarryoverHistory = teamCarryoverHistory(promotions, teamCarryoverLookbackPromotions)
    const normalizedReportingChainCarryoverHistory = reportingChainCarryoverHistory(
      promotions,
      reportingChainCarryoverLookbackPromotions,
    )
    const reentryRemediation = reentryContext
      ? await QualityReentryRemediation.latestForContext({
          source: bundle.model.source,
          contextID: reentryContext.contextID,
        })
      : undefined
    const stability = QualityStabilityGuard.summarize({
      source: bundle.model.source,
      rollbacks,
      cooldownHours: options?.cooldownHours,
      repeatFailureWindowHours: options?.repeatFailureWindowHours,
      repeatFailureThreshold: options?.repeatFailureThreshold,
    })
    const eligibility = QualityPromotionEligibility.summarize({
      bundle,
      stability,
      currentActiveSource: currentActive?.source ?? null,
      lastPromotionAt: promotions[promotions.length - 1]?.promotedAt ?? null,
      lastRollbackAt: rollbacks[rollbacks.length - 1]?.rolledBackAt ?? null,
      priorPromotions: promotions.length,
      priorRollbacks: rollbacks.length,
      reentryContext,
      remediation: reentryRemediation,
      priorPromotionApprovers,
      teamCarryoverHistory: normalizedTeamCarryoverHistory,
      priorPromotionReportingChains,
      reviewerCarryoverHistory: normalizedReviewerCarryoverHistory,
      reportingChainCarryoverHistory: normalizedReportingChainCarryoverHistory,
      currentReleasePolicyDigest: options?.releasePolicyDigest ?? null,
    })
    return {
      currentActive,
      promotions,
      rollbacks,
      priorPromotion,
      reentryContext,
      reentryRemediation,
      stability,
      eligibility,
    }
  }

  export async function buildPromotionDecisionBundle(
    bundle: QualityCalibrationModel.BenchmarkBundle,
    options?: {
      cooldownHours?: number
      repeatFailureWindowHours?: number
      repeatFailureThreshold?: number
      releasePolicyResolution?: QualityPromotionReleasePolicyStore.Resolution
    },
  ) {
    const evaluation = await evaluatePromotionEligibility(bundle, {
      ...options,
      reviewerCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.reviewerCarryoverLookbackPromotions,
      teamCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.teamCarryoverLookbackPromotions,
      reportingChainCarryoverLookbackPromotions:
        options?.releasePolicyResolution?.policy?.approval?.rules?.reentry?.reportingChainCarryoverLookbackPromotions,
    })
    const decisionBundle = QualityPromotionDecisionBundle.build({
      benchmark: bundle,
      stability: evaluation.stability,
      eligibility: evaluation.eligibility,
      policy: {
        cooldownHours: options?.cooldownHours,
        repeatFailureWindowHours: options?.repeatFailureWindowHours,
        repeatFailureThreshold: options?.repeatFailureThreshold,
      },
      releasePolicySnapshot: options?.releasePolicyResolution
        ? {
            policy: options.releasePolicyResolution.policy,
            provenance: QualityPromotionReleasePolicyStore.provenance(options.releasePolicyResolution),
          }
        : undefined,
    })
    return { ...evaluation, decisionBundle }
  }

  // Re-export promotion functions from sub-modules
  export const promote = _promote
  export const promoteDecisionBundle = _promoteDecisionBundle
  export const finalizePromotion = _finalizePromotion
  export const promoteApprovedDecisionBundle = _promoteApprovedDecisionBundle
  export const promoteSubmissionBundle = _promoteSubmissionBundle
  export const promoteReviewDossier = _promoteReviewDossier
  export const promoteBoardDecision = _promoteBoardDecision
  export const promoteReleaseDecisionRecord = _promoteReleaseDecisionRecord
  export const promoteReleasePacket = _promoteReleasePacket
  export const rollbackPromotion = _rollbackPromotion
}

import { promote as _promote, promoteDecisionBundle as _promoteDecisionBundle, finalizePromotion as _finalizePromotion } from "./promote"
import {
  promoteApprovedDecisionBundle as _promoteApprovedDecisionBundle,
  promoteSubmissionBundle as _promoteSubmissionBundle,
  promoteReviewDossier as _promoteReviewDossier,
  promoteBoardDecision as _promoteBoardDecision,
  promoteReleaseDecisionRecord as _promoteReleaseDecisionRecord,
} from "./promote-bundle"
import { promoteReleasePacket as _promoteReleasePacket } from "./release-packet"
import { rollbackPromotion as _rollbackPromotion } from "./rollback"
