import z from "zod"
import type { TaskQueue } from "../session/task-queue"
import { WorkflowRun } from "./run"
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
    const phaseStatus = aggregatePhaseStatus(
      refreshed.children.filter((candidate) => candidate.phaseID === payload.workflow.phaseID),
    )
    const phase = refreshed.phases.find((candidate) => candidate.id === payload.workflow.phaseID)
    if (phase && phase.status !== phaseStatus) {
      await WorkflowRun.setPhaseStatus({
        id: phase.id,
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

function aggregatePhaseStatus(children: WorkflowChildRecord[]): WorkflowRun.PhaseStatus {
  if (children.length === 0) return "queued"
  if (children.some((child) => child.status === "failed")) return "failed"
  if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
    return "blocked"
  }
  if (children.every((child) => child.status === "completed")) return "completed"
  if (children.every((child) => child.status === "cancelled")) return "cancelled"
  if (children.some((child) => child.status === "paused")) return "paused"
  return "running"
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
