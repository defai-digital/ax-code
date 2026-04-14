import { describe, expect, test } from "bun:test"
import {
  assertTuiBenchmarkOutputPath,
  createTuiBenchmarkReport,
  createTuiBenchmarkPlan,
  evaluateTuiBenchmarkResults,
  tuiBenchmarkCommand,
  tuiBenchmarkFlag,
  tuiBenchmarkValue,
  type TuiBenchmarkResult,
  writeTuiBenchmarkReport,
} from "../../script/tui-benchmark"
import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "../..")

describe("script.tui-benchmark", () => {
  test("creates a benchmark plan from the TUI criteria", () => {
    const plan = createTuiBenchmarkPlan({ command: ["bun", "run", "src/index.ts"], repeat: 2, timeoutMs: 1234 })

    expect(plan.map((item) => item.criterionID)).toEqual([
      "startup.first-frame",
      "input.keypress-echo",
      "input.paste-echo",
      "terminal.resize-stability",
      "mouse.click-release",
      "selection.drag-stability",
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
    expect(plan[2]).toMatchObject({ probe: "pty-paste-echo", inputSequence: "axpaste" })
    expect(plan[3]).toMatchObject({ probe: "pty-resize-stability" })
    expect(plan[4]).toMatchObject({ probe: "pty-mouse-click-release" })
    expect(plan[5]).toMatchObject({ probe: "pty-selection-drag-stability" })
  })

  test("records native renderer metadata in benchmark plans and reports", async () => {
    const plan = createTuiBenchmarkPlan({ renderer: "native" })
    const report = await createTuiBenchmarkReport({
      generatedAt: "2026-04-13T00:00:00.000Z",
      renderer: "native",
      results: [],
      verdict: { ok: true, failures: [], notes: [] },
    })

    expect(plan.every((item) => item.renderer === "native")).toBe(true)
    expect(report.metadata.renderer.name).toBe("native")
    expect(report.metadata.renderer.coreVersion).toBe("workspace:*")
    expect(report.metadata.renderer.solidVersion).toBeUndefined()
  })

  test("rejects empty benchmark plans from invalid repeat or timeout values", () => {
    expect(() => createTuiBenchmarkPlan({ repeat: 0 })).toThrow("repeat must be a positive integer")
    expect(() => createTuiBenchmarkPlan({ timeoutMs: Number.NaN })).toThrow("timeoutMs must be a positive integer")
  })

  test("does not parse benchmark flags from the command after --", () => {
    const argv = [
      "--renderer",
      "native",
      "--run",
      "--",
      "ax-code",
      "--renderer",
      "opentui",
      "--output",
      "/tmp/wrong.json",
    ]

    expect(tuiBenchmarkValue("--renderer", argv)).toBe("native")
    expect(tuiBenchmarkValue("--output", argv)).toBeUndefined()
    expect(tuiBenchmarkFlag("--run", argv)).toBe(true)
    expect(tuiBenchmarkCommand(argv)).toEqual(["ax-code", "--renderer", "opentui", "--output", "/tmp/wrong.json"])
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
      metadata: {
        generatedAt: "2026-04-13T00:00:00.000Z",
        os: { platform: "darwin" as const, release: "test", arch: "arm64" },
        runtime: { bun: "test", node: "v0.0.0" },
        terminal: {},
        renderer: { name: "opentui" as const, coreVersion: "test", solidVersion: "test" },
      },
      results: [] as TuiBenchmarkResult[],
      verdict: { ok: true, failures: [], notes: [] },
    }

    await writeTuiBenchmarkReport(output, report)

    expect(JSON.parse(await readFile(output, "utf8"))).toEqual(report)
  })

  test("creates benchmark reports with environment metadata", async () => {
    const report = await createTuiBenchmarkReport({
      generatedAt: "2026-04-13T00:00:00.000Z",
      command: ["ax-code", "--debug"],
      results: [],
      verdict: { ok: true, failures: [], notes: [] },
    })

    expect(report.version).toBe("2026-04-13")
    expect(report.metadata.command).toEqual(["ax-code", "--debug"])
    expect(report.metadata.renderer.name).toBe("opentui")
    expect(report.metadata.renderer.coreVersion).toBeTruthy()
    expect(report.metadata.os.platform).toBe(process.platform)
    expect(report.metadata.runtime.node).toBe(process.version)
  })

  test("rejects benchmark reports in product documentation paths", () => {
    expect(() => assertTuiBenchmarkOutputPath(path.resolve(process.cwd(), "docs", "tui-benchmark.json"))).toThrow(
      "TUI benchmark reports must be written to temp or CI artifact paths",
    )
    expect(() => assertTuiBenchmarkOutputPath(path.join(WORKSPACE_ROOT, "docs", "tui-benchmark.json"))).toThrow(
      "TUI benchmark reports must be written to temp or CI artifact paths",
    )
    expect(() => assertTuiBenchmarkOutputPath(path.join(PACKAGE_ROOT, "TODOS", "tui-benchmark.json"))).toThrow(
      "TUI benchmark reports must be written to temp or CI artifact paths",
    )
  })
})
