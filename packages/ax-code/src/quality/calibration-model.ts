import z from "zod"
import { ProbabilisticRollout } from "./probabilistic-rollout"

export namespace QualityCalibrationModel {
  type TrainingRecord = ProbabilisticRollout.CalibrationRecord & {
    createdAt: string
  }

  export const CalibrationBin = z.object({
    start: z.number(),
    end: z.number(),
    count: z.number().int().nonnegative(),
    positives: z.number().int().nonnegative(),
    negatives: z.number().int().nonnegative(),
    avgBaselineConfidence: z.number().nullable(),
    empiricalRate: z.number().nullable(),
    smoothedRate: z.number(),
  })
  export type CalibrationBin = z.output<typeof CalibrationBin>

  export const GroupModel = z.object({
    workflow: z.lazy(() => ProbabilisticRollout.Workflow),
    artifactKind: z.lazy(() => ProbabilisticRollout.ArtifactKind),
    totalCount: z.number().int().nonnegative(),
    positives: z.number().int().nonnegative(),
    negatives: z.number().int().nonnegative(),
    prior: z.number(),
    bins: CalibrationBin.array(),
  })
  export type GroupModel = z.output<typeof GroupModel>

  export const ModelFile = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-calibration-model"),
    source: z.string(),
    trainedAt: z.string(),
    globalPrior: z.number(),
    laplaceAlpha: z.number(),
    requestedBinCount: z.number().int().positive(),
    minBinCount: z.number().int().positive(),
    training: z.object({
      sessionIDs: z.string().array(),
      labeledItems: z.number().int().nonnegative(),
      positives: z.number().int().nonnegative(),
      negatives: z.number().int().nonnegative(),
    }),
    groups: GroupModel.array(),
  })
  export type ModelFile = z.output<typeof ModelFile>

  export const BenchmarkSplit = z.object({
    ratio: z.number(),
    trainSessionIDs: z.string().array(),
    evalSessionIDs: z.string().array(),
  })
  export type BenchmarkSplit = z.output<typeof BenchmarkSplit>

  export const BenchmarkBundle = z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("ax-code-quality-benchmark-bundle"),
    split: BenchmarkSplit,
    model: ModelFile,
    baselineSummary: z.lazy(() => ProbabilisticRollout.CalibrationSummary),
    candidateSummary: z.lazy(() => ProbabilisticRollout.CalibrationSummary),
    comparison: z.lazy(() => ProbabilisticRollout.CalibrationComparison),
  })
  export type BenchmarkBundle = z.output<typeof BenchmarkBundle>

  function groupKey(input: { workflow: ProbabilisticRollout.Workflow; artifactKind: ProbabilisticRollout.ArtifactKind }) {
    return `${input.workflow}:${input.artifactKind}`
  }

  function ratio(numerator: number, denominator: number) {
    if (denominator === 0) return null
    return Number((numerator / denominator).toFixed(4))
  }

  function monotonicRates(bins: CalibrationBin[]) {
    let floor = 0
    return bins.map((bin) => {
      const next = Math.max(floor, bin.smoothedRate)
      floor = next
      return {
        ...bin,
        smoothedRate: Number(next.toFixed(4)),
      }
    })
  }

  function trainingRecords(items: ProbabilisticRollout.ReplayItem[], labels: ProbabilisticRollout.Label[]) {
    const itemMap = new Map(items.map((item) => [item.artifactID, item]))
    return ProbabilisticRollout.calibrationRecords(items, labels).flatMap((record) => {
      const item = itemMap.get(record.artifactID)
      if (!item) return []
      return [{
        ...record,
        createdAt: item.createdAt,
      }] satisfies TrainingRecord[]
    })
  }

  function buildBins(records: TrainingRecord[], globalPrior: number, input: {
    requestedBinCount: number
    minBinCount: number
    laplaceAlpha: number
  }) {
    if (records.length === 0) return []
    const maxBinsByCount = Math.max(1, Math.floor(records.length / input.minBinCount) || 1)
    const actualBinCount = Math.max(1, Math.min(input.requestedBinCount, maxBinsByCount, records.length))
    const chunkSize = Math.max(input.minBinCount, Math.ceil(records.length / actualBinCount))
    const sorted = [...records].sort((a, b) => a.confidence - b.confidence)
    const bins: CalibrationBin[] = []

    for (let startIndex = 0; startIndex < sorted.length; startIndex += chunkSize) {
      const chunk = sorted.slice(startIndex, Math.min(sorted.length, startIndex + chunkSize))
      if (chunk.length === 0) continue
      const positives = chunk.filter((record) => record.actualPositive).length
      const negatives = chunk.length - positives
      const empiricalRate = ratio(positives, chunk.length)
      const avgBaselineConfidence = Number(
        (chunk.reduce((sum, record) => sum + record.confidence, 0) / chunk.length).toFixed(4),
      )
      const smoothedRate = Number(
        (((positives + input.laplaceAlpha * globalPrior) / (chunk.length + input.laplaceAlpha))).toFixed(4),
      )

      bins.push({
        start: Number(chunk[0]!.confidence.toFixed(4)),
        end: Number(chunk[chunk.length - 1]!.confidence.toFixed(4)),
        count: chunk.length,
        positives,
        negatives,
        avgBaselineConfidence,
        empiricalRate,
        smoothedRate,
      })
    }

    return monotonicRates(bins)
  }

  function groupModel(records: TrainingRecord[], globalPrior: number, input: {
    requestedBinCount: number
    minBinCount: number
    laplaceAlpha: number
  }): GroupModel {
    const first = records[0]
    if (!first) {
      throw new Error("Cannot build group model from empty records")
    }
    const positives = records.filter((record) => record.actualPositive).length
    const negatives = records.length - positives
    return {
      workflow: first.workflow,
      artifactKind: first.artifactKind,
      totalCount: records.length,
      positives,
      negatives,
      prior: ratio(positives, records.length) ?? globalPrior,
      bins: buildBins(records, globalPrior, input),
    }
  }

  function globalPrior(records: TrainingRecord[]) {
    if (records.length === 0) return 0.5
    return ratio(records.filter((record) => record.actualPositive).length, records.length) ?? 0.5
  }

  function predictionConfidence(item: ProbabilisticRollout.ReplayItem, model: ModelFile) {
    const baselineConfidence = item.baseline.confidence
    if (typeof baselineConfidence !== "number") return null
    const group = model.groups.find((candidate) => candidate.workflow === item.workflow && candidate.artifactKind === item.artifactKind)
    if (!group || group.bins.length === 0) return model.globalPrior

    const nearest = group.bins.reduce((best, bin) => {
      const bestDistance = baselineConfidence < best.start
        ? best.start - baselineConfidence
        : baselineConfidence > best.end
          ? baselineConfidence - best.end
          : 0
      const nextDistance = baselineConfidence < bin.start
        ? bin.start - baselineConfidence
        : baselineConfidence > bin.end
          ? baselineConfidence - bin.end
          : 0
      if (nextDistance < bestDistance) return bin
      if (nextDistance > bestDistance) return best
      return bin.start < best.start ? bin : best
    })
    return nearest.smoothedRate
  }

  function assignRanks(predictions: ProbabilisticRollout.Prediction[]) {
    const next = predictions.map((prediction) => ({ ...prediction, rank: null as number | null }))
    const grouped = new Map<string, typeof next>()

    for (const prediction of next) {
      if (typeof prediction.confidence !== "number" || !prediction.workflow || !prediction.artifactKind || !prediction.sessionID) continue
      const key = `${prediction.workflow}:${prediction.artifactKind}:${prediction.sessionID}`
      const list = grouped.get(key) ?? []
      list.push(prediction)
      grouped.set(key, list)
    }

    for (const list of grouped.values()) {
      list
        .sort((a, b) => {
          const byConfidence = (b.confidence ?? -1) - (a.confidence ?? -1)
          if (byConfidence !== 0) return byConfidence
          return a.artifactID.localeCompare(b.artifactID)
        })
        .forEach((prediction, index) => {
          prediction.rank = index + 1
        })
    }

    return next
  }

  function itemSessionMap(items: ProbabilisticRollout.ReplayItem[], labels: ProbabilisticRollout.Label[]) {
    const itemMap = new Map(items.map((item) => [item.artifactID, item]))
    const bySession = new Map<string, string>()

    for (const label of labels) {
      const item = itemMap.get(label.artifactID)
      if (!item) continue
      const current = bySession.get(item.sessionID)
      if (!current || item.createdAt < current) {
        bySession.set(item.sessionID, item.createdAt)
      }
    }

    return bySession
  }

  export function train(
    items: ProbabilisticRollout.ReplayItem[],
    labels: ProbabilisticRollout.Label[],
    options?: {
      source?: string
      binCount?: number
      minBinCount?: number
      laplaceAlpha?: number
    },
  ): ModelFile {
    const requestedBinCount = Math.max(1, Math.floor(options?.binCount ?? 5))
    const minBinCount = Math.max(1, Math.floor(options?.minBinCount ?? 5))
    const laplaceAlpha = options?.laplaceAlpha ?? 2
    const records = trainingRecords(items, labels)
    const prior = globalPrior(records)
    const grouped = new Map<string, TrainingRecord[]>()

    for (const record of records) {
      const key = groupKey(record)
      const list = grouped.get(key) ?? []
      list.push(record)
      grouped.set(key, list)
    }

    return ModelFile.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-model",
      source: options?.source ?? "histogram-calibration-v1",
      trainedAt: new Date().toISOString(),
      globalPrior: prior,
      laplaceAlpha,
      requestedBinCount,
      minBinCount,
      training: {
        sessionIDs: [...new Set(records.map((record) => record.sessionID))].sort(),
        labeledItems: records.length,
        positives: records.filter((record) => record.actualPositive).length,
        negatives: records.filter((record) => !record.actualPositive).length,
      },
      groups: [...grouped.values()]
        .map((group) => groupModel(group, prior, { requestedBinCount, minBinCount, laplaceAlpha }))
        .sort((a, b) => groupKey(a).localeCompare(groupKey(b))),
    })
  }

  export function predict(items: ProbabilisticRollout.ReplayItem[], model: ModelFile): ProbabilisticRollout.PredictionFile {
    const predictions = assignRanks(items.map((item) => ({
      artifactID: item.artifactID,
      sessionID: item.sessionID,
      workflow: item.workflow,
      artifactKind: item.artifactKind,
      source: model.source,
      confidence: predictionConfidence(item, model),
      score: item.baseline.score ?? null,
      readiness: item.baseline.readiness ?? null,
      rank: null,
    } satisfies ProbabilisticRollout.Prediction)))

    return ProbabilisticRollout.PredictionFile.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-prediction-file",
      source: model.source,
      generatedAt: new Date().toISOString(),
      predictions,
    })
  }

  export function split(
    items: ProbabilisticRollout.ReplayItem[],
    labels: ProbabilisticRollout.Label[],
    ratio = 0.7,
  ): BenchmarkSplit {
    const ordered = [...itemSessionMap(items, labels).entries()].sort((a, b) => a[1].localeCompare(b[1]))
    if (ordered.length < 2) {
      throw new Error("Benchmark split requires labels from at least two sessions")
    }
    const normalizedRatio = Math.min(0.95, Math.max(0.05, ratio))
    const rawTrainCount = Math.floor(ordered.length * normalizedRatio)
    const trainCount = Math.min(ordered.length - 1, Math.max(1, rawTrainCount))

    return {
      ratio: normalizedRatio,
      trainSessionIDs: ordered.slice(0, trainCount).map(([sessionID]) => sessionID),
      evalSessionIDs: ordered.slice(trainCount).map(([sessionID]) => sessionID),
    }
  }

  export function benchmark(
    items: ProbabilisticRollout.ReplayItem[],
    labels: ProbabilisticRollout.Label[],
    options?: {
      ratio?: number
      source?: string
      binCount?: number
      minBinCount?: number
      laplaceAlpha?: number
      threshold?: number
      abstainBelow?: number
    },
  ): {
    split: BenchmarkSplit
    model: ModelFile
    predictions: ProbabilisticRollout.PredictionFile
    baselineSummary: ProbabilisticRollout.CalibrationSummary
    candidateSummary: ProbabilisticRollout.CalibrationSummary
    comparison: ProbabilisticRollout.CalibrationComparison
    bundle: BenchmarkBundle
  } {
    const nextSplit = split(items, labels, options?.ratio)
    const trainSessions = new Set(nextSplit.trainSessionIDs)
    const evalSessions = new Set(nextSplit.evalSessionIDs)
    const trainItems = items.filter((item) => trainSessions.has(item.sessionID))
    const trainLabels = labels.filter((label) => label.sessionID && trainSessions.has(label.sessionID))
    const evalItems = items.filter((item) => evalSessions.has(item.sessionID))
    const evalLabels = labels.filter((label) => label.sessionID && evalSessions.has(label.sessionID))

    const model = train(trainItems, trainLabels, {
      source: options?.source,
      binCount: options?.binCount,
      minBinCount: options?.minBinCount,
      laplaceAlpha: options?.laplaceAlpha,
    })
    const predictions = predict(evalItems, model)
    const baselineSummary = ProbabilisticRollout.summarizeCalibration(evalItems, evalLabels, {
      threshold: options?.threshold,
      abstainBelow: options?.abstainBelow,
      source: "baseline",
    })
    const candidateSummary = ProbabilisticRollout.summarizeCalibration(evalItems, evalLabels, {
      threshold: options?.threshold,
      abstainBelow: options?.abstainBelow,
      predictions: predictions.predictions,
      source: predictions.source,
    })
    const comparison = ProbabilisticRollout.compareCalibrationSummaries(baselineSummary, candidateSummary)
    const bundle = BenchmarkBundle.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-benchmark-bundle",
      split: nextSplit,
      model,
      baselineSummary,
      candidateSummary,
      comparison,
    })

    return { split: nextSplit, model, predictions, baselineSummary, candidateSummary, comparison, bundle }
  }

  export function renderBenchmarkReport(bundle: BenchmarkBundle) {
    const lines: string[] = []
    lines.push("## ax-code quality benchmark")
    lines.push("")
    lines.push(`- split ratio: ${bundle.split.ratio}`)
    lines.push(`- train sessions: ${bundle.split.trainSessionIDs.length}`)
    lines.push(`- eval sessions: ${bundle.split.evalSessionIDs.length}`)
    lines.push(`- model source: ${bundle.model.source}`)
    lines.push(`- labeled training items: ${bundle.model.training.labeledItems}`)
    lines.push(`- overall status: ${bundle.comparison.overallStatus}`)
    lines.push("")
    lines.push(ProbabilisticRollout.renderCalibrationComparisonReport(bundle.comparison).trim())
    lines.push("")
    return lines.join("\n")
  }
}
