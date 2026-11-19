import z from "zod"
import { TaskQueue } from "../session/task-queue"
import { ScheduledTaskID } from "../session/schema"
import { NotFoundError } from "../storage/db"
import { WorkflowRun } from "./run"
import { WorkflowPacing, WorkflowPermissions, WorkflowPhaseBudget } from "./spec"
import {
  WorkflowChildID,
  WorkflowChildWorktree,
  WorkflowPhaseID,
  WorkflowRunID,
  type WorkflowChildRecord,
} from "./state"
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
    worktree: WorkflowChildWorktree.optional(),
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

  export async function syncItem(
    item: TaskQueue.Info,
    options: { childOnly?: boolean } = {},
  ): Promise<WorkflowRun.Info | undefined> {
    const payload = readPayload(item.payload)
    if (!payload) return undefined

    const detail = await WorkflowRun.getDetail(payload.workflow.runID)
    const child = detail.children.find((candidate) => candidate.id === payload.workflow.childID)
    if (!child || child.phaseID !== payload.workflow.phaseID) return detail
    if (child.taskQueueID && child.taskQueueID !== item.id) return detail
    // Explicit cancellation is authoritative. Late queue notifications must
    // not reinterpret completed + cancelled phases as a failed/live run.
    if (detail.status === "cancelled" || !TaskQueue.isCurrentWorkflowStatus(item)) return detail

    // A status can be superseded while reconciliation waits on another step.
    // Recheck the queue snapshot inside each transaction that uses it.
    const statusOptions = { queueItem: item }
    const childStatus = childStatusFromQueueStatus(item.status)
    // Pausing a running child cancels its turn, so the item later settles as
    // failed/cancelled. That is the pause landing, not a failure: keep the child
    // paused; resume() retries the item.
    if (child.status === "paused" && (childStatus === "failed" || childStatus === "cancelled")) return detail
    const childBudgetStopped =
      child.status === "failed" &&
      detail.budgetLedger.some((entry) => entry.kind === "exceeded" && entry.childID === child.id)
    const childChanged = !childBudgetStopped && (child.status !== childStatus || child.error !== item.error)
    if (childChanged) {
      await WorkflowRun.setChildStatus({ id: child.id, status: childStatus, error: item.error }, statusOptions)
    }

    // Explicit workflow cancellation settles siblings before writing the
    // phase and run together. Per-child outcomes must not advance the run.
    if (options.childOnly) return detail

    let refreshed = childChanged ? await WorkflowRun.getDetail(payload.workflow.runID) : detail
    const { phaseID } = payload.workflow
    let phase = refreshed.phases.find((candidate) => candidate.id === phaseID)
    let phaseChildren = refreshed.children.filter((candidate) => candidate.phaseID === phaseID)
    const mergeStrategy = phase ? mergeStrategyForPhase(refreshed, phase) : "all"
    let phaseStatus = aggregatePhaseStatus(phaseChildren, mergeStrategy)
    if (phase && phaseStatus === "completed") {
      await cancelSupersededPhaseChildren(phaseChildren, { queueItem: item })
      // Stops can change the child states used for the merge, including via
      // recursive queue notifications. Project the result from one snapshot.
      refreshed = await WorkflowRun.getDetail(payload.workflow.runID)
      phase = refreshed.phases.find((candidate) => candidate.id === phaseID)
      phaseChildren = refreshed.children.filter((candidate) => candidate.phaseID === phaseID)
      phaseStatus = aggregatePhaseStatus(phaseChildren, mergeStrategy)
    }

    // A phase the budget enforcement failed is a deliberate stop. A later
    // sibling completion must not revive it and start another phase.
    const phaseBudgetStopped =
      phase?.status === "failed" &&
      phaseStatus !== "failed" &&
      WorkflowRun.isBudgetExceeded(payload.workflow.runID, phase.id)
    const effectivePhaseStatus = phaseBudgetStopped ? "failed" : phaseStatus
    let latest = refreshed
    if (phase && phase.status !== effectivePhaseStatus) {
      await WorkflowRun.setPhaseStatus(
        {
          id: phase.id,
          status: effectivePhaseStatus,
          error: effectivePhaseStatus === "failed" || effectivePhaseStatus === "blocked" ? item.error : undefined,
        },
        { ...statusOptions, ifCurrent: { status: phase.status, children: phaseChildren } },
      )
      latest = await WorkflowRun.getDetail(payload.workflow.runID)
    }
    // A cancel can land during the awaits above; it stays authoritative, as at
    // the top of this sync.
    if (latest.status === "cancelled") return latest
    const runStatus = aggregateRunStatus(latest.phases)
    // Same deliberate-stop rule at the run level: a budget-failed run stays
    // failed even when the aggregate would call it running or completed again.
    const runBudgetStopped =
      latest.status === "failed" && runStatus !== "failed" && WorkflowRun.isBudgetExceeded(payload.workflow.runID)
    const effectiveRunStatus = runBudgetStopped ? "failed" : runStatus
    const run =
      latest.status === effectiveRunStatus
        ? latest
        : await WorkflowRun.setStatus(
            {
              id: latest.id,
              status: effectiveRunStatus,
              error: effectiveRunStatus === "failed" || effectiveRunStatus === "blocked" ? item.error : undefined,
            },
            { ...statusOptions, ifCurrent: { status: latest.status, phases: latest.phases } },
          )
    if (!TaskQueue.isCurrentWorkflowStatus(item)) return run
    if (run.status === "failed" && WorkflowRun.isBudgetExceeded(run.id)) {
      await cancelSupersededPhaseChildren(latest.children, { error: "Workflow budget exceeded." })
    }
    if (run.status === "completed") await WorkflowRun.ensureFinalReportArtifact(latest.id)
    await reportScheduledOutcome(run)

    if (
      run.status === "running" &&
      latest.phases.some((phase) => phase.id === phaseID && phase.status === "completed")
    ) {
      return WorkflowScheduler.start(latest.id, payload.workflow.startOptions)
    }

    return run
  }
}

