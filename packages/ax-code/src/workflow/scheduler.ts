import z from "zod"
import { Instance } from "../project/instance"
import { Session } from "../session"
import type { TaskQueueID } from "../session/schema"
import { KeyedSerialQueue } from "../util/queue"
import { JsonBoolean } from "../util/schema"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget } from "./budget"
import { isWorkflowRuntimeEnabled, type WorkflowSpecV1 } from "./spec"
import { planWorkflowDryRun, type WorkflowDryRunPhase } from "./planner"
import { WorkflowRun } from "./run"
import { WorkflowPhaseID, type WorkflowRunDetail, WorkflowRunID } from "./state"

type WorkflowDispatchExecutor = (
  spec: { agent: string; prompt: string; constraints?: string[]; timeoutMs?: number },
  signal: AbortSignal,
) => Promise<{
  output?: string
  filesModified?: string[]
  filesProposed?: string[]
  tokensUsed?: number
  inputTokens?: number
  outputTokens?: number
}>

const startLocks = Instance.state(
  () => new KeyedSerialQueue(),
  async (queue) => {
    queue.clear()
  },
)

export namespace WorkflowScheduler {
  export const StartOptions = z.object({
    allowScaleBeyondDefaults: JsonBoolean.default(false),
    allowWriteWorkflows: JsonBoolean.default(false),
    durableChildren: JsonBoolean.default(true),
    enqueueChildren: JsonBoolean.default(true),
  })
  export type StartOptions = z.input<typeof StartOptions> & {
    dispatchExecutor?: WorkflowDispatchExecutor
    signal?: AbortSignal
  }

  export async function start(runID: WorkflowRunID, options: StartOptions = {}) {
    assertEnabled()
    return startLocks().run(`workflow-run:${Instance.project.id}:${runID}`, () => startUnlocked(runID, options))
  }

