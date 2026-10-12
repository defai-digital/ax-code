import z from "zod"
import type { TaskQueue } from "../session/task-queue"
import { ScheduledTaskID } from "../session/schema"
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
    worktree: z
      .object({
        mode: z.enum(["current", "dedicated"]),
        directory: z.string().min(1),
        name: z.string().optional(),
        branch: z.string().optional(),
      })
      .optional(),
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
    // Explicit cancellation is authoritative. Late queue notifications must
    // not reinterpret completed + cancelled phases as a failed/live run.
    if (detail.status === "cancelled") return detail

    const childStatus = childStatusFromQueueStatus(item.status)
    const childBudgetStopped =
      child.status === "failed" &&
      detail.budgetLedger.some((entry) => entry.kind === "exceeded" && entry.childID === child.id)
    const childChanged = !childBudgetStopped && (child.status !== childStatus || child.error !== item.error)
    if (childChanged) {
      await WorkflowRun.setChildStatus({
        id: child.id,
        status: childStatus,
        error: item.error,
      })
    }

    // The child write above is the only mutation so far. A no-op sync (status
    // unchanged) can keep reusing `detail` instead of rebuilding it with 5
    // more SELECTs + a full zod parse.
    const refreshed = childChanged ? await WorkflowRun.getDetail(payload.workflow.runID) : detail
    const phase = refreshed.phases.find((candidate) => candidate.id === payload.workflow.phaseID)
    const phaseChildren = refreshed.children.filter((candidate) => candidate.phaseID === payload.workflow.phaseID)
    const phaseStatus = aggregatePhaseStatus(phaseChildren, phase ? mergeStrategyForPhase(refreshed, phase) : "all")
    if (phase && phaseStatus === "completed") {
      await cancelSupersededPhaseChildren(phaseChildren)
    }

    const afterMerge = phaseStatus === "completed" ? await WorkflowRun.getDetail(payload.workflow.runID) : refreshed
    const latestPhase = afterMerge.phases.find((candidate) => candidate.id === payload.workflow.phaseID)
    // A phase the budget enforcement failed is a deliberate stop. A later
    // sibling completion must not recompute it back to completed (first-success
    // / majority), which would flip the run back to running and start the next
    // phase — spending tokens the budget already refused.
    const phaseBudgetStopped =
      latestPhase?.status === "failed" &&
      phaseStatus !== "failed" &&
      WorkflowRun.isBudgetExceeded(payload.workflow.runID, latestPhase.id)
    const effectivePhaseStatus = phaseBudgetStopped ? "failed" : phaseStatus
    const phaseChanged = latestPhase !== undefined && latestPhase.status !== effectivePhaseStatus
    if (phaseChanged) {
      await WorkflowRun.setPhaseStatus({
        id: latestPhase.id,
        status: effectivePhaseStatus,
        error: effectivePhaseStatus === "failed" || effectivePhaseStatus === "blocked" ? item.error : undefined,
      })
    }

    // The phase write (when it happened) is the only mutation since `afterMerge`
    // was read; a no-op sync keeps using `afterMerge` instead of rebuilding it.
    const latest = phaseChanged ? await WorkflowRun.getDetail(payload.workflow.runID) : afterMerge
    const runStatus = aggregateRunStatus(latest.phases)
    // Same deliberate-stop rule at the run level: a budget-failed run stays
    // failed even when the aggregate would call it running or completed again.
    const runBudgetStopped =
      latest.status === "failed" && runStatus !== "failed" && WorkflowRun.isBudgetExceeded(payload.workflow.runID)
    const effectiveRunStatus = runBudgetStopped ? "failed" : runStatus
    const run =
      latest.status === effectiveRunStatus
        ? latest
        : await WorkflowRun.setStatus({
            id: latest.id,
            status: effectiveRunStatus,
            error: effectiveRunStatus === "failed" || effectiveRunStatus === "blocked" ? item.error : undefined,
          })
    if (run.status === "completed") await WorkflowRun.ensureFinalReportArtifact(latest.id)
    if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
      const sourceTaskID = run.sourceTaskID
      if (sourceTaskID?.startsWith("sch_")) {
        const { ScheduledTask } = await import("../session/scheduled-task")
        await ScheduledTask.recordWorkflowOutcome(ScheduledTaskID.make(sourceTaskID), run.status, run.error)
      }
    }

    if (effectivePhaseStatus === "completed" && effectiveRunStatus === "running") {
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
    if (children.every((child) => WorkflowRun.isTerminalChildStatus(child.status))) return "failed"
    if (children.some((child) => child.status === "paused")) return "paused"
    return "running"
  }
  if (isCriticMergeStrategy(mergeStrategy)) return aggregateCriticPhaseStatus(children)
  if (isMajorityMergeStrategy(mergeStrategy)) {
    const completed = children.filter((child) => child.status === "completed").length
    if (completed > children.length / 2) return "completed"
    if (children.every((child) => child.status === "cancelled")) return "cancelled"
    const failedOrCancelled = children.filter(
      (child) => child.status === "failed" || child.status === "cancelled",
    ).length
    if (failedOrCancelled > children.length / 2) return "failed"
    if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
      return "blocked"
    }
    if (children.every((child) => WorkflowRun.isTerminalChildStatus(child.status))) return "failed"
    if (children.some((child) => child.status === "paused")) return "paused"
    return "running"
  }
  if (children.some((child) => child.status === "failed")) return "failed"
  if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
    return "blocked"
  }
  if (children.every((child) => child.status === "completed")) return "completed"
  if (children.every((child) => child.status === "cancelled")) return "cancelled"
  // Every child is terminal but the mix isn't uniformly completed or
  // cancelled (e.g. some completed, some cancelled, none failed) — the "all"
  // merge condition can never be satisfied and no more progress will happen.
  // Without this, the phase (and therefore the run) would stay "running"
  // forever. The first-success and majority branches above already guard
  // against this same case.
  if (children.every((child) => WorkflowRun.isTerminalChildStatus(child.status))) return "failed"
  if (children.some((child) => child.status === "paused")) return "paused"
  return "running"
}

