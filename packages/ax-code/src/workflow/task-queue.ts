import z from "zod"
import type { TaskQueue } from "../session/task-queue"
import { WorkflowRun } from "./run"
import { WorkflowPacing, WorkflowPermissions, WorkflowPhaseBudget } from "./spec"
import { WorkflowChildID, WorkflowPhaseID, WorkflowRunID, type WorkflowChildRecord } from "./state"
import { WorkflowScheduler } from "./scheduler"

export namespace WorkflowTaskQueue {
  export const Payload = z.object({
    workflow: z.object({
      runID: WorkflowRunID.zod,
      phaseID: WorkflowPhaseID.zod,
      childID: WorkflowChildID.zod,
      specPhaseID: z.string().min(1),
      startOptions: WorkflowScheduler.StartOptions.partial().optional(),
    }),
    artifactRefs: z.array(z.string()).default([]),
    budgetSlice: WorkflowPhaseBudget.optional(),
    pacing: WorkflowPacing.optional(),
    maxParallel: z.number().int().positive().optional(),
    allowedTools: WorkflowPermissions.shape.allowedTools,
    writePolicy: WorkflowPermissions.shape.writePolicy,
    networkPolicy: WorkflowPermissions.shape.networkPolicy,
    escalationPolicy: WorkflowPermissions.shape.escalationPolicy,
  })
  export type Payload = z.infer<typeof Payload>

  export function readPayload(payload: TaskQueue.Payload): Payload | undefined {
    const parsed = Payload.safeParse(payload)
    return parsed.success ? parsed.data : undefined
  }

  export async function syncItem(item: TaskQueue.Info): Promise<WorkflowRun.Info | undefined> {
    const payload = readPayload(item.payload)
    if (!payload) return undefined

    const detail = await WorkflowRun.getDetail(payload.workflow.runID)
    const child = detail.children.find((candidate) => candidate.id === payload.workflow.childID)
    if (!child || child.phaseID !== payload.workflow.phaseID) return detail
    if (child.taskQueueID && child.taskQueueID !== item.id) return detail

    const childStatus = childStatusFromQueueStatus(item.status)
    if (child.status !== childStatus || child.error !== item.error) {
      await WorkflowRun.setChildStatus({
        id: child.id,
        status: childStatus,
        error: item.error,
      })
    }

    const refreshed = await WorkflowRun.getDetail(payload.workflow.runID)
    const phase = refreshed.phases.find((candidate) => candidate.id === payload.workflow.phaseID)
    const phaseChildren = refreshed.children.filter((candidate) => candidate.phaseID === payload.workflow.phaseID)
    const phaseStatus = aggregatePhaseStatus(phaseChildren, phase ? mergeStrategyForPhase(refreshed, phase) : "all")
    if (phase && phaseStatus === "completed") {
      await cancelSupersededPhaseChildren(phaseChildren)
    }

    const afterMerge = phaseStatus === "completed" ? await WorkflowRun.getDetail(payload.workflow.runID) : refreshed
    const latestPhase = afterMerge.phases.find((candidate) => candidate.id === payload.workflow.phaseID)
    if (latestPhase && latestPhase.status !== phaseStatus) {
      await WorkflowRun.setPhaseStatus({
        id: latestPhase.id,
        status: phaseStatus,
        error: phaseStatus === "failed" || phaseStatus === "blocked" ? item.error : undefined,
      })
    }

    const latest = await WorkflowRun.getDetail(payload.workflow.runID)
    const runStatus = aggregateRunStatus(latest.phases)
    const run =
      latest.status === runStatus
        ? latest
        : await WorkflowRun.setStatus({
            id: latest.id,
            status: runStatus,
            error: runStatus === "failed" || runStatus === "blocked" ? item.error : undefined,
          })
    if (run.status === "completed") await WorkflowRun.ensureFinalReportArtifact(latest.id)

    if (phaseStatus === "completed" && runStatus === "running") {
      return WorkflowScheduler.start(latest.id, payload.workflow.startOptions)
    }

    return run
  }
}

