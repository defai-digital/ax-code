import path from "node:path"
import { HTTPException } from "hono/http-exception"
import z from "zod"
import type { DispatchExecutor } from "../dispatch"
import { Global } from "../global"
import { Instance } from "../project/instance"
import type { TaskQueue } from "../session/task-queue"
import { NotFoundError } from "../storage/db"
import { FileLock } from "../util/filelock"
import { Filesystem } from "../util/filesystem"
import { Hash } from "../util/hash"
import { KeyedSerialQueue } from "../util/queue"
import { JsonBoolean } from "../util/schema"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget } from "./budget"
import { isWorkflowRuntimeEnabled, isWorkflowStartAllowed, type WorkflowSpecV1 } from "./spec"
import { loadPhasePreparation, prepareWorkflowChildSession } from "./phase-preparation"
import { planWorkflowDryRun, type WorkflowDryRunPhase } from "./planner"
import { WorkflowRun } from "./run"
import { WorkflowPhaseID, type WorkflowRunDetail, WorkflowRunID } from "./state"

type InlineDispatch = {
  executePhase: typeof import("./dispatch-adapter").WorkflowDispatchAdapter.executePhase
  executor: DispatchExecutor
  signal: AbortSignal
}

const inlineExecutions = new Map<string, { owner: KeyedSerialQueue; controller: AbortController }>()

const startLocks = Instance.state(
  () => new KeyedSerialQueue(),
  async (queue) => {
    queue.clear()
    for (const execution of inlineExecutions.values()) {
      if (execution.owner === queue) execution.controller.abort()
    }
  },
)

function runKey(runID: WorkflowRunID): string {
  return `workflow-run:${Instance.project.id}:${runID}`
}

export namespace WorkflowScheduler {
  export const StartOptions = z.object({
    allowScaleBeyondDefaults: JsonBoolean.default(false),
    allowWriteWorkflows: JsonBoolean.default(false),
    durableChildren: JsonBoolean.default(true),
    enqueueChildren: JsonBoolean.default(true),
    autoStartChildren: JsonBoolean.default(true),
  })
  export type StartOptions = z.input<typeof StartOptions> & {
    dispatchExecutor?: DispatchExecutor
    signal?: AbortSignal
  }

  export async function start(runID: WorkflowRunID, options: StartOptions = {}) {
    if (!isWorkflowRuntimeEnabled()) {
      let specID: string | undefined
      try {
        specID = (await WorkflowRun.get(runID)).spec.id
      } catch {
        throw new WorkflowSchedulerDisabledError()
      }
      await assertEnabledForSpec(specID)
    }
    const owner = startLocks()
    return owner.run(runKey(runID), () => startUnlocked(runID, options, owner))
  }

  async function startUnlocked(
    runID: WorkflowRunID,
    options: StartOptions,
    owner: KeyedSerialQueue,
  ): Promise<WorkflowRunDetail> {
    const parsed = StartOptions.parse(options)
    const initial = await WorkflowRun.getDetail(runID)
    await assertEnabledForSpec(initial.spec.id)
    if (initial.status === "completed" || initial.status === "cancelled" || initial.status === "failed") {
      return initial
    }
    const timedOut = await stopIfWallTimeExceeded(runID, initial)
    if (timedOut) return timedOut
    // A paused run must go through resume(): startUnlocked would flip it to
    // running and then return at the existing-children guard, leaving paused
    // children with no execution carrier (zombie "running" run).
    if (initial.status === "paused") return resume(runID)
    assertExecutableMergeStrategies(initial.spec)

    const plan = planWorkflowDryRun({
      spec: initial.spec,
      allowScaleBeyondDefaults: parsed.allowScaleBeyondDefaults,
      allowWriteWorkflows: parsed.allowWriteWorkflows,
      durableChildren: parsed.durableChildren,
    })
    const inlineRequired =
      !parsed.enqueueChildren && initial.phases.some((phase) => phase.status !== "completed" && phase.kind !== "noop")
    const adapter = inlineRequired ? await import("./dispatch-adapter") : undefined
    const key = runKey(runID)
    if (inlineExecutions.has(key)) {
      throw new HTTPException(409, { message: `Workflow run ${runID} already has an active inline dispatch.` })
    }
    if (!adapter) return startPhases(initial, parsed, plan)

    const { WorkflowDispatchAdapter, WorkflowDispatchExecutorMissingError } = adapter
    const executor = options.dispatchExecutor
    if (!executor) throw new WorkflowDispatchExecutorMissingError()
    WorkflowDispatchAdapter.assertReadOnly(initial.spec)

    const controller = new AbortController()
    inlineExecutions.set(key, { owner, controller })
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal
    try {
      const result = await startPhases(initial, parsed, plan, {
        executePhase: WorkflowDispatchAdapter.executePhase,
        executor,
        signal,
      }).catch(async (error) => {
        if (!(signal.aborted && error instanceof HTTPException && error.status === 409)) throw error
        return WorkflowRun.getDetail(runID)
      })
      if (options.signal?.aborted && !controller.signal.aborted && !WorkflowRun.isTerminalRunStatus(result.status)) {
        return await terminateRun(runID)
      }
      return result
    } finally {
      inlineExecutions.delete(key)
    }
  }