async function cancelSupersededPhaseChildren(children: WorkflowChildRecord[]) {
  const { TaskQueue } = await import("../session/task-queue")
  for (const child of children) {
    if (child.status === "completed" || child.status === "failed" || child.status === "cancelled") continue
    let cancelledQueue = false
    if (child.taskQueueID) {
      // stop() rather than a bare setStatus: a superseded item that is already
      // running owns a live session, and setStatus would only flip the durable
      // status — leaving the subagent executing (spending tokens, running tools,
      // mutating the workspace) after the merge strategy was already satisfied.
      // stop() interrupts running/blocked sessions and cancels everything else.
      await TaskQueue.stop(child.taskQueueID)
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
  return strategy === "majority"
}

function aggregateCriticPhaseStatus(children: WorkflowChildRecord[]): WorkflowRun.PhaseStatus {
  const critic = children.at(-1)
  const completed = children.filter((child) => child.status === "completed").length
  if (children.every((child) => child.status === "cancelled")) return "cancelled"
  if (critic?.status === "completed" && completed > children.length / 2) return "completed"
  // A successful critic can finish before the worker majority. Only an
  // unsuccessful critic makes that merge condition impossible immediately.
  if (critic?.status === "failed" || critic?.status === "cancelled") return "failed"

  const failedOrCancelled = children.filter((child) => child.status === "failed" || child.status === "cancelled").length
  if (failedOrCancelled > children.length / 2) return "failed"
  if (children.some((child) => child.status === "blocked_permission" || child.status === "blocked_question")) {
    return "blocked"
  }
  if (children.every((child) => WorkflowRun.isTerminalChildStatus(child.status))) return "failed"
  if (children.some((child) => child.status === "paused")) return "paused"
  return "running"
}

function isCriticMergeStrategy(strategy: WorkflowPhaseMergeStrategy) {
  return strategy === "vote-with-critic" || strategy === "critic-confirmation"
}

function aggregateRunStatus(phases: WorkflowRunDetailPhase[]): WorkflowRun.Status {
  if (phases.length === 0) return "queued"
  if (phases.some((phase) => phase.status === "failed")) return "failed"
  if (phases.some((phase) => phase.status === "blocked")) return "blocked"
  if (phases.every((phase) => phase.status === "completed")) return "completed"
  if (phases.every((phase) => phase.status === "cancelled")) return "cancelled"
  // Every phase is terminal but the mix isn't uniformly completed or
  // cancelled (e.g. an earlier phase completed while a later phase's
  // children were individually cancelled through the generic task-queue
  // cancel endpoint, without going through WorkflowScheduler.cancel()). The
  // run can never make further progress, so without this fallback it would
  // stay "running" forever — the scheduler only advances past a "completed"
  // phase and has no path to resolve a cancelled one.
  if (phases.every((phase) => WorkflowRun.isTerminalPhaseStatus(phase.status))) return "failed"
  if (phases.some((phase) => phase.status === "paused")) return "paused"
  return "running"
}

type WorkflowRunDetailPhase = Awaited<ReturnType<typeof WorkflowRun.getDetail>>["phases"][number]
type WorkflowPhaseMergeStrategy = Awaited<
  ReturnType<typeof WorkflowRun.getDetail>
>["spec"]["phases"][number]["mergeStrategy"]
