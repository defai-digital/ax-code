import { TUI_PERFORMANCE_CRITERIA, TUI_PERFORMANCE_CRITERIA_VERSION } from "./performance-criteria"
import { TUI_RENDERER_CONTRACT, TUI_RENDERER_CONTRACT_VERSION } from "./renderer-contract"
import type { TuiRendererName } from "./renderer-adapter/types"

export const TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA = [
  "startup.first-frame",
  "input.keypress-echo",
  "input.paste-echo",
  "terminal.resize-stability",
  "mouse.click-release",
  "selection.drag-stability",
  "transcript.large-append",
  "scroll.long-cjk-wrapped",
] as const

export type TuiRendererParityStatus = "passed" | "failed" | "missing"

export type TuiRendererParityCheck = {
  id: string
  status: TuiRendererParityStatus
  reason?: string
}

export type TuiRendererParityBenchmarkReport = {
  version: string
  metadata?: {
    renderer?: {
      name?: TuiRendererName
    }
  }
  results: Array<{
    id: string
    criterionID: string
    metric: TuiRendererParityBenchmarkMetric
    value?: number
    skipped?: string
  }>
  verdict: {
    ok: boolean
    failures: string[]
  }
}

export type TuiRendererParityBenchmarkMetric = "p95Ms" | "minFps"

export type TuiRendererContractStatus = {
  id: string
  status: "passed" | "failed"
  evidence?: string[]
  note?: string
}

export type TuiRendererContractReport = {
  version: string
  statuses: TuiRendererContractStatus[]
}

export type TuiRendererParityInput = {
  renderer: TuiRendererName
  benchmarkReport?: TuiRendererParityBenchmarkReport
  contract: TuiRendererContractReport
  opentuiFallbackRetained: boolean
}

export type TuiRendererParityDecision = {
  action: "retain-opentui-default" | "keep-native-flagged" | "promote-native-default"
  ready: boolean
  checks: TuiRendererParityCheck[]
}

export function evaluateTuiRendererParity(input: TuiRendererParityInput): TuiRendererParityDecision {
  const checks = [
    rendererCheck(input.renderer),
    fallbackCheck(input.opentuiFallbackRetained),
    benchmarkReportCheck(input.benchmarkReport),
    ...benchmarkIntegrityChecks(input.benchmarkReport),
    ...benchmarkCriteriaChecks(input.benchmarkReport),
    ...contractChecks(input.contract),
  ]
  const ready = checks.every((check) => check.status === "passed")

  if (input.renderer !== "native") return { action: "retain-opentui-default", ready: false, checks }
  if (!ready) return { action: "keep-native-flagged", ready: false, checks }
  return { action: "promote-native-default", ready: true, checks }
}

export function createTuiRendererContractTemplate(): TuiRendererContractReport {
  return {
    version: TUI_RENDERER_CONTRACT_VERSION,
    statuses: TUI_RENDERER_CONTRACT.map((requirement) => ({
      id: requirement.id,
      status: "failed",
      note: `TODO (${requirement.gate}): ${requirement.requirement}`,
    })),
  }
}

export function normalizeTuiRendererContractReport(value: unknown): TuiRendererContractReport {
  if (Array.isArray(value)) return { version: "missing", statuses: validateContractStatuses(value) }
  const report = object(value, "contract report")
  if (typeof report.version !== "string" || !report.version) {
    throw new Error("contract report version must be a non-empty string")
  }
  if (!Array.isArray(report.statuses)) throw new Error("contract report statuses must be an array")
  return {
    version: report.version,
    statuses: validateContractStatuses(report.statuses),
  }
}

