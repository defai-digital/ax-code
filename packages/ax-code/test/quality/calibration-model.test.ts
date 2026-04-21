import { describe, expect, test } from "bun:test"
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

function label(input: {
  labelID: string
  artifactID: string
  sessionID: string
  outcome: "accepted" | "dismissed"
}) {
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
})
