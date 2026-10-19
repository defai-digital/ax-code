import { describe, expect, test } from "vitest"
import { QualityCalibrationModel } from "../../src/quality/calibration-model"
import { ProbabilisticRollout } from "../../src/quality/probabilistic-rollout"

function replayItem(input: {
  artifactID: string
  sessionID: string
  createdAt: string
  confidence: number
  title?: string
}) {
  return {
    schemaVersion: 1,
    kind: "ax-code-quality-replay-item",
    workflow: "review",
    artifactKind: "review_finding",
    artifactID: input.artifactID,
    sessionID: input.sessionID,
    projectID: "proj_1",
    title: input.title ?? input.artifactID,
    createdAt: input.createdAt,
    baseline: {
      source: "Risk.assess",
      confidence: input.confidence,
      score: Math.round(input.confidence * 100),
      readiness: "ready",
      rank: null,
    },
    context: {
      directory: "/repo",
      graphCommitSha: "abc123",
      touchedFiles: ["src/a.ts"],
      diffSummary: { files: 1, additions: 1, deletions: 0 },
      eventCount: 1,
      toolCount: 1,
    },
    evidence: {
      toolSummaries: [],
    },
  } satisfies ProbabilisticRollout.ReplayItem
}

function label(input: { labelID: string; artifactID: string; sessionID: string; outcome: "accepted" | "dismissed" }) {
  return {
    labelID: input.labelID,
    artifactID: input.artifactID,
    artifactKind: "review_finding",
    workflow: "review",
    projectID: "proj_1",
    sessionID: input.sessionID,
    labeledAt: "2026-04-20T00:00:00.000Z",
    labelSource: "human",
    labelVersion: 1,
    outcome: input.outcome,
  } satisfies ProbabilisticRollout.Label
}

