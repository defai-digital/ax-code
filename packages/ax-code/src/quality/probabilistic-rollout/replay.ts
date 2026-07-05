import { EventQuery } from "../../replay/query"
import { Session } from "../../session"
import { SessionDebug } from "../../session/debug"
import { SessionID } from "../../session/schema"
import { Risk } from "../../risk/score"
import * as ProbabilisticRolloutReadiness from "../probabilistic-rollout-readiness"
import * as ProbabilisticRolloutSchema from "../probabilistic-rollout-schema"
import {
  REVIEW_TOOLS,
  RUNTIME_DEBUG_TOOLS,
  type ReplayExport,
  type ReplayItem,
  type ReplayReadinessGate,
  type Label,
  type Workflow,
  collectToolCalls,
  debugMetadataCaseId,
  debugMetadataHypothesisId,
  extractQARuns,
  extractReviewFindings,
  findingField,
  findingReplaySummary,
  graphCommitSha,
  numberField,
  readinessKinds,
  stringField,
  stringValue,
  summarizeDiff,
  toolResultRows,
  toolSummary,
  touchedFiles,
  type ToolSummary,
  reviewFindingTitle,
  reviewFindingSummary,
  qaRecommendationCommands,
  booleanField,
} from "./helpers"

export async function exportReplay(sessionID: SessionID, workflow: Workflow): Promise<ReplayExport> {
  const [session, diffs] = await Promise.all([Session.get(sessionID), Session.diff(sessionID)])
  const events = EventQuery.bySessionWithTimestamp(sessionID)
  const calls = collectToolCalls(events)
  const risk = Risk.fromSession(sessionID)
  const commitSha = graphCommitSha(events)
  const touched = touchedFiles(diffs)
  const diffSummary = summarizeDiff(diffs)

  const tRows = toolResultRows(events)
  const toolSummaries = tRows
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
    const findingItems = tRows.flatMap((row) => {
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
    const debugResults = tRows.filter((row) => row.event_data.tool === "debug_analyze")
    const debugAnalyzeFindings = debugResults
      .map((row) => findingField(row.event_data.metadata, "finding"))
      .filter((finding): finding is import("../finding").Finding => !!finding)
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
        const caseToolSummaries = tRows
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
          const hypothesisToolSummaries = tRows
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
    const qaRuns = extractQARuns(tRows, calls)
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

  return ProbabilisticRolloutSchema.ReplayReadinessSummary.parse({
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
