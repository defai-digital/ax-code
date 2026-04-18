import { appendFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  assertTuiBenchmarkOutputPath,
  createTuiBenchmarkPlan,
  createTuiBenchmarkReport,
  evaluateTuiBenchmarkResults,
  runTuiBenchmarkPlan,
  tuiBenchmarkCommand,
  tuiBenchmarkFlag,
  tuiBenchmarkValue,
  writeTuiBenchmarkReport,
} from "./tui-benchmark"
import {
  createTuiRendererContractTemplate,
  normalizeTuiRendererContractReport,
  validateTuiRendererParityBenchmarkReport,
} from "../src/cli/cmd/tui/renderer-parity"
import { TUI_RENDERER_CONTRACT } from "../src/cli/cmd/tui/renderer-contract"
import { createTuiRendererContractReport } from "./tui-renderer-contract"
import {
  resolveTuiRendererPhase5Artifacts,
  runTuiRendererPhase5Gate,
  type TuiRendererPhase5GateManifest,
} from "./tui-renderer-phase5-gate"

export type TuiRendererEvaluationArtifacts = {
  artifactDir: string
  benchmarkReportPath: string
  contractReportPath: string
  contractTemplatePath: string
  decisionPath: string
  manifestPath: string
}

export type TuiRendererEvaluationResult = {
  artifacts: TuiRendererEvaluationArtifacts
  manifest: TuiRendererPhase5GateManifest
  benchmarkGenerated: boolean
  contractGenerated: boolean
}

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await Bun.file(file).text()) as T
}

