import z from "zod"
import { EventQuery } from "../replay/query"
import { Session } from "../session"
import { SessionDebug } from "../session/debug"
import { SessionID } from "../session/schema"
import { Risk } from "../risk/score"
import { Snapshot } from "../snapshot"
import { FindingSchema, type Finding } from "./finding"
import { asRecordOrUndefined } from "@/util/record"
import * as ProbabilisticRolloutReadiness from "./probabilistic-rollout-readiness"
import * as ProbabilisticRolloutSchema from "./probabilistic-rollout-schema"

const REVIEW_TOOLS = new Set([
  "impact_analyze",
  "security_scan",
  "race_scan",
  "lifecycle_scan",
  "hardcode_scan",
  "dedup_scan",
])

const QA_TEST_COMMAND_PATTERNS = [
  /\b(?:bun|pnpm|npm|yarn)\s+(?:run\s+)?test\b/i,
  /\b(?:vitest|jest|mocha|ava|pytest|rspec|phpunit)\b/i,
  /\b(?:go test|cargo test|deno test|swift test|dotnet test)\b/i,
]
const RUNTIME_DEBUG_TOOLS = new Set([
  "debug_open_case",
  "debug_capture_evidence",
  "debug_plan_instrumentation",
  "debug_propose_hypothesis",
  "debug_apply_verification",
])

export namespace ProbabilisticRollout {
  type EventRow = ReturnType<typeof EventQuery.bySessionWithTimestamp>[number]
  type ReviewFindingExtract = {
    artifactID: string
    callID: string
    tool: string
    finding: Record<string, unknown>
  }
  type QARunExtract = {
    callID: string
    command: string
    failed: boolean
    framework: string | null
    output: string
    summary: ToolSummary
  }

  export const Workflow = ProbabilisticRolloutSchema.Workflow
  export type Workflow = z.output<typeof Workflow>

  export const ArtifactKind = ProbabilisticRolloutSchema.ArtifactKind
  export type ArtifactKind = z.output<typeof ArtifactKind>

  export const LabelSource = ProbabilisticRolloutSchema.LabelSource
  export type LabelSource = z.output<typeof LabelSource>

  export const ReviewRunOutcome = ProbabilisticRolloutSchema.ReviewRunOutcome

  export const ReviewFindingOutcome = ProbabilisticRolloutSchema.ReviewFindingOutcome

  export const DebugOutcome = ProbabilisticRolloutSchema.DebugOutcome

  export const QARunOutcome = ProbabilisticRolloutSchema.QARunOutcome

  export const QAFailureOutcome = ProbabilisticRolloutSchema.QAFailureOutcome

  export const ReviewRunLabel = ProbabilisticRolloutSchema.ReviewRunLabel

  export const ReviewFindingLabel = ProbabilisticRolloutSchema.ReviewFindingLabel

  export const DebugCaseLabel = ProbabilisticRolloutSchema.DebugCaseLabel

  export const DebugHypothesisLabel = ProbabilisticRolloutSchema.DebugHypothesisLabel

  export const QARunLabel = ProbabilisticRolloutSchema.QARunLabel

  export const QAFailureLabel = ProbabilisticRolloutSchema.QAFailureLabel

  export const Label = ProbabilisticRolloutSchema.Label
  export type Label = z.output<typeof Label>

  export const LabelFile = ProbabilisticRolloutSchema.LabelFile
  export type LabelFile = z.output<typeof LabelFile>

  export const ToolSummary = ProbabilisticRolloutSchema.ToolSummary
  export type ToolSummary = z.output<typeof ToolSummary>

  export const ReplayItem = ProbabilisticRolloutSchema.ReplayItem
  export type ReplayItem = z.output<typeof ReplayItem>

  export const ReplayExport = ProbabilisticRolloutSchema.ReplayExport
  export type ReplayExport = z.output<typeof ReplayExport>

  export const ReplayReadinessGate = ProbabilisticRolloutSchema.ReplayReadinessGate
  export type ReplayReadinessGate = z.output<typeof ReplayReadinessGate>

  export const ReplayReadinessSummary = ProbabilisticRolloutSchema.ReplayReadinessSummary
  export type ReplayReadinessSummary = z.output<typeof ReplayReadinessSummary>

  export const ReplayReadinessFile = ProbabilisticRolloutSchema.ReplayReadinessFile
  export type ReplayReadinessFile = z.output<typeof ReplayReadinessFile>

  export const UserFacingReadinessState = ProbabilisticRolloutSchema.UserFacingReadinessState
  export type UserFacingReadinessState = z.output<typeof UserFacingReadinessState>

  export const CalibrationRecord = ProbabilisticRolloutSchema.CalibrationRecord
  export type CalibrationRecord = z.output<typeof CalibrationRecord>

  export const CalibrationSummary = ProbabilisticRolloutSchema.CalibrationSummary
  export type CalibrationSummary = z.output<typeof CalibrationSummary>

  export const Prediction = ProbabilisticRolloutSchema.Prediction
  export type Prediction = z.output<typeof Prediction>

  export const PredictionFile = ProbabilisticRolloutSchema.PredictionFile
  export type PredictionFile = z.output<typeof PredictionFile>

  export const MetricComparison = ProbabilisticRolloutSchema.MetricComparison
  export type MetricComparison = z.output<typeof MetricComparison>

  export const ComparisonGate = ProbabilisticRolloutSchema.ComparisonGate
  export type ComparisonGate = z.output<typeof ComparisonGate>

  export const CalibrationComparison = ProbabilisticRolloutSchema.CalibrationComparison
  export type CalibrationComparison = z.output<typeof CalibrationComparison>

  export const ShadowDecision = ProbabilisticRolloutSchema.ShadowDecision
  export type ShadowDecision = z.output<typeof ShadowDecision>

  export const ShadowRecord = ProbabilisticRolloutSchema.ShadowRecord
  export type ShadowRecord = z.output<typeof ShadowRecord>

  export const ShadowFile = ProbabilisticRolloutSchema.ShadowFile
  export type ShadowFile = z.output<typeof ShadowFile>

  export const ShadowSummary = ProbabilisticRolloutSchema.ShadowSummary
  export type ShadowSummary = z.output<typeof ShadowSummary>

  export type UserFacingReadinessKind = ProbabilisticRolloutSchema.UserFacingReadinessKind

