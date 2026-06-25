import { ModelID, ProviderID } from "../../provider/schema"
import { Session } from "../../session"
import { MessageV2 } from "../../session/message-v2"
import { sessionAssistantPath, zeroTokenUsage } from "../../session/prompt-message-builders"
import { MessageID, PartID } from "../../session/schema"
import { Log } from "../../util/log"
import { defaultWorkflowArtifactRedaction } from "../artifact"
import { classifyWorkflowFindingArtifact, evaluateWorkflowRun, type WorkflowEvalFindingStatus } from "../eval"
import {
  WorkflowArtifactID,
  WorkflowArtifactRecord,
  WorkflowBudgetLedgerEntry,
  WorkflowRunDetail,
  WorkflowRunID,
} from "../state"
import {
  countByStatus,
  finalReportVerification,
  uniqueEvidenceRefs,
} from "./internal"
import { appendArtifact, getDetail } from "./index"

const log = Log.create({ service: "workflow.run.final-report" })
const WORKFLOW_RUNTIME_MODEL_ID = ModelID.make("workflow-runtime")
const WORKFLOW_RUNTIME_PROVIDER_ID = ProviderID.axCode

export const WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID = "workflow-final-report"

export async function ensureFinalReportArtifact(runID: WorkflowRunID): Promise<WorkflowArtifactRecord | undefined> {
  const detail = await getDetail(runID)
  const existing = detail.artifacts.find(
    (artifact) => artifact.specArtifactID === WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
  )
  if (existing) {
    await syncFinalReportToParentSession(detail, existing)
    return existing
  }

  const phaseCounts = countByStatus(detail.phases.map((phase) => phase.status))
  const childCounts = countByStatus(detail.children.map((child) => child.status))
  const artifactCounts = countByStatus(detail.artifacts.map((artifact) => artifact.kind))
  const verification = finalReportVerification(detail)
  const findings = finalReportFindings(detail)
  const evidenceRefs = finalReportEvidenceRefs(detail)
  const evaluation = evaluateWorkflowRun({ run: detail, now: detail.time.completed ?? Date.now() })
  const redactionSummary = finalReportRedactionSummary(detail)
  const summary = [
    `Workflow final report: ${detail.spec.name}`,
    `Status: ${detail.status}`,
    `Verification: ${verification.status} (${verification.mode})`,
    ...verification.summaryLines,
    `Eval decision: ${evaluation.decision}.`,
    `Evidence refs: ${formatEvidenceRefs(evidenceRefs)}`,
    `Budget limits: ${formatWorkflowBudgetLimit(detail.budget)}`,
    `Pacing: ${formatWorkflowPacing(detail.spec.pacing)}`,
    findingSummaryLine(findings),
    ...findingBucketSummaryLines(findings),
    `Phases: ${detail.phases.length} total, ${phaseCounts.completed ?? 0} completed, ${phaseCounts.failed ?? 0} failed, ${phaseCounts.cancelled ?? 0} cancelled.`,
    `Children: ${detail.children.length} total, ${childCounts.completed ?? 0} completed, ${childCounts.failed ?? 0} failed, ${childCounts.cancelled ?? 0} cancelled.`,
    `Artifacts: ${detail.artifacts.length} existing, verification envelopes: ${detail.verificationEnvelopeIDs.length}.`,
    `Redaction: ${formatRedactionSummary(redactionSummary)}`,
  ].join("\n")

  const artifact = await appendArtifact({
    runID,
    specArtifactID: WORKFLOW_FINAL_REPORT_SPEC_ARTIFACT_ID,
    kind: "summary",
    retention: "session",
    exposeToMainContext: detail.spec.synthesis.exposeToMainContext,
    summary,
    payload: {
      kind: "workflow-final-report",
      runID: detail.id,
      status: detail.status,
      sourceTemplateID: detail.sourceTemplateID,
      spec: {
        id: detail.spec.id,
        name: detail.spec.name,
        tags: detail.spec.tags,
      },
      phaseCounts,
      childCounts,
      artifactCounts,
      evidenceRefs,
      verification,
      findings,
      evaluation,
      redactionSummary,
      budgetLimit: detail.budget,
      pacing: detail.spec.pacing,
      budgetUsage: detail.budgetUsage,
      budgetLedger: detail.budgetLedger.map(compactBudgetLedgerEntry),
      verificationEnvelopeIDs: detail.verificationEnvelopeIDs,
      exposedArtifactIDs: detail.artifacts
        .filter((artifact) => artifact.exposeToMainContext)
        .map((artifact) => artifact.id),
    },
    redaction: { status: "pending", summary: "Generated compact workflow final report from durable run state." },
    evidenceRefs,
  })
  await syncFinalReportToParentSession(detail, artifact)
  return artifact
}

function compactBudgetLedgerEntry(entry: WorkflowBudgetLedgerEntry) {
  return {
    id: entry.id,
    phaseID: entry.phaseID,
    childID: entry.childID,
    kind: entry.kind,
    usageDelta: entry.usageDelta,
    message: entry.message,
    time: entry.time,
  }
}