export function validateTuiRendererParityBenchmarkReport(value: unknown): TuiRendererParityBenchmarkReport {
  const report = object(value, "benchmark report")
  if (typeof report.version !== "string" || !report.version) {
    throw new Error("benchmark report version must be a non-empty string")
  }
  if (!Array.isArray(report.results)) throw new Error("benchmark report results must be an array")
  const verdict = object(report.verdict, "benchmark report verdict")
  if (typeof verdict.ok !== "boolean") throw new Error("benchmark report verdict.ok must be boolean")

  return {
    version: report.version,
    metadata: validateBenchmarkMetadata(report.metadata),
    results: report.results.map((item, index) => {
      const result = object(item, `benchmark results[${index}]`)
      if (typeof result.id !== "string" || !result.id) {
        throw new Error(`benchmark results[${index}].id must be a non-empty string`)
      }
      if (typeof result.criterionID !== "string" || !result.criterionID) {
        throw new Error(`benchmark results[${index}].criterionID must be a non-empty string`)
      }
      if (result.metric !== "p95Ms" && result.metric !== "minFps") {
        throw new Error(`benchmark results[${index}].metric must be p95Ms or minFps`)
      }
      if (result.value !== undefined && (typeof result.value !== "number" || !Number.isFinite(result.value))) {
        throw new Error(`benchmark results[${index}].value must be a finite number`)
      }
      if (result.skipped !== undefined && typeof result.skipped !== "string") {
        throw new Error(`benchmark results[${index}].skipped must be a string`)
      }
      return {
        id: result.id,
        criterionID: result.criterionID,
        metric: result.metric as TuiRendererParityBenchmarkMetric,
        value: result.value as number | undefined,
        skipped: result.skipped as string | undefined,
      }
    }),
    verdict: {
      ok: verdict.ok,
      failures: stringArray(verdict.failures, "benchmark report verdict.failures"),
    },
  }
}

function rendererCheck(renderer: TuiRendererName): TuiRendererParityCheck {
  if (renderer === "native") return { id: "renderer.native-selected", status: "passed" }
  return {
    id: "renderer.native-selected",
    status: "failed",
    reason: "Phase 5 can only promote the native renderer after evaluating native.",
  }
}

function fallbackCheck(retained: boolean): TuiRendererParityCheck {
  if (retained) return { id: "fallback.opentui-retained", status: "passed" }
  return {
    id: "fallback.opentui-retained",
    status: "failed",
    reason: "OpenTUI fallback must remain available for at least one release cycle.",
  }
}

function benchmarkReportCheck(report: TuiRendererParityBenchmarkReport | undefined): TuiRendererParityCheck {
  if (!report) return { id: "benchmark.report", status: "missing", reason: "No benchmark report was provided." }
  if (report.version !== TUI_PERFORMANCE_CRITERIA_VERSION) {
    return {
      id: "benchmark.report",
      status: "failed",
      reason: `Benchmark version ${report.version} does not match ${TUI_PERFORMANCE_CRITERIA_VERSION}.`,
    }
  }
  if (report.metadata?.renderer?.name !== "native") {
    return {
      id: "benchmark.report",
      status: "failed",
      reason: "Benchmark report must be generated with AX_CODE_TUI_RENDERER=native.",
    }
  }
  if (!report.verdict.ok) {
    return { id: "benchmark.report", status: "failed", reason: "Benchmark report contains failing targets." }
  }
  if (report.verdict.failures.length > 0) {
    return {
      id: "benchmark.report",
      status: "failed",
      reason: "Benchmark report is marked ok but still contains failures.",
    }
  }
  return { id: "benchmark.report", status: "passed" }
}

