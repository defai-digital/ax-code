import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { assertTuiBenchmarkOutputPath } from "./tui-benchmark"
import {
  evaluateTuiRendererParity,
  normalizeTuiRendererContractReport,
  validateTuiRendererParityBenchmarkReport,
  type TuiRendererParityDecision,
} from "../src/cli/cmd/tui/renderer-parity"

export type TuiRendererPhase5GateManifest = {
  version: 1
  generatedAt: string
  renderer: "native"
  opentuiFallbackRetained: true
  benchmarkReport: string
  contractReport: string
  decisionPath: string
  decision: TuiRendererParityDecision
}

export type TuiRendererPhase5GateArtifacts = {
  artifactDir: string
  decisionPath: string
  manifestPath: string
}

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await Bun.file(file).text()) as T
}

async function writeJSON(file: string, value: unknown) {
  assertTuiBenchmarkOutputPath(file)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2) + "\n")
}

export function resolveTuiRendererPhase5Artifacts(artifactDir: string): TuiRendererPhase5GateArtifacts {
  const resolved = path.resolve(artifactDir)
  const decisionPath = path.join(resolved, "tui-renderer-parity-decision.json")
  const manifestPath = path.join(resolved, "tui-renderer-phase5-manifest.json")
  assertTuiBenchmarkOutputPath(decisionPath)
  assertTuiBenchmarkOutputPath(manifestPath)
  return {
    artifactDir: resolved,
    decisionPath,
    manifestPath,
  }
}

export async function runTuiRendererPhase5Gate(input: {
  benchmarkReportPath: string
  contractReportPath: string
  artifactDir: string
  generatedAt?: string
}): Promise<TuiRendererPhase5GateManifest> {
  const artifacts = resolveTuiRendererPhase5Artifacts(input.artifactDir)
  const decision = evaluateTuiRendererParity({
    renderer: "native",
    benchmarkReport: validateTuiRendererParityBenchmarkReport(await readJSON<unknown>(input.benchmarkReportPath)),
    contract: normalizeTuiRendererContractReport(await readJSON<unknown>(input.contractReportPath)),
    opentuiFallbackRetained: true,
  })
  const manifest: TuiRendererPhase5GateManifest = {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    renderer: "native",
    opentuiFallbackRetained: true,
    benchmarkReport: path.resolve(input.benchmarkReportPath),
    contractReport: path.resolve(input.contractReportPath),
    decisionPath: artifacts.decisionPath,
    decision,
  }

  await writeJSON(artifacts.decisionPath, decision)
  await writeJSON(artifacts.manifestPath, manifest)
  return manifest
}

function value(name: string, argv = process.argv.slice(2)) {
  const idx = argv.indexOf(name)
  if (idx < 0) return
  const next = argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

async function main() {
  const benchmarkReportPath = value("--benchmark-report")
  const contractReportPath = value("--contract")
  const artifactDir = value("--artifacts-dir")
  if (!benchmarkReportPath || !contractReportPath || !artifactDir) {
    throw new Error("Provide --benchmark-report <file>, --contract <file>, and --artifacts-dir <dir>")
  }

  const manifest = await runTuiRendererPhase5Gate({
    benchmarkReportPath,
    contractReportPath,
    artifactDir,
  })
  console.log(JSON.stringify(manifest, null, 2))
  if (!manifest.decision.ready) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
