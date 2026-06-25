import type {
  CalibrationComparison,
  CalibrationRecord,
  CalibrationSummary,
  ComparisonGate,
  Label,
  Prediction,
  ReplayItem,
} from "./helpers"
import {
  actualPositive,
  decisionFromItem,
  decisionFromPrediction,
  finiteOption,
  finiteOptionalOption,
  isResolved,
  metricComparison,
  numberDelta,
  positiveIntegerOption,
  predictionForItem,
  predictionMap,
  ratio,
} from "./helpers"

export function calibrationRecords(
  items: ReplayItem[],
  labels: Label[],
  options?: { threshold?: number; abstainBelow?: number; predictions?: Prediction[] },
): CalibrationRecord[] {
  const threshold = finiteOption(options?.threshold, 0.5)
  const abstainBelow = finiteOptionalOption(options?.abstainBelow)
  const predictions = predictionMap(options?.predictions)
  const labelMap = new Map(labels.map((label) => [label.artifactID, label]))
  const records: CalibrationRecord[] = []

  for (const item of items) {
    const decision = options?.predictions
      ? decisionFromPrediction(item, predictionForItem(item, predictions))
      : decisionFromItem(item)
    if (!decision) continue
    const confidence = decision.confidence
    if (typeof confidence !== "number") continue
    const label = labelMap.get(item.artifactID)
    if (!label || !isResolved(label)) continue
    if (label.workflow !== item.workflow || label.artifactKind !== item.artifactKind) continue

    const abstained =
      abstainBelow !== undefined
        ? confidence < abstainBelow || decision.readiness === "needs_review"
        : decision.readiness === "needs_review"

    records.push({
      artifactID: item.artifactID,
      sessionID: item.sessionID,
      workflow: item.workflow,
      artifactKind: item.artifactKind,
      source: decision.source,
      confidence,
      score: decision.score ?? null,
      readiness: decision.readiness ?? null,
      actualPositive: actualPositive(label),
      predictedPositive: !abstained && confidence >= threshold,
      abstained,
      outcome: label.outcome,
    })
  }

  return records
}

function topKPrecision(records: CalibrationRecord[], size: number) {
  if (records.length === 0) return null
  const grouped = new Map<string, CalibrationRecord[]>()
  for (const record of records) {
    const key = `${record.workflow}:${record.artifactKind}:${record.sessionID}`
    const list = grouped.get(key) ?? []
    list.push(record)
    grouped.set(key, list)
  }

  let hits = 0
  let total = 0
  for (const group of grouped.values()) {
    const top = group
      .filter((record) => !record.abstained)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, size)
    for (const record of top) {
      total++
      if (record.actualPositive) hits++
    }
  }

  return ratio(hits, total)
}

function calibrationBins(records: CalibrationRecord[], binCount: number) {
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: index / binCount,
    end: (index + 1) / binCount,
    items: [] as CalibrationRecord[],
  }))

  for (const record of records) {
    const normalized = Math.min(Math.max(record.confidence, 0), 0.999999)
    const index = Math.min(binCount - 1, Math.floor(normalized * binCount))
    bins[index]?.items.push(record)
  }

  return bins.map((bin) => {
    if (bin.items.length === 0) {
      return {
        start: Number(bin.start.toFixed(2)),
        end: Number(bin.end.toFixed(2)),
        count: 0,
        avgConfidence: null,
        empiricalRate: null,
      }
    }
    const avgConfidence = bin.items.reduce((sum, item) => sum + item.confidence, 0) / bin.items.length
    const empiricalRate = bin.items.filter((item) => item.actualPositive).length / bin.items.length
    return {
      start: Number(bin.start.toFixed(2)),
      end: Number(bin.end.toFixed(2)),
      count: bin.items.length,
      avgConfidence: Number(avgConfidence.toFixed(4)),
      empiricalRate: Number(empiricalRate.toFixed(4)),
    }
  })
}

