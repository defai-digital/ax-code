import z from "zod"
import { Session } from "../session"
import { isWorkflowRuntimeEnabled } from "./spec"
import { planWorkflowDryRun } from "./planner"
import { WorkflowRun } from "./run"
import { WorkflowRunID } from "./state"

export namespace WorkflowScheduler {
  export const StartOptions = z.object({
    allowScaleBeyondDefaults: z.boolean().default(false),
    allowWriteWorkflows: z.boolean().default(false),
    durableChildren: z.boolean().default(true),
    enqueueChildren: z.boolean().default(true),
  })
  export type StartOptions = z.input<typeof StartOptions>

  export async function start(runID: WorkflowRunID, options: StartOptions = {}) {
    assertEnabled()
    const parsed = StartOptions.parse(options)
    const initial = await WorkflowRun.getDetail(runID)
    if (initial.status === "completed" || initial.status === "cancelled" || initial.status === "failed") {
      return initial
    }

    const plan = planWorkflowDryRun({
      spec: initial.spec,
      allowScaleBeyondDefaults: parsed.allowScaleBeyondDefaults,
      allowWriteWorkflows: parsed.allowWriteWorkflows,
      durableChildren: parsed.durableChildren,
    })
    const TaskQueue = await loadTaskQueue()

    await WorkflowRun.setStatus({ id: runID, status: "running" })
    for (const phase of initial.phases) {
      if (phase.status === "completed") continue
      const phasePlan = plan.phases.find((item) => item.specPhaseID === phase.specPhaseID)
      if (!phasePlan) throw new Error(`No dry-run phase plan for workflow phase ${phase.specPhaseID}`)

      await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })

      if (phase.kind === "noop") {
        await WorkflowRun.appendArtifact({
          runID,
          phaseID: phase.id,
          kind: "summary",
          retention: "session",
          summary: `Noop phase completed: ${phase.name}`,
          payload: { phaseID: phase.id, specPhaseID: phase.specPhaseID },
        })
        await WorkflowRun.setPhaseStatus({ id: phase.id, status: "completed" })
        continue
      }

      if (parsed.enqueueChildren) {
        for (const childPlan of phasePlan.children) {
          const session = await Session.create({
            parentID: initial.parentSessionID,
            title: `${initial.spec.name}: ${phase.name} #${childPlan.index + 1} (@${childPlan.agent ?? "workflow"} workflow child)`,
          })
          const child = await WorkflowRun.appendChild({
            runID,
            phaseID: phase.id,
            sessionID: session.id,
            agent: childPlan.agent,
            model: childPlan.model,
            budgetSlice: childPlan.budgetSlice,
          })
          const task = await TaskQueue.enqueue({
            sessionID: session.id,
            kind: "subagent",
            title: `${initial.spec.name}: ${phase.name} #${childPlan.index + 1}`,
            agent: childPlan.agent,
            model: childPlan.model,
            payload: {
              workflow: {
                runID,
                phaseID: phase.id,
                childID: child.id,
                specPhaseID: phase.specPhaseID,
                startOptions: parsed,
              },
              prompt: childPlan.prompt,
              budgetSlice: childPlan.budgetSlice,
              allowedTools: childPlan.allowedTools,
              writePolicy: childPlan.writePolicy,
              networkPolicy: childPlan.networkPolicy,
            },
          })
          await WorkflowRun.attachChildTaskQueueID({ id: child.id, taskQueueID: task.id })
          await WorkflowRun.appendBudgetUsage({
            runID,
            phaseID: phase.id,
            childID: child.id,
            kind: "reserve",
            usageDelta: { childAgents: 1 },
          })
        }
      }