  async function startPhases(
    initial: WorkflowRunDetail,
    parsed: z.output<typeof StartOptions>,
    plan: ReturnType<typeof planWorkflowDryRun>,
    inline?: InlineDispatch,
  ): Promise<WorkflowRunDetail> {
    const runID = initial.id
    if (inline?.signal.aborted) return WorkflowRun.getDetail(runID)
    const started = await WorkflowRun.setStatus(
      { id: runID, status: "running" },
      { signal: inline?.signal, preserveTerminal: true },
    )
    if (started.status !== "running") return WorkflowRun.getDetail(runID)
    for (const phase of initial.phases) {
      if (inline?.signal.aborted) return WorkflowRun.getDetail(runID)
      const stopped = await stopIfWallTimeExceeded(runID)
      if (stopped) return stopped
      if (phase.status === "completed") continue
      const phasePlan = plan.phases.find((item) => item.specPhaseID === phase.specPhaseID)
      if (!phasePlan) throw new Error(`No dry-run phase plan for workflow phase ${phase.specPhaseID}`)
      if (parsed.enqueueChildren || phase.kind === "noop") {
        const admitted = await admitDurablePhase(runID, phase.id, phasePlan, parsed)
        if (admitted.kind === "advance") continue
        if (admitted.kind === "queued" && parsed.autoStartChildren && admitted.tasks.length > 0) {
          // Dispatch after releasing the lock. Starting a child synchronizes
          // the workflow and can request another phase admission.
          const TaskQueueExecutor = await loadTaskQueueExecutor()
          for (const task of admitted.tasks) {
            if (shouldAutoStartWorkflowQueueItem(task)) await TaskQueueExecutor.start(task)
          }
        }
        return WorkflowRun.getDetail(runID)
      }

      if (inline) {
        await ensurePhasePromptArtifact(runID, initial.spec, phase, phasePlan)
        const advanced = await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })
        if (advanced.status !== "running") return WorkflowRun.getDetail(runID)
        const phaseSpec = initial.spec.phases.find((item) => item.id === phase.specPhaseID)
        if (!phaseSpec) throw new Error(`No workflow phase spec for ${phase.specPhaseID}`)
        const executed = await inline.executePhase({
          runID,
          spec: initial.spec,
          phase,
          phaseSpec,
          phasePlan,
          executor: inline.executor,
          signal: inline.signal,
        })
        if (!executed || inline.signal.aborted) return WorkflowRun.getDetail(runID)
        if (executed.status === "failed" || executed.status === "cancelled") {
          await WorkflowRun.setStatus(
            { id: runID, status: executed.status, error: executed.error },
            { signal: inline.signal },
          )
          return WorkflowRun.getDetail(runID)
        }
        continue
      }