function benchmarkIntegrityChecks(report: TuiRendererParityBenchmarkReport | undefined): TuiRendererParityCheck[] {
  if (!report)
    return [
      { id: "benchmark.duplicate-criteria", status: "missing", reason: "No benchmark report was provided." },
      { id: "benchmark.duplicate-results", status: "missing", reason: "No benchmark report was provided." },
      { id: "benchmark.unknown-criteria", status: "missing", reason: "No benchmark report was provided." },
    ]
  const knownCriteria = new Set(TUI_PERFORMANCE_CRITERIA.map((item) => item.id))
  const seenCriteria = new Set<string>()
  const duplicateCriteria = new Set<string>()
  const seenResults = new Set<string>()
  const duplicateResults = new Set<string>()
  const unknownCriteria = new Set<string>()
  for (const result of report.results) {
    if (seenCriteria.has(result.criterionID)) duplicateCriteria.add(result.criterionID)
    seenCriteria.add(result.criterionID)
    if (seenResults.has(result.id)) duplicateResults.add(result.id)
    seenResults.add(result.id)
    if (!knownCriteria.has(result.criterionID)) unknownCriteria.add(result.criterionID)
  }
  return [
    {
      id: "benchmark.duplicate-criteria",
      status: duplicateCriteria.size === 0 ? "passed" : "failed",
      reason:
        duplicateCriteria.size === 0
          ? undefined
          : `Duplicate benchmark criteria: ${[...duplicateCriteria].sort().join(", ")}`,
    },
    {
      id: "benchmark.duplicate-results",
      status: duplicateResults.size === 0 ? "passed" : "failed",
      reason:
        duplicateResults.size === 0
          ? undefined
          : `Duplicate benchmark result ids: ${[...duplicateResults].sort().join(", ")}`,
    },
    {
      id: "benchmark.unknown-criteria",
      status: unknownCriteria.size === 0 ? "passed" : "failed",
      reason:
        unknownCriteria.size === 0
          ? undefined
          : `Unknown benchmark criteria: ${[...unknownCriteria].sort().join(", ")}`,
    },
  ]
}

function benchmarkCriteriaChecks(report: TuiRendererParityBenchmarkReport | undefined): TuiRendererParityCheck[] {
  return TUI_NATIVE_DEFAULT_REQUIRED_CRITERIA.map((criterionID) => {
    const result = report?.results.find((item) => item.criterionID === criterionID)
    if (!result) return { id: `benchmark.${criterionID}`, status: "missing", reason: "Missing benchmark result." }
    if (result.skipped) {
      return { id: `benchmark.${criterionID}`, status: "failed", reason: `Benchmark skipped: ${result.skipped}` }
    }
    const failure = report?.verdict.failures.find((item) => item.startsWith(`${result.id}:`))
    if (failure) return { id: `benchmark.${criterionID}`, status: "failed", reason: failure }
    if (result.value === undefined) {
      return { id: `benchmark.${criterionID}`, status: "failed", reason: "Benchmark result has no value." }
    }
    const expectedMetric = benchmarkMetric(criterionID)
    if (!expectedMetric) {
      return { id: `benchmark.${criterionID}`, status: "failed", reason: "Unknown benchmark criterion." }
    }
    if (result.metric !== expectedMetric) {
      return {
        id: `benchmark.${criterionID}`,
        status: "failed",
        reason: `Benchmark metric ${result.metric} does not match expected ${expectedMetric}.`,
      }
    }
    const thresholdFailure = benchmarkThresholdFailure(criterionID, result.value)
    if (thresholdFailure) return { id: `benchmark.${criterionID}`, status: "failed", reason: thresholdFailure }
    return { id: `benchmark.${criterionID}`, status: "passed" }
  })
}

function benchmarkMetric(criterionID: string): TuiRendererParityBenchmarkMetric | undefined {
  const criterion = TUI_PERFORMANCE_CRITERIA.find((item) => item.id === criterionID)
  if (!criterion) return undefined
  return criterion.target.minFps === undefined ? "p95Ms" : "minFps"
}

function benchmarkThresholdFailure(criterionID: string, value: number): string | undefined {
  const criterion = TUI_PERFORMANCE_CRITERIA.find((item) => item.id === criterionID)
  if (!criterion) return "Unknown benchmark criterion."
  if (criterion.target.p95Ms !== undefined && value > criterion.target.p95Ms) {
    return `Benchmark p95 ${value.toFixed(1)}ms exceeds ${criterion.target.p95Ms}ms.`
  }
  if (criterion.target.minFps !== undefined && value < criterion.target.minFps) {
    return `Benchmark ${value.toFixed(1)}fps is below ${criterion.target.minFps}fps.`
  }
}