function finalReportEvidenceRefs(detail: WorkflowRunDetail): WorkflowArtifactRecord["evidenceRefs"] {
  return uniqueEvidenceRefs([
    ...detail.artifacts.map((artifact) => ({ kind: "artifact" as const, id: artifact.id })),
    ...detail.verificationEnvelopeIDs.map((id) => ({ kind: "verification" as const, id })),
  ])
}

function finalReportRedactionSummary(detail: WorkflowRunDetail) {
  const counts: Record<WorkflowArtifactRedactionStatus, number> = {
    none: 0,
    redacted: 0,
    pending: 0,
  }
  const summaries: string[] = []

  for (const artifact of detail.artifacts) {
    const redaction = artifact.redaction ?? defaultWorkflowArtifactRedaction(artifact)
    counts[redaction.status]++
    if (redaction.summary) summaries.push(`${artifact.specArtifactID ?? artifact.id}: ${redaction.summary}`)
  }

  return {
    counts,
    summaries: summaries.slice(0, 12),
    omittedSummaryCount: Math.max(0, summaries.length - 12),
  }
}

type WorkflowArtifactRedactionStatus = NonNullable<WorkflowArtifactRecord["redaction"]>["status"]

function formatRedactionSummary(summary: ReturnType<typeof finalReportRedactionSummary>) {
  const base = `none=${summary.counts.none}, redacted=${summary.counts.redacted}, pending=${summary.counts.pending}`
  if (summary.summaries.length === 0) return `${base}.`
  const suffix = summary.omittedSummaryCount > 0 ? `; +${summary.omittedSummaryCount} more summaries` : ""
  return `${base}; ${summary.summaries.join("; ")}${suffix}.`
}

function formatEvidenceRefs(evidenceRefs: WorkflowArtifactRecord["evidenceRefs"], max = 12) {
  if (evidenceRefs.length === 0) return "none."
  const shown = evidenceRefs.slice(0, max).map((ref) => `${ref.kind}:${ref.id}`)
  const suffix = evidenceRefs.length > max ? `, +${evidenceRefs.length - max} more` : ""
  return `${shown.join(", ")}${suffix}.`
}

function formatWorkflowBudgetLimit(budget: WorkflowRunDetail["budget"]) {
  return [
    `tokens ${budget.maxTotalTokens}`,
    `child agents ${budget.maxTotalAgents}`,
    `concurrent ${budget.maxConcurrentAgents}`,
    `tool calls ${budget.maxToolCalls}`,
    `retries ${budget.maxRetries}`,
    `wall ${formatDurationMs(budget.maxWallTimeMs)}`,
  ].join(", ")
}

function formatWorkflowPacing(pacing: WorkflowRunDetail["spec"]["pacing"]) {
  return `requests/min ${pacing.maxRequestsPerMinute}, tokens/min ${pacing.maxTokensPerMinute}.`
}

function formatDurationMs(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds % 3600 === 0) return `${seconds / 3600}h`
  if (seconds % 60 === 0) return `${seconds / 60}m`
  return `${seconds}s`
}

async function syncFinalReportToParentSession(detail: WorkflowRunDetail, artifact: WorkflowArtifactRecord) {
  if (!detail.parentSessionID || !artifact.exposeToMainContext) return
  try {
    const messages = await Session.messages({ sessionID: detail.parentSessionID })
    if (hasParentFinalReportMessage(messages, detail.id)) return

    const now = Date.now()
    const latestUser = findLatestUserMessage(messages)
    let parentID = latestUser?.info.id
    if (!parentID) {
      const anchor: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID: detail.parentSessionID,
        role: "user",
        time: { created: now },
        agent: "workflow",
        model: {
          providerID: WORKFLOW_RUNTIME_PROVIDER_ID,
          modelID: WORKFLOW_RUNTIME_MODEL_ID,
        },
      }
      const anchorPart: MessageV2.TextPart = {
        id: PartID.ascending(),
        messageID: anchor.id,
        sessionID: detail.parentSessionID,
        type: "text",
        text: `Workflow ${detail.id} completed.`,
        synthetic: true,
        ignored: true,
        metadata: {
          workflowFinalReportAnchor: {
            schemaVersion: 1,
            runID: detail.id,
            artifactID: artifact.id,
          },
        },
      }
      await Session.updateMessageWithParts(anchor, [anchorPart])
      parentID = anchor.id
    }

    const assistant: MessageV2.Assistant = {
      id: MessageID.ascending(),
      sessionID: detail.parentSessionID,
      role: "assistant",
      parentID,
      modelID: WORKFLOW_RUNTIME_MODEL_ID,
      providerID: WORKFLOW_RUNTIME_PROVIDER_ID,
      mode: "workflow",
      agent: "workflow",
      path: sessionAssistantPath({ directory: detail.directory }),
      tokens: zeroTokenUsage(),
      time: {
        created: now,
        completed: now,
      },
      finish: "stop",
    }
    const part: MessageV2.TextPart = {
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID: detail.parentSessionID,
      type: "text",
      text: formatParentFinalReport(detail, artifact),
      metadata: {
        workflowFinalReport: {
          schemaVersion: 1,
          runID: detail.id,
          artifactID: artifact.id,
          status: detail.status,
          specID: detail.spec.id,
          specName: detail.spec.name,
        },
      },
    }
    await Session.updateMessageWithParts(assistant, [part])
  } catch (error) {
    log.warn("failed to sync workflow final report to parent session", {
      runID: detail.id,
      parentSessionID: detail.parentSessionID,
      artifactID: artifact.id,
      error,
    })
  }
}

