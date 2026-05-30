import z from "zod"
import {
  computeEnvelopeId,
  VerificationEnvelopeSchema,
  type VerificationEnvelope,
} from "../quality/verification-envelope"
import { SessionVerifications } from "../session/verifications"
import { evaluateWorkflowBudget } from "./budget"
import { WorkflowRunDetail, WorkflowUsageDelta, type WorkflowArtifactRecord } from "./state"

const BASELINE_MULTIPLIER_LIMIT = 2

export const WorkflowEvalFindingStatus = z.enum(["confirmed", "likely", "rejected", "unverified"])
export type WorkflowEvalFindingStatus = z.infer<typeof WorkflowEvalFindingStatus>

export const WorkflowEvalMetrics = z.object({
  status: z.enum(["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"]),
  elapsedMs: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  toolCalls: z.number().int().min(0),
  childAgents: z.number().int().min(0),
  retries: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  costPerConfirmedFindingUsd: z.number().min(0).nullable(),
  verifiedCompletionCount: z.number().int().min(0),
  costPerVerifiedCompletionUsd: z.number().min(0).nullable(),
  confirmedFindings: z.number().int().min(0),
  likelyFindings: z.number().int().min(0),
  rejectedFindings: z.number().int().min(0),
  unverifiedFindings: z.number().int().min(0),
  falsePositiveFindings: z.number().int().min(0),
  artifactCount: z.number().int().min(0),
  exposedArtifactCount: z.number().int().min(0),
  verificationEnvelopeCount: z.number().int().min(0),
  interventionCount: z.number().int().min(0),
})
export type WorkflowEvalMetrics = z.infer<typeof WorkflowEvalMetrics>

export const WorkflowEvalBaseline = z.object({
  label: z.string().trim().min(1).default("single-agent"),
  metrics: WorkflowEvalMetrics.partial().extend({
    confirmedFindings: z.number().int().min(0).default(0),
    falsePositiveFindings: z.number().int().min(0).default(0),
  }),
})
export type WorkflowEvalBaseline = z.input<typeof WorkflowEvalBaseline>

export const WorkflowEvalComparison = z.object({
  baselineLabel: z.string(),
  confirmedFindingsDelta: z.number().int(),
  falsePositiveFindingsDelta: z.number().int(),
  totalTokensDelta: z.number().int().optional(),
  elapsedMsDelta: z.number().int().optional(),
  estimatedCostUsdDelta: z.number().optional(),
  interventionCountDelta: z.number().int().optional(),
})
export type WorkflowEvalComparison = z.infer<typeof WorkflowEvalComparison>

export const WorkflowEvalSummary = z.object({
  runID: z.string(),
  sourceTemplateID: z.string().optional(),
  decision: z.enum(["promote", "hold", "rollback"]),
  reasons: z.array(z.string()),
  metrics: WorkflowEvalMetrics,
  budgetStatus: z.enum(["ok", "warning", "exceeded"]),
  budgetWarnings: z.array(z.string()),
  budgetExceeded: z.array(z.string()),
  verificationSatisfied: z.boolean(),
  comparison: WorkflowEvalComparison.optional(),
})
export type WorkflowEvalSummary = z.infer<typeof WorkflowEvalSummary>

export const WorkflowEvalInput = z.object({
  run: WorkflowRunDetail,
  baseline: WorkflowEvalBaseline.optional(),
  now: z.number().int().min(0).optional(),
})
export type WorkflowEvalInput = z.input<typeof WorkflowEvalInput>

export function evaluateWorkflowRun(input: WorkflowEvalInput): WorkflowEvalSummary {
  const parsed = WorkflowEvalInput.parse(input)
  const elapsedMs = workflowElapsedMs(parsed.run, parsed.now ?? Date.now())
  const budget = evaluateWorkflowBudget({
    budget: parsed.run.budget,
    usage: parsed.run.budgetUsage,
    elapsedMs,
  })
  const metrics = workflowMetrics(parsed.run, elapsedMs)
  const verificationSatisfied = workflowVerificationSatisfied(parsed.run)
  const comparison = parsed.baseline ? compareBaseline(metrics, WorkflowEvalBaseline.parse(parsed.baseline)) : undefined
  const reasons = promotionBlockers({
    run: parsed.run,
    verificationSatisfied,
    budgetExceeded: budget.exceeded,
    comparison,
    baseline: parsed.baseline ? WorkflowEvalBaseline.parse(parsed.baseline) : undefined,
  })

  const decision =
    parsed.run.status === "failed" || parsed.run.status === "cancelled" || budget.status === "exceeded"
      ? "rollback"
      : reasons.length > 0
        ? "hold"
        : "promote"

  return WorkflowEvalSummary.parse({
    runID: parsed.run.id,
    sourceTemplateID: parsed.run.sourceTemplateID,
    decision,
    reasons,
    metrics,
    budgetStatus: budget.status,
    budgetWarnings: budget.warnings,
    budgetExceeded: budget.exceeded,
    verificationSatisfied,
    comparison,
  })
}

