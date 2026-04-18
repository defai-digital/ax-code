import { describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  renderTuiRendererEvaluationSummary,
  resolveTuiRendererEvaluationArtifacts,
  runTuiRendererEvaluation,
} from "../../script/tui-renderer-evaluate"
import { TUI_PERFORMANCE_CRITERIA, TUI_PERFORMANCE_CRITERIA_VERSION } from "../../src/cli/cmd/tui/performance-criteria"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "../../src/cli/cmd/tui/renderer-contract"
import { TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA } from "../../src/cli/cmd/tui/renderer-parity"

const PACKAGE_ROOT = path.resolve(import.meta.dir, "../..")
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "../..")

function metricFor(criterionID: string): "p95Ms" | "minFps" {
  const criterion = TUI_PERFORMANCE_CRITERIA.find((item) => item.id === criterionID)
  if (!criterion) throw new Error(`Missing test criterion ${criterionID}`)
  return criterion.target.minFps === undefined ? "p95Ms" : "minFps"
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

describe("script.tui-renderer-evaluate", () => {
  test("writes a self-contained phase5 artifact bundle from provided reports", async () => {
    await using tmp = await tmpdir()
    const benchmarkPath = path.join(tmp.path, "benchmark.json")
    const contractPath = path.join(tmp.path, "contract.json")
    await writeFile(benchmarkPath, JSON.stringify(passingBenchmarkReport()))
    await writeFile(contractPath, JSON.stringify(contractReport()))

    const result = await runTuiRendererEvaluation({
      artifactDir: path.join(tmp.path, "artifacts"),
      benchmarkReportPath: benchmarkPath,
      contractReportPath: contractPath,
      verifyContract: false,
    })

    const artifacts = resolveTuiRendererEvaluationArtifacts(path.join(tmp.path, "artifacts"))
    expect(result.manifest.decision).toMatchObject({ action: "promote-native-default", ready: true })
    expect(result.benchmarkGenerated).toBe(false)
    expect(result.contractGenerated).toBe(false)
    expect(JSON.parse(await readFile(artifacts.benchmarkReportPath, "utf8"))).toMatchObject({
      metadata: { renderer: { name: "native" } },
    })
    expect(JSON.parse(await readFile(artifacts.contractReportPath, "utf8"))).toEqual(contractReport())
    expect(renderTuiRendererEvaluationSummary(result)).toContain("action: promote-native-default")
  })

  test("bootstraps a repository-backed contract report when evidence is not provided", async () => {
    await using tmp = await tmpdir()
    const benchmarkPath = path.join(tmp.path, "benchmark.json")
    await writeFile(benchmarkPath, JSON.stringify(passingBenchmarkReport()))

    const result = await runTuiRendererEvaluation({
      artifactDir: path.join(tmp.path, "artifacts"),
      benchmarkReportPath: benchmarkPath,
      verifyContract: false,
    })

    expect(result.manifest.decision).toMatchObject({ action: "promote-native-default", ready: true })
    expect(result.contractGenerated).toBe(true)
    expect(JSON.parse(await readFile(result.artifacts.contractReportPath, "utf8"))).toMatchObject({
      version: TUI_RENDERER_CONTRACT_VERSION,
    })
    expect(JSON.parse(await readFile(result.artifacts.contractTemplatePath, "utf8"))).toMatchObject({
      version: TUI_RENDERER_CONTRACT_VERSION,
    })
  })

  test("rejects product documentation paths for generated artifacts", () => {
    expect(() =>
      resolveTuiRendererEvaluationArtifacts(path.join(WORKSPACE_ROOT, "docs", "tui-renderer-phase5")),
    ).toThrow("TUI benchmark reports must be written to temp or CI artifact paths")
  })
})