function hasParentFinalReportMessage(messages: MessageV2.WithParts[], runID: WorkflowRunID) {
  return messages.some((message) =>
    message.parts.some((part) => {
      if (part.type !== "text") return false
      const metadata = part.metadata?.workflowFinalReport
      if (!metadata || typeof metadata !== "object") return false
      return (metadata as Record<string, unknown>).runID === runID
    }),
  )
}

function findLatestUserMessage(messages: MessageV2.WithParts[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.info.role === "user") return message as MessageV2.WithParts & { info: MessageV2.User }
  }
  return undefined
}

function formatParentFinalReport(detail: WorkflowRunDetail, artifact: WorkflowArtifactRecord) {
  const usage = detail.budgetUsage
  const evaluation = evaluateWorkflowRun({ run: detail, now: detail.time.completed ?? Date.now() })
  return [
    artifact.summary ?? `Workflow final report: ${detail.spec.name}`,
    "",
    `Run: ${detail.id}`,
    `Final artifact: ${artifact.id}`,
    `Linked evidence refs: ${formatEvidenceRefs(artifact.evidenceRefs)}`,
    `Eval decision: ${evaluation.decision}.`,
    `Budget limits: ${formatWorkflowBudgetLimit(detail.budget)}`,
    `Pacing: ${formatWorkflowPacing(detail.spec.pacing)}`,
    `Budget used: ${usage.totalTokens} tokens, ${usage.toolCalls} tool calls, ${usage.childAgents} child agents.`,
  ].join("\n")
}

// --- Finding types and helpers ---

type FinalReportFinding = {
  artifactID: WorkflowArtifactID
  specArtifactID?: string
  summary?: string
  reason?: string
  evidenceRefs: WorkflowArtifactRecord["evidenceRefs"]
}

type FinalReportFindingBuckets = Record<WorkflowEvalFindingStatus, FinalReportFinding[]>

function finalReportFindings(detail: WorkflowRunDetail): FinalReportFindingBuckets {
  const buckets: FinalReportFindingBuckets = {
    confirmed: [],
    likely: [],
    rejected: [],
    unverified: [],
  }

  for (const artifact of detail.artifacts) {
    if (artifact.kind !== "finding") continue
    const status = classifyWorkflowFindingArtifact(artifact)
    buckets[status].push({
      artifactID: artifact.id,
      specArtifactID: artifact.specArtifactID,
      summary: artifact.summary,
      reason: status === "rejected" ? findingRejectionReason(artifact.payload) : undefined,
      evidenceRefs: artifact.evidenceRefs,
    })
  }

  return buckets
}

function findingSummaryLine(findings: FinalReportFindingBuckets) {
  return [
    `Findings: ${findings.confirmed.length} confirmed`,
    `${findings.likely.length} likely`,
    `${findings.rejected.length} rejected`,
    `${findings.unverified.length} unverified.`,
  ].join(", ")
}

function findingBucketSummaryLines(findings: FinalReportFindingBuckets) {
  const lines: string[] = []
  for (const status of ["confirmed", "likely", "rejected", "unverified"] as const) {
    const bucket = findings[status]
    if (bucket.length === 0) continue
    lines.push(`${titleCase(status)} findings:`)
    for (const finding of bucket.slice(0, 5)) {
      const summary = finding.summary ? ` - ${finding.summary}` : ""
      const reason = status === "rejected" && finding.reason ? ` rejectionReason=${finding.reason}` : ""
      const evidence =
        finding.evidenceRefs.length > 0
          ? ` evidence=${finding.evidenceRefs.map((ref) => `${ref.kind}:${ref.id}`).join(",")}`
          : ""
      lines.push(`- ${finding.artifactID}${summary}${reason}${evidence}`)
    }
    if (bucket.length > 5) lines.push(`- ${bucket.length - 5} more ${status} findings omitted from compact summary.`)
  }
  return lines
}

function findingRejectionReason(payload: unknown) {
  const reason = payloadStringField(payload, [
    "reason",
    "rejectionReason",
    "rejectedReason",
    "verificationReason",
    "rationale",
    "explanation",
  ])
  if (!reason) return undefined
  const compact = reason.replace(/\s+/g, " ").trim()
  if (!compact) return undefined
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact
}

function payloadStringField(payload: unknown, keys: readonly string[]) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
