import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  summarizeTuiRendererEvidence,
  type TuiRendererEvidenceInput,
  type TuiRendererIssueEvidence,
} from "../src/cli/cmd/tui/renderer-evidence"
import type { TuiRendererIssueLayer } from "../src/cli/cmd/tui/renderer-decision"

type BenchmarkReport = {
  results: Array<{
    id: string
    criterionID: string
  }>
  verdict: {
    failures: string[]
  }
}

type EvidenceFile = Partial<TuiRendererEvidenceInput> & {
  issues?: TuiRendererIssueEvidence[]
}

const ISSUE_LAYERS = new Set(["product-layer", "integration-layer", "renderer-specific"])
const ISSUE_STATUSES = new Set(["open", "needs-repro", "mitigated", "closed"])
const ISSUE_SOURCES = new Set([
  "bug-report",
  "benchmark",
  "manual-repro",
  "release-regression",
  "support-case",
  "code-audit",
])

function value(name: string, argv = process.argv.slice(2)) {
  const idx = argv.indexOf(name)
  if (idx < 0) return
  const next = argv[idx + 1]
  if (!next || next.startsWith("--")) throw new Error(`Missing value for ${name}`)
  return next
}

function flag(name: string, argv = process.argv.slice(2)) {
  return argv.includes(name)
}

function rendererIssueLayer(value: string | undefined): TuiRendererIssueLayer {
  if (value === undefined) return "integration-layer"
  if (ISSUE_LAYERS.has(value)) return value as TuiRendererIssueLayer
  throw new Error(`Invalid --benchmark-layer: ${value}`)
}

async function readJSON<T>(file: string): Promise<T> {
  return JSON.parse(await Bun.file(file).text()) as T
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function stringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value
}

function validateIssue(value: unknown, index: number): TuiRendererIssueEvidence {
  const issue = object(value, `issues[${index}]`)
  if (typeof issue.id !== "string" || !issue.id) throw new Error(`issues[${index}].id must be a non-empty string`)
  if (typeof issue.title !== "string" || !issue.title) {
    throw new Error(`issues[${index}].title must be a non-empty string`)
  }
  if (typeof issue.layer !== "string" || !ISSUE_LAYERS.has(issue.layer)) {
    throw new Error(`issues[${index}].layer must be product-layer, integration-layer, or renderer-specific`)
  }
  if (typeof issue.status !== "string" || !ISSUE_STATUSES.has(issue.status)) {
    throw new Error(`issues[${index}].status must be open, needs-repro, mitigated, or closed`)
  }
  if (typeof issue.reproducible !== "boolean") throw new Error(`issues[${index}].reproducible must be boolean`)
  if (typeof issue.source !== "string" || !ISSUE_SOURCES.has(issue.source)) {
    throw new Error(`issues[${index}].source is invalid`)
  }
  if (issue.blocksProductDirection !== undefined && typeof issue.blocksProductDirection !== "boolean") {
    throw new Error(`issues[${index}].blocksProductDirection must be boolean`)
  }

  return {
    id: issue.id,
    title: issue.title,
    layer: issue.layer as TuiRendererIssueLayer,
    status: issue.status as TuiRendererIssueEvidence["status"],
    reproducible: issue.reproducible,
    source: issue.source as TuiRendererIssueEvidence["source"],
    criteriaFailures: stringArray(issue.criteriaFailures, `issues[${index}].criteriaFailures`),
    blocksProductDirection: issue.blocksProductDirection as boolean | undefined,
    notes: stringArray(issue.notes, `issues[${index}].notes`),
  }
}

export function validateEvidenceFile(value: unknown): EvidenceFile {
  const file = object(value, "evidence file")
  if (file.issues !== undefined && !Array.isArray(file.issues)) throw new Error("issues must be an array")
  if (file.installOrBuildRiskAccepted !== undefined && typeof file.installOrBuildRiskAccepted !== "boolean") {
    throw new Error("installOrBuildRiskAccepted must be boolean")
  }
  if (file.offlinePackagingDeterministic !== undefined && typeof file.offlinePackagingDeterministic !== "boolean") {
    throw new Error("offlinePackagingDeterministic must be boolean")
  }

  return {
    issues: file.issues?.map(validateIssue),
    installOrBuildRiskAccepted: file.installOrBuildRiskAccepted as boolean | undefined,
    offlinePackagingDeterministic: file.offlinePackagingDeterministic as boolean | undefined,
  }
}