  async function startUnlocked(runID: WorkflowRunID, options: StartOptions = {}) {
    const dispatchExecutor = options.dispatchExecutor
    const signal = options.signal
    const parsed = StartOptions.parse(options)
    const initial = await WorkflowRun.getDetail(runID)
    if (initial.status === "completed" || initial.status === "cancelled" || initial.status === "failed") {
      return initial
    }
    const timedOut = await stopIfWallTimeExceeded(runID, initial)
    if (timedOut) return timedOut
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
      const stopped = await stopIfWallTimeExceeded(runID)
      if (stopped) return stopped
      if (phase.status === "completed") continue
      const phasePlan = plan.phases.find((item) => item.specPhaseID === phase.specPhaseID)
      if (!phasePlan) throw new Error(`No dry-run phase plan for workflow phase ${phase.specPhaseID}`)
      await ensurePhasePromptArtifact(runID, initial.spec, phase, phasePlan)

      if (parsed.enqueueChildren) {
        const current = await WorkflowRun.getDetail(runID)
        const existingChildren = current.children.filter((child) => child.phaseID === phase.id)
        if (existingChildren.length > 0) return current
      }

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
        const enqueuedTasks: Array<{ task: Awaited<ReturnType<typeof TaskQueue.enqueue>> }> = []
        for (const childPlan of phasePlan.children) {
          const target = await prepareChildRuntimeTarget(runID, phase, childPlan)
          const { child, task } = await Instance.provide({
            directory: target.directory,
            fn: async () => {
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
                worktree: target.worktree,
                agent: childPlan.agent,
                model: childPlan.model,
                sourceTaskID: initial.sourceTaskID,
                payload: {
                  workflow: {
                    runID,
                    phaseID: phase.id,
                    childID: child.id,
                    specPhaseID: phase.specPhaseID,
                    startOptions: parsed,
                  },
                  worktree: target.payload,
                  prompt: childPlan.prompt,
                  artifactRefs: childPlan.artifactRefs,
                  budgetSlice: childPlan.budgetSlice,
                  pacing: childPlan.pacing,
                  maxParallel: phasePlan.maxParallel,
                  allowedTools: childPlan.allowedTools,
                  writePolicy: childPlan.writePolicy,
                  networkPolicy: childPlan.networkPolicy,
                  escalationPolicy: childPlan.escalationPolicy,
                },
              })
              return { child, task }
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
          enqueuedTasks.push({ task })
        }

        // Enqueue creates the queue items but does not start them. Without
        // this explicit start, workflow children sit in "queued" forever —
        // drainNextWorkflowPhaseItem() only fires after a child completes,
        // so the first batch never gets picked up.
        const TaskQueueExecutor = await loadTaskQueueExecutor()
        for (const { task } of enqueuedTasks) {
          await TaskQueueExecutor.start(task)
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
        await cancelWorkflowQueueItem(child.taskQueueID).catch(() => undefined)
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
        // Children whose queue items are actively running (or blocked) must
        // have their session cancelled so the executor drains and the child
        // can be marked paused.  Without this, refreshPausedRunState sees
        // live children and refuses to flip the workflow to "paused".
        if (
          item?.status === "running" ||
          item?.status === "blocked_permission" ||
          item?.status === "blocked_question"
        ) {
          if (item.sessionID) {
            const { SessionPrompt } = await import("../session/prompt")
            await SessionPrompt.cancel(item.sessionID).catch(() => undefined)
          }
          await TaskQueue.pause(child.taskQueueID).catch(() => undefined)
          await WorkflowRun.setChildStatus({ id: child.id, status: "paused" })
          continue
        }
      }
      if (child.status === "queued" || child.status === "running") {
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
          const resumed = await TaskQueue.resume(child.taskQueueID)
          const TaskQueueExecutor = await loadTaskQueueExecutor()
          await TaskQueueExecutor.start(resumed)
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

type WorkflowChildRuntimeTarget = {
  directory: string
  worktree: string
  payload: {
    mode: "current" | "dedicated"
    directory: string
    name?: string
    branch?: string
  }
}

async function prepareChildRuntimeTarget(
  runID: WorkflowRunID,
  phase: WorkflowRunDetail["phases"][number],
  childPlan: WorkflowDryRunPhase["children"][number],
): Promise<WorkflowChildRuntimeTarget> {
  if (childPlan.writePolicy !== "worktree-required") {
    return {
      directory: Instance.directory,
      worktree: Instance.worktree,
      payload: {
        mode: "current",
        directory: Instance.worktree,
      },
    }
  }

  const { Worktree } = await import("../worktree")
  const info = await Worktree.makeWorktreeInfo(`workflow-${runID}-${phase.specPhaseID}-${childPlan.index + 1}`)
  const bootstrap = await Worktree.createFromInfo(info)
  await bootstrap()
  return {
    directory: info.directory,
    worktree: info.directory,
    payload: {
      mode: "dedicated",
      directory: info.directory,
      name: info.name,
      branch: info.branch,
    },
  }
}

async function stopIfWallTimeExceeded(runID: WorkflowRunID, inputDetail?: WorkflowRunDetail) {
  const detail = inputDetail ?? (await WorkflowRun.getDetail(runID))
  if (detail.time.started === undefined) return undefined
  const elapsedMs = Date.now() - detail.time.started
  const evaluation = evaluateWorkflowBudget({
    budget: detail.budget,
    usage: detail.budgetUsage,
    elapsedMs,
  })
  if (!evaluation.exceeded.some((item) => item.startsWith("wall time "))) return undefined

  await WorkflowRun.appendBudgetUsage({
    runID,
    kind: "exceeded",
    usageDelta: {},
    message: `Workflow wall time budget exceeded before scheduler advance: ${evaluation.exceeded.join("; ")}`,
  })
  return WorkflowRun.getDetail(runID)
}

async function cancelWorkflowQueueItem(taskQueueID: TaskQueueID) {
  const TaskQueue = await loadTaskQueue()
  const item = await TaskQueue.get(taskQueueID)
  if (item.status === "cancelled") return item
  if (item.status === "queued" || item.status === "waiting_for_idle" || item.status === "paused") {
    return TaskQueue.cancel(taskQueueID)
  }
  if (item.status === "running" || item.status === "blocked_permission" || item.status === "blocked_question") {
    if (item.sessionID) {
      const { SessionPrompt } = await import("../session/prompt")
      await SessionPrompt.cancel(item.sessionID).catch(() => undefined)
    }
    return TaskQueue.setStatus({
      id: taskQueueID,
      status: "cancelled",
      error: "Workflow run cancelled.",
    })
  }
  return item
}

async function ensurePhasePromptArtifact(
  runID: WorkflowRunID,
  spec: WorkflowSpecV1,
  phase: WorkflowRunDetail["phases"][number],
  phasePlan: WorkflowDryRunPhase,
) {
  const specArtifactID = phasePromptArtifactID(phase.specPhaseID)
  const detail = await WorkflowRun.getDetail(runID)
  if (detail.artifacts.some((artifact) => artifact.specArtifactID === specArtifactID)) return

  const phaseSpec = spec.phases.find((item) => item.id === phase.specPhaseID)
  await WorkflowRun.appendArtifact({
    runID,
    phaseID: phase.id,
    specArtifactID,
    kind: "log",
    retention: "session",
    summary: `Phase prompt summary: ${phase.name}`,
    payload: {
      kind: "phase-prompt-summary",
      phaseID: phase.id,
      specPhaseID: phase.specPhaseID,
      phaseKind: phase.kind,
      agent: phase.agent,
      promptSummary: summarizePrompt(phaseSpec?.prompt),
      outputs: phase.outputs,
      dependsOn: phaseSpec?.dependsOn ?? [],
      maxParallel: phasePlan.maxParallel,
      estimatedChildren: phasePlan.estimatedChildren,
      childPromptSummaries: phasePlan.children.map((child) => ({
        index: child.index,
        agent: child.agent,
        modelRole: child.modelRole,
        model: child.model,
        promptSummary: summarizePrompt(child.prompt),
        artifactRefs: child.artifactRefs,
      })),
    },
  })
}

function phasePromptArtifactID(specPhaseID: string) {
  return `phase-prompt-${specPhaseID}`
}

function summarizePrompt(prompt: string | undefined) {
  if (!prompt) return "No prompt declared."
  const compact = prompt.replace(/\s+/g, " ").trim()
  return compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`
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
        const retried = await TaskQueue.retry(child.taskQueueID)
        const TaskQueueExecutor = await loadTaskQueueExecutor()
        await TaskQueueExecutor.start(retried)
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

async function loadTaskQueueExecutor() {
  return (await import("../session/task-queue-executor")).TaskQueueExecutor
}
