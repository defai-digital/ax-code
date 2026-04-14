import { describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { TUI_PERFORMANCE_CRITERIA, TUI_PERFORMANCE_CRITERIA_VERSION } from "../../src/cli/cmd/tui/performance-criteria"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "../../src/cli/cmd/tui/renderer-contract"
import { TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA } from "../../src/cli/cmd/tui/renderer-parity"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")
const SCRIPT = path.join(PACKAGE_ROOT, "script/tui-renderer-parity.ts")

function runParity(args: string[], env: Record<string, string | undefined> = {}) {
  return Bun.spawnSync({
    cmd: ["bun", "run", SCRIPT, ...args],
    cwd: PACKAGE_ROOT,
    env: { ...process.env, ...env },
  })
}

function passingBenchmarkReport() {
  return {
    version: TUI_PERFORMANCE_CRITERIA_VERSION,
    metadata: { renderer: { name: "native" } },
    results: TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA.map((criterionID) => ({
      id: `${criterionID}:probe`,
      criterionID,
      metric: metricFor(criterionID),
      value: metricFor(criterionID) === "minFps" ? 60 : 1,
    })),
    verdict: { ok: true, failures: [], notes: [] },
  }
}

function metricFor(criterionID: string): "p95Ms" | "minFps" {
  const criterion = TUI_PERFORMANCE_CRITERIA.find((item) => item.id === criterionID)
  if (!criterion) throw new Error(`Missing test criterion ${criterionID}`)
  return criterion.target.minFps === undefined ? "p95Ms" : "minFps"
}

function passingContractReport() {
  return {
    version: TUI_RENDERER_CONTRACT_VERSION,
    statuses: TUI_RENDERER_CONTRACT.map((item) => ({
      id: item.id,
      status: "passed",
      evidence: [`test:${item.id}`],
    })),
  }
}

describe("script.tui-renderer-parity", () => {
  test("writes a fail-closed contract template", async () => {
    await using tmp = await tmpdir()
    const output = path.join(tmp.path, "contract-template.json")
    const result = runParity(["--contract-template", "--output", output])
    const stdout = JSON.parse(result.stdout.toString())
    const written = JSON.parse(await readFile(output, "utf8"))

    expect(result.exitCode).toBe(0)
    expect(written).toEqual(stdout)
    expect(written.version).toBe(TUI_RENDERER_CONTRACT_VERSION)
    expect(written.statuses.every((item: { status: string }) => item.status === "failed")).toBe(true)
  })

  test("promotes native only from valid benchmark and contract files", async () => {
    await using tmp = await tmpdir()
    const benchmarkPath = path.join(tmp.path, "benchmark.json")
    const contractPath = path.join(tmp.path, "contract.json")
    const output = path.join(tmp.path, "decision.json")
    await writeFile(benchmarkPath, JSON.stringify(passingBenchmarkReport()))
    await writeFile(contractPath, JSON.stringify(passingContractReport()))

    const result = runParity([
      "--benchmark-report",
      benchmarkPath,
      "--contract",
      contractPath,
      "--renderer",
      "native",
      "--opentui-fallback-retained",
      "--output",
      output,
    ])
    const decision = JSON.parse(await readFile(output, "utf8"))

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual(decision)
    expect(decision).toMatchObject({ action: "promote-native-default", ready: true })
  })

  test("rejects invalid renderer values from the environment", async () => {
    await using tmp = await tmpdir()
    const benchmarkPath = path.join(tmp.path, "benchmark.json")
    const contractPath = path.join(tmp.path, "contract.json")
    await writeFile(benchmarkPath, JSON.stringify(passingBenchmarkReport()))
    await writeFile(contractPath, JSON.stringify(passingContractReport()))

    const result = runParity(["--benchmark-report", benchmarkPath, "--contract", contractPath], {
      AX_CODE_TUI_RENDERER: "bogus",
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("Invalid TUI renderer")
  })
})