      return WorkflowRun.getDetail(runID)
    }

    if (inline?.signal.aborted) return WorkflowRun.getDetail(runID)
    const completed = await WorkflowRun.setStatus({ id: runID, status: "completed" }, { signal: inline?.signal })
    if (completed.status === "completed") await WorkflowRun.ensureFinalReportArtifact(runID)
    return WorkflowRun.getDetail(runID)
  }

  async function admitDurablePhase(
    runID: WorkflowRunID,
    phaseID: WorkflowPhaseID,
    plan: WorkflowDryRunPhase,
    options: z.output<typeof StartOptions>,
  ): Promise<{ kind: "advance" | "stop" } | { kind: "queued"; tasks: TaskQueue.Info[] }> {
    // Serialize preparation of this run across worktrees and processes.
    // A run's phases share one lock, and the database owns admission.
    // @scan-suppress security_scan Hash.fast encodes the run key as hex without path separators.
    const lockPath = path.join(Global.Path.state, "workflow-phase-setup", Hash.fast(runKey(runID)))
    using _lock = await FileLock.acquire(lockPath).catch((error) => {
      if (!(error instanceof FileLock.TimeoutError)) throw error
      throw new HTTPException(409, { message: `Workflow run ${runID} is already preparing a phase.` })
    })
    const current = await WorkflowRun.getDetail(runID)
    if (current.status !== "running" && current.status !== "blocked") return { kind: "stop" }
    const phase = current.phases.find((item) => item.id === phaseID)
    if (!phase) throw new Error(`Missing workflow phase ${phaseID}`)
    if (phase.status === "completed") return { kind: "advance" }
    if (WorkflowRun.isTerminalPhaseStatus(phase.status) || phase.status === "paused") {
      return { kind: "stop" }
    }

    const existingChildren = current.children.some((child) => child.phaseID === phase.id)
    if (existingChildren) {
      // A process can exit after admission but before dispatch. The saved
      // queue policy still decides which of those items may be auto-started.
      const TaskQueue = await loadTaskQueue()
      const tasks = options.autoStartChildren
        ? await TaskQueue.listWorkflowChildren({ runID, phaseID: phase.id, statuses: ["queued", "waiting_for_idle"] })
        : []
      return { kind: "queued", tasks }
    }

    if (phase.kind === "noop") {
      await ensurePhasePromptArtifact(runID, current.spec, phase, plan)
      const advanced = await WorkflowRun.setPhaseStatus({ id: phase.id, status: "running" })
      if (advanced.status !== "running") return { kind: "stop" }
      await WorkflowRun.appendArtifact({
        runID,
        phaseID: phase.id,
        kind: "summary",
        retention: "session",
        summary: `Noop phase completed: ${phase.name}`,
        payload: { phaseID: phase.id, specPhaseID: phase.specPhaseID },
      })
      await WorkflowRun.setPhaseStatus({ id: phase.id, status: "completed" })
      return { kind: "advance" }
    }

    if (!WorkflowRun.canPreparePhaseChildren(runID, phase.id, plan.children.length)) return { kind: "stop" }

    // A retry or a child's completion can reach the scheduler from a different
    // checkout. Prepare new children only from the run's original workspace.
    if (!(await Filesystem.isDir(current.directory))) {
      throw new HTTPException(409, { message: "The workflow's original workspace is unavailable." })
    }
    return await Instance.provide({
      directory: current.directory,
      fn: () => prepareAndEnqueueChildren(current, phase, plan, options),
    })
  }

  async function prepareAndEnqueueChildren(
    run: WorkflowRunDetail,
    phase: WorkflowRunDetail["phases"][number],
    plan: WorkflowDryRunPhase,
    options: z.output<typeof StartOptions>,
  ): Promise<{ kind: "queued"; tasks: TaskQueue.Info[] }> {
    if (Instance.project.id !== run.projectID) {
      throw new HTTPException(409, { message: "The workflow's original workspace now belongs to another project." })
    }

    const runID = run.id
    const preparation = await loadPhasePreparation(runID, phase)
    const prepared: Awaited<ReturnType<typeof WorkflowRun.prepareQueuedChild>>[] = []
    for (const childPlan of plan.children) {
      const { target, sessionID } = await preparation.reserve(childPlan.index, childPlan.writePolicy)
      const child = await Instance.provide({
        directory: target.directory,
        fn: async () => {
          if (Instance.project.id !== run.projectID) {
            throw new HTTPException(409, { message: "A prepared workflow target belongs to another project." })
          }
          const session = await prepareWorkflowChildSession(sessionID, {
            parentID: run.parentSessionID,
            title: `${run.spec.name}: ${phase.name} #${childPlan.index + 1} (@${childPlan.agent ?? "workflow"} workflow child)`,
          })
          return WorkflowRun.prepareQueuedChild(
            {
              runID,
              phaseID: phase.id,
              sessionID: session.id,
              agent: childPlan.agent,
              model: childPlan.model,
              budgetSlice: childPlan.budgetSlice,
            },
            {
              title: `${run.spec.name}: ${phase.name} #${childPlan.index + 1}`,
              specPhaseID: phase.specPhaseID,
              startOptions: options,
              sourceTaskID: run.sourceTaskID,
              payload: {
                worktree: target.payload,
                prompt: childPlan.prompt,
                artifactRefs: childPlan.artifactRefs,
                budgetSlice: childPlan.budgetSlice,
                pacing: childPlan.pacing,
                maxParallel: plan.maxParallel,
                allowedTools: childPlan.allowedTools,
                writePolicy: childPlan.writePolicy,
                networkPolicy: childPlan.networkPolicy,
                escalationPolicy: childPlan.escalationPolicy,
                effort: childPlan.effort,
              },
            },
          )
        },
      })
      prepared.push(child)
    }
    await ensurePhasePromptArtifact(runID, run.spec, phase, plan)
    const tasks = await WorkflowRun.enqueuePhaseChildren(runID, phase.id, prepared)
    if (tasks.length > 0) await preparation.clear()
    return { kind: "queued", tasks }
  }

  export async function cancel(runID: WorkflowRunID) {
    const detail = await WorkflowRun.get(runID)
    await assertEnabledForSpec(detail.spec.id)
    const cancelled = await terminateRun(runID)
    const { reportScheduledOutcome } = await import("./task-queue")
    await reportScheduledOutcome(cancelled)
    return cancelled
  }

  /**
   * Terminate a run that never started, without the enablement gate `cancel`
   * asserts. A dispatch that failed BECAUSE the spec is runtime-disabled must
   * still be cleaned up: `cancel` would re-run the same assert, throw the same
   * error, and leave the pre-created row `queued` indefinitely.
   */
  export async function cancelUnstarted(runID: WorkflowRunID) {
    return terminateRun(runID)
  }

  async function terminateRun(runID: WorkflowRunID): Promise<WorkflowRunDetail> {
    const TaskQueue = await loadTaskQueue()
    for (const child of TaskQueue.captureWorkflowCancellation(runID)) {
      try {
        await TaskQueue.stopWorkflowChild(child)
      } catch (error) {
        if (!NotFoundError.isInstance(error)) throw error
      }
    }
    WorkflowRun.finishCancellation(runID)
    inlineExecutions.get(runKey(runID))?.controller.abort()
    return WorkflowRun.getDisplayDetail(runID)
  }

  export async function pause(runID: WorkflowRunID) {
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    await assertEnabledForSpec(detail.spec.id)
    // Pausing a settled run would overwrite its outcome and completion time
    // with "paused", and a later resume would strand it in "running".
    if (WorkflowRun.isTerminalRunStatus(detail.status)) return detail
    for (const child of detail.children) {
      if (WorkflowRun.isTerminalChildStatus(child.status) || child.status === "paused") continue
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
          await TaskQueue.stopWorkflowChild(item)
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
    const TaskQueue = await loadTaskQueue()
    const detail = await WorkflowRun.getDetail(runID)
    await assertEnabledForSpec(detail.spec.id)
    let resumedAny = false
    for (const child of detail.children) {
      if (child.status !== "paused") continue
      resumedAny = true
      if (child.taskQueueID) {
        const item = await TaskQueue.get(child.taskQueueID).catch(() => undefined)
        if (item?.status === "paused") {
          const resumed = await TaskQueue.resume(child.taskQueueID)
          if (shouldAutoStartWorkflowQueueItem(resumed)) {
            const TaskQueueExecutor = await loadTaskQueueExecutor()
            await TaskQueueExecutor.start(resumed)
          }
          continue
        }
        // Pausing a running child cancels its still-active queue item (marking
        // it terminal, not paused), so resume must re-run that item — otherwise
        // the child is queued with no execution carrier and the run never
        // settles.
        if (item?.status === "failed" || item?.status === "cancelled") {
          const retried = await TaskQueue.retry(child.taskQueueID)
          if (shouldAutoStartWorkflowQueueItem(retried)) {
            const TaskQueueExecutor = await loadTaskQueueExecutor()
            await TaskQueueExecutor.start(retried)
          }
          continue
        }
        // The turn can also finish inside the pause's cancel window: the item
        // then settles to completed while the pause still parked the child.
        // Re-sync the child from that item instead of queueing it — a queued
        // child whose item is already terminal has no execution carrier, and
        // the run then never leaves "running".
        if (item?.status === "completed") {
          const WorkflowTaskQueue = await loadWorkflowTaskQueue()
          await WorkflowTaskQueue.syncItem(item)
          continue
        }
      }
      await WorkflowRun.setChildStatus({ id: child.id, status: "queued" })
    }
    // Only refresh when there was something to resume. Refreshing a terminal
    // (failed/cancelled) run with no paused children would flip it back to
    // "running" with no live children — a zombie run that can never settle.
    if (resumedAny || detail.status === "paused") await refreshRunningRunState(runID)
    return WorkflowRun.getDetail(runID)
  }

  export async function retry(runID: WorkflowRunID) {
    const detail = await WorkflowRun.get(runID)
    await assertEnabledForSpec(detail.spec.id)
    return retryChildren(runID)
  }

  export async function retryPhase(runID: WorkflowRunID, phaseID: WorkflowPhaseID) {
    const detail = await WorkflowRun.get(runID)
    await assertEnabledForSpec(detail.spec.id)
    return retryChildren(runID, phaseID)
  }
}

