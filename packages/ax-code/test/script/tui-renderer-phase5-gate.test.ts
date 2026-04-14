import { describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  resolveTuiRendererPhase5Artifacts,
  runTuiRendererPhase5Gate,
} from "../../script/tui-renderer-phase5-gate"
import { TUI_PERFORMANCE_CRITERIA, TUI_PERFORMANCE_CRITERIA_VERSION } from "../../src/cli/cmd/tui/performance-criteria"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "../../src/cli/cmd/tui/renderer-contract"
import { TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA } from "../../src/cli/cmd/tui/renderer-parity"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "../..")

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

function contractReport(status: "passed" | "failed" = "passed") {
  return {
    version: TUI_RENDERER_CONTRACT_VERSION,
    statuses: TUI_RENDERER_CONTRACT.map((item) => ({
      id: item.id,
      status,
      evidence: status === "passed" ? [`test:${item.id}`] : undefined,
    })),
  }
}

async function writeInputs(dir: string, input: { contractStatus?: "passed" | "failed" } = {}) {
  const benchmarkPath = path.join(dir, "benchmark.json")
  const contractPath = path.join(dir, "contract.json")
  await writeFile(benchmarkPath, JSON.stringify(passingBenchmarkReport()))
  await writeFile(contractPath, JSON.stringify(contractReport(input.contractStatus)))
  return { benchmarkPath, contractPath }
}

describe("script.tui-renderer-phase5-gate", () => {
  test("writes a native parity decision and manifest for release artifacts", async () => {
    await using tmp = await tmpdir()
    const artifactsDir = path.join(tmp.path, "artifacts")
    const { benchmarkPath, contractPath } = await writeInputs(tmp.path)

    const manifest = await runTuiRendererPhase5Gate({
      benchmarkReportPath: benchmarkPath,
      contractReportPath: contractPath,
      artifactDir: artifactsDir,
      generatedAt: "2026-04-14T00:00:00.000Z",
    })
    const artifacts = resolveTuiRendererPhase5Artifacts(artifactsDir)

    expect(manifest).toMatchObject({
      version: 1,
      generatedAt: "2026-04-14T00:00:00.000Z",
      renderer: "native",
      opentuiFallbackRetained: true,
      decision: { action: "promote-native-default", ready: true },
    })
    expect(JSON.parse(await readFile(artifacts.decisionPath, "utf8"))).toEqual(manifest.decision)
    expect(JSON.parse(await readFile(artifacts.manifestPath, "utf8"))).toEqual(manifest)
  })

  test("keeps native flagged when contract evidence is not ready", async () => {
    await using tmp = await tmpdir()
    const { benchmarkPath, contractPath } = await writeInputs(tmp.path, { contractStatus: "failed" })

    const manifest = await runTuiRendererPhase5Gate({
      benchmarkReportPath: benchmarkPath,
      contractReportPath: contractPath,
      artifactDir: path.join(tmp.path, "artifacts"),
    })

    expect(manifest.decision).toMatchObject({ action: "keep-native-flagged", ready: false })
  })

  test("rejects product documentation paths for generated artifacts", () => {
    expect(() => resolveTuiRendererPhase5Artifacts(path.join(WORKSPACE_ROOT, "docs", "tui-phase5"))).toThrow(
      "TUI benchmark reports must be written to temp or CI artifact paths",
    )
  })
})
