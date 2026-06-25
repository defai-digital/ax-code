import type {
  PredictionFile,
  ReplayItem,
  ShadowFile,
  ShadowSummary,
} from "./helpers"
import {
  decisionFromItem,
  decisionFromPrediction,
  finiteOption,
  finiteOptionalOption,
  predictionForItem,
  predictionMap,
  toShadowDecision,
} from "./helpers"

export function buildShadowFile(
  items: ReplayItem[],
  predictionFile: PredictionFile,
  options?: {
    baselineThreshold?: number
    baselineAbstainBelow?: number
    candidateThreshold?: number
    candidateAbstainBelow?: number
  },
): ShadowFile {
  const predictions = predictionMap(predictionFile.predictions)
  const baselineThreshold = finiteOption(options?.baselineThreshold, 0.5)
  const candidateThreshold = finiteOption(options?.candidateThreshold, 0.5)
  const baselineAbstainBelow = finiteOptionalOption(options?.baselineAbstainBelow)
  const candidateAbstainBelow = finiteOptionalOption(options?.candidateAbstainBelow)
  const capturedAt = new Date().toISOString()

  const records = items.map((item) => {
    const baselineDecision = toShadowDecision(
      decisionFromItem(item),
      item.baseline.source,
      baselineThreshold,
      baselineAbstainBelow,
    )
    const candidateDecision = toShadowDecision(
      decisionFromPrediction(item, predictionForItem(item, predictions)),
      predictionFile.source,
      candidateThreshold,
      candidateAbstainBelow,
    )
    const confidenceDelta =
      baselineDecision.confidence === null || candidateDecision.confidence === null
        ? null
        : Number((candidateDecision.confidence - baselineDecision.confidence).toFixed(4))
    const baselineRank = baselineDecision.rank ?? null
    const candidateRank = candidateDecision.rank ?? null
    const rankDelta = baselineRank === null || candidateRank === null ? null : candidateRank - baselineRank

    return {
      schemaVersion: 1 as const,
      kind: "ax-code-quality-shadow-record" as const,
      artifactID: item.artifactID,
      sessionID: item.sessionID,
      workflow: item.workflow,
      artifactKind: item.artifactKind,
      title: item.title,
      createdAt: item.createdAt,
      capturedAt,
      baseline: baselineDecision,
      candidate: candidateDecision,
      disagreement: {
        candidateMissing: !candidateDecision.available,
        predictionChanged:
          baselineDecision.predictedPositive !== null &&
          candidateDecision.predictedPositive !== null &&
          baselineDecision.predictedPositive !== candidateDecision.predictedPositive,
        abstentionChanged: baselineDecision.abstained !== candidateDecision.abstained,
        confidenceDelta,
        rankDelta,
      },
    }
  })

  return {
    schemaVersion: 1,
    kind: "ax-code-quality-shadow-file",
    baselineSource: items[0]?.baseline.source ?? "baseline",
    candidateSource: predictionFile.source,
    generatedAt: new Date().toISOString(),
    records,
  }
}

export function summarizeShadowFile(shadow: ShadowFile): ShadowSummary {
  const comparable = shadow.records.filter((record) => record.baseline.available && record.candidate.available)
  const confidenceDeltas = comparable
    .map((record) => record.disagreement.confidenceDelta)
    .filter((delta): delta is number => delta !== null)
  const avgConfidenceDelta =
    confidenceDeltas.length === 0
      ? null
      : Number((confidenceDeltas.reduce((sum, delta) => sum + delta, 0) / confidenceDeltas.length).toFixed(4))
  const maxAbsConfidenceDelta =
    confidenceDeltas.length === 0
      ? null
      : Number(Math.max(...confidenceDeltas.map((delta) => Math.abs(delta))).toFixed(4))

  return {
    schemaVersion: 1,
    kind: "ax-code-quality-shadow-summary",
    baselineSource: shadow.baselineSource,
    candidateSource: shadow.candidateSource,
    totalItems: shadow.records.length,
    comparableItems: comparable.length,
    missingCandidateItems: shadow.records.filter((record) => record.disagreement.candidateMissing).length,
    predictionChangedItems: shadow.records.filter((record) => record.disagreement.predictionChanged).length,
    abstentionChangedItems: shadow.records.filter((record) => record.disagreement.abstentionChanged).length,
    avgConfidenceDelta,
    maxAbsConfidenceDelta,
    candidatePromotions: shadow.records.filter((record) => (record.disagreement.rankDelta ?? 0) < 0).length,
    candidateDemotions: shadow.records.filter((record) => (record.disagreement.rankDelta ?? 0) > 0).length,
  }
}

export function renderShadowReport(summary: ShadowSummary) {
  const lines: string[] = []
  lines.push("## ax-code quality shadow report")
  lines.push("")
  lines.push(`- baseline source: ${summary.baselineSource}`)
  lines.push(`- candidate source: ${summary.candidateSource}`)
  lines.push(`- total items: ${summary.totalItems}`)
  lines.push(`- comparable items: ${summary.comparableItems}`)
  lines.push(`- missing candidate items: ${summary.missingCandidateItems}`)
  lines.push(`- prediction changed items: ${summary.predictionChangedItems}`)
  lines.push(`- abstention changed items: ${summary.abstentionChangedItems}`)
  lines.push(`- avg confidence delta: ${summary.avgConfidenceDelta ?? "n/a"}`)
  lines.push(`- max abs confidence delta: ${summary.maxAbsConfidenceDelta ?? "n/a"}`)
  lines.push(`- candidate promotions: ${summary.candidatePromotions}`)
  lines.push(`- candidate demotions: ${summary.candidateDemotions}`)
  lines.push("")
  return lines.join("\n")
}