function childStatusFromQueueStatus(status: TaskQueue.Status): WorkflowRun.ChildStatus {
  switch (status) {
    case "waiting_for_idle":
      return "queued"
    case "blocked_permission":
      return "blocked_permission"
    case "blocked_question":
      return "blocked_question"
    case "paused":
      return "paused"
    case "failed":
      return "failed"
    case "completed":
      return "completed"
    case "cancelled":
      return "cancelled"
    case "running":
      return "running"
    case "queued":
      return "queued"
  }
}

function aggregatePhaseStatus(
  children: WorkflowChildRecord[],
  mergeStrategy: WorkflowPhaseMergeStrategy,
): WorkflowRun.PhaseStatus {
  if (children.length === 0) return "queued"
  if (mergeStrategy === "first-success") {
    if (children.some((child) => child.status === "completed")) return "completed"
    if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
      return "blocked"
    }
    if (children.every((child) => child.status === "cancelled")) return "cancelled"
    if (children.every((child) => isTerminalChildStatus(child.status))) return "failed"
    if (children.some((child) => child.status === "paused")) return "paused"
    return "running"
  }
  if (isMajorityMergeStrategy(mergeStrategy)) {
    const completed = children.filter((child) => child.status === "completed").length
    if (completed > children.length / 2) return "completed"
    const failedOrCancelled = children.filter(
      (child) => child.status === "failed" || child.status === "cancelled",
    ).length
    if (failedOrCancelled > children.length / 2) return "failed"
    if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
      return "blocked"
    }
    if (children.every((child) => child.status === "cancelled")) return "cancelled"
    if (children.every((child) => isTerminalChildStatus(child.status))) return "failed"
    if (children.some((child) => child.status === "paused")) return "paused"
    return "running"
  }
  if (children.some((child) => child.status === "failed")) return "failed"
  if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
    return "blocked"
  }
  if (children.every((child) => child.status === "completed")) return "completed"
  if (children.every((child) => child.status === "cancelled")) return "cancelled"
  if (children.some((child) => child.status === "paused")) return "paused"
  return "running"
}

async function cancelSupersededPhaseChildren(children: WorkflowChildRecord[]) {
  const { TaskQueue } = await import("../session/task-queue")
  for (const child of children) {
    if (child.status === "completed" || child.status === "failed" || child.status === "cancelled") continue
    let cancelledQueue = false
    if (child.taskQueueID) {
      await TaskQueue.setStatus({
        id: child.taskQueueID,
        status: "cancelled",
        error: "Workflow phase merge strategy already satisfied.",
      })
        .then(() => {
          cancelledQueue = true
        })
        .catch(() => undefined)
    }
    if (!cancelledQueue) {
      await WorkflowRun.setChildStatus({
        id: child.id,
        status: "cancelled",
        error: "Workflow phase merge strategy already satisfied.",
      })
    }
  }
}

function mergeStrategyForPhase(
  detail: Awaited<ReturnType<typeof WorkflowRun.getDetail>>,
  phase: WorkflowRunDetailPhase,
) {
  return detail.spec.phases.find((candidate) => candidate.id === phase.specPhaseID)?.mergeStrategy ?? "all"
}

function isMajorityMergeStrategy(strategy: WorkflowPhaseMergeStrategy) {
  return strategy === "majority" || strategy === "vote-with-critic" || strategy === "critic-confirmation"
}

function isTerminalChildStatus(status: WorkflowRun.ChildStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function aggregateRunStatus(phases: WorkflowRunDetailPhase[]): WorkflowRun.Status {
  if (phases.length === 0) return "queued"
  if (phases.some((phase) => phase.status === "failed")) return "failed"
  if (phases.some((phase) => phase.status === "blocked")) return "blocked"
  if (phases.every((phase) => phase.status === "completed")) return "completed"
  if (phases.every((phase) => phase.status === "cancelled")) return "cancelled"
  if (phases.some((phase) => phase.status === "paused")) return "paused"
  return "running"
}

type WorkflowRunDetailPhase = Awaited<ReturnType<typeof WorkflowRun.getDetail>>["phases"][number]
type WorkflowPhaseMergeStrategy = Awaited<ReturnType<typeof WorkflowRun.getDetail>>["spec"]["phases"][number]["mergeStrategy"]
