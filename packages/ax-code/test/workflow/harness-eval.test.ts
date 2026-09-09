import { expect, test } from "vitest"
import { HarnessEval } from "../../src/workflow/harness-eval"
const run = (arm: string, extra: Partial<HarnessEval.Run> = {}): HarnessEval.Run => ({
  taskID: "fix",
  arm,
  model: "same/model",
  cohort: "fixture-config-oracle-revision",
  repetition: 0,
  outcome: "completed",
  verified: true,
  elapsedMs: 100,
  ...extra,
})

test("keeps failures in quality denominators and reports paired-success latency separately", () => {
  const runs = [
    run("a"),
    run("b", { elapsedMs: 50 }),
    run("a", { repetition: 1, outcome: "failed", verified: false }),
    run("b", { repetition: 1, outcome: "timeout", verified: false }),
    run("a", { repetition: 2, verified: false }),
    run("b", { repetition: 2 }),
  ]
  const report = HarnessEval.compare(runs, "a", "b")
  expect(report.baseline).toMatchObject({
    count: 3,
    verifiedCount: 1,
    successRate: 1 / 3,
    failures: { failed: 1, completed_unverified: 1 },
    successfulElapsedP95Ms: null,
  })
  expect(report.candidate.successRate).toBe(2 / 3)
  expect(report.pairedVerifiedCount).toBe(1)
  expect(report.medianCandidateOverBaselineElapsedRatio).toBe(0.5)
  expect(HarnessEval.compare([...runs].reverse(), "a", "b")).toEqual(report)
})

test("rejects missing pairs, mixed cohorts, duplicate records and unknown arms", () => {
  for (const runs of [
    [],
    [run("a")],
    [run("a"), run("b", { cohort: "different" })],
    [run("a"), run("b"), run("a")],
    [run("a"), run("c")],
  ])
    expect(() => HarnessEval.compare(runs, "a", "b")).toThrow()
  expect(() => HarnessEval.compare([run("a"), run("b")], "a", "a")).toThrow()
})

test("validates outcomes and metrics and avoids invented quantiles with no successes", () => {
  for (const item of [
    run("a", { elapsedMs: Infinity }),
    run("a", { toolCalls: -1 }),
    run("a", { outcome: "failed", verified: true }),
  ])
    expect(HarnessEval.Run.safeParse(item).success).toBe(false)
  const report = HarnessEval.compare(
    [run("a", { outcome: "cancelled", verified: false }), run("b", { outcome: "timeout", verified: false })],
    "a",
    "b",
  )
  expect(report.baseline.successfulElapsedMedianMs).toBeNull()
  expect(report.medianCandidateOverBaselineElapsedRatio).toBeNull()
  const zero = HarnessEval.compare([run("a", { elapsedMs: 0 }), run("b")], "a", "b")
  expect(zero.pairedVerifiedCount).toBe(1)
  expect(zero.ratioSampleCount).toBe(0)
})

test("only reports the descriptive nearest-rank p95 once enough verified observations exist", () => {
  const runs = Array.from({ length: 20 }, (_, repetition) => [
    run("a", { repetition, elapsedMs: repetition + 1 }),
    run("b", { repetition }),
  ]).flat()
  expect(HarnessEval.compare(runs, "a", "b").baseline.successfulElapsedP95Ms).toBe(19)
})

test("does not pool a p95 across different tasks and reads streaming capture records", () => {
  const runs = Array.from({ length: 20 }, (_, repetition) => [
    run("a", { repetition, taskID: `task_${repetition}` }),
    run("b", { repetition, taskID: `task_${repetition}` }),
  ]).flat()
  expect(HarnessEval.compare(runs, "a", "b").baseline.successfulElapsedP95Ms).toBeNull()
  const captured = runs
    .map((run) => JSON.stringify({ type: "run", run }))
    .concat(JSON.stringify({ type: "comparison", comparison: null, incomplete: false }))
    .join("\n")
  expect(HarnessEval.records(captured)).toEqual(runs)
  expect(() => HarnessEval.records('{"type":"unknown"}')).toThrow()
})