      return WorkflowRun.getDetail(runID)
    }

    await WorkflowRun.setStatus({ id: runID, status: "completed" })
    return WorkflowRun.getDetail(runID)
  }

  export async function cancel(runID: WorkflowRunID) {
    assertEnabled()
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    for (const child of detail.children) {
      if (child.taskQueueID) {
        await TaskQueue.cancel(child.taskQueueID).catch(() => undefined)
      }
      if (!isTerminalChildStatus(child.status)) {
        await WorkflowRun.setChildStatus({ id: child.id, status: "cancelled" })
      }
    }
    for (const phase of detail.phases) {
      if (!isTerminalPhaseStatus(phase.status)) {
        await WorkflowRun.setPhaseStatus({ id: phase.id, status: "cancelled" })
      }
    }
    await WorkflowRun.setStatus({ id: runID, status: "cancelled" })
    return WorkflowRun.getDetail(runID)
  }

  export async function pause(runID: WorkflowRunID) {
    assertEnabled()
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    for (const child of detail.children) {
      if (isTerminalChildStatus(child.status) || child.status === "paused") continue
      if (child.taskQueueID) {
        const item = await TaskQueue.get(child.taskQueueID).catch(() => undefined)
        if (item?.status === "queued" || item?.status === "waiting_for_idle") {
          await TaskQueue.pause(child.taskQueueID)
          continue
        }
      }
      if (child.status === "queued") {
        await WorkflowRun.setChildStatus({ id: child.id, status: "paused" })
      }
    }
    await refreshPausedRunState(runID)
    return WorkflowRun.getDetail(runID)
  }

  export async function resume(runID: WorkflowRunID) {
    assertEnabled()
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    for (const child of detail.children) {
      if (child.status !== "paused") continue
      if (child.taskQueueID) {
        const item = await TaskQueue.get(child.taskQueueID).catch(() => undefined)
        if (item?.status === "paused") {
          await TaskQueue.resume(child.taskQueueID)
          continue
        }
      }
      await WorkflowRun.setChildStatus({ id: child.id, status: "queued" })
    }
    await refreshRunningRunState(runID)
    return WorkflowRun.getDetail(runID)
  }

  export async function retry(runID: WorkflowRunID) {
    assertEnabled()
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    for (const child of detail.children) {
      if (child.status !== "failed" && child.status !== "cancelled") continue
      if (child.taskQueueID) {
        const item = await TaskQueue.get(child.taskQueueID).catch(() => undefined)
        if (item?.status === "failed" || item?.status === "cancelled") {
          await TaskQueue.retry(child.taskQueueID)
          continue
        }
      }
      await WorkflowRun.setChildStatus({ id: child.id, status: "queued" })
    }
    await refreshRunningRunState(runID)
    return WorkflowRun.getDetail(runID)
  }
}

export class WorkflowSchedulerDisabledError extends Error {
  constructor() {
    super("Workflow runtime is disabled. Set AX_CODE_WORKFLOW_RUNTIME=1 to enable workflow scheduling.")
    this.name = "WorkflowSchedulerDisabledError"
  }
}

function assertEnabled() {
  if (!isWorkflowRuntimeEnabled()) throw new WorkflowSchedulerDisabledError()
}

function isTerminalPhaseStatus(status: WorkflowRun.PhaseStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

function isTerminalChildStatus(status: WorkflowRun.ChildStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

async function refreshPausedRunState(runID: WorkflowRunID) {
  const detail = await WorkflowRun.getDetail(runID)
  const active = detail.children.some(
    (child) => child.status === "running" || child.status === "blocked_permission" || child.status === "blocked_question",
  )
  if (active) return
  for (const phase of detail.phases) {
    const phaseChildren = detail.children.filter((child) => child.phaseID === phase.id)
    if (phaseChildren.some((child) => child.status === "paused") && !isTerminalPhaseStatus(phase.status)) {
      await WorkflowRun.setPhaseStatus({ id: phase.id, status: "paused" })
    }
  }
  await WorkflowRun.setStatus({ id: runID, status: "paused" })
}

async function refreshRunningRunState(runID: WorkflowRunID) {
  const detail = await WorkflowRun.getDetail(runID)
  for (const phase of detail.phases) {
    const phaseChildren = detail.children.filter((child) => child.phaseID === phase.id)
    const hasResumedChild = phaseChildren.some(
      (child) =>
        child.status === "queued" ||
        child.status === "running" ||
        child.status === "blocked_permission" ||
        child.status === "blocked_question",
    )
    if (hasResumedChild && (phase.status === "paused" || phase.status === "failed" || phase.status === "cancelled")) {
      await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })
    }
  }
  if (detail.status === "paused" || detail.status === "failed" || detail.status === "cancelled") {
    await WorkflowRun.setStatus({ id: runID, status: "running" })
  }
}

async function loadTaskQueue() {
  return (await import("../session/task-queue")).TaskQueue
}
