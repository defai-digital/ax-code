import z from "zod"
import { WorkflowRunDetail, WorkflowUsageDelta } from "./state"

const StatusCount = z.number().int().min(0)

export const WorkflowPhaseStatusCounts = z.object({
  queued: StatusCount,
  running: StatusCount,
  blocked: StatusCount,
  paused: StatusCount,
  failed: StatusCount,
  completed: StatusCount,
  cancelled: StatusCount,
})
export type WorkflowPhaseStatusCounts = z.infer<typeof WorkflowPhaseStatusCounts>

export const WorkflowChildStatusCounts = z.object({
  queued: StatusCount,
  running: StatusCount,
  blockedPermission: StatusCount,
  blockedQuestion: StatusCount,
  paused: StatusCount,
  failed: StatusCount,
  completed: StatusCount,
  cancelled: StatusCount,
})
export type WorkflowChildStatusCounts = z.infer<typeof WorkflowChildStatusCounts>

export const WorkflowArtifactKindCounts = z.object({
  summary: StatusCount,
  finding: StatusCount,
  patch: StatusCount,
  verification: StatusCount,
  metric: StatusCount,
  log: StatusCount,
})
export type WorkflowArtifactKindCounts = z.infer<typeof WorkflowArtifactKindCounts>

export const WorkflowRunProjection = z.object({
  runID: z.string(),
  status: z.enum(["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"]),
  name: z.string(),
  sourceTemplateID: z.string().optional(),
  currentPhaseID: z.string().optional(),
  currentPhaseName: z.string().optional(),
  currentPhaseStatus: z.enum(["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"]).optional(),
  elapsedMs: z.number().int().min(0),
  effort: z.enum(["normal", "deep", "workflow", "max-workflow"]),
  models: z.object({
    planner: z.string().optional(),
    worker: z.string().optional(),
    verifier: z.string().optional(),
    synthesizer: z.string().optional(),
  }),
  budgetUsage: WorkflowUsageDelta,
  budgetLimit: z.object({
    maxTotalTokens: z.number().int().positive(),
    maxWallTimeMs: z.number().int().positive(),
    maxConcurrentAgents: z.number().int().positive(),
    maxTotalAgents: z.number().int().positive(),
    maxToolCalls: z.number().int().positive(),
    maxRetries: z.number().int().min(0),
  }),
  phaseCounts: WorkflowPhaseStatusCounts,
  childCounts: WorkflowChildStatusCounts,
  artifactCounts: WorkflowArtifactKindCounts,
  verificationEnvelopeCount: z.number().int().min(0),
  exposedArtifactCount: z.number().int().min(0),
  blockedReason: z.string().optional(),
})
export type WorkflowRunProjection = z.infer<typeof WorkflowRunProjection>

export function summarizeWorkflowRunDetail(
  detail: z.infer<typeof WorkflowRunDetail>,
  now = Date.now(),
): WorkflowRunProjection {
  const currentPhase = detail.currentPhaseID
    ? detail.phases.find((phase) => phase.id === detail.currentPhaseID)
    : detail.phases.find((phase) => phase.status === detail.status)

  return WorkflowRunProjection.parse({
    runID: detail.id,
    status: detail.status,
    name: detail.spec.name,
    sourceTemplateID: detail.sourceTemplateID,
    currentPhaseID: currentPhase?.id,
    currentPhaseName: currentPhase?.name,
    currentPhaseStatus: currentPhase?.status,
    elapsedMs: workflowElapsedMs(detail, now),
    effort: detail.spec.modelPolicy.effort,
    models: {
      planner: detail.spec.modelPolicy.plannerModel,
      worker: detail.spec.modelPolicy.workerModel,
      verifier: detail.spec.modelPolicy.verifierModel,
      synthesizer: detail.spec.modelPolicy.synthesizerModel,
    },
    budgetUsage: detail.budgetUsage,
    budgetLimit: detail.budget,
    phaseCounts: countPhaseStatuses(detail),
    childCounts: countChildStatuses(detail),
    artifactCounts: countArtifactKinds(detail),
    verificationEnvelopeCount: detail.verificationEnvelopeIDs.length,
    exposedArtifactCount: detail.artifacts.filter((artifact) => artifact.exposeToMainContext).length,
    blockedReason: blockedReason(detail),
  })
}

function workflowElapsedMs(detail: z.infer<typeof WorkflowRunDetail>, now: number) {
  if (!detail.time.started) return 0
  return Math.max(0, (detail.time.completed ?? now) - detail.time.started)
}

function countPhaseStatuses(detail: z.infer<typeof WorkflowRunDetail>): WorkflowPhaseStatusCounts {
  const counts = {
    queued: 0,
    running: 0,
    blocked: 0,
    paused: 0,
    failed: 0,
    completed: 0,
    cancelled: 0,
  }
  for (const phase of detail.phases) counts[phase.status]++
  return counts
}

function countChildStatuses(detail: z.infer<typeof WorkflowRunDetail>): WorkflowChildStatusCounts {
  const counts = {
    queued: 0,
    running: 0,
    blockedPermission: 0,
    blockedQuestion: 0,
    paused: 0,
    failed: 0,
    completed: 0,
    cancelled: 0,
  }
  for (const child of detail.children) {
    if (child.status === "blocked_permission") counts.blockedPermission++
    else if (child.status === "blocked_question") counts.blockedQuestion++
    else counts[child.status]++
  }
  return counts
}

function countArtifactKinds(detail: z.infer<typeof WorkflowRunDetail>): WorkflowArtifactKindCounts {
  const counts = {
    summary: 0,
    finding: 0,
    patch: 0,
    verification: 0,
    metric: 0,
    log: 0,
  }
  for (const artifact of detail.artifacts) counts[artifact.kind]++
  return counts
}

function blockedReason(detail: z.infer<typeof WorkflowRunDetail>) {
  if (detail.error) return detail.error
  const blockedPhase = detail.phases.find((phase) => phase.status === "blocked" && phase.error)
  if (blockedPhase?.error) return blockedPhase.error
  const blockedChild = detail.children.find(
    (child) => (child.status === "blocked_permission" || child.status === "blocked_question") && child.error,
  )
  return blockedChild?.error
}
