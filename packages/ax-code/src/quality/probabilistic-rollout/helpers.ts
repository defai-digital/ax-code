import z from "zod"
import { EventQuery } from "../../replay/query"
import { Snapshot } from "../../snapshot"
import { FindingSchema, type Finding } from "../finding"
import { asRecordOrUndefined } from "@/util/record"
import { uniqueStrings } from "@/util/string-list"
import * as ProbabilisticRolloutReadiness from "../probabilistic-rollout-readiness"
import * as ProbabilisticRolloutSchema from "../probabilistic-rollout-schema"

export const REVIEW_TOOLS = new Set([
  "impact_analyze",
  "security_scan",
  "race_scan",
  "lifecycle_scan",
  "hardcode_scan",
  "dedup_scan",
])

export const QA_TEST_COMMAND_PATTERNS = [
  /\b(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?test\b/i,
  /\b(?:vitest|jest|mocha|ava|pytest|rspec|phpunit)\b/i,
  /\b(?:go test|cargo test|deno test|swift test|dotnet test)\b/i,
]
export const RUNTIME_DEBUG_TOOLS = new Set([
  "debug_open_case",
  "debug_capture_evidence",
  "debug_plan_instrumentation",
  "debug_propose_hypothesis",
  "debug_apply_verification",
])

// Re-export schema and readiness modules for namespace assembly
export { ProbabilisticRolloutReadiness, ProbabilisticRolloutSchema }

export type EventRow = ReturnType<typeof EventQuery.bySessionWithTimestamp>[number]
export type ReviewFindingExtract = {
  artifactID: string
  callID: string
  tool: string
  finding: Record<string, unknown>
}
export type QARunExtract = {
  callID: string
  command: string
  failed: boolean
  framework: string | null
  output: string
  summary: ToolSummary
}

export type ToolCall = {
  callID: string
  tool: string
  input: Record<string, unknown>
}

export type DecisionView = {
  source: string
  confidence: number | null
  score: number | null | undefined
  readiness: string | null | undefined
  rank: number | null | undefined
}

// Type aliases from schema
export type Workflow = z.output<typeof ProbabilisticRolloutSchema.Workflow>
export type ArtifactKind = z.output<typeof ProbabilisticRolloutSchema.ArtifactKind>
export type LabelSource = z.output<typeof ProbabilisticRolloutSchema.LabelSource>
export type Label = z.output<typeof ProbabilisticRolloutSchema.Label>
export type LabelFile = z.output<typeof ProbabilisticRolloutSchema.LabelFile>
export type ToolSummary = z.output<typeof ProbabilisticRolloutSchema.ToolSummary>
export type ReplayItem = z.output<typeof ProbabilisticRolloutSchema.ReplayItem>
export type ReplayExport = z.output<typeof ProbabilisticRolloutSchema.ReplayExport>
export type ReplayReadinessGate = z.output<typeof ProbabilisticRolloutSchema.ReplayReadinessGate>
export type ReplayReadinessSummary = z.output<typeof ProbabilisticRolloutSchema.ReplayReadinessSummary>
export type ReplayReadinessFile = z.output<typeof ProbabilisticRolloutSchema.ReplayReadinessFile>
export type UserFacingReadinessState = z.output<typeof ProbabilisticRolloutSchema.UserFacingReadinessState>
export type CalibrationRecord = z.output<typeof ProbabilisticRolloutSchema.CalibrationRecord>
export type CalibrationSummary = z.output<typeof ProbabilisticRolloutSchema.CalibrationSummary>
export type Prediction = z.output<typeof ProbabilisticRolloutSchema.Prediction>
export type PredictionFile = z.output<typeof ProbabilisticRolloutSchema.PredictionFile>
export type MetricComparison = z.output<typeof ProbabilisticRolloutSchema.MetricComparison>
export type ComparisonGate = z.output<typeof ProbabilisticRolloutSchema.ComparisonGate>
export type CalibrationComparison = z.output<typeof ProbabilisticRolloutSchema.CalibrationComparison>
export type ShadowDecision = z.output<typeof ProbabilisticRolloutSchema.ShadowDecision>
export type ShadowRecord = z.output<typeof ProbabilisticRolloutSchema.ShadowRecord>
export type ShadowFile = z.output<typeof ProbabilisticRolloutSchema.ShadowFile>
export type ShadowSummary = z.output<typeof ProbabilisticRolloutSchema.ShadowSummary>
export type UserFacingReadinessKind = ProbabilisticRolloutSchema.UserFacingReadinessKind

// --- Helper functions ---

export function toolResultRows(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
  return events.filter(
    (
      row,
    ): row is EventRow & {
      event_data: Extract<EventRow["event_data"], { type: "tool.result" }>
    } => row.event_data.type === "tool.result",
  )
}

export function graphCommitSha(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
  const snapshot = events.find((row) => row.event_data.type === "code.graph.snapshot")
  if (!snapshot || snapshot.event_data.type !== "code.graph.snapshot") return null
  return snapshot.event_data.commitSha
}

export function summarizeDiff(diffs: Snapshot.FileDiff[]) {
  return {
    files: diffs.length,
    additions: diffs.reduce((sum, diff) => sum + diff.additions, 0),
    deletions: diffs.reduce((sum, diff) => sum + diff.deletions, 0),
  }
}

export function touchedFiles(diffs: Snapshot.FileDiff[]) {
  return uniqueStrings(diffs.map((diff) => diff.file))
}

export function collectToolCalls(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
  const calls = new Map<string, ToolCall>()
  for (const row of events) {
    if (row.event_data.type !== "tool.call") continue
    const callID = stringValue(row.event_data.callID)
    calls.set(callID, {
      callID,
      tool: stringValue(row.event_data.tool),
      input: row.event_data.input,
    })
  }
  return calls
}

export function numberField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function stringField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "string" ? value : undefined
}