function workflowMetrics(run: z.infer<typeof WorkflowRunDetail>, elapsedMs: number): WorkflowEvalMetrics {
  const findingCounts = countFindingArtifacts(run.artifacts)
  const budgetUsage = WorkflowUsageDelta.parse(run.budgetUsage)
  const verifiedCompletionCount = run.status === "completed" && workflowVerificationSatisfied(run) ? 1 : 0
  const blockedChildren = run.children.filter(
    (child) => child.status === "blocked_permission" || child.status === "blocked_question",
  ).length
  const failedChildren = run.children.filter((child) => child.status === "failed").length

  return WorkflowEvalMetrics.parse({
    status: run.status,
    elapsedMs,
    ...budgetUsage,
    costPerConfirmedFindingUsd:
      findingCounts.confirmedFindings === 0 ? null : budgetUsage.estimatedCostUsd / findingCounts.confirmedFindings,
    verifiedCompletionCount,
    costPerVerifiedCompletionUsd: verifiedCompletionCount === 0 ? null : budgetUsage.estimatedCostUsd,
    ...findingCounts,
    falsePositiveFindings: findingCounts.rejectedFindings,
    artifactCount: run.artifacts.length,
    exposedArtifactCount: run.artifacts.filter((artifact) => artifact.exposeToMainContext).length,
    verificationEnvelopeCount: run.verificationEnvelopeIDs.length,
    interventionCount: blockedChildren + failedChildren + (run.status === "blocked" || run.status === "failed" ? 1 : 0),
  })
}

function workflowElapsedMs(run: z.infer<typeof WorkflowRunDetail>, now: number) {
  if (!run.time.started) return 0
  return Math.max(0, (run.time.completed ?? now) - run.time.started)
}

function workflowVerificationSatisfied(run: z.infer<typeof WorkflowRunDetail>) {
  if (run.spec.verification.mode !== "required") return true

  const required = run.spec.verification.requiredArtifactIds
  const present = new Set(run.artifacts.map((artifact) => artifact.specArtifactID).filter(Boolean))
  if (required.length > 0 && !required.every((artifactID) => present.has(artifactID))) return false

  const evidence = workflowVerificationEvidence(run)
  if (evidence.failures.length > 0 || evidence.missingEnvelopeIds.length > 0) return false
  if (run.verificationEnvelopeIDs.length > 0) {
    return run.verificationEnvelopeIDs.every((id) => evidence.passingEnvelopeIds.has(id))
  }
  if (required.length > 0) return required.every((artifactID) => evidence.passingArtifactIds.has(artifactID))
  return evidence.passingArtifactIds.size > 0
}

function workflowVerificationEvidence(run: z.infer<typeof WorkflowRunDetail>) {
  const evidence = {
    failures: [] as string[],
    missingEnvelopeIds: [] as string[],
    passingEnvelopeIds: new Set<string>(),
    passingArtifactIds: new Set<string>(),
  }

  for (const artifact of run.artifacts) {
    if (artifact.kind !== "verification") continue
    for (const envelope of verificationEnvelopesFromPayload(artifact.payload)) {
      if (envelope.result.passed && envelope.result.status === "passed") {
        evidence.passingEnvelopeIds.add(computeEnvelopeId(envelope))
        evidence.passingArtifactIds.add(artifact.specArtifactID ?? artifact.id)
        continue
      }
      evidence.failures.push(artifact.specArtifactID ?? artifact.id)
    }
  }

  if (run.verificationEnvelopeIDs.length > 0) {
    const loaded = run.parentSessionID
      ? new Map(SessionVerifications.loadWithIds(run.parentSessionID).map((item) => [item.envelopeId, item.envelope]))
      : new Map<string, VerificationEnvelope>()
    for (const envelopeID of run.verificationEnvelopeIDs) {
      if (evidence.passingEnvelopeIds.has(envelopeID)) continue
      const envelope = loaded.get(envelopeID)
      if (!envelope) {
        evidence.missingEnvelopeIds.push(envelopeID)
        continue
      }
      if (envelope.result.passed && envelope.result.status === "passed") {
        evidence.passingEnvelopeIds.add(envelopeID)
        continue
      }
      evidence.failures.push(envelopeID)
    }
  }

  return evidence
}

function verificationEnvelopesFromPayload(payload: unknown): VerificationEnvelope[] {
  const parsed = VerificationEnvelopeSchema.safeParse(payload)
  if (parsed.success) return [parsed.data]
  if (Array.isArray(payload)) return payload.flatMap(verificationEnvelopesFromPayload)
  if (!payload || typeof payload !== "object") return []

  const record = payload as Record<string, unknown>
  return [
    ...verificationEnvelopesFromPayload(record.envelope),
    ...verificationEnvelopesFromPayload(record.verificationEnvelope),
    ...verificationEnvelopesFromPayload(record.envelopes),
    ...verificationEnvelopesFromPayload(record.verificationEnvelopes),
  ]
}