  export const BLOCKING_GATE_NAMES = ProbabilisticRolloutReadiness.BLOCKING_GATE_NAMES

  export const readinessState = ProbabilisticRolloutReadiness.readinessState

  export const readinessStateLabel = ProbabilisticRolloutReadiness.readinessStateLabel

  export const readinessStateKind = ProbabilisticRolloutReadiness.readinessStateKind

  export const readinessCounts = ProbabilisticRolloutReadiness.readinessCounts

  export const readinessResolvedLabelsSummary = ProbabilisticRolloutReadiness.readinessResolvedLabelsSummary

  export const readinessDetailLabel = ProbabilisticRolloutReadiness.readinessDetailLabel

  export const readinessNextActionLabel = ProbabilisticRolloutReadiness.readinessNextActionLabel

  export const renderReplayReadinessReport = ProbabilisticRolloutReadiness.renderReplayReadinessReport

  export const targetedTestRecommendations = ProbabilisticRolloutReadiness.targetedTestRecommendations

  type ToolCall = {
    callID: string
    tool: string
    input: Record<string, unknown>
  }

  type DecisionView = {
    source: string
    confidence: number | null
    score: number | null | undefined
    readiness: string | null | undefined
    rank: number | null | undefined
  }

  function toolResultRows(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
    return events.filter(
      (
        row,
      ): row is EventRow & {
        event_data: Extract<EventRow["event_data"], { type: "tool.result" }>
      } => row.event_data.type === "tool.result",
    )
  }

  function graphCommitSha(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
    const snapshot = events.find((row) => row.event_data.type === "code.graph.snapshot")
    if (!snapshot || snapshot.event_data.type !== "code.graph.snapshot") return null
    return snapshot.event_data.commitSha
  }

  function summarizeDiff(diffs: Snapshot.FileDiff[]) {
    return {
      files: diffs.length,
      additions: diffs.reduce((sum, diff) => sum + diff.additions, 0),
      deletions: diffs.reduce((sum, diff) => sum + diff.deletions, 0),
    }
  }

  function touchedFiles(diffs: Snapshot.FileDiff[]) {
    return [...new Set(diffs.map((diff) => diff.file))]
  }

  function collectToolCalls(events: ReturnType<typeof EventQuery.bySessionWithTimestamp>) {
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

  function numberField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  function stringField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return typeof value === "string" ? value : undefined
  }

  function stringValue(value: unknown, fallback = "unknown") {
    return typeof value === "string" && value.length > 0 ? value : fallback
  }

  function finiteNumber(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
  }

  function toolStatus(value: unknown): ToolSummary["status"] {
    return value === "error" ? "error" : "completed"
  }