export function summarizeCalibration(
  items: ReplayItem[],
  labels: Label[],
  options?: { threshold?: number; abstainBelow?: number; bins?: number; predictions?: Prediction[]; source?: string },
): CalibrationSummary {
  const threshold = finiteOption(options?.threshold, 0.5)
  const abstainBelow = finiteOptionalOption(options?.abstainBelow) ?? null
  const binCount = positiveIntegerOption(options?.bins, 5)
  const predictions = predictionMap(options?.predictions)
  const records = calibrationRecords(items, labels, {
    threshold,
    abstainBelow: abstainBelow ?? undefined,
    predictions: options?.predictions,
  })
  const considered = records.filter((record) => !record.abstained)
  const scoredItems = items.filter((item) => {
    const decision = options?.predictions
      ? decisionFromPrediction(item, predictionForItem(item, predictions))
      : decisionFromItem(item)
    return typeof decision?.confidence === "number"
  }).length
  const missingPredictionItems = options?.predictions
    ? items.filter((item) => !predictionForItem(item, predictions)).length
    : 0

  const positives = considered.filter((record) => record.actualPositive).length
  const negatives = considered.length - positives
  const tp = considered.filter((record) => record.predictedPositive && record.actualPositive).length
  const fp = considered.filter((record) => record.predictedPositive && !record.actualPositive).length
  const tn = considered.filter((record) => !record.predictedPositive && !record.actualPositive).length
  const fn = considered.filter((record) => !record.predictedPositive && record.actualPositive).length
  const bins = calibrationBins(records, binCount)
  const calibrationError =
    records.length === 0
      ? null
      : Number(
          (
            bins.reduce((sum, bin) => {
              if (bin.count === 0 || bin.avgConfidence === null || bin.empiricalRate === null) return sum
              return sum + Math.abs(bin.avgConfidence - bin.empiricalRate) * bin.count
            }, 0) / records.length
          ).toFixed(4),
        )

  return {
    schemaVersion: 1,
    kind: "ax-code-quality-calibration-summary",
    source: options?.source ?? options?.predictions?.[0]?.source ?? "baseline",
    threshold,
    abstainBelow,
    totalItems: items.length,
    scoredItems,
    missingPredictionItems,
    labeledItems: records.length,
    consideredItems: considered.length,
    abstainedItems: records.filter((record) => record.abstained).length,
    positives,
    negatives,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    falseNegativeRate: ratio(fn, fn + tp),
    precisionAt1: topKPrecision(records, 1),
    precisionAt3: topKPrecision(records, 3),
    calibrationError,
    bins,
  }
}

export function renderCalibrationReport(summary: CalibrationSummary) {
  const lines: string[] = []
  lines.push("## ax-code quality calibration report")
  lines.push("")
  lines.push(`- source: ${summary.source}`)
  lines.push(`- threshold: ${summary.threshold}`)
  lines.push(`- abstain below: ${summary.abstainBelow ?? "off"}`)
  lines.push(`- total items: ${summary.totalItems}`)
  lines.push(`- scored items: ${summary.scoredItems}`)
  lines.push(`- missing prediction items: ${summary.missingPredictionItems}`)
  lines.push(`- labeled items: ${summary.labeledItems}`)
  lines.push(`- considered items: ${summary.consideredItems}`)
  lines.push(`- abstained items: ${summary.abstainedItems}`)
  lines.push(`- positives: ${summary.positives}`)
  lines.push(`- negatives: ${summary.negatives}`)
  lines.push("")
  lines.push("Metrics:")
  lines.push(`- precision: ${summary.precision ?? "n/a"}`)
  lines.push(`- recall: ${summary.recall ?? "n/a"}`)
  lines.push(`- false positive rate: ${summary.falsePositiveRate ?? "n/a"}`)
  lines.push(`- false negative rate: ${summary.falseNegativeRate ?? "n/a"}`)
  lines.push(`- precision@1: ${summary.precisionAt1 ?? "n/a"}`)
  lines.push(`- precision@3: ${summary.precisionAt3 ?? "n/a"}`)
  lines.push(`- calibration error: ${summary.calibrationError ?? "n/a"}`)
  lines.push("")
  lines.push("Calibration bins:")
  for (const bin of summary.bins) {
    lines.push(
      `- ${bin.start.toFixed(2)}-${bin.end.toFixed(2)}: count=${bin.count}, avg_confidence=${bin.avgConfidence ?? "n/a"}, empirical_rate=${bin.empiricalRate ?? "n/a"}`,
    )
  }
  lines.push("")
  return lines.join("\n")
}

