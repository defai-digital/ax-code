import { describe, expect, test } from "bun:test"
import {
  createTuiBenchmarkPlan,
  evaluateTuiBenchmarkResults,
  type TuiBenchmarkResult,
  writeTuiBenchmarkReport,
} from "../../script/tui-benchmark"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

describe("script.tui-benchmark", () => {
  test("creates a benchmark plan from the TUI criteria", () => {
    const plan = createTuiBenchmarkPlan({ command: ["bun", "run", "src/index.ts"], repeat: 2, timeoutMs: 1234 })

    expect(plan.map((item) => item.criterionID)).toEqual([
      "startup.first-frame",
      "input.keypress-echo",
      "transcript.large-append",
      "scroll.long-cjk-wrapped",
    ])
    expect(plan[0]).toMatchObject({
      probe: "pty-first-frame",
      metric: "p95Ms",
      repeat: 2,
      timeoutMs: 1234,
      command: ["bun", "run", "src/index.ts"],
    })
    expect(plan[1]?.inputSequence).toBe("axbench")
  })

  test("evaluates p95 and fps thresholds", () => {
    const results: TuiBenchmarkResult[] = [
      { id: "startup", criterionID: "startup.first-frame", metric: "p95Ms", value: 1201 },
      { id: "input", criterionID: "input.keypress-echo", metric: "p95Ms", value: 50 },
      { id: "scroll", criterionID: "scroll.long-cjk-wrapped", metric: "minFps", value: 44 },
      { id: "transcript", criterionID: "transcript.large-append", metric: "p95Ms", skipped: "manual fixture" },
    ]

    const verdict = evaluateTuiBenchmarkResults(results)

    expect(verdict.ok).toBe(false)
    expect(verdict.failures).toEqual(["startup: p95 1201.0ms exceeds 1200ms", "scroll: 44.0fps is below 45fps"])
    expect(verdict.notes).toEqual(["transcript: skipped: manual fixture"])
  })

  test("writes benchmark reports to an artifact path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ax-code-tui-benchmark-"))
    const output = path.join(dir, "reports", "tui.json")
    const report = {
      version: "test",
      results: [] as TuiBenchmarkResult[],
      verdict: { ok: true, failures: [], notes: [] },
    }

    await writeTuiBenchmarkReport(output, report)

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report)
  })
})