  function booleanField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return typeof value === "boolean" ? value : undefined
  }

  function recordField(input: Record<string, unknown> | undefined, key: string) {
    const value = input?.[key]
    return asRecordOrUndefined(value)
  }

  function findingField(input: Record<string, unknown> | undefined, key: string) {
    const candidate = recordField(input, key)
    if (!candidate) return undefined
    const parsed = FindingSchema.safeParse(candidate)
    return parsed.success ? parsed.data : undefined
  }

  function findingReplaySummary(finding: Finding): Record<string, unknown> {
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

  function debugMetadataCaseId(metadata: Record<string, unknown> | undefined) {
    return (
      stringField(metadata, "caseId") ??
      stringField(recordField(metadata, "debugCase"), "caseId") ??
      stringField(recordField(metadata, "debugEvidence"), "caseId") ??
      stringField(recordField(metadata, "debugInstrumentationPlan"), "caseId") ??
      stringField(recordField(metadata, "debugHypothesis"), "caseId")
    )
  }

  function debugMetadataHypothesisId(metadata: Record<string, unknown> | undefined) {
    return (
      stringField(metadata, "hypothesisId") ?? stringField(recordField(metadata, "debugHypothesis"), "hypothesisId")
    )
  }

  function toolCallCommand(call: ToolCall | undefined) {
    return stringField(call?.input, "command") ?? stringField(call?.input, "cmd")
  }

  function toolSummary(
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

  function reviewFindingTitle(tool: string, finding: Record<string, unknown>) {
    const kind =
      stringField(finding, "pattern") ?? stringField(finding, "kind") ?? stringField(finding, "resourceType") ?? tool
    const file = stringField(finding, "file") ?? "unknown"
    const line = numberField(finding, "line")
    return line !== undefined ? `${kind} at ${file}:${line}` : `${kind} at ${file}`
  }

  function reviewFindingSummary(finding: Record<string, unknown>) {
    return (
      stringField(finding, "description") ??
      stringField(finding, "suggestion") ??
      stringField(finding, "detail") ??
      stringField(finding, "fix") ??
      stringField(finding, "value") ??
      "review finding"
    )
  }

  function extractReviewFindings(
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

  function isQATestCommand(command: string) {
    return QA_TEST_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
  }

  function qaFramework(command: string) {
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

  function qaCommandFailed(input: { command: string; status: "completed" | "error"; output: string; error?: string }) {
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

  function qaRecommendationCommands(runs: QARunExtract[]) {
    const prioritized = runs.filter((run) => run.failed)
    const selected = prioritized.length > 0 ? prioritized : runs
    return [...new Set(selected.map((run) => run.command.trim()).filter(Boolean))].slice(0, 3)
  }

  function extractQARuns(rows: ReturnType<typeof toolResultRows>, calls: Map<string, ToolCall>): QARunExtract[] {
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

  function readinessKinds(workflow: Workflow) {
    if (workflow === "review") {
      return { anchorKind: "review_run" as const, evidenceKind: "review_finding" as const }
    }
    if (workflow === "debug") {
      return { anchorKind: "debug_case" as const, evidenceKind: "debug_hypothesis" as const }
    }
    return { anchorKind: "qa_run" as const, evidenceKind: "qa_failure" as const }
  }

  function predictionMap(predictions: Prediction[] | undefined) {
    const map = new Map<string, Prediction>()
    for (const prediction of predictions ?? []) {
      if (map.has(prediction.artifactID)) {
        throw new Error(`Duplicate prediction for artifact ${prediction.artifactID}`)
      }
      map.set(prediction.artifactID, prediction)
    }
    return map
  }

  function predictionForItem(item: ReplayItem, predictions: Map<string, Prediction>) {
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

  function decisionFromItem(item: ReplayItem): DecisionView {
    return {
      source: item.baseline.source,
      confidence: item.baseline.confidence,
      score: item.baseline.score ?? null,
      readiness: item.baseline.readiness ?? null,
      rank: item.baseline.rank ?? null,
    }
  }

  function decisionFromPrediction(item: ReplayItem, prediction: Prediction | undefined): DecisionView | undefined {
    if (!prediction) return
    return {
      source: prediction.source,
      confidence: prediction.confidence,
      score: prediction.score ?? null,
      readiness: prediction.readiness ?? null,
      rank: prediction.rank ?? null,
    }
  }

  function toShadowDecision(
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

  function numberDelta(candidate: number | null, baseline: number | null) {
    if (candidate === null || baseline === null) return null
    return Number((candidate - baseline).toFixed(4))
  }

  function metricComparison(
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

  export async function exportReplay(sessionID: SessionID, workflow: Workflow): Promise<ReplayExport> {
    const [session, diffs] = await Promise.all([Session.get(sessionID), Session.diff(sessionID)])
    const events = EventQuery.bySessionWithTimestamp(sessionID)
    const calls = collectToolCalls(events)
    const risk = Risk.fromSession(sessionID)
    const commitSha = graphCommitSha(events)
    const touched = touchedFiles(diffs)
    const diffSummary = summarizeDiff(diffs)

    const toolRows = toolResultRows(events)
    const toolSummaries = toolRows
      .map((row) => toolSummary(row, calls.get(stringValue(row.event_data.callID))))
      .filter((item): item is ToolSummary => !!item)

    const common = {
      sessionID,
      projectID: session.projectID,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
      context: {
        directory: session.directory,
        graphCommitSha: commitSha,
        touchedFiles: touched,
        diffSummary,
        eventCount: events.length,
        toolCount: toolSummaries.length,
      },
    }

    const items: ReplayItem[] = []

    if (workflow === "review") {
      const reviewTools = toolSummaries.filter((item) => REVIEW_TOOLS.has(item.tool))
      const findingItems = toolRows.flatMap((row) => {
        if (!REVIEW_TOOLS.has(row.event_data.tool)) return []
        return extractReviewFindings(row.event_data.tool, row.event_data.callID, row.event_data.metadata)
      })

      items.push({
        schemaVersion: 1,
        kind: "ax-code-quality-replay-item",
        workflow: "review",
        artifactKind: "review_run",
        artifactID: `review:${sessionID}`,
        ...common,
        baseline: {
          source: "Risk.assess",
          confidence: risk.confidence,
          score: risk.score,
          readiness: risk.readiness,
          rank: null,
        },
        evidence: {
          toolSummaries: reviewTools,
          summary: {
            findingCount: findingItems.length,
            scannerCount: reviewTools.length,
          },
        },
      })

      for (const item of findingItems) {
        const finding = item.finding
        items.push({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "review",
          artifactKind: "review_finding",
          artifactID: item.artifactID,
          ...common,
          baseline: {
            source: "Risk.assess",
            confidence: risk.confidence,
            score: risk.score,
            readiness: risk.readiness,
            rank: null,
          },
          evidence: {
            toolSummaries: reviewTools.filter((tool) => tool.callID === item.callID),
            summary: {
              sourceTool: item.tool,
            },
            finding: {
              sourceTool: item.tool,
              title: reviewFindingTitle(item.tool, finding),
              summary: reviewFindingSummary(finding),
              severity: stringField(finding, "severity"),
              file: stringField(finding, "file"),
              line: numberField(finding, "line"),
            },
          },
        })
      }
    }

    if (workflow === "debug") {
      const debugResults = toolRows.filter((row) => row.event_data.tool === "debug_analyze")
      const debugAnalyzeFindings = debugResults
        .map((row) => findingField(row.event_data.metadata, "finding"))
        .filter((finding): finding is Finding => !!finding)
      if (debugResults.length > 0) {
        items.push({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "debug",
          artifactKind: "debug_case",
          artifactID: `debug:${sessionID}`,
          ...common,
          baseline: {
            source: "debug_analyze",
            confidence: null,
            score: null,
            readiness: null,
            rank: null,
          },
          evidence: {
            toolSummaries: debugResults
              .map((row) => toolSummary(row, calls.get(stringValue(row.event_data.callID))))
              .filter((item): item is ToolSummary => !!item),
            summary: {
              debugAnalyzeCount: debugResults.length,
              findingCount: debugAnalyzeFindings.length,
            },
          },
        })
      }

      for (const row of debugResults) {
        const call = calls.get(stringValue(row.event_data.callID))
        const metadata = row.event_data.metadata
        const finding = findingField(metadata, "finding")
        items.push({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "debug",
          artifactKind: "debug_hypothesis",
          artifactID: `debug:${sessionID}:${row.event_data.callID}`,
          ...common,
          baseline: {
            source: "debug_analyze",
            confidence: numberField(metadata, "confidence") ?? null,
            score: null,
            readiness: null,
            rank: 1,
          },
          evidence: {
            toolSummaries: [toolSummary(row, call)].filter((item): item is ToolSummary => !!item),
            summary: {
              error: stringField(call?.input, "error"),
              hasStackTrace: typeof stringField(call?.input, "stackTrace") === "string",
              chainLength: numberField(metadata, "chainLength"),
              resolvedCount: numberField(metadata, "resolvedCount"),
              truncated: booleanField(metadata, "truncated"),
            },
            finding: finding ? findingReplaySummary(finding) : undefined,
          },
        })
      }

      const runtimeDebug = SessionDebug.load(sessionID)
      if (runtimeDebug.cases.length > 0) {
        const rollups = SessionDebug.rollup(runtimeDebug)
        for (const debugCase of runtimeDebug.cases) {
          const rollup = rollups.find((item) => item.caseId === debugCase.caseId)
          const caseEvidence = runtimeDebug.evidence.filter((item) => item.caseId === debugCase.caseId)
          const casePlans = runtimeDebug.instrumentationPlans.filter((item) => item.caseId === debugCase.caseId)
          const caseHypotheses = runtimeDebug.hypotheses
            .filter((item) => item.caseId === debugCase.caseId)
            .sort((a, b) => b.confidence - a.confidence || a.hypothesisId.localeCompare(b.hypothesisId))
          const caseToolSummaries = toolRows
            .filter((row) => RUNTIME_DEBUG_TOOLS.has(row.event_data.tool))
            .filter((row) => debugMetadataCaseId(row.event_data.metadata) === debugCase.caseId)
            .map((row) => toolSummary(row, calls.get(stringValue(row.event_data.callID))))
            .filter((item): item is ToolSummary => !!item)

          items.push({
            schemaVersion: 1,
            kind: "ax-code-quality-replay-item",
            workflow: "debug",
            artifactKind: "debug_case",
            artifactID: `debug:${sessionID}:case:${debugCase.caseId}`,
            ...common,
            title: debugCase.problem,
            baseline: {
              source: "debug_open_case",
              confidence: null,
              score: null,
              readiness: rollup?.effectiveStatus ?? debugCase.status,
              rank: null,
            },
            evidence: {
              toolSummaries: caseToolSummaries,
              summary: {
                caseId: debugCase.caseId,
                status: debugCase.status,
                effectiveStatus: rollup?.effectiveStatus ?? debugCase.status,
                evidenceCount: caseEvidence.length,
                instrumentationPlanCount: casePlans.length,
                hypothesisCount: caseHypotheses.length,
              },
            },
          })

          caseHypotheses.forEach((hypothesis, index) => {
            const staticToolSummary = hypothesis.staticAnalysis
              ? toolSummaries.find((item) => item.callID === hypothesis.staticAnalysis?.sourceCallId)
              : undefined
            const hypothesisToolSummaries = toolRows
              .filter(
                (row) =>
                  row.event_data.tool === "debug_propose_hypothesis" ||
                  row.event_data.tool === "debug_apply_verification",
              )
              .filter((row) => debugMetadataHypothesisId(row.event_data.metadata) === hypothesis.hypothesisId)
              .map((row) => toolSummary(row, calls.get(stringValue(row.event_data.callID))))
              .filter((item): item is ToolSummary => !!item)
            items.push({
              schemaVersion: 1,
              kind: "ax-code-quality-replay-item",
              workflow: "debug",
              artifactKind: "debug_hypothesis",
              artifactID: `debug:${sessionID}:hypothesis:${hypothesis.hypothesisId}`,
              ...common,
              title: hypothesis.claim,
              baseline: {
                source: "debug_propose_hypothesis",
                confidence: hypothesis.confidence,
                score: null,
                readiness: hypothesis.status,
                rank: index + 1,
              },
              evidence: {
                toolSummaries: [...hypothesisToolSummaries, ...(staticToolSummary ? [staticToolSummary] : [])],
                summary: {
                  hypothesisId: hypothesis.hypothesisId,
                  caseId: hypothesis.caseId,
                  status: hypothesis.status,
                  evidenceRefs: hypothesis.evidenceRefs,
                  staticAnalysis: hypothesis.staticAnalysis,
                },
              },
            })
          })
        }
      }
    }

    if (workflow === "qa") {
      const qaRuns = extractQARuns(toolRows, calls)
      if (qaRuns.length > 0) {
        const recommendedCommands = qaRecommendationCommands(qaRuns)
        const failingRuns = qaRuns.filter((run) => run.failed)

        items.push({
          schemaVersion: 1,
          kind: "ax-code-quality-replay-item",
          workflow: "qa",
          artifactKind: "qa_run",
          artifactID: `qa:${sessionID}`,
          ...common,
          baseline: {
            source: "qa_replay",
            confidence: failingRuns.length > 0 ? 0.85 : 0.6,
            score: null,
            readiness: failingRuns.length > 0 ? "needs_review" : "ready",
            rank: null,
          },
          evidence: {
            toolSummaries: qaRuns.map((run) => run.summary),
            summary: {
              runCount: qaRuns.length,
              failingRunCount: failingRuns.length,
              passingRunCount: qaRuns.length - failingRuns.length,
              recommendedCommands,
            },
          },
        })

        for (const [index, run] of failingRuns.entries()) {
          items.push({
            schemaVersion: 1,
            kind: "ax-code-quality-replay-item",
            workflow: "qa",
            artifactKind: "qa_failure",
            artifactID: `qa:${sessionID}:failure:${run.callID}`,
            ...common,
            title: run.command,
            baseline: {
              source: "qa_replay",
              confidence: 0.9,
              score: null,
              readiness: "needs_review",
              rank: index + 1,
            },
            evidence: {
              toolSummaries: [run.summary],
              summary: {
                command: run.command,
                framework: run.framework,
                recommendedCommand: run.command,
                failureReason: run.summary.status === "error" ? "tool_error" : "test_failure",
              },
            },
          })
        }
      }
    }

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-replay-export",
      workflow,
      sessionID,
      exportedAt: new Date().toISOString(),
      items,
    }
  }

  export function summarizeReplayReadiness(input: { replay: ReplayExport; labels?: Label[] }) {
    const labels = (input.labels ?? []).filter(
      (label) => label.sessionID === input.replay.sessionID && label.workflow === input.replay.workflow,
    )
    const labelMap = new Map(labels.map((label) => [label.artifactID, label]))
    const { anchorKind, evidenceKind } = readinessKinds(input.replay.workflow)
    const anchorItems = input.replay.items.filter((item) => item.artifactKind === anchorKind).length
    const evidenceItems = input.replay.items.filter((item) => item.artifactKind === evidenceKind).length
    const toolSummaryCount = input.replay.items.reduce((sum, item) => sum + item.evidence.toolSummaries.length, 0)
    const labeledItems = input.replay.items.filter((item) => labelMap.has(item.artifactID)).length
    const unresolvedLabeledItems = input.replay.items.filter((item) => {
      const label = labelMap.get(item.artifactID)
      return label?.outcome === "unresolved"
    }).length
    const resolvedLabeledItems = input.replay.items.filter((item) => {
      const label = labelMap.get(item.artifactID)
      return label && label.outcome !== "unresolved"
    }).length
    const missingLabels = Math.max(input.replay.items.length - labeledItems, 0)

    const exportable = input.replay.items.length > 0 && anchorItems > 0
    const hasWorkflowEvidence = evidenceItems > 0 || toolSummaryCount > 0
    const qaRecommendedCommands =
      input.replay.workflow !== "qa"
        ? []
        : [
            ...new Set(
              input.replay.items.flatMap((item) => {
                const directCommand = stringField(item.evidence.summary, "command")
                if (item.artifactKind === "qa_failure" && directCommand) return [directCommand]
                const recommended = item.evidence.summary?.["recommendedCommands"]
                if (!Array.isArray(recommended)) return []
                return recommended.filter(
                  (value): value is string => typeof value === "string" && value.trim().length > 0,
                )
              }),
            ),
          ].slice(0, 3)

    const gates: ReplayReadinessGate[] = [
      {
        name: "exportable-session-shape",
        status: exportable ? "pass" : "fail",
        detail: exportable
          ? `${anchorItems} anchor item(s) exported for workflow ${input.replay.workflow}`
          : `no anchor items exported for workflow ${input.replay.workflow}`,
      },
      {
        name: "workflow-evidence-present",
        status: hasWorkflowEvidence ? "pass" : "fail",
        detail: hasWorkflowEvidence
          ? `${evidenceItems} evidence item(s) and ${toolSummaryCount} tool summary record(s) exported`
          : "no workflow evidence was exported from the session",
      },
      {
        name: "label-coverage",
        status: labeledItems === 0 ? "warn" : missingLabels === 0 && unresolvedLabeledItems === 0 ? "pass" : "warn",
        detail:
          labeledItems === 0
            ? "no labels recorded for exported artifacts"
            : missingLabels === 0 && unresolvedLabeledItems === 0
              ? `all ${labeledItems} exported artifact(s) are labeled and resolved`
              : `${labeledItems} labeled, ${missingLabels} missing, ${unresolvedLabeledItems} unresolved`,
      },
      {
        name: "benchmark-readiness",
        status: resolvedLabeledItems > 0 ? "pass" : "warn",
        detail:
          resolvedLabeledItems > 0
            ? `${resolvedLabeledItems} resolved label(s) available for calibration or benchmark work`
            : "no resolved labels available yet for calibration or benchmark work",
      },
    ]

    if (input.replay.workflow === "qa") {
      gates.push({
        name: "targeted-test-recommendation",
        status: qaRecommendedCommands.length > 0 ? "pass" : "warn",
        detail:
          qaRecommendedCommands.length > 0
            ? `prioritize these QA command(s): ${qaRecommendedCommands.join(" | ")}`
            : "no targeted QA command recommendation could be derived from the recorded test evidence",
      })
    }

    const nextAction = !exportable
      ? input.replay.workflow === "qa"
        ? "Run one or more test commands in this session to capture QA evidence."
        : `Capture ${input.replay.workflow} workflow activity before exporting replay again.`
      : !hasWorkflowEvidence
        ? input.replay.workflow === "qa"
          ? "Run the project's test workflow until this session records test output."
          : `Run the ${input.replay.workflow} workflow until it produces evidence-bearing tool output.`
        : labeledItems === 0
          ? input.replay.workflow === "qa"
            ? "Record QA outcomes for the exported test artifacts."
            : "Record outcome labels for the exported artifacts."
          : resolvedLabeledItems === 0
            ? input.replay.workflow === "qa"
              ? "Resolve at least one QA label before benchmarking."
              : "Resolve at least one exported artifact label before benchmarking."
            : missingLabels > 0 || unresolvedLabeledItems > 0
              ? input.replay.workflow === "qa"
                ? "Finish QA label coverage for the remaining exported test artifacts."
                : "Finish label coverage for the remaining exported artifacts."
              : input.replay.workflow === "qa" && qaRecommendedCommands.length > 0
                ? `Run targeted QA verification first: ${qaRecommendedCommands.join(" | ")}`
                : null

    return ReplayReadinessSummary.parse({
      schemaVersion: 1,
      kind: "ax-code-quality-replay-readiness-summary",
      workflow: input.replay.workflow,
      sessionID: input.replay.sessionID,
      projectID: input.replay.items[0]?.projectID ?? labels[0]?.projectID ?? "unknown",
      exportedAt: input.replay.exportedAt,
      totalItems: input.replay.items.length,
      anchorItems,
      evidenceItems,
      toolSummaryCount,
      labeledItems,
      resolvedLabeledItems,
      unresolvedLabeledItems,
      missingLabels,
      readyForBenchmark: exportable && hasWorkflowEvidence && resolvedLabeledItems > 0,
      overallStatus: ProbabilisticRolloutReadiness.summarizeReplayReadinessOverall(gates),
      nextAction,
      gates,
    })
  }

  function actualPositive(label: Label) {
    if (label.artifactKind === "review_run") return label.outcome === "findings_accepted"
    if (label.artifactKind === "review_finding") return label.outcome === "accepted"
    if (label.artifactKind === "qa_run") return label.outcome === "failed" || label.outcome === "flaky"
    if (label.artifactKind === "qa_failure") return label.outcome === "reproduced"
    return label.outcome === "validated"
  }

  function isResolved(label: Label) {
    return label.outcome !== "unresolved"
  }

  function finiteOption(value: number | undefined, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback
  }

  function finiteOptionalOption(value: number | undefined) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  }

  function positiveIntegerOption(value: number | undefined, fallback: number) {
    return Math.max(1, Math.floor(finiteOption(value, fallback)))
  }

  export function calibrationRecords(
    items: ReplayItem[],
    labels: Label[],
    options?: { threshold?: number; abstainBelow?: number; predictions?: Prediction[] },
  ): CalibrationRecord[] {
    const threshold = finiteOption(options?.threshold, 0.5)
    const abstainBelow = finiteOptionalOption(options?.abstainBelow)
    const predictions = predictionMap(options?.predictions)
    const labelMap = new Map(labels.map((label) => [label.artifactID, label]))
    const records: CalibrationRecord[] = []

    for (const item of items) {
      const decision = options?.predictions
        ? decisionFromPrediction(item, predictionForItem(item, predictions))
        : decisionFromItem(item)
      if (!decision) continue
      const confidence = decision.confidence
      if (typeof confidence !== "number") continue
      const label = labelMap.get(item.artifactID)
      if (!label || !isResolved(label)) continue
      if (label.workflow !== item.workflow || label.artifactKind !== item.artifactKind) continue

      const abstained =
        abstainBelow !== undefined
          ? confidence < abstainBelow || decision.readiness === "needs_review"
          : decision.readiness === "needs_review"

      records.push({
        artifactID: item.artifactID,
        sessionID: item.sessionID,
        workflow: item.workflow,
        artifactKind: item.artifactKind,
        source: decision.source,
        confidence,
        score: decision.score ?? null,
        readiness: decision.readiness ?? null,
        actualPositive: actualPositive(label),
        predictedPositive: !abstained && confidence >= threshold,
        abstained,
        outcome: label.outcome,
      })
    }

    return records
  }

  function ratio(numerator: number, denominator: number) {
    if (denominator === 0) return null
    return Number((numerator / denominator).toFixed(4))
  }

  function topKPrecision(records: CalibrationRecord[], size: number) {
    if (records.length === 0) return null
    const grouped = new Map<string, CalibrationRecord[]>()
    for (const record of records) {
      const key = `${record.workflow}:${record.artifactKind}:${record.sessionID}`
      const list = grouped.get(key) ?? []
      list.push(record)
      grouped.set(key, list)
    }

    let hits = 0
    let total = 0
    for (const group of grouped.values()) {
      const top = group
        .filter((record) => !record.abstained)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, size)
      for (const record of top) {
        total++
        if (record.actualPositive) hits++
      }
    }

    return ratio(hits, total)
  }

  function calibrationBins(records: CalibrationRecord[], binCount: number) {
    const bins = Array.from({ length: binCount }, (_, index) => ({
      start: index / binCount,
      end: (index + 1) / binCount,
      items: [] as CalibrationRecord[],
    }))

    for (const record of records) {
      const normalized = Math.min(Math.max(record.confidence, 0), 0.999999)
      const index = Math.min(binCount - 1, Math.floor(normalized * binCount))
      bins[index]?.items.push(record)
    }

    return bins.map((bin) => {
      if (bin.items.length === 0) {
        return {
          start: Number(bin.start.toFixed(2)),
          end: Number(bin.end.toFixed(2)),
          count: 0,
          avgConfidence: null,
          empiricalRate: null,
        }
      }
      const avgConfidence = bin.items.reduce((sum, item) => sum + item.confidence, 0) / bin.items.length
      const empiricalRate = bin.items.filter((item) => item.actualPositive).length / bin.items.length
      return {
        start: Number(bin.start.toFixed(2)),
        end: Number(bin.end.toFixed(2)),
        count: bin.items.length,
        avgConfidence: Number(avgConfidence.toFixed(4)),
        empiricalRate: Number(empiricalRate.toFixed(4)),
      }
    })
  }

  export function summarizeCalibration(
    items: ReplayItem[],
    labels: Label[],
    options?: { threshold?: number; abstainBelow?: number; bins?: number; predictions?: Prediction[]; source?: string },
  ): CalibrationSummary {
    const threshold = finiteOption(options?.threshold, 0.5)
    const abstainBelow = finiteOptionalOption(options?.abstainBelow) ?? null
    const binCount = positiveIntegerOption(options?.bins, 5)
    const predictions = predictionMap(options?.predictions)
    const records = calibrationRecords(items, labels, {
      threshold,
      abstainBelow: abstainBelow ?? undefined,
      predictions: options?.predictions,
    })
    const considered = records.filter((record) => !record.abstained)
    const scoredItems = items.filter((item) => {
      const decision = options?.predictions
        ? decisionFromPrediction(item, predictionForItem(item, predictions))
        : decisionFromItem(item)
      return typeof decision?.confidence === "number"
    }).length
    const missingPredictionItems = options?.predictions
      ? items.filter((item) => !predictionForItem(item, predictions)).length
      : 0

    const positives = considered.filter((record) => record.actualPositive).length
    const negatives = considered.length - positives
    const tp = considered.filter((record) => record.predictedPositive && record.actualPositive).length
    const fp = considered.filter((record) => record.predictedPositive && !record.actualPositive).length
    const tn = considered.filter((record) => !record.predictedPositive && !record.actualPositive).length
    const fn = considered.filter((record) => !record.predictedPositive && record.actualPositive).length
    const bins = calibrationBins(records, binCount)
    const calibrationError =
      records.length === 0
        ? null
        : Number(
            (
              bins.reduce((sum, bin) => {
                if (bin.count === 0 || bin.avgConfidence === null || bin.empiricalRate === null) return sum
                return sum + Math.abs(bin.avgConfidence - bin.empiricalRate) * bin.count
              }, 0) / records.length
            ).toFixed(4),
          )

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-summary",
      source: options?.source ?? options?.predictions?.[0]?.source ?? "baseline",
      threshold,
      abstainBelow,
      totalItems: items.length,
      scoredItems,
      missingPredictionItems,
      labeledItems: records.length,
      consideredItems: considered.length,
      abstainedItems: records.filter((record) => record.abstained).length,
      positives,
      negatives,
      precision: ratio(tp, tp + fp),
      recall: ratio(tp, tp + fn),
      falsePositiveRate: ratio(fp, fp + tn),
      falseNegativeRate: ratio(fn, fn + tp),
      precisionAt1: topKPrecision(records, 1),
      precisionAt3: topKPrecision(records, 3),
      calibrationError,
      bins,
    }
  }

  export function renderCalibrationReport(summary: CalibrationSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality calibration report")
    lines.push("")
    lines.push(`- source: ${summary.source}`)
    lines.push(`- threshold: ${summary.threshold}`)
    lines.push(`- abstain below: ${summary.abstainBelow ?? "off"}`)
    lines.push(`- total items: ${summary.totalItems}`)
    lines.push(`- scored items: ${summary.scoredItems}`)
    lines.push(`- missing prediction items: ${summary.missingPredictionItems}`)
    lines.push(`- labeled items: ${summary.labeledItems}`)
    lines.push(`- considered items: ${summary.consideredItems}`)
    lines.push(`- abstained items: ${summary.abstainedItems}`)
    lines.push(`- positives: ${summary.positives}`)
    lines.push(`- negatives: ${summary.negatives}`)
    lines.push("")
    lines.push("Metrics:")
    lines.push(`- precision: ${summary.precision ?? "n/a"}`)
    lines.push(`- recall: ${summary.recall ?? "n/a"}`)
    lines.push(`- false positive rate: ${summary.falsePositiveRate ?? "n/a"}`)
    lines.push(`- false negative rate: ${summary.falseNegativeRate ?? "n/a"}`)
    lines.push(`- precision@1: ${summary.precisionAt1 ?? "n/a"}`)
    lines.push(`- precision@3: ${summary.precisionAt3 ?? "n/a"}`)
    lines.push(`- calibration error: ${summary.calibrationError ?? "n/a"}`)
    lines.push("")
    lines.push("Calibration bins:")
    for (const bin of summary.bins) {
      lines.push(
        `- ${bin.start.toFixed(2)}-${bin.end.toFixed(2)}: count=${bin.count}, avg_confidence=${bin.avgConfidence ?? "n/a"}, empirical_rate=${bin.empiricalRate ?? "n/a"}`,
      )
    }
    lines.push("")
    return lines.join("\n")
  }

  export function compareCalibrationSummaries(
    baseline: CalibrationSummary,
    candidate: CalibrationSummary,
    options?: {
      maxPrecisionDrop?: number
      maxRecallDrop?: number
      maxFalsePositiveRateIncrease?: number
      maxFalseNegativeRateIncrease?: number
      maxCalibrationErrorIncrease?: number
    },
  ): CalibrationComparison {
    const metrics = {
      precision: metricComparison(baseline.precision, candidate.precision, "higher_is_better"),
      recall: metricComparison(baseline.recall, candidate.recall, "higher_is_better"),
      falsePositiveRate: metricComparison(baseline.falsePositiveRate, candidate.falsePositiveRate, "lower_is_better"),
      falseNegativeRate: metricComparison(baseline.falseNegativeRate, candidate.falseNegativeRate, "lower_is_better"),
      precisionAt1: metricComparison(baseline.precisionAt1, candidate.precisionAt1, "higher_is_better"),
      precisionAt3: metricComparison(baseline.precisionAt3, candidate.precisionAt3, "higher_is_better"),
      calibrationError: metricComparison(baseline.calibrationError, candidate.calibrationError, "lower_is_better"),
    }

    const gates: ComparisonGate[] = []
    const precisionDrop = numberDelta(candidate.precision, baseline.precision)
    const recallDrop = numberDelta(candidate.recall, baseline.recall)
    const falsePositiveIncrease = numberDelta(candidate.falsePositiveRate, baseline.falsePositiveRate)
    const falseNegativeIncrease = numberDelta(candidate.falseNegativeRate, baseline.falseNegativeRate)
    const calibrationErrorIncrease = numberDelta(candidate.calibrationError, baseline.calibrationError)

    const maxPrecisionDrop = finiteOption(options?.maxPrecisionDrop, 0.02)
    const maxRecallDrop = finiteOption(options?.maxRecallDrop, 0.02)
    const maxFalsePositiveRateIncrease = finiteOption(options?.maxFalsePositiveRateIncrease, 0.01)
    const maxFalseNegativeRateIncrease = finiteOption(options?.maxFalseNegativeRateIncrease, 0.01)
    const maxCalibrationErrorIncrease = finiteOption(options?.maxCalibrationErrorIncrease, 0.02)

    gates.push({
      name: "dataset-consistency",
      status:
        baseline.totalItems === candidate.totalItems && baseline.labeledItems === candidate.labeledItems
          ? "pass"
          : "warn",
      detail: `baseline total/labeled=${baseline.totalItems}/${baseline.labeledItems}, candidate total/labeled=${candidate.totalItems}/${candidate.labeledItems}`,
    })
    gates.push({
      name: "precision-regression",
      status: precisionDrop !== null && precisionDrop < -maxPrecisionDrop ? "fail" : "pass",
      detail: `candidate precision delta=${precisionDrop ?? "n/a"} (allowed drop ${maxPrecisionDrop})`,
    })
    gates.push({
      name: "recall-regression",
      status: recallDrop !== null && recallDrop < -maxRecallDrop ? "fail" : "pass",
      detail: `candidate recall delta=${recallDrop ?? "n/a"} (allowed drop ${maxRecallDrop})`,
    })
    gates.push({
      name: "false-positive-rate",
      status: falsePositiveIncrease !== null && falsePositiveIncrease > maxFalsePositiveRateIncrease ? "fail" : "pass",
      detail: `candidate false positive rate delta=${falsePositiveIncrease ?? "n/a"} (allowed increase ${maxFalsePositiveRateIncrease})`,
    })
    gates.push({
      name: "false-negative-rate",
      status: falseNegativeIncrease !== null && falseNegativeIncrease > maxFalseNegativeRateIncrease ? "fail" : "pass",
      detail: `candidate false negative rate delta=${falseNegativeIncrease ?? "n/a"} (allowed increase ${maxFalseNegativeRateIncrease})`,
    })
    gates.push({
      name: "calibration-error",
      status:
        calibrationErrorIncrease !== null && calibrationErrorIncrease > maxCalibrationErrorIncrease ? "warn" : "pass",
      detail: `candidate calibration error delta=${calibrationErrorIncrease ?? "n/a"} (allowed increase ${maxCalibrationErrorIncrease})`,
    })

    const overallStatus = gates.some((gate) => gate.status === "fail")
      ? "fail"
      : gates.some((gate) => gate.status === "warn")
        ? "warn"
        : "pass"

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-calibration-comparison",
      baselineSource: baseline.source,
      candidateSource: candidate.source,
      overallStatus,
      dataset: {
        baselineTotalItems: baseline.totalItems,
        candidateTotalItems: candidate.totalItems,
        baselineScoredItems: baseline.scoredItems,
        candidateScoredItems: candidate.scoredItems,
        baselineLabeledItems: baseline.labeledItems,
        candidateLabeledItems: candidate.labeledItems,
        baselineMissingPredictionItems: baseline.missingPredictionItems,
        candidateMissingPredictionItems: candidate.missingPredictionItems,
      },
      metrics,
      gates,
    }
  }

  export function renderCalibrationComparisonReport(comparison: CalibrationComparison) {
    const lines: string[] = []
    lines.push("## ax-code quality calibration comparison")
    lines.push("")
    lines.push(`- baseline source: ${comparison.baselineSource}`)
    lines.push(`- candidate source: ${comparison.candidateSource}`)
    lines.push(`- overall status: ${comparison.overallStatus}`)
    lines.push("")
    lines.push("Dataset:")
    lines.push(
      `- baseline total/labeled/scored: ${comparison.dataset.baselineTotalItems}/${comparison.dataset.baselineLabeledItems}/${comparison.dataset.baselineScoredItems}`,
    )
    lines.push(
      `- candidate total/labeled/scored: ${comparison.dataset.candidateTotalItems}/${comparison.dataset.candidateLabeledItems}/${comparison.dataset.candidateScoredItems}`,
    )
    lines.push(`- baseline missing prediction items: ${comparison.dataset.baselineMissingPredictionItems}`)
    lines.push(`- candidate missing prediction items: ${comparison.dataset.candidateMissingPredictionItems}`)
    lines.push("")
    lines.push("Metrics:")
    for (const [name, metric] of Object.entries(comparison.metrics)) {
      lines.push(
        `- ${name}: baseline=${metric.baseline ?? "n/a"}, candidate=${metric.candidate ?? "n/a"}, delta=${metric.delta ?? "n/a"}`,
      )
    }
    lines.push("")
    lines.push("Gates:")
    for (const gate of comparison.gates) {
      lines.push(`- [${gate.status}] ${gate.name}: ${gate.detail}`)
    }
    lines.push("")
    return lines.join("\n")
  }

  export function buildShadowFile(
    items: ReplayItem[],
    predictionFile: PredictionFile,
    options?: {
      baselineThreshold?: number
      baselineAbstainBelow?: number
      candidateThreshold?: number
      candidateAbstainBelow?: number
    },
  ): ShadowFile {
    const predictions = predictionMap(predictionFile.predictions)
    const baselineThreshold = finiteOption(options?.baselineThreshold, 0.5)
    const candidateThreshold = finiteOption(options?.candidateThreshold, 0.5)
    const baselineAbstainBelow = finiteOptionalOption(options?.baselineAbstainBelow)
    const candidateAbstainBelow = finiteOptionalOption(options?.candidateAbstainBelow)
    const capturedAt = new Date().toISOString()

    const records: ShadowRecord[] = items.map((item) => {
      const baselineDecision = toShadowDecision(
        decisionFromItem(item),
        item.baseline.source,
        baselineThreshold,
        baselineAbstainBelow,
      )
      const candidateDecision = toShadowDecision(
        decisionFromPrediction(item, predictionForItem(item, predictions)),
        predictionFile.source,
        candidateThreshold,
        candidateAbstainBelow,
      )
      const confidenceDelta =
        baselineDecision.confidence === null || candidateDecision.confidence === null
          ? null
          : Number((candidateDecision.confidence - baselineDecision.confidence).toFixed(4))
      const baselineRank = baselineDecision.rank ?? null
      const candidateRank = candidateDecision.rank ?? null
      const rankDelta = baselineRank === null || candidateRank === null ? null : candidateRank - baselineRank

      return {
        schemaVersion: 1,
        kind: "ax-code-quality-shadow-record",
        artifactID: item.artifactID,
        sessionID: item.sessionID,
        workflow: item.workflow,
        artifactKind: item.artifactKind,
        title: item.title,
        createdAt: item.createdAt,
        capturedAt,
        baseline: baselineDecision,
        candidate: candidateDecision,
        disagreement: {
          candidateMissing: !candidateDecision.available,
          predictionChanged:
            baselineDecision.predictedPositive !== null &&
            candidateDecision.predictedPositive !== null &&
            baselineDecision.predictedPositive !== candidateDecision.predictedPositive,
          abstentionChanged: baselineDecision.abstained !== candidateDecision.abstained,
          confidenceDelta,
          rankDelta,
        },
      }
    })

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-file",
      baselineSource: items[0]?.baseline.source ?? "baseline",
      candidateSource: predictionFile.source,
      generatedAt: new Date().toISOString(),
      records,
    }
  }

  export function summarizeShadowFile(shadow: ShadowFile): ShadowSummary {
    const comparable = shadow.records.filter((record) => record.baseline.available && record.candidate.available)
    const confidenceDeltas = comparable
      .map((record) => record.disagreement.confidenceDelta)
      .filter((delta): delta is number => delta !== null)
    const avgConfidenceDelta =
      confidenceDeltas.length === 0
        ? null
        : Number((confidenceDeltas.reduce((sum, delta) => sum + delta, 0) / confidenceDeltas.length).toFixed(4))
    const maxAbsConfidenceDelta =
      confidenceDeltas.length === 0
        ? null
        : Number(Math.max(...confidenceDeltas.map((delta) => Math.abs(delta))).toFixed(4))

    return {
      schemaVersion: 1,
      kind: "ax-code-quality-shadow-summary",
      baselineSource: shadow.baselineSource,
      candidateSource: shadow.candidateSource,
      totalItems: shadow.records.length,
      comparableItems: comparable.length,
      missingCandidateItems: shadow.records.filter((record) => record.disagreement.candidateMissing).length,
      predictionChangedItems: shadow.records.filter((record) => record.disagreement.predictionChanged).length,
      abstentionChangedItems: shadow.records.filter((record) => record.disagreement.abstentionChanged).length,
      avgConfidenceDelta,
      maxAbsConfidenceDelta,
      candidatePromotions: shadow.records.filter((record) => (record.disagreement.rankDelta ?? 0) < 0).length,
      candidateDemotions: shadow.records.filter((record) => (record.disagreement.rankDelta ?? 0) > 0).length,
    }
  }

  export function renderShadowReport(summary: ShadowSummary) {
    const lines: string[] = []
    lines.push("## ax-code quality shadow report")
    lines.push("")
    lines.push(`- baseline source: ${summary.baselineSource}`)
    lines.push(`- candidate source: ${summary.candidateSource}`)
    lines.push(`- total items: ${summary.totalItems}`)
    lines.push(`- comparable items: ${summary.comparableItems}`)
    lines.push(`- missing candidate items: ${summary.missingCandidateItems}`)
    lines.push(`- prediction changed items: ${summary.predictionChangedItems}`)
    lines.push(`- abstention changed items: ${summary.abstentionChangedItems}`)
    lines.push(`- avg confidence delta: ${summary.avgConfidenceDelta ?? "n/a"}`)
    lines.push(`- max abs confidence delta: ${summary.maxAbsConfidenceDelta ?? "n/a"}`)
    lines.push(`- candidate promotions: ${summary.candidatePromotions}`)
    lines.push(`- candidate demotions: ${summary.candidateDemotions}`)
    lines.push("")
    return lines.join("\n")
  }
}