export async function reportScheduledOutcome(run: WorkflowRun.Info): Promise<void> {
  const { status, sourceTaskID } = run
  if ((status !== "completed" && status !== "failed" && status !== "cancelled") || !sourceTaskID?.startsWith("sch_"))
    return
  const { ScheduledTask } = await import("../session/scheduled-task")
  try {
    await ScheduledTask.recordWorkflowOutcome(ScheduledTaskID.make(sourceTaskID), status, run.error, run.id)
  } catch (error) {
    if (!NotFoundError.isInstance(error)) throw error
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

async function cancelSupersededPhaseChildren(
  children: WorkflowChildRecord[],
  {
    error = "Workflow phase merge strategy already satisfied.",
    queueItem,
  }: { error?: string; queueItem?: TaskQueue.Info } = {},
) {
  for (const snapshot of children) {
    // Stopping one queue item awaits a recursive sync that can settle the
    // remaining siblings. Re-read before acting on the next snapshot.
    const child = (await WorkflowRun.getDetail(snapshot.runID)).children.find(
      (candidate) => candidate.id === snapshot.id,
    )
    if (!child || WorkflowRun.isTerminalChildStatus(child.status)) continue
    if (queueItem && !TaskQueue.isCurrentWorkflowStatus(queueItem)) return
    const taskQueueID = child.taskQueueID
    if (taskQueueID) {
      // stop() rather than a bare setStatus: a superseded item that is already
      // running owns a live session, and setStatus would only flip the durable
      // status — leaving the subagent executing (spending tokens, running tools,
      // mutating the workspace) after the merge strategy was already satisfied.
      // stop() interrupts running/blocked sessions and cancels everything else.
      await TaskQueue.stop(taskQueueID).catch(async (stopError) => {
        // A queue item may settle between the child read and stop admission.
        // Preserve that outcome; a real stop failure must not claim a live
        // session was cancelled merely by changing its workflow row.
        const settled = await TaskQueue.get(taskQueueID)
        if (settled.status !== "completed" && settled.status !== "failed" && settled.status !== "cancelled") {
          throw stopError
        }
        await WorkflowTaskQueue.syncItem(settled)
      })
    } else {
      await WorkflowRun.setChildStatus({ id: child.id, status: "cancelled", error }, { queueItem })
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