export function compareCalibrationSummaries(
  baseline: CalibrationSummary,
  candidate: CalibrationSummary,
  options?: {
    maxPrecisionDrop?: number
    maxRecallDrop?: number
    maxFalsePositiveRateIncrease?: number
    maxFalseNegativeRateIncrease?: number
    maxCalibrationErrorIncrease?: number
  },
): CalibrationComparison {
  const metrics = {
    precision: metricComparison(baseline.precision, candidate.precision, "higher_is_better"),
    recall: metricComparison(baseline.recall, candidate.recall, "higher_is_better"),
    falsePositiveRate: metricComparison(baseline.falsePositiveRate, candidate.falsePositiveRate, "lower_is_better"),
    falseNegativeRate: metricComparison(baseline.falseNegativeRate, candidate.falseNegativeRate, "lower_is_better"),
    precisionAt1: metricComparison(baseline.precisionAt1, candidate.precisionAt1, "higher_is_better"),
    precisionAt3: metricComparison(baseline.precisionAt3, candidate.precisionAt3, "higher_is_better"),
    calibrationError: metricComparison(baseline.calibrationError, candidate.calibrationError, "lower_is_better"),
  }

  const gates: ComparisonGate[] = []
  const precisionDrop = numberDelta(candidate.precision, baseline.precision)
  const recallDrop = numberDelta(candidate.recall, baseline.recall)
  const falsePositiveIncrease = numberDelta(candidate.falsePositiveRate, baseline.falsePositiveRate)
  const falseNegativeIncrease = numberDelta(candidate.falseNegativeRate, baseline.falseNegativeRate)
  const calibrationErrorIncrease = numberDelta(candidate.calibrationError, baseline.calibrationError)

  const maxPrecisionDrop = finiteOption(options?.maxPrecisionDrop, 0.02)
  const maxRecallDrop = finiteOption(options?.maxRecallDrop, 0.02)
  const maxFalsePositiveRateIncrease = finiteOption(options?.maxFalsePositiveRateIncrease, 0.01)
  const maxFalseNegativeRateIncrease = finiteOption(options?.maxFalseNegativeRateIncrease, 0.01)
  const maxCalibrationErrorIncrease = finiteOption(options?.maxCalibrationErrorIncrease, 0.02)

  gates.push({
    name: "dataset-consistency",
    status:
      baseline.totalItems === candidate.totalItems && baseline.labeledItems === candidate.labeledItems
        ? "pass"
        : "warn",
    detail: `baseline total/labeled=${baseline.totalItems}/${baseline.labeledItems}, candidate total/labeled=${candidate.totalItems}/${candidate.labeledItems}`,
  })
  gates.push({
    name: "precision-regression",
    status: precisionDrop !== null && precisionDrop < -maxPrecisionDrop ? "fail" : "pass",
    detail: `candidate precision delta=${precisionDrop ?? "n/a"} (allowed drop ${maxPrecisionDrop})`,
  })
  gates.push({
    name: "recall-regression",
    status: recallDrop !== null && recallDrop < -maxRecallDrop ? "fail" : "pass",
    detail: `candidate recall delta=${recallDrop ?? "n/a"} (allowed drop ${maxRecallDrop})`,
  })
  gates.push({
    name: "false-positive-rate",
    status: falsePositiveIncrease !== null && falsePositiveIncrease > maxFalsePositiveRateIncrease ? "fail" : "pass",
    detail: `candidate false positive rate delta=${falsePositiveIncrease ?? "n/a"} (allowed increase ${maxFalsePositiveRateIncrease})`,
  })
  gates.push({
    name: "false-negative-rate",
    status: falseNegativeIncrease !== null && falseNegativeIncrease > maxFalseNegativeRateIncrease ? "fail" : "pass",
    detail: `candidate false negative rate delta=${falseNegativeIncrease ?? "n/a"} (allowed increase ${maxFalseNegativeRateIncrease})`,
  })
  gates.push({
    name: "calibration-error",
    status:
      calibrationErrorIncrease !== null && calibrationErrorIncrease > maxCalibrationErrorIncrease ? "warn" : "pass",
    detail: `candidate calibration error delta=${calibrationErrorIncrease ?? "n/a"} (allowed increase ${maxCalibrationErrorIncrease})`,
  })

  const overallStatus = gates.some((gate) => gate.status === "fail")
    ? "fail"
    : gates.some((gate) => gate.status === "warn")
      ? "warn"
      : "pass"

  return {
    schemaVersion: 1,
    kind: "ax-code-quality-calibration-comparison",
    baselineSource: baseline.source,
    candidateSource: candidate.source,
    overallStatus,
    dataset: {
      baselineTotalItems: baseline.totalItems,
      candidateTotalItems: candidate.totalItems,
      baselineScoredItems: baseline.scoredItems,
      candidateScoredItems: candidate.scoredItems,
      baselineLabeledItems: baseline.labeledItems,
      candidateLabeledItems: candidate.labeledItems,
      baselineMissingPredictionItems: baseline.missingPredictionItems,
      candidateMissingPredictionItems: candidate.missingPredictionItems,
    },
    metrics,
    gates,
  }
}

export function renderCalibrationComparisonReport(comparison: CalibrationComparison) {
  const lines: string[] = []
  lines.push("## ax-code quality calibration comparison")
  lines.push("")
  lines.push(`- baseline source: ${comparison.baselineSource}`)
  lines.push(`- candidate source: ${comparison.candidateSource}`)
  lines.push(`- overall status: ${comparison.overallStatus}`)
  lines.push("")
  lines.push("Dataset:")
  lines.push(
    `- baseline total/labeled/scored: ${comparison.dataset.baselineTotalItems}/${comparison.dataset.baselineLabeledItems}/${comparison.dataset.baselineScoredItems}`,
  )
  lines.push(
    `- candidate total/labeled/scored: ${comparison.dataset.candidateTotalItems}/${comparison.dataset.candidateLabeledItems}/${comparison.dataset.candidateScoredItems}`,
  )
  lines.push(`- baseline missing prediction items: ${comparison.dataset.baselineMissingPredictionItems}`)
  lines.push(`- candidate missing prediction items: ${comparison.dataset.candidateMissingPredictionItems}`)
  lines.push("")
  lines.push("Metrics:")
  for (const [name, metric] of Object.entries(comparison.metrics)) {
    lines.push(
      `- ${name}: baseline=${metric.baseline ?? "n/a"}, candidate=${metric.candidate ?? "n/a"}, delta=${metric.delta ?? "n/a"}`,
    )
  }
  lines.push("")
  lines.push("Gates:")
  for (const gate of comparison.gates) {
    lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
  }
  lines.push("")
  return lines.join("\n")
}