function countFindingArtifacts(artifacts: WorkflowArtifactRecord[]) {
  const counts = {
    confirmedFindings: 0,
    likelyFindings: 0,
    rejectedFindings: 0,
    unverifiedFindings: 0,
  }

  for (const artifact of artifacts) {
    if (artifact.kind !== "finding") continue
    const status = classifyWorkflowFindingArtifact(artifact)
    if (status === "confirmed") counts.confirmedFindings++
    else if (status === "likely") counts.likelyFindings++
    else if (status === "rejected") counts.rejectedFindings++
    else counts.unverifiedFindings++
  }

  return counts
}

export function classifyWorkflowFindingArtifact(artifact: WorkflowArtifactRecord): WorkflowEvalFindingStatus {
  const fromPayload = payloadFindingStatus(artifact.payload)
  if (fromPayload) return fromPayload

  const summary = artifact.summary?.toLowerCase() ?? ""
  if (summary.includes("confirmed") || summary.includes("valid")) return "confirmed"
  if (summary.includes("likely")) return "likely"
  if (summary.includes("rejected") || summary.includes("false positive") || summary.includes("unsupported")) {
    return "rejected"
  }
  return "unverified"
}

function payloadFindingStatus(payload: unknown): WorkflowEvalFindingStatus | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  for (const key of ["status", "findingStatus", "verificationStatus", "classification", "outcome"]) {
    const value = record[key]
    if (typeof value !== "string") continue
    const normalized = value.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
    if (
      normalized === "confirmed" ||
      normalized === "valid" ||
      normalized === "true_positive" ||
      normalized === "passed"
    ) {
      return "confirmed"
    }
    if (normalized === "likely" || normalized === "probable") return "likely"
    if (
      normalized === "rejected" ||
      normalized === "false_positive" ||
      normalized === "invalid" ||
      normalized === "unsupported"
    ) {
      return "rejected"
    }
    if (normalized === "unverified" || normalized === "unknown" || normalized === "needs_verification") {
      return "unverified"
    }
  }
  return undefined
}

function compareBaseline(metrics: WorkflowEvalMetrics, baseline: z.infer<typeof WorkflowEvalBaseline>) {
  return WorkflowEvalComparison.parse({
    baselineLabel: baseline.label,
    confirmedFindingsDelta: metrics.confirmedFindings - baseline.metrics.confirmedFindings,
    falsePositiveFindingsDelta: metrics.falsePositiveFindings - baseline.metrics.falsePositiveFindings,
    totalTokensDelta:
      baseline.metrics.totalTokens === undefined ? undefined : metrics.totalTokens - baseline.metrics.totalTokens,
    elapsedMsDelta:
      baseline.metrics.elapsedMs === undefined ? undefined : metrics.elapsedMs - baseline.metrics.elapsedMs,
    estimatedCostUsdDelta:
      baseline.metrics.estimatedCostUsd === undefined
        ? undefined
        : metrics.estimatedCostUsd - baseline.metrics.estimatedCostUsd,
    interventionCountDelta:
      baseline.metrics.interventionCount === undefined
        ? undefined
        : metrics.interventionCount - baseline.metrics.interventionCount,
  })
}

function promotionBlockers(input: {
  run: z.infer<typeof WorkflowRunDetail>
  verificationSatisfied: boolean
  budgetExceeded: string[]
  comparison: WorkflowEvalComparison | undefined
  baseline: z.infer<typeof WorkflowEvalBaseline> | undefined
}) {
  const reasons: string[] = []
  if (input.run.status !== "completed") reasons.push(`workflow status is ${input.run.status}`)
  if (!input.verificationSatisfied) reasons.push("required verification evidence is missing")
  for (const exceeded of input.budgetExceeded) reasons.push(`budget exceeded: ${exceeded}`)
  if (!input.comparison || !input.baseline) return reasons

  if (input.comparison.confirmedFindingsDelta < 0) {
    reasons.push("workflow found fewer confirmed findings than baseline")
  }
  if (input.comparison.falsePositiveFindingsDelta > 0) {
    reasons.push("workflow produced more false positives than baseline")
  }
  if (
    input.baseline.metrics.totalTokens !== undefined &&
    input.baseline.metrics.totalTokens > 0 &&
    input.run.budgetUsage.totalTokens > input.baseline.metrics.totalTokens * BASELINE_MULTIPLIER_LIMIT
  ) {
    reasons.push("workflow used more than 2x baseline tokens")
  }
  if (
    input.baseline.metrics.estimatedCostUsd !== undefined &&
    input.baseline.metrics.estimatedCostUsd > 0 &&
    input.run.budgetUsage.estimatedCostUsd > input.baseline.metrics.estimatedCostUsd * BASELINE_MULTIPLIER_LIMIT
  ) {
    reasons.push("workflow cost exceeded 2x baseline")
  }
  return reasons
}