function contractChecks(report: TuiRendererContractReport): TuiRendererParityCheck[] {
  const byID = new Map(report.statuses.map((item) => [item.id, item]))
  return [
    contractVersionCheck(report.version),
    ...contractIntegrityChecks(report),
    ...TUI_RENDERER_CONTRACT.map((requirement): TuiRendererParityCheck => {
      const status = byID.get(requirement.id)
      if (!status) {
        return { id: `contract.${requirement.id}`, status: "missing", reason: "Missing renderer contract result." }
      }
      if (status.status === "failed") {
        return {
          id: `contract.${requirement.id}`,
          status: "failed",
          reason: status.note ?? requirement.requirement,
        }
      }
      return { id: `contract.${requirement.id}`, status: "passed" }
    }),
  ]
}

function contractIntegrityChecks(report: TuiRendererContractReport): TuiRendererParityCheck[] {
  const requiredIDs = new Set(TUI_RENDERER_CONTRACT.map((item) => item.id))
  const seen = new Set<string>()
  const duplicateIDs = new Set<string>()
  const unknownIDs = new Set<string>()
  const passedWithoutEvidence = new Set<string>()

  for (const status of report.statuses) {
    if (seen.has(status.id)) duplicateIDs.add(status.id)
    seen.add(status.id)
    if (!requiredIDs.has(status.id)) unknownIDs.add(status.id)
    if (status.status === "passed" && !status.evidence?.some((item) => item.trim().length > 0)) {
      passedWithoutEvidence.add(status.id)
    }
  }

  return [
    {
      id: "contract.duplicate-ids",
      status: duplicateIDs.size === 0 ? "passed" : "failed",
      reason: duplicateIDs.size === 0 ? undefined : `Duplicate contract ids: ${[...duplicateIDs].sort().join(", ")}`,
    },
    {
      id: "contract.unknown-ids",
      status: unknownIDs.size === 0 ? "passed" : "failed",
      reason: unknownIDs.size === 0 ? undefined : `Unknown contract ids: ${[...unknownIDs].sort().join(", ")}`,
    },
    {
      id: "contract.evidence",
      status: passedWithoutEvidence.size === 0 ? "passed" : "failed",
      reason:
        passedWithoutEvidence.size === 0
          ? undefined
          : `Passed contract ids require evidence: ${[...passedWithoutEvidence].sort().join(", ")}`,
    },
  ]
}

function contractVersionCheck(version: string): TuiRendererParityCheck {
  if (version !== TUI_RENDERER_CONTRACT_VERSION) {
    return {
      id: "contract.version",
      status: "failed",
      reason: `Contract version ${version} does not match ${TUI_RENDERER_CONTRACT_VERSION}.`,
    }
  }
  return {
    id: "contract.version",
    status: "passed",
  }
}

function validateContractStatuses(value: unknown[]): TuiRendererContractStatus[] {
  return value.map((item, index) => {
    const status = object(item, `contract statuses[${index}]`)
    if (typeof status.id !== "string" || !status.id) {
      throw new Error(`contract statuses[${index}].id must be a non-empty string`)
    }
    if (status.status !== "passed" && status.status !== "failed") {
      throw new Error(`contract statuses[${index}].status must be passed or failed`)
    }
    if (status.note !== undefined && typeof status.note !== "string") {
      throw new Error(`contract statuses[${index}].note must be a string`)
    }
    return {
      id: status.id,
      status: status.status,
      evidence: stringArrayOptional(status.evidence, `contract statuses[${index}].evidence`),
      note: status.note as string | undefined,
    }
  })
}

function validateBenchmarkMetadata(value: unknown): TuiRendererParityBenchmarkReport["metadata"] {
  if (value === undefined) return undefined
  const metadata = object(value, "benchmark report metadata")
  if (metadata.renderer === undefined) return {}
  const renderer = object(metadata.renderer, "benchmark report metadata.renderer")
  if (renderer.name !== "opentui" && renderer.name !== "native" && renderer.name !== undefined) {
    throw new Error("benchmark report metadata.renderer.name must be opentui or native")
  }
  return { renderer: { name: renderer.name as TuiRendererName | undefined } }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`)
  }
  return value
}

function stringArrayOptional(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  return stringArray(value, label)
}