export function stringValue(value: unknown, fallback = "unknown") {
  return typeof value === "string" && value.length > 0 ? value : fallback
}

export function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function toolStatus(value: unknown): ToolSummary["status"] {
  return value === "error" ? "error" : "completed"
}

export function booleanField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return typeof value === "boolean" ? value : undefined
}

export function recordField(input: Record<string, unknown> | undefined, key: string) {
  const value = input?.[key]
  return asRecordOrUndefined(value)
}

export function findingField(input: Record<string, unknown> | undefined, key: string) {
  const candidate = recordField(input, key)
  if (!candidate) return undefined
  const parsed = FindingSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

export function findingReplaySummary(finding: Finding): Record<string, unknown> {
  return {
    findingId: finding.findingId,
    sourceTool: finding.source.tool,
    title: `${finding.severity} ${finding.category} at ${finding.file}`,
    summary: finding.summary,
    severity: finding.severity,
    category: finding.category,
    confidence: finding.confidence,
    file: finding.file,
    line: finding.anchor.kind === "line" ? finding.anchor.line : undefined,
    symbolId: finding.anchor.kind === "symbol" ? finding.anchor.symbolId : undefined,
    suggestedNextAction: finding.suggestedNextAction,
  }
}

export function debugMetadataCaseId(metadata: Record<string, unknown> | undefined) {
  return (
    stringField(metadata, "caseId") ??
    stringField(recordField(metadata, "debugCase"), "caseId") ??
    stringField(recordField(metadata, "debugEvidence"), "caseId") ??
    stringField(recordField(metadata, "debugInstrumentationPlan"), "caseId") ??
    stringField(recordField(metadata, "debugHypothesis"), "caseId")
  )
}

export function debugMetadataHypothesisId(metadata: Record<string, unknown> | undefined) {
  return stringField(metadata, "hypothesisId") ?? stringField(recordField(metadata, "debugHypothesis"), "hypothesisId")
}

export function toolCallCommand(call: ToolCall | undefined) {
  return stringField(call?.input, "command") ?? stringField(call?.input, "cmd")
}

export function toolSummary(
  row: ReturnType<typeof EventQuery.bySessionWithTimestamp>[number],
  call: ToolCall | undefined,
): ToolSummary | undefined {
  if (row.event_data.type !== "tool.result") return
  const metadata = row.event_data.metadata
  return {
    tool: stringValue(row.event_data.tool),
    callID: stringValue(row.event_data.callID),
    status: toolStatus(row.event_data.status),
    timeCreated: row.time_created,
    durationMs: finiteNumber(row.event_data.durationMs),
    findingCount: numberField(metadata, "findingCount"),
    riskLabel: stringField(metadata, "riskLabel"),
    riskScore: numberField(metadata, "riskScore"),
    confidence: numberField(metadata, "confidence"),
    truncated: booleanField(metadata, "truncated"),
    error: typeof row.event_data.error === "string" ? row.event_data.error : undefined,
    input: call?.input,
  }
}

export function reviewFindingTitle(tool: string, finding: Record<string, unknown>) {
  const kind =
    stringField(finding, "pattern") ?? stringField(finding, "kind") ?? stringField(finding, "resourceType") ?? tool
  const file = stringField(finding, "file") ?? "unknown"
  const line = numberField(finding, "line")
  return line !== undefined ? `${kind} at ${file}:${line}` : `${kind} at ${file}`
}

export function reviewFindingSummary(finding: Record<string, unknown>) {
  return (
    stringField(finding, "description") ??
    stringField(finding, "suggestion") ??
    stringField(finding, "detail") ??
    stringField(finding, "fix") ??
    stringField(finding, "value") ??
    "review finding"
  )
}

export function extractReviewFindings(
  tool: string,
  callID: string,
  metadata: Record<string, unknown> | undefined,
): ReviewFindingExtract[] {
  const report = metadata?.["report"]
  if (!report || typeof report !== "object") return []
  const findings = (report as Record<string, unknown>)["findings"]
  if (!Array.isArray(findings)) return []
  return findings
    .filter((finding): finding is Record<string, unknown> => !!finding && typeof finding === "object")
    .map((finding, index) => ({
      artifactID: `review:${callID}:${index}`,
      callID,
      tool,
      finding,
    }))
}

export function isQATestCommand(command: string) {
  return QA_TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

export function qaFramework(command: string) {
  const normalized = command.toLowerCase()
  if (/\bvitest\b/.test(normalized)) return "vitest"
  if (/\bjest\b/.test(normalized)) return "jest"
  if (/\bpytest\b/.test(normalized)) return "pytest"
  if (/\bcargo test\b/.test(normalized)) return "cargo"
  if (/\bgo test\b/.test(normalized)) return "go"
  if (/\bbun(?:\s+run)?\s+test\b/.test(normalized)) return "bun"
  if (/\bpnpm(?:\s+run)?\s+test\b/.test(normalized)) return "pnpm"
  if (/\bnpm(?:\s+run)?\s+test\b/.test(normalized)) return "npm"
  if (/\byarn(?:\s+run)?\s+test\b/.test(normalized)) return "yarn"
  return null
}

export function qaCommandFailed(input: {
  command: string
  status: "completed" | "error"
  output: string
  error?: string
}) {
  if (input.status === "error") return true
  if (!isQATestCommand(input.command)) return false

  const text = `${input.output}\n${input.error ?? ""}`.toLowerCase()
  if (/\b0\s+fail(?:ed|ures?)?\b/.test(text) || /\b0\s+errors?\b/.test(text)) return false

  return (
    /\b[1-9]\d*\s+fail(?:ed|ures?)?\b/.test(text) ||
    /\btest suites:\s*[1-9]\d*\s+failed\b/i.test(input.output) ||
    /\bFAIL\b/.test(input.output) ||
    /\bfailed\b/.test(text)
  )
}

export function qaRecommendationCommands(runs: QARunExtract[]) {
  const prioritized = runs.filter((run) => run.failed)
  const selected = prioritized.length > 0 ? prioritized : runs
  return uniqueStrings(selected.map((run) => run.command.trim()).filter(Boolean)).slice(0, 3)
}

export function extractQARuns(rows: ReturnType<typeof toolResultRows>, calls: Map<string, ToolCall>): QARunExtract[] {
  return rows.flatMap((row) => {
    if (row.event_data.tool !== "bash") return []
    const callID = stringValue(row.event_data.callID)
    const call = calls.get(callID)
    const command = toolCallCommand(call)
    if (!command || !isQATestCommand(command)) return []
    const summary = toolSummary(row, call)
    if (!summary) return []
    const output = typeof row.event_data.output === "string" ? row.event_data.output : ""
    return [
      {
        callID,
        command,
        failed: qaCommandFailed({
          command,
          status: toolStatus(row.event_data.status),
          output,
          error: typeof row.event_data.error === "string" ? row.event_data.error : undefined,
        }),
        framework: qaFramework(command),
        output,
        summary,
      },
    ]
  })
}

export function readinessKinds(workflow: Workflow) {
  if (workflow === "review") {
    return { anchorKind: "review_run" as const, evidenceKind: "review_finding" as const }
  }
  if (workflow === "debug") {
    return { anchorKind: "debug_case" as const, evidenceKind: "debug_hypothesis" as const }
  }
  return { anchorKind: "qa_run" as const, evidenceKind: "qa_failure" as const }
}

export function predictionMap(predictions: Prediction[] | undefined) {
  const map = new Map<string, Prediction>()
  for (const prediction of predictions ?? []) {
    if (map.has(prediction.artifactID)) {
      throw new Error(`Duplicate prediction for artifact ${prediction.artifactID}`)
    }
    map.set(prediction.artifactID, prediction)
  }
  return map
}

export function predictionForItem(item: ReplayItem, predictions: Map<string, Prediction>) {
  const prediction = predictions.get(item.artifactID)
  if (!prediction) return
  if (prediction.sessionID && prediction.sessionID !== item.sessionID) {
    throw new Error(`Prediction session mismatch for artifact ${item.artifactID}`)
  }
  if (prediction.workflow && prediction.workflow !== item.workflow) {
    throw new Error(`Prediction workflow mismatch for artifact ${item.artifactID}`)
  }
  if (prediction.artifactKind && prediction.artifactKind !== item.artifactKind) {
    throw new Error(`Prediction artifact kind mismatch for artifact ${item.artifactID}`)
  }
  return prediction
}

export function decisionFromItem(item: ReplayItem): DecisionView {
  return {
    source: item.baseline.source,
    confidence: item.baseline.confidence,
    score: item.baseline.score ?? null,
    readiness: item.baseline.readiness ?? null,
    rank: item.baseline.rank ?? null,
  }
}

export function decisionFromPrediction(
  _item: ReplayItem,
  prediction: Prediction | undefined,
): DecisionView | undefined {
  if (!prediction) return
  return {
    source: prediction.source,
    confidence: prediction.confidence,
    score: prediction.score ?? null,
    readiness: prediction.readiness ?? null,
    rank: prediction.rank ?? null,
  }
}

export function toShadowDecision(
  decision: DecisionView | undefined,
  fallbackSource: string,
  threshold: number,
  abstainBelow: number | undefined,
): ShadowDecision {
  const confidence = decision?.confidence ?? null
  const readiness = decision?.readiness ?? null
  const available = !!decision
  const abstained =
    !available ||
    confidence === null ||
    (abstainBelow !== undefined
      ? confidence < abstainBelow || readiness === "needs_review"
      : readiness === "needs_review")
  const predictedPositive = confidence === null || abstained ? null : confidence >= threshold

  return {
    source: decision?.source ?? fallbackSource,
    available,
    confidence,
    score: decision?.score ?? null,
    readiness,
    rank: decision?.rank ?? null,
    threshold,
    abstainBelow: abstainBelow ?? null,
    predictedPositive,
    abstained,
  }
}

export function numberDelta(candidate: number | null, baseline: number | null) {
  if (candidate === null || baseline === null) return null
  return Number((candidate - baseline).toFixed(4))
}

export function metricComparison(
  baseline: number | null,
  candidate: number | null,
  direction: "higher_is_better" | "lower_is_better",
): MetricComparison {
  const delta = numberDelta(candidate, baseline)
  if (delta === null) {
    return { baseline, candidate, delta: null, direction, improvement: false, regression: false }
  }
  const improvement = direction === "higher_is_better" ? delta > 0 : delta < 0
  const regression = direction === "higher_is_better" ? delta < 0 : delta > 0
  return { baseline, candidate, delta, direction, improvement, regression }
}

export function actualPositive(label: Label) {
  if (label.artifactKind === "review_run") return label.outcome === "findings_accepted"
  if (label.artifactKind === "review_finding") return label.outcome === "accepted"
  if (label.artifactKind === "qa_run") return label.outcome === "failed" || label.outcome === "flaky"
  if (label.artifactKind === "qa_failure") return label.outcome === "reproduced"
  return label.outcome === "validated"
}

export function isResolved(label: Label) {
  return label.outcome !== "unresolved"
}

export function finiteOption(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function finiteOptionalOption(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function positiveIntegerOption(value: number | undefined, fallback: number) {
  return Math.max(1, Math.floor(finiteOption(value, fallback)))
}

export function ratio(numerator: number, denominator: number) {
  if (denominator === 0) return null
  return Number((numerator / denominator).toFixed(4))
}
