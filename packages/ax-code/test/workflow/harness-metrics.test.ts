import { expect, test } from "vitest"
import { harnessMetrics } from "../../src/workflow/harness-metrics"
import { HarnessEval } from "../../src/workflow/harness-eval"

const usage = {
  type: "step_finish",
  part: { id: "step1", type: "step-finish", tokens: { input: 10, output: 3, reasoning: 2, cache: { read: 5 } } },
}
const error = { type: "tool_use", part: { id: "tool1", type: "tool", state: { status: "error" } } }

test("captures split JSONL usage and deduplicates repeated part updates", () => {
  const metrics = harnessMetrics()
  const text = [usage, error, usage, error].map((event) => JSON.stringify(event)).join("\n")
  for (const chunk of Buffer.from(text)) metrics.write(Buffer.from([chunk]))
  expect(metrics.finish(true)).toEqual({
    metricsStatus: "observed",
    inputTokens: 10,
    outputTokens: 3,
    reasoningTokens: 2,
    cacheReadTokens: 5,
    toolCalls: 1,
    toolErrors: 1,
  })
})

test("withholds truncated, malformed and absent observations", () => {
  for (const bad of [
    "invalid\n",
    "x".repeat(1_000_001) + "\n",
    JSON.stringify({ ...usage, part: { ...usage.part, tokens: {} } }),
  ]) {
    const metrics = harnessMetrics()
    metrics.write(Buffer.from(JSON.stringify(usage) + "\n" + bad))
    expect(metrics.finish(true)).toEqual({ metricsStatus: "partial" })
  }
  expect(harnessMetrics().finish(true)).toEqual({ metricsStatus: "unavailable" })
  const interrupted = harnessMetrics()
  interrupted.write(Buffer.from(JSON.stringify(usage)))
  expect(interrupted.finish(false)).toEqual({ metricsStatus: "partial" })
})

test("comparison includes failures and missing metric coverage without zero filling", () => {
  const run = {
    taskID: "fix",
    model: "p/m",
    cohort: "frozen",
    repetition: 0,
    outcome: "failed",
    verified: false,
    elapsedMs: 1,
  }
  const result = HarnessEval.compare(
    [
      { ...run, arm: "a", inputTokens: 10 },
      { ...run, arm: "b" },
    ],
    "a",
    "b",
  )
  expect(result.baseline.metrics.inputTokens).toEqual({ observedCount: 1, missingCount: 0, median: 10 })
  expect(result.candidate.metrics.inputTokens).toEqual({ observedCount: 0, missingCount: 1, median: null })
  expect(result.baseline.successRate).toBe(0)
})

test("withholds conflicting duplicate updates and oversized identities", () => {
  for (const part of [
    { ...usage.part, tokens: { ...usage.part.tokens, input: 20 } },
    { ...usage.part, id: "x".repeat(301) },
  ]) {
    const metrics = harnessMetrics()
    metrics.write(Buffer.from([usage, { type: "step_finish", part }].map((value) => JSON.stringify(value)).join("\n")))
    expect(metrics.finish(true)).toEqual({ metricsStatus: "partial" })
  }
})