async function stopIfWallTimeExceeded(runID: WorkflowRunID, inputDetail?: WorkflowRun.Info) {
  // Only `time.started`, `budget`, and `budgetUsage` are read here, and all
  // three live on the run row itself — `getDetail` would run 5 SELECTs plus a
  // full zod parse just to reconstruct phases/children/artifacts we ignore.
  const detail = inputDetail ?? (await WorkflowRun.get(runID))
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
    throw new WorkflowPhaseNotInRunError(phaseID, runID)
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

  // An explicit, budget-admitted retry reopens cancellation before queue
  // notifications arrive. Ordinary late notifications remain ignored.
  if (detail.status === "cancelled") {
    await WorkflowRun.setStatus({ id: runID, status: "running" }, { reopenCancelled: true })
  }

  for (const child of retryableChildren) {
    if (child.taskQueueID) {
      const item = await TaskQueue.get(child.taskQueueID).catch(() => undefined)
      if (item?.status === "failed" || item?.status === "cancelled") {
        const retried = await TaskQueue.retry(child.taskQueueID)
        if (shouldAutoStartWorkflowQueueItem(retried)) {
          const TaskQueueExecutor = await loadTaskQueueExecutor()
          await TaskQueueExecutor.start(retried)
        }
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

async function assertEnabledForSpec(specID: string) {
  if (isWorkflowStartAllowed(`builtin:${specID}`)) return
  throw new WorkflowSchedulerDisabledError()
}

function assertExecutableMergeStrategies(spec: WorkflowSpecV1) {
  for (const phase of spec.phases) {
    if (phase.mergeStrategy === "custom-reducer") {
      throw new WorkflowUnsupportedMergeStrategyError(phase.id, phase.mergeStrategy)
    }
  }
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
    if (phaseChildren.some((child) => child.status === "paused") && !WorkflowRun.isTerminalPhaseStatus(phase.status)) {
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

async function loadWorkflowTaskQueue() {
  return (await import("./task-queue")).WorkflowTaskQueue
}

function shouldAutoStartWorkflowQueueItem(item: TaskQueue.Info) {
  const workflow = item.payload["workflow"]
  if (!workflow || typeof workflow !== "object") return true
  const startOptions = (workflow as { startOptions?: unknown }).startOptions
  return WorkflowScheduler.StartOptions.parse(startOptions ?? {}).autoStartChildren
}

export class WorkflowPhaseNotInRunError extends Error {
  constructor(phaseID: WorkflowPhaseID, runID: WorkflowRunID) {
    super(`Workflow phase ${phaseID} does not belong to workflow run ${runID}.`)
    this.name = "WorkflowPhaseNotInRunError"
  }
}
