import z from "zod"
import { ProbabilisticRollout } from "./probabilistic-rollout"
import { uniqueSortedStrings } from "@/util/string-list"
import { finiteOption, ratio } from "./coerce"

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
    laplaceAlpha: z.number().nonnegative(),
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

  function groupKey(input: {
    workflow: ProbabilisticRollout.Workflow
    artifactKind: ProbabilisticRollout.ArtifactKind
  }) {
    return `${input.workflow}:${input.artifactKind}`
  }

  // Count-weighted pool-adjacent-violators. A prefix max would lift every
  // higher bin to one noisy low-confidence spike; pooling pulls the violating
  // neighbours to their weighted mean instead.
  function monotonicRates(bins: CalibrationBin[]) {
    const blocks: Array<{ rate: number; weight: number; size: number }> = []
    for (const bin of bins) {
      blocks.push({ rate: bin.smoothedRate, weight: bin.count, size: 1 })
      while (blocks.length > 1 && blocks[blocks.length - 2]!.rate > blocks[blocks.length - 1]!.rate) {
        const right = blocks.pop()!
        const left = blocks.pop()!
        const weight = left.weight + right.weight
        blocks.push({
          rate: (left.rate * left.weight + right.rate * right.weight) / weight,
          weight,
          size: left.size + right.size,
        })
      }
    }
    const rates = blocks.flatMap((block) => Array.from({ length: block.size }, () => block.rate))
    return bins.map((bin, index) => ({
      ...bin,
      smoothedRate: Number(rates[index]!.toFixed(4)),
    }))
  }

  function trainingRecords(items: ProbabilisticRollout.ReplayItem[], labels: ProbabilisticRollout.Label[]) {
    const itemMap = new Map(items.map((item) => [item.artifactID, item]))
    return ProbabilisticRollout.calibrationRecords(items, labels).flatMap((record) => {
      const item = itemMap.get(record.artifactID)
      if (!item) return []
      return [
        {
          ...record,
          createdAt: item.createdAt,
        },
      ] satisfies TrainingRecord[]
    })
  }

  // Bin edges are stored at four decimals; grouping and lookup use the same resolution.
  function edge(confidence: number) {
    return Number(confidence.toFixed(4))
  }

  function buildBins(
    records: TrainingRecord[],
    globalPrior: number,
    input: {
      requestedBinCount: number
      minBinCount: number
      laplaceAlpha: number
    },
  ) {
    if (records.length === 0) return []
    const maxBinsByCount = Math.max(1, Math.floor(records.length / input.minBinCount) || 1)
    const actualBinCount = Math.max(1, Math.min(input.requestedBinCount, maxBinsByCount, records.length))
    const sorted = [...records].sort((a, b) => a.confidence - b.confidence)
    const bins: CalibrationBin[] = []
    const baseSize = Math.floor(sorted.length / actualBinCount)
    const remainder = sorted.length % actualBinCount
    let startIndex = 0

    for (let binIndex = 0; binIndex < actualBinCount && startIndex < sorted.length; binIndex++) {
      // Spread the remainder over the first bins so every bin keeps at least
      // floor(n / bins) records, which is >= minBinCount by construction.
      const size = baseSize + (binIndex < remainder ? 1 : 0)
      let endIndex = Math.min(sorted.length, startIndex + size)
      // Never split a run of identical confidences across bins: the split would
      // follow training order, and lookup could not tell the bins apart.
      // Compare at the stored edge resolution so two bins never share edges.
      while (endIndex < sorted.length && edge(sorted[endIndex]!.confidence) === edge(sorted[endIndex - 1]!.confidence))
        endIndex++
      // Fold a short tail left behind by tie extension into this bin.
      if (binIndex === actualBinCount - 1 || sorted.length - endIndex < input.minBinCount) endIndex = sorted.length
      const chunk = sorted.slice(startIndex, endIndex)
      startIndex = endIndex
      if (chunk.length === 0) continue
      const positives = chunk.filter((record) => record.actualPositive).length
      const negatives = chunk.length - positives
      const empiricalRate = ratio(positives, chunk.length)
      const avgBaselineConfidence = Number(
        (chunk.reduce((sum, record) => sum + record.confidence, 0) / chunk.length).toFixed(4),
      )
      const smoothedRate = Number(
        ((positives + input.laplaceAlpha * globalPrior) / (chunk.length + input.laplaceAlpha)).toFixed(4),
      )

      bins.push({
        start: edge(chunk[0]!.confidence),
        end: edge(chunk[chunk.length - 1]!.confidence),
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

  function groupModel(
    records: TrainingRecord[],
    globalPrior: number,
    input: {
      requestedBinCount: number
      minBinCount: number
      laplaceAlpha: number
    },
  ): GroupModel {
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
    const rawConfidence = item.baseline.confidence
    // NaN compares false against every edge and would land "inside" every bin.
    if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence)) return null
    const baselineConfidence = edge(rawConfidence)
    const group = model.groups.find(
      (candidate) => candidate.workflow === item.workflow && candidate.artifactKind === item.artifactKind,
    )
    if (!group || group.bins.length === 0) return model.globalPrior

    // Equal-count bins can split a run of identical confidences, so several
    // bins may contain the value. Pool them by count instead of picking the
    // lowest one, which would depend on training order.
    const containing = group.bins.filter((bin) => baselineConfidence >= bin.start && baselineConfidence <= bin.end)
    const total = containing.reduce((sum, bin) => sum + bin.count, 0)
    if (containing.length > 1 && total > 0) {
      return Number((containing.reduce((sum, bin) => sum + bin.smoothedRate * bin.count, 0) / total).toFixed(4))
    }

    const nearest = group.bins.reduce((best, bin) => {
      const bestDistance =
        baselineConfidence < best.start
          ? best.start - baselineConfidence
          : baselineConfidence > best.end
            ? baselineConfidence - best.end
            : 0
      const nextDistance =
        baselineConfidence < bin.start
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
      if (
        typeof prediction.confidence !== "number" ||
        !prediction.workflow ||
        !prediction.artifactKind ||
        !prediction.sessionID
      )
        continue
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
    const requestedBinCount = Math.max(1, Math.floor(finiteOption(options?.binCount, 5)))
    const minBinCount = Math.max(1, Math.floor(finiteOption(options?.minBinCount, 5)))
    const laplaceAlpha = Math.max(0, finiteOption(options?.laplaceAlpha, 2))
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
        sessionIDs: uniqueSortedStrings(records.map((record) => record.sessionID)),
        labeledItems: records.length,
        positives: records.filter((record) => record.actualPositive).length,
        negatives: records.filter((record) => !record.actualPositive).length,
      },
      groups: [...grouped.values()]
        .map((group) => groupModel(group, prior, { requestedBinCount, minBinCount, laplaceAlpha }))
        .sort((a, b) => groupKey(a).localeCompare(groupKey(b))),
    })
  }

  export function predict(
    items: ProbabilisticRollout.ReplayItem[],
    model: ModelFile,
  ): ProbabilisticRollout.PredictionFile {
    const predictions = assignRanks(
      items.map(
        (item) =>
          ({
            artifactID: item.artifactID,
            sessionID: item.sessionID,
            workflow: item.workflow,
            artifactKind: item.artifactKind,
            source: model.source,
            confidence: predictionConfidence(item, model),
            score: item.baseline.score ?? null,
            readiness: item.baseline.readiness ?? null,
            rank: null,
          }) satisfies ProbabilisticRollout.Prediction,
      ),
    )

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
    const normalizedRatio = Math.min(0.95, Math.max(0.05, finiteOption(ratio, 0.7)))
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
    // Labels may omit the optional sessionID; their item still identifies the
    // session used by the split, so partition by that instead of dropping them.
    const itemSessionByArtifactID = new Map(items.map((item) => [item.artifactID, item.sessionID]))
    const labelSessionID = (label: ProbabilisticRollout.Label) =>
      itemSessionByArtifactID.get(label.artifactID) ?? label.sessionID
    const trainItems = items.filter((item) => trainSessions.has(item.sessionID))
    const trainLabels = labels.filter((label) => {
      const sessionID = labelSessionID(label)
      return sessionID !== undefined && trainSessions.has(sessionID)
    })
    const evalItems = items.filter((item) => evalSessions.has(item.sessionID))
    const evalLabels = labels.filter((label) => {
      const sessionID = labelSessionID(label)
      return sessionID !== undefined && evalSessions.has(sessionID)
    })

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