describe("QualityCalibrationModel", () => {
  test("pools bins that split a run of identical confidences instead of depending on training order", () => {
    const outcomes = ["dismissed", "dismissed", "accepted", "accepted"] as const
    const build = (order: readonly ("accepted" | "dismissed")[]) => {
      const items = order.map((_, index) =>
        replayItem({
          artifactID: `tie_${index}`,
          sessionID: `ses_${index % 2}`,
          createdAt: `2026-04-20T00:00:0${index}.000Z`,
          confidence: 0.8,
        }),
      )
      const labels = order.map((outcome, index) =>
        label({ labelID: `lbl_${index}`, artifactID: `tie_${index}`, sessionID: `ses_${index % 2}`, outcome }),
      )
      const model = QualityCalibrationModel.train(items, labels, { binCount: 2, minBinCount: 1, laplaceAlpha: 2 })
      expect(model.groups[0]?.bins).toHaveLength(1)
      return QualityCalibrationModel.predict([items[0]!], model).predictions[0]?.confidence
    }

    const forward = build(outcomes)
    const reversed = build([...outcomes].reverse())
    expect(forward).toBe(reversed)
    expect(forward).toBeCloseTo(0.5, 2)
  })

  test("pools a low-confidence spike down instead of lifting higher bins to it", () => {
    const rows = [
      { confidence: 0.1, outcome: "accepted" },
      { confidence: 0.2, outcome: "accepted" },
      { confidence: 0.7, outcome: "dismissed" },
      { confidence: 0.75, outcome: "dismissed" },
      { confidence: 0.8, outcome: "dismissed" },
      { confidence: 0.85, outcome: "dismissed" },
      { confidence: 0.9, outcome: "accepted" },
      { confidence: 0.95, outcome: "dismissed" },
    ] as const
    const items = rows.map((row, index) =>
      replayItem({
        artifactID: `pav_${index}`,
        sessionID: `ses_${index % 2}`,
        createdAt: `2026-04-20T00:00:0${index}.000Z`,
        confidence: row.confidence,
      }),
    )
    const labels = rows.map((row, index) =>
      label({
        labelID: `lbl_${index}`,
        artifactID: `pav_${index}`,
        sessionID: `ses_${index % 2}`,
        outcome: row.outcome,
      }),
    )
    const bins = QualityCalibrationModel.train(items, labels, { binCount: 4, minBinCount: 2, laplaceAlpha: 1 })
      .groups[0]!.bins
    const rates = bins.map((bin) => bin.smoothedRate)
    for (let index = 1; index < rates.length; index++) expect(rates[index]!).toBeGreaterThanOrEqual(rates[index - 1]!)
    // Prefix max pins every bin to the 2/2 low-confidence spike (0.7917); pooling
    // pulls the spike down and leaves the top bin at its own 1/2 evidence.
    expect(rates[0]!).toBeLessThan(0.5)
    expect(rates[rates.length - 1]!).toBeCloseTo(0.4583, 4)
  })

  test("keeps confidences that share a stored bin edge in one bin", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => ({ confidence: 0.5, outcome: "dismissed" as const })),
      ...Array.from({ length: 5 }, () => ({ confidence: 0.50001, outcome: "accepted" as const })),
    ]
    const items = rows.map((row, index) =>
      replayItem({
        artifactID: `edge_${index}`,
        sessionID: `ses_${index % 2}`,
        createdAt: `2026-04-20T00:00:${String(index).padStart(2, "0")}.000Z`,
        confidence: row.confidence,
      }),
    )
    const labels = rows.map((row, index) =>
      label({
        labelID: `lbl_${index}`,
        artifactID: `edge_${index}`,
        sessionID: `ses_${index % 2}`,
        outcome: row.outcome,
      }),
    )
    const model = QualityCalibrationModel.train(items, labels, { binCount: 2, minBinCount: 5, laplaceAlpha: 2 })
    expect(model.groups[0]?.bins).toHaveLength(1)
    expect(QualityCalibrationModel.predict([items[9]!], model).predictions[0]?.confidence).toBeCloseTo(0.5, 4)
  })

  test("does not pool zero-count bins into a NaN prediction", () => {
    const item = replayItem({
      artifactID: "z",
      sessionID: "ses_1",
      createdAt: "2026-04-20T00:00:00.000Z",
      confidence: 0.4,
    })
    const bin = {
      start: 0,
      end: 1,
      count: 0,
      positives: 0,
      negatives: 0,
      avgBaselineConfidence: 0.4,
      empiricalRate: null,
      smoothedRate: 0.3,
    }
    const model = QualityCalibrationModel.ModelFile.parse({
      ...QualityCalibrationModel.train(
        [item, { ...item, artifactID: "y", sessionID: "ses_2" }],
        [
          label({ labelID: "lbl_z", artifactID: "z", sessionID: "ses_1", outcome: "accepted" }),
          label({ labelID: "lbl_y", artifactID: "y", sessionID: "ses_2", outcome: "dismissed" }),
        ],
        { binCount: 1, minBinCount: 1 },
      ),
    })
    model.groups[0]!.bins = [bin, { ...bin, smoothedRate: 0.6 }]
    const confidence = QualityCalibrationModel.predict([item], model).predictions[0]?.confidence
    expect(Number.isNaN(confidence)).toBe(false)
  })

  test("abstains on a non-finite baseline confidence", () => {
    const items = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.9 }),
      replayItem({ artifactID: "b", sessionID: "ses_2", createdAt: "2026-04-20T00:01:00.000Z", confidence: 0.1 }),
    ]
    const labels = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "accepted" }),
      label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_2", outcome: "dismissed" }),
    ]
    const model = QualityCalibrationModel.train(items, labels, { binCount: 2, minBinCount: 1 })
    const nan = { ...items[0]!, baseline: { ...items[0]!.baseline, confidence: Number.NaN } }
    expect(QualityCalibrationModel.predict([nan], model).predictions[0]?.confidence).toBeNull()
  })

  test("trains a grouped calibration model and predicts ranked candidate confidences", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.9 }),
      replayItem({ artifactID: "b", sessionID: "ses_1", createdAt: "2026-04-20T00:00:01.000Z", confidence: 0.2 }),
      replayItem({ artifactID: "c", sessionID: "ses_2", createdAt: "2026-04-20T00:01:00.000Z", confidence: 0.8 }),
      replayItem({ artifactID: "d", sessionID: "ses_2", createdAt: "2026-04-20T00:01:01.000Z", confidence: 0.1 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "accepted" }),
      label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_1", outcome: "dismissed" }),
      label({ labelID: "lbl_c", artifactID: "c", sessionID: "ses_2", outcome: "accepted" }),
      label({ labelID: "lbl_d", artifactID: "d", sessionID: "ses_2", outcome: "dismissed" }),
    ]

    const model = QualityCalibrationModel.train(items, labels, {
      source: "histogram-test-v1",
      binCount: 2,
      minBinCount: 1,
      laplaceAlpha: 1,
    })

    expect(model.source).toBe("histogram-test-v1")
    expect(model.training.labeledItems).toBe(4)
    expect(model.groups).toHaveLength(1)
    expect(model.groups[0]?.bins).toHaveLength(2)

    const predictions = QualityCalibrationModel.predict(items, model)
    expect(predictions.source).toBe("histogram-test-v1")
    expect(predictions.predictions).toHaveLength(4)

    const top = predictions.predictions.find((prediction) => prediction.artifactID === "a")
    const low = predictions.predictions.find((prediction) => prediction.artifactID === "b")
    expect((top?.confidence ?? 0) > (low?.confidence ?? 1)).toBe(true)
    expect(top?.rank).toBe(1)
    expect(low?.rank).toBe(2)
  })

  test("creates a time-ordered benchmark bundle from labeled sessions", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.1 }),
      replayItem({ artifactID: "b", sessionID: "ses_2", createdAt: "2026-04-20T00:01:00.000Z", confidence: 0.9 }),
      replayItem({ artifactID: "c", sessionID: "ses_3", createdAt: "2026-04-20T00:02:00.000Z", confidence: 0.2 }),
      replayItem({ artifactID: "d", sessionID: "ses_4", createdAt: "2026-04-20T00:03:00.000Z", confidence: 0.8 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "dismissed" }),
      label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_2", outcome: "accepted" }),
      label({ labelID: "lbl_c", artifactID: "c", sessionID: "ses_3", outcome: "dismissed" }),
      label({ labelID: "lbl_d", artifactID: "d", sessionID: "ses_4", outcome: "accepted" }),
    ]

    const benchmark = QualityCalibrationModel.benchmark(items, labels, {
      ratio: 0.5,
      source: "histogram-benchmark-v1",
      binCount: 2,
      minBinCount: 1,
      laplaceAlpha: 1,
      threshold: 0.5,
    })

    expect(benchmark.split.trainSessionIDs).toEqual(["ses_1", "ses_2"])
    expect(benchmark.split.evalSessionIDs).toEqual(["ses_3", "ses_4"])
    expect(benchmark.model.source).toBe("histogram-benchmark-v1")
    expect(benchmark.predictions.predictions).toHaveLength(2)
    expect(benchmark.bundle.kind).toBe("ax-code-quality-benchmark-bundle")

    const report = QualityCalibrationModel.renderBenchmarkReport(benchmark.bundle)
    expect(report).toContain("## ax-code quality benchmark")
    expect(report).toContain("- train sessions: 2")
    expect(report).toContain("- eval sessions: 2")
  })

  test("normalizes non-finite benchmark split ratios", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.1 }),
      replayItem({ artifactID: "b", sessionID: "ses_2", createdAt: "2026-04-20T00:01:00.000Z", confidence: 0.9 }),
      replayItem({ artifactID: "c", sessionID: "ses_3", createdAt: "2026-04-20T00:02:00.000Z", confidence: 0.2 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "dismissed" }),
      label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_2", outcome: "accepted" }),
      label({ labelID: "lbl_c", artifactID: "c", sessionID: "ses_3", outcome: "dismissed" }),
    ]

    const split = QualityCalibrationModel.split(items, labels, Number.NaN)

    expect(() => QualityCalibrationModel.BenchmarkSplit.parse(split)).not.toThrow()
    expect(split.ratio).toBe(0.7)
    expect(split.trainSessionIDs.length).toBeGreaterThan(0)
    expect(split.evalSessionIDs.length).toBeGreaterThan(0)
  })

  test("normalizes non-finite training options", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.9 }),
      replayItem({ artifactID: "b", sessionID: "ses_1", createdAt: "2026-04-20T00:00:01.000Z", confidence: 0.2 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "accepted" }),
      label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_1", outcome: "dismissed" }),
    ]

    const model = QualityCalibrationModel.train(items, labels, {
      binCount: Number.NaN,
      minBinCount: Number.POSITIVE_INFINITY,
      laplaceAlpha: Number.NaN,
    })

    expect(() => QualityCalibrationModel.ModelFile.parse(model)).not.toThrow()
    expect(model.requestedBinCount).toBe(5)
    expect(model.minBinCount).toBe(5)
    expect(model.laplaceAlpha).toBe(2)
  })

  test("keeps labels that omit the optional session id in the benchmark split", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.1 }),
      replayItem({ artifactID: "b", sessionID: "ses_2", createdAt: "2026-04-20T00:01:00.000Z", confidence: 0.9 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      {
        ...label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "dismissed" }),
        sessionID: undefined,
      },
      {
        ...label({ labelID: "lbl_b", artifactID: "b", sessionID: "ses_2", outcome: "accepted" }),
        sessionID: undefined,
      },
    ]

    const benchmark = QualityCalibrationModel.benchmark(items, labels, {
      ratio: 0.5,
      binCount: 1,
      minBinCount: 1,
      laplaceAlpha: 1,
    })

    expect(benchmark.model.training.labeledItems).toBe(1)
    expect(benchmark.baselineSummary.labeledItems).toBe(1)
  })

  test("clamps a negative laplace alpha instead of crashing training", () => {
    const items: ProbabilisticRollout.ReplayItem[] = [
      replayItem({ artifactID: "a", sessionID: "ses_1", createdAt: "2026-04-20T00:00:00.000Z", confidence: 0.9 }),
    ]
    const labels: ProbabilisticRollout.Label[] = [
      label({ labelID: "lbl_a", artifactID: "a", sessionID: "ses_1", outcome: "accepted" }),
    ]

    const model = QualityCalibrationModel.train(items, labels, {
      binCount: 1,
      minBinCount: 1,
      laplaceAlpha: -1,
    })

    expect(model.laplaceAlpha).toBe(0)
    expect(() => QualityCalibrationModel.ModelFile.parse(model)).not.toThrow()
  })

  test("keeps every calibration bin at or above the minimum count", () => {
    const items: ProbabilisticRollout.ReplayItem[] = Array.from({ length: 10 }, (_, index) =>
      replayItem({
        artifactID: `item_${index}`,
        sessionID: "ses_1",
        createdAt: `2026-04-20T00:00:${String(index).padStart(2, "0")}.000Z`,
        confidence: index / 10,
      }),
    )
    const labels: ProbabilisticRollout.Label[] = items.map((item, index) =>
      label({
        labelID: `lbl_${index}`,
        artifactID: item.artifactID,
        sessionID: "ses_1",
        outcome: index % 2 === 0 ? "accepted" : "dismissed",
      }),
    )

    const model = QualityCalibrationModel.train(items, labels, { binCount: 3, minBinCount: 3 })

    expect(model.groups[0]?.bins.map((bin) => bin.count)).toEqual([4, 3, 3])
  })
})