async function writeJSON(file: string, value: unknown) {
  assertTuiBenchmarkOutputPath(file)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

function positiveInteger(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  return value
}

export function resolveTuiRendererEvaluationArtifacts(artifactDir: string): TuiRendererEvaluationArtifacts {
  const phase5 = resolveTuiRendererPhase5Artifacts(artifactDir)
  const benchmarkReportPath = path.join(phase5.artifactDir, "tui-benchmark-report.json")
  const contractReportPath = path.join(phase5.artifactDir, "tui-renderer-contract-report.json")
  const contractTemplatePath = path.join(phase5.artifactDir, "tui-renderer-contract-template.json")
  assertTuiBenchmarkOutputPath(benchmarkReportPath)
  assertTuiBenchmarkOutputPath(contractReportPath)
  assertTuiBenchmarkOutputPath(contractTemplatePath)
  return {
    artifactDir: phase5.artifactDir,
    benchmarkReportPath,
    contractReportPath,
    contractTemplatePath,
    decisionPath: phase5.decisionPath,
    manifestPath: phase5.manifestPath,
  }
}

export function renderTuiRendererEvaluationSummary(input: {
  artifacts: TuiRendererEvaluationArtifacts
  manifest: TuiRendererPhase5GateManifest
  benchmarkGenerated: boolean
  contractGenerated: boolean
}) {
  const lines = [
    "## TUI renderer phase5",
    "",
    `- action: ${input.manifest.decision.action}`,
    `- ready: ${input.manifest.decision.ready ? "yes" : "no"}`,
    `- benchmark report: ${path.relative(process.cwd(), input.artifacts.benchmarkReportPath)}`,
    `- benchmark generated now: ${input.benchmarkGenerated ? "yes" : "no"}`,
    `- contract report: ${path.relative(process.cwd(), input.manifest.contractReport)}`,
    `- contract generated now: ${input.contractGenerated ? "yes" : "no"}`,
    `- parity decision: ${path.relative(process.cwd(), input.artifacts.decisionPath)}`,
    `- phase5 manifest: ${path.relative(process.cwd(), input.artifacts.manifestPath)}`,
    "",
  ]
  return lines.join("\n")
}

async function appendSummary(text: string) {
  const file = process.env["GITHUB_STEP_SUMMARY"]
  if (!file) return
  await appendFile(file, text)
}

async function ensureBenchmarkReport(input: {
  artifactPath: string
  benchmarkReportPath?: string
  repeat?: number
  timeoutMs?: number
  command?: string[]
}) {
  if (input.benchmarkReportPath) {
    const report = await readJSON<unknown>(path.resolve(input.benchmarkReportPath))
    validateTuiRendererParityBenchmarkReport(report)
    await writeJSON(input.artifactPath, report)
    return {
      path: input.artifactPath,
      generated: false,
    }
  }

  const plan = createTuiBenchmarkPlan({
    command: input.command,
    renderer: "native",
    repeat: positiveInteger(input.repeat ?? 3, "repeat"),
    timeoutMs: positiveInteger(input.timeoutMs ?? 15_000, "timeoutMs"),
  })
  const results = await runTuiBenchmarkPlan(plan)
  const verdict = evaluateTuiBenchmarkResults(results)
  const report = await createTuiBenchmarkReport({
    results,
    verdict,
    command: input.command,
    renderer: "native",
  })
  await writeTuiBenchmarkReport(input.artifactPath, report)
  return {
    path: input.artifactPath,
    generated: true,
  }
}

async function ensureContractReport(input: {
  artifactPath: string
  templatePath: string
  contractReportPath?: string
  verify?: boolean
  timeoutMs?: number
}) {
  if (input.contractReportPath) {
    const report = normalizeTuiRendererContractReport(await readJSON<unknown>(path.resolve(input.contractReportPath)))
    await writeJSON(input.artifactPath, report)
    return {
      path: input.artifactPath,
      generated: false,
    }
  }

  const report = await createTuiRendererContractReport({
    requirements: TUI_RENDERER_CONTRACT,
    verify: input.verify,
    timeoutMs: input.timeoutMs,
  })
  await writeJSON(input.artifactPath, report)
  await writeJSON(input.templatePath, createTuiRendererContractTemplate())
  return {
    path: input.artifactPath,
    generated: true,
  }
}

export async function runTuiRendererEvaluation(input: {
  artifactDir: string
  benchmarkReportPath?: string
  contractReportPath?: string
  repeat?: number
  timeoutMs?: number
  command?: string[]
  verifyContract?: boolean
}): Promise<TuiRendererEvaluationResult> {
  const artifacts = resolveTuiRendererEvaluationArtifacts(input.artifactDir)
  const benchmark = await ensureBenchmarkReport({
    artifactPath: artifacts.benchmarkReportPath,
    benchmarkReportPath: input.benchmarkReportPath,
    repeat: input.repeat,
    timeoutMs: input.timeoutMs,
    command: input.command,
  })
  const contract = await ensureContractReport({
    artifactPath: artifacts.contractReportPath,
    templatePath: artifacts.contractTemplatePath,
    contractReportPath: input.contractReportPath,
    verify: input.verifyContract,
    timeoutMs: input.timeoutMs,
  })
  const manifest = await runTuiRendererPhase5Gate({
    benchmarkReportPath: benchmark.path,
    contractReportPath: contract.path,
    artifactDir: artifacts.artifactDir,
  })
  const result = {
    artifacts,
    manifest,
    benchmarkGenerated: benchmark.generated,
    contractGenerated: contract.generated,
  } satisfies TuiRendererEvaluationResult
  const summary = renderTuiRendererEvaluationSummary(result)
  console.log(summary)
  await appendSummary(summary)
  return result
}

function value(name: string, argv = process.argv.slice(2)) {
  const value = tuiBenchmarkValue(name, argv)
  return value ? path.resolve(value) : undefined
}

async function main() {
  const artifactDir = value("--artifacts-dir")
  if (!artifactDir) throw new Error("Provide --artifacts-dir <dir>")

  const result = await runTuiRendererEvaluation({
    artifactDir,
    benchmarkReportPath: value("--benchmark-report"),
    contractReportPath: value("--contract"),
    repeat: Number(tuiBenchmarkValue("--repeat") ?? "3"),
    timeoutMs: Number(tuiBenchmarkValue("--timeout-ms") ?? "15000"),
    command: tuiBenchmarkFlag("--run") ? tuiBenchmarkCommand() : undefined,
    verifyContract: !tuiBenchmarkFlag("--no-verify-contract"),
  })

  console.log(JSON.stringify(result.manifest, null, 2))
  if (!result.manifest.decision.ready) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