export function validateBenchmarkReport(value: unknown): BenchmarkReport {
  const report = object(value, "benchmark report")
  if (!Array.isArray(report.results)) throw new Error("benchmark report results must be an array")
  const verdict = object(report.verdict, "benchmark report verdict")
  const failures = stringArray(verdict.failures, "benchmark report verdict.failures") ?? []

  return {
    results: report.results.map((item, index) => {
      const result = object(item, `benchmark results[${index}]`)
      if (typeof result.id !== "string" || !result.id) {
        throw new Error(`benchmark results[${index}].id must be a non-empty string`)
      }
      if (typeof result.criterionID !== "string" || !result.criterionID) {
        throw new Error(`benchmark results[${index}].criterionID must be a non-empty string`)
      }
      return { id: result.id, criterionID: result.criterionID }
    }),
    verdict: { failures },
  }
}

export function benchmarkIssues(
  report: BenchmarkReport,
  input: {
    layer: TuiRendererIssueLayer
    blocksProductDirection: boolean
  },
): TuiRendererIssueEvidence[] {
  const results = [...report.results].sort((a, b) => b.id.length - a.id.length)
  return report.verdict.failures.flatMap((failure) => {
    const result = results.find((item) => failure.startsWith(`${item.id}:`))
    if (!result) throw new Error(`Benchmark failure did not match a result id: ${failure}`)
    return [
      {
        id: `benchmark:${result.id}`,
        title: `TUI benchmark failed: ${result.criterionID}`,
        layer: input.layer,
        status: "open",
        reproducible: true,
        source: "benchmark",
        criteriaFailures: [result.criterionID],
        blocksProductDirection: input.blocksProductDirection,
        notes: [failure],
      } satisfies TuiRendererIssueEvidence,
    ]
  })
}

function template() {
  return {
    installOrBuildRiskAccepted: false,
    offlinePackagingDeterministic: false,
    issues: [
      {
        id: "tui-001",
        title: "Prompt loses focus after terminal resize",
        layer: "renderer-specific",
        status: "open",
        reproducible: true,
        source: "manual-repro",
        criteriaFailures: ["terminal.resize-stability"],
        blocksProductDirection: true,
        notes: ["Include terminal, OS, AX Code version, and exact repro steps."],
      },
    ],
  } satisfies TuiRendererEvidenceInput
}

async function main() {
  if (flag("--template")) {
    console.log(JSON.stringify(template(), null, 2))
    return
  }

  const issuesPath = value("--issues")
  const benchmarkPath = value("--benchmark-report")
  if (!issuesPath && !benchmarkPath) {
    throw new Error("Provide --issues <file>, --benchmark-report <file>, or --template")
  }

  const evidence: EvidenceFile = issuesPath ? validateEvidenceFile(await readJSON<unknown>(issuesPath)) : { issues: [] }
  const issues = [...(evidence.issues ?? [])]

  if (benchmarkPath) {
    issues.push(
      ...benchmarkIssues(validateBenchmarkReport(await readJSON<unknown>(benchmarkPath)), {
        layer: rendererIssueLayer(value("--benchmark-layer")),
        blocksProductDirection: flag("--benchmark-blocks-product"),
      }),
    )
  }

  const summary = summarizeTuiRendererEvidence({
    issues,
    installOrBuildRiskAccepted: flag("--accept-build-risk") || evidence.installOrBuildRiskAccepted === true,
    offlinePackagingDeterministic: flag("--offline-packaging") || evidence.offlinePackagingDeterministic === true,
  })

  const output = value("--output")
  if (output) {
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(summary, null, 2) + "\n")
  }
  console.log(JSON.stringify(summary, null, 2))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
