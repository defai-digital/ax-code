import z from "zod"
import { Session } from "../session"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget } from "./budget"
import { isWorkflowRuntimeEnabled, type WorkflowSpecV1 } from "./spec"
import { planWorkflowDryRun } from "./planner"
import { WorkflowRun } from "./run"
import { WorkflowPhaseID, WorkflowRunID } from "./state"

type WorkflowDispatchExecutor = (
  spec: { agent: string; prompt: string; constraints?: string[]; timeoutMs?: number },
  signal: AbortSignal,
) => Promise<{
  output?: string
  filesModified?: string[]
  tokensUsed?: number
  inputTokens?: number
  outputTokens?: number
}>

export namespace WorkflowScheduler {
  export const StartOptions = z.object({
    allowScaleBeyondDefaults: z.boolean().default(false),
    allowWriteWorkflows: z.boolean().default(false),
    durableChildren: z.boolean().default(true),
    enqueueChildren: z.boolean().default(true),
  })
  export type StartOptions = z.input<typeof StartOptions> & {
    dispatchExecutor?: WorkflowDispatchExecutor
    signal?: AbortSignal
  }

  export async function start(runID: WorkflowRunID, options: StartOptions = {}) {
    assertEnabled()
    const dispatchExecutor = options.dispatchExecutor
    const signal = options.signal
    const parsed = StartOptions.parse(options)
    const initial = await WorkflowRun.getDetail(runID)
    if (initial.status === "completed" || initial.status === "cancelled" || initial.status === "failed") {
      return initial
    }
    assertExecutableMergeStrategies(initial.spec)

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
              pacing: childPlan.pacing,
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
      } else {
        const { WorkflowDispatchAdapter, WorkflowDispatchExecutorMissingError } = await import("./dispatch-adapter")
        if (!dispatchExecutor) throw new WorkflowDispatchExecutorMissingError()
        const phaseSpec = initial.spec.phases.find((item) => item.id === phase.specPhaseID)
        if (!phaseSpec) throw new Error(`No workflow phase spec for ${phase.specPhaseID}`)
        const executed = await WorkflowDispatchAdapter.executePhase({
          runID,
          spec: initial.spec,
          phase,
          phaseSpec,
          phasePlan,
          executor: dispatchExecutor,
          signal,
        })
        if (executed.phase.status === "failed" || executed.phase.status === "cancelled") {
          await WorkflowRun.setStatus({ id: runID, status: executed.phase.status, error: executed.phase.error })
          return WorkflowRun.getDetail(runID)
        }
        continue
      }

      return WorkflowRun.getDetail(runID)
    }

    const completed = await WorkflowRun.setStatus({ id: runID, status: "completed" })
    if (completed.status === "completed") await WorkflowRun.ensureFinalReportArtifact(runID)
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
    return retryChildren(runID)
  }

  export async function retryPhase(runID: WorkflowRunID, phaseID: WorkflowPhaseID) {
    assertEnabled()
    return retryChildren(runID, phaseID)
  }
}

async function retryChildren(runID: WorkflowRunID, phaseID?: WorkflowPhaseID) {
  const TaskQueue = await loadTaskQueue()
  const detail = await WorkflowRun.getDetail(runID)
  if (phaseID && !detail.phases.some((phase) => phase.id === phaseID)) {
    throw new Error(`Workflow phase ${phaseID} does not belong to workflow run ${runID}.`)
  }
  const children = phaseID ? detail.children.filter((child) => child.phaseID === phaseID) : detail.children
  const retryableChildren = children.filter((child) => child.status === "failed" || child.status === "cancelled")
  if (retryableChildren.length === 0) return detail

  const retryDelta = { retries: 1 }
  const retryBudget = evaluateWorkflowBudget({
    budget: detail.budget,
    usage: addWorkflowBudgetUsage(detail.budgetUsage, retryDelta),
  })
  await WorkflowRun.appendBudgetUsage({
    runID,
    phaseID,
    kind: "consume",
    usageDelta: retryDelta,
    message: phaseID ? `Retry requested for workflow phase ${phaseID}.` : "Retry requested for workflow run.",
  })
  if (retryBudget.exceeded.length > 0) return WorkflowRun.getDetail(runID)

  for (const child of retryableChildren) {
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

export class WorkflowSchedulerDisabledError extends Error {
  constructor() {
    super("Workflow runtime is disabled. Set AX_CODE_WORKFLOW_RUNTIME=1 to enable workflow scheduling.")
    this.name = "WorkflowSchedulerDisabledError"
  }
}

export class WorkflowUnsupportedMergeStrategyError extends Error {
  constructor(phaseID: string, strategy: string) {
    super(`Workflow phase ${phaseID} uses mergeStrategy ${strategy}, which is a schema placeholder and cannot run yet.`)
    this.name = "WorkflowUnsupportedMergeStrategyError"
  }
}

function assertEnabled() {
  if (!isWorkflowRuntimeEnabled()) throw new WorkflowSchedulerDisabledError()
}

function assertExecutableMergeStrategies(spec: WorkflowSpecV1) {
  for (const phase of spec.phases) {
    if (phase.mergeStrategy === "custom-reducer") {
      throw new WorkflowUnsupportedMergeStrategyError(phase.id, phase.mergeStrategy)
    }
  }
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
    (child) =>
      child.status === "running" || child.status === "blocked_permission" || child.status === "blocked_question",
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
