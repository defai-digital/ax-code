import { randomUUID } from "node:crypto"
import { Bus } from "@/bus"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { Question } from "@/question"
import { EventQuery } from "@/replay/query"
import { Log } from "@/util/log"
import { KeyedSerialQueue } from "@/util/queue"
import { uniqueItems, uniqueStrings } from "@/util/string-list"
import { scheduleUnref } from "@/util/timeout"
import { voidSafe } from "@/util/void-safe"
import { NamedError } from "@ax-code/util/error"
import { lazy } from "../util/lazy"
import { assistantError } from "../tool/task-errors"
import {
  inspectSubagentBackgroundWork,
  prepareSubagentBackgroundFinalization,
} from "./background-subagent-finalization"
import { MessageV2 } from "./message-v2"
import { SessionPrompt } from "./prompt"
import { SessionExecution } from "./execution"
import {
  PromptIsolationPolicy,
  type PromptIsolationPolicy as PromptIsolationPolicyType,
} from "./prompt/prompt-runtime-policy"
import { TaskQueue } from "./task-queue"
import { ACTIVE_QUEUE_EXECUTION_STATUSES as activeStatuses, workflowMaxParallel } from "./workflow-queue-admission"
import { ScheduledTaskID, type SessionID, type TaskQueueID } from "./schema"
import type {
  WorkflowArtifactID,
  WorkflowChildID,
  WorkflowEvidenceRef,
  WorkflowPhaseID,
  WorkflowRunID,
} from "../workflow/state"

const log = Log.create({ service: "session.task-queue-executor" })

// Lazy: session/prompt has a circular dep with session/index. Evaluating these
// schemas at module load can race the circular load cycle in the full test suite.
const QueuePromptBody = lazy(() => SessionPrompt.PromptInput.omit({ sessionID: true }))
const QueueCommandBody = lazy(() => SessionPrompt.CommandInput.omit({ sessionID: true }))
const QueueShellBody = lazy(() => SessionPrompt.ShellInput.omit({ sessionID: true }))
const QueueAssistantResult = lazy(() =>
  MessageV2.Assistant.pick({ id: true, sessionID: true, role: true, error: true }),
)

type WorkflowRunApi = typeof import("../workflow/run").WorkflowRun

type QueueExecution = {
  sessionID?: SessionID
  run: (attempt: TaskQueue.ExecutionAttempt) => Promise<unknown>
  cancel?: (current: TaskQueue.Info | undefined, options?: CancelOptions) => Promise<unknown>
}

type CancelOptions = { cancelQueueItems?: boolean }

const DEFAULT_EXECUTION_TIMEOUT_MS = 72 * 60 * 60 * 1_000
// How long a timed-out execution's cancellation may take to settle before the
// timeout cleanup force-releases the session start key. Without the bound, a
// cancellation that never settles (a wedged tool, a hung process teardown)
// parks the session key forever and no successor ever drains.
const CANCELLATION_SETTLE_MS = 30_000
const EXECUTION_HEARTBEAT_MS = 30_000
const workflowRetryTimers = Instance.state(
  () => new Map<TaskQueueID, ReturnType<typeof scheduleUnref>>(),
  async (timers) => {
    for (const timer of timers.values()) timer.clear()
    timers.clear()
  },
)
const startLocks = Instance.state(
  () => new KeyedSerialQueue(),
  async (queue) => {
    queue.clear()
  },
)

const timeoutCleanup = Instance.state(
  () => ({
    pending: new Map<string, { key: string; workflow?: { token: string; until: number } }>(),
    disposed: false,
  }),
  async (state) => {
    state.disposed = true
    state.pending.clear()
  },
)

const blockObserverState = Instance.state(
  () => ({
    initialized: false,
    unsubscribe: [] as Array<() => void>,
  }),
  async (state) => {
    for (const unsubscribe of state.unsubscribe) unsubscribe()
    state.unsubscribe = []
    state.initialized = false
  },
)

export namespace TaskQueueExecutor {
  export function initSessionBlockObservers() {
    ensureSessionBlockObservers()
  }

  /**
   * Maps workflow model-policy effort values to ReasoningPolicy depth.
   *
   * - `"normal"` — no override; the full auto-policy decides per turn.
   * - `"workflow"` — pins standard depth (predictable, no auto-upgrade).
   * - `"deep"` — forces deep reasoning variant.
   * - `"max-workflow"` — forces maximum depth (xdeep).
   */
  export function workflowEffortToRequestedDepth(effort: string): "fast" | "standard" | "deep" | "xdeep" | undefined {
    return mapEffortToDepth(effort)
  }

  export async function sendNow(id: TaskQueueID): Promise<TaskQueue.Info> {
    const item = await TaskQueue.sendNow(id)
    return start(item)
  }

  export async function start(item: TaskQueue.Info): Promise<TaskQueue.Info> {
    if (item.directory !== Instance.directory) {
      return Instance.provide({
        directory: item.directory,
        fn: () => start(item),
      })
    }

    ensureSessionBlockObservers()
    const execution = queueItemExecution(item)
    if (!execution) return item

    return startLocks().run(startLockKey(item, execution), async () => {
      const latest = await TaskQueue.get(item.id)
      const latestExecution = queueItemExecution(latest)
      if (!latestExecution) return latest
      if (latest.status !== "queued" && latest.status !== "waiting_for_idle") return latest

      if (latestExecution.sessionID && (await shouldWaitForIdle(latestExecution.sessionID, latest.id))) {
        return latest.status === "waiting_for_idle"
          ? latest
          : TaskQueue.setStatus({ id: latest.id, status: "waiting_for_idle" })
      }
      // Recheck cleanup after asynchronous admission checks, immediately before claiming.
      const key = startLockKey(latest, latestExecution)
      if ([...timeoutCleanup().pending.values()].some((pending) => pending.key === key)) {
        const error = "Waiting for a timed-out execution and its cancellation to settle."
        return latest.status === "waiting_for_idle" && latest.error === error
          ? latest
          : TaskQueue.setStatus({ id: latest.id, status: "waiting_for_idle", error })
      }

      const claim = await TaskQueue.claimForExecution(latest.id)
      if (claim.kind === "waiting") {
        if (claim.retryAfterMs !== undefined) scheduleWorkflowRetry(claim.item, claim.retryAfterMs)
        return claim.item
      }
      if (claim.kind === "unavailable") return claim.item ?? TaskQueue.get(latest.id)
      const { item: running, attempt } = claim
      clearWorkflowRetry(running.id)

      // Re-derive the execution plan from the row the claim actually
      // returned, not `latestExecution` (built from the pre-claim snapshot).
      // A concurrent edit() can land between that snapshot and the atomic
      // claim above; the executor must run the body the claim captured, or a
      // successful edit right before execution starts would be silently
      // discarded in favor of the stale pre-edit text (ADR-106 D5).
      const claimedExecution = queueItemExecution(running)
      const task = SessionExecution.bindSuccessor(claimedExecution?.sessionID, async () => {
        if (!claimedExecution) {
          await finishIfRunning(attempt, {
            status: "failed",
            error: "Task queue item became unexecutable after an edit raced its execution claim.",
          })
          return
        }
        await executeClaimedItem(running, claimedExecution, attempt)
      })
      try {
        startDetachedQueueTask(task)
      } catch (error) {
        task.cancel()
        throw error
      }
      return running
    })
  }

  export async function drainNextForSession(sessionID: SessionID): Promise<TaskQueue.Info | undefined> {
    const pending = await pendingSessionItems(sessionID)
    for (const item of pending) {
      let execution: QueueExecution | undefined
      try {
        execution = queueItemExecution(item)
      } catch (error) {
        // A row whose stored body no longer parses can never run. Fail it
        // instead of throwing out of the drain, which left it and every item
        // queued behind it in the session stuck in "queued" for good.
        log.warn("failing task queue item with an invalid payload", { taskID: item.id, sessionID, error })
        await TaskQueue.setStatus({
          id: item.id,
          status: "failed",
          error: `Invalid queued payload: ${NamedError.message(error)}`,
          onlyFromActive: true,
        })
        continue
      }
      if (!execution) continue
      return start(item)
    }
    return undefined
  }
}

function startLockKey(item: TaskQueue.Info, execution: QueueExecution): string {
  return execution.sessionID ? `session:${item.projectID}:${execution.sessionID}` : `task:${item.projectID}:${item.id}`
}

type QueueResult = { status: "completed"; result: unknown } | QueueExecutionOutcome

async function executeClaimedItem(
  item: TaskQueue.Info,
  execution: QueueExecution,
  attempt: TaskQueue.ExecutionAttempt,
) {
  try {
    let outcome: QueueResult
    let failure: unknown
    try {
      const result = await runWithExecutionWatchdog(item, execution, attempt)
      const current = TaskQueue.executionItem(attempt)
      if (!current) return
      outcome = outcomeForQueueExecution(current, result) ?? { status: "completed", result }
      if (outcome.status === "failed") throw new Error(outcome.error)
    } catch (error) {
      failure = error
      outcome = { status: "failed", error: NamedError.message(error) }
    }

    const error = outcome.status === "completed" ? undefined : outcome.error
    const finished = await finishIfRunning(attempt, { status: outcome.status, error })
    if (!finished) return
    const settled = finished.item
    if (finished.changed && outcome.status === "failed") {
      DiagnosticLog.recordProcess("server.taskQueueTaskFailed", {
        taskID: item.id,
        sessionID: item.sessionID,
        kind: item.kind,
        error: failure,
      })
      log.error("task queue item execution failed", { taskID: item.id, sessionID: item.sessionID, error: failure })
    }
    if (settled.status === "completed" && outcome.status === "completed") {
      await syncScheduledTaskOutcome(settled, attempt)
      await deliverLiveTaskSubagent(settled, outcome)
    } else if (settled.status === "failed" || settled.status === "cancelled") {
      const message = settled.error ?? error ?? `Task ended with status ${settled.status}.`
      const terminalError = finished.changed ? (failure ?? new Error(message)) : new Error(message)
      await syncScheduledTaskOutcome(settled, attempt, terminalError)
      await deliverLiveTaskSubagent(settled, { status: settled.status, error: message })
    }
  } finally {
    const current = TaskQueue.executionItem(attempt)
    if (current) await drainAfterExecution(current)
  }
}

async function drainAfterExecution(item: TaskQueue.Info) {
  if (item.sessionID) {
    await TaskQueueExecutor.drainNextForSession(item.sessionID).catch((error) => {
      DiagnosticLog.recordProcess("server.taskQueueDrainFailed", {
        taskID: item.id,
        sessionID: item.sessionID,
        error,
      })
      log.warn("failed to drain task queue after item settled", { taskID: item.id, sessionID: item.sessionID, error })
    })
  }
  await drainNextWorkflowPhaseItem(item).catch((error) => {
    DiagnosticLog.recordProcess("server.taskQueueWorkflowDrainFailed", {
      taskID: item.id,
      sessionID: item.sessionID,
      error,
    })
    log.warn("failed to drain workflow phase queue after item settled", {
      taskID: item.id,
      sessionID: item.sessionID,
      error,
    })
  })
}

async function deliverLiveTaskSubagent(
  item: TaskQueue.Info,
  outcome:
    | { status: "completed"; result: unknown }
    | { status: "failed"; error: string }
    | { status: "cancelled"; error: string },
) {
  if (item.kind !== "subagent" || item.payload["source"] !== "task") return
  await import("./background-subagent-delivery")
    .then(({ deliverBackgroundSubagentHandoff }) => deliverBackgroundSubagentHandoff({ item, outcome }))
    .catch((error) => {
      log.warn("background subagent delivery failed", { taskID: item.id, sessionID: item.sessionID, error })
    })
}

async function runWithExecutionWatchdog(
  item: TaskQueue.Info,
  execution: QueueExecution,
  attempt: TaskQueue.ExecutionAttempt,
): Promise<unknown> {
  const timeoutMs = item.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abandoned = false
  const heartbeat = setInterval(() => {
    try {
      // A row that left the active statuses (for example a blocked task the
      // user cancelled) must stop its live execution, not only change its row.
      if (abandoned || TaskQueue.heartbeat(attempt)) return
      abandoned = true
      log.warn("task queue item is no longer active; cancelling its execution", {
        taskID: item.id,
        sessionID: item.sessionID,
      })
      void Promise.resolve()
        .then(() => cancelAttempt(execution, TaskQueue.executionItem(attempt), { cancelQueueItems: false }))
        .catch((error) => {
          log.warn("failed to cancel abandoned task queue execution", {
            taskID: item.id,
            sessionID: item.sessionID,
            error,
          })
        })
    } catch (error) {
      log.warn("task queue heartbeat failed", { taskID: item.id, sessionID: item.sessionID, error })
    }
  }, EXECUTION_HEARTBEAT_MS)
  heartbeat.unref?.()

  const run = Promise.resolve().then(() => {
    if (executionIsActive(attempt)) return execution.run(attempt)
  })
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Task queue execution timed out after ${timeoutMs} ms; cancellation requested.`)
      DiagnosticLog.recordProcess("server.taskQueueTaskTimedOut", {
        taskID: item.id,
        sessionID: item.sessionID,
        kind: item.kind,
        timeoutMs,
      })
      let current: TaskQueue.Info | undefined
      try {
        current = TaskQueue.executionItem(attempt)
      } catch (readError) {
        reject(readError)
        return
      }
      // Reject first: synchronous cancellation can resolve the original run.
      reject(error)
      if (!current) {
        voidSafe(() => cancelAttempt(execution, undefined), "task-queue.retired-timeout")
        return
      }
      const cleanup = timeoutCleanup()
      const until = Date.now() + CANCELLATION_SETTLE_MS
      const workflow = TaskQueue.workflowChild(item) ? { token: randomUUID(), until } : undefined
      const pending = { key: startLockKey(item, execution), workflow }
      cleanup.pending.set(attempt.generation, pending)
      const cancellation = Promise.resolve()
        .then(() => {
          const current = TaskQueue.executionItem(attempt)
          const options =
            abandoned || !current || !isActiveQueueStatus(current.status) ? { cancelQueueItems: false } : undefined
          return cancelAttempt(execution, current, options)
        })
        .catch((error) => {
          log.warn("failed to cancel timed-out task queue execution", {
            taskID: item.id,
            sessionID: item.sessionID,
            error,
          })
          throw error
        })
      voidSafe(async () => {
        // A misbehaving execution can ignore cancellation forever. Settle the
        // cleanup after a bounded grace even then — the row is already failed
        // by the deadline race — so the session start key is released and the
        // queue cannot wedge behind a hung teardown.
        let graceTimer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([
          Promise.allSettled([run, cancellation]),
          new Promise((resolve) => {
            graceTimer = setTimeout(resolve, Math.max(0, until - Date.now()))
            // Best-effort cleanup only: a hung execution must not keep the
            // process alive for the grace either.
            graceTimer.unref?.()
          }),
        ])
        clearTimeout(graceTimer)
        if (cleanup.disposed || cleanup.pending.get(attempt.generation) !== pending) return
        cleanup.pending.delete(attempt.generation)
        if (workflow) TaskQueue.releaseWorkflowTimeoutCleanup(item.id, workflow.token)
        // Settled queue promises do not prove OS-level process quiescence.
        // They do ensure this cancellation can no longer target a successor.
        const current = TaskQueue.executionItem(attempt)
        if (current?.sessionID) await TaskQueueExecutor.drainNextForSession(current.sessionID)
        await drainNextWorkflowPhaseItem(item)
      }, "task-queue.timeout-cleanup")
    }, timeoutMs)
  })

  try {
    return await Promise.race([run, deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
    clearInterval(heartbeat)
  }
}

async function cancelAttempt(execution: QueueExecution, current: TaskQueue.Info | undefined, options?: CancelOptions) {
  if (execution.cancel) return execution.cancel(current, options)
  return cancelSession(current, options)
}

async function cancelSession(current: TaskQueue.Info | undefined, options?: CancelOptions) {
  if (!current?.sessionID) return
  if (options) await SessionPrompt.cancel(current.sessionID, options)
  else await SessionPrompt.cancel(current.sessionID)
}

async function syncScheduledTaskOutcome(item: TaskQueue.Info, attempt: TaskQueue.ExecutionAttempt, error?: unknown) {
  const scheduledTaskID = item.payload["scheduledTaskID"]
  if (typeof scheduledTaskID !== "string" || !scheduledTaskID.startsWith("sch_")) return
  // Workflow dispatch completion is not workflow completion. The workflow
  // queue bridge records the terminal outcome after its children settle.
  if (item.payload["workflowTemplateID"] && item.status === "completed") return
  await import("./scheduled-task")
    .then(({ ScheduledTask }) => {
      if (!TaskQueue.executionItem(attempt)) return
      return ScheduledTask.recordQueueOutcome(
        ScheduledTaskID.make(scheduledTaskID),
        item.status === "completed" ? "completed" : "failed",
        error,
        item.id,
      )
    })
    .catch((syncError) => {
      log.warn("failed to sync scheduled task queue outcome", {
        taskID: item.id,
        scheduledTaskID,
        error: syncError,
      })
    })
}

async function finishIfRunning(
  attempt: TaskQueue.ExecutionAttempt,
  input: { status: "completed" | "failed" | "cancelled"; error?: string },
) {
  const cleanup = input.status === "failed" ? timeoutCleanup().pending.get(attempt.generation)?.workflow : undefined
  return TaskQueue.finishExecution(attempt, { ...input, cleanup })
}

function startDetachedQueueTask(task: () => Promise<void>) {
  // Never let a detached queue task take down the process. setTimeout(0)
  // throws become uncaught exceptions (process.exit via the global handler),
  // and rejected promises must also be swallowed after logging.
  setTimeout(() => {
    voidSafe(async () => {
      try {
        await task()
      } catch (error) {
        DiagnosticLog.recordProcess("server.taskQueueTaskUnhandledFailure", { error })
        log.error("detached task queue execution failed", { error })
        throw error
      }
    }, "task-queue.detached")
  }, 0)
}

async function shouldWaitForIdle(sessionID: SessionID, currentTaskID: TaskQueueID) {
  if (sessionPromptBusy(sessionID)) return true
  const active = await activeSessionItems(sessionID)
  return active.some((item) => item.id !== currentTaskID)
}

async function drainNextWorkflowPhaseItem(item: TaskQueue.Info) {
  const workflow = TaskQueue.workflowChild(item)
  if (!workflow || workflowMaxParallel(item.payload) === undefined) return

  const { runID, phaseID } = workflow
  const candidates = await TaskQueue.listWorkflowChildren({ runID, phaseID, statuses: ["queued", "waiting_for_idle"] })
  const [next] = candidates.sort(compareQueueItems)
  if (!next) return
  await TaskQueueExecutor.start(next)
}

function clearWorkflowRetry(id: TaskQueueID): void {
  const timers = workflowRetryTimers()
  const timer = timers.get(id)
  timer?.clear()
  timers.delete(id)
}

function scheduleWorkflowRetry(item: TaskQueue.Info, waitMs: number) {
  const timers = workflowRetryTimers()
  if (timers.has(item.id)) return
  const timer = scheduleUnref(() => {
    timers.delete(item.id)
    void TaskQueue.get(item.id)
      .then((latest) => TaskQueueExecutor.start(latest))
      .catch((error) => {
        DiagnosticLog.recordProcess("server.taskQueueWorkflowRetryFailed", {
          taskID: item.id,
          sessionID: item.sessionID,
          error,
        })
        log.warn("failed to retry workflow child after admission wait", {
          taskID: item.id,
          sessionID: item.sessionID,
          error,
        })
      })
  }, waitMs)
  timers.set(item.id, timer)
}

function sessionPromptBusy(sessionID: SessionID) {
  try {
    SessionPrompt.assertNotBusy(sessionID)
    return false
  } catch {
    return true
  }
}

async function pendingSessionItems(sessionID: SessionID) {
  return TaskQueue.list({ sessionID, statuses: ["queued", "waiting_for_idle"], limit: 200 })
}

async function activeSessionItems(sessionID: SessionID) {
  return TaskQueue.list({ sessionID, statuses: [...activeStatuses], limit: 300 })
}

function isActiveQueueStatus(status: TaskQueue.Status) {
  return activeStatuses.includes(status as (typeof activeStatuses)[number])
}

function executionIsActive(attempt: TaskQueue.ExecutionAttempt): boolean {
  const current = TaskQueue.executionItem(attempt)
  return current !== undefined && isActiveQueueStatus(current.status)
}

function requireActiveQueueItem(attempt: TaskQueue.ExecutionAttempt): void {
  if (!executionIsActive(attempt)) throw new Error("Scheduled automation stopped before execution")
}

type QueueExecutionOutcome = { status: "failed"; error: string } | { status: "cancelled"; error: string }

function outcomeForQueueExecution(item: TaskQueue.Info, result: unknown): QueueExecutionOutcome | undefined {
  if (!item.sessionID) return undefined
  // Prompt failures are returned as assistant messages, not necessarily thrown
  // or recorded as replay errors (for example, a blocked completion gate).
  const info = result && typeof result === "object" ? (result as { info?: unknown }).info : undefined
  const assistant = QueueAssistantResult().safeParse(info)
  if (assistant.success && assistant.data.sessionID === item.sessionID && assistant.data.error) {
    const error = assistant.data.error
    if ("message" in error.data && typeof error.data.message === "string" && error.data.message.trim()) {
      return { status: "failed", error: error.data.message.trim() }
    }
    return { status: "failed", error: error.name }
  }

  const startedAt = item.time.started ?? item.time.created
  // Read the tail: bySessionLog caps the oldest records and can omit the
  // terminal outcome entirely once a long-running session exceeds that cap.
  const events = EventQuery.recentBySessionWithTimestamp(item.sessionID, EventQuery.BY_SESSION_LIMIT).filter(
    (event) => event.time_created >= startedAt,
  )
  const latestEnd = events.findLast((event) => event.event_data.type === "session.end")?.event_data
  if (latestEnd?.type !== "session.end" || latestEnd.reason === "completed") return undefined

  const messageID = resultMessageID(result)
  const latestError = events.findLast((event) => {
    const data = event.event_data
    if (data.type !== "error") return false
    return !messageID || !data.messageID || data.messageID === messageID
  })?.event_data

  if (latestError?.type === "error" && latestError.message.trim()) {
    return { status: "failed", error: latestError.message.trim() }
  }
  switch (latestEnd.reason) {
    // A goal budget stop is an expected clean end — the wrap-up turn ran
    // before the session stopped — so the row is cancelled like other
    // expected terminations, not failed as a stall would be.
    case "budget_limited":
      return { status: "cancelled", error: "Session stopped after the goal reached its budget" }
    case "error":
      return { status: "failed", error: "Session ended with an error" }
    case "stalled":
      return { status: "failed", error: "Session stalled before completing the task" }
    case "step_limit":
      return { status: "failed", error: "Session reached its step limit before completing the task" }
    case "aborted":
      return { status: "failed", error: "Session was aborted before completing the task" }
  }
}

function resultMessageID(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object") return undefined
  const id = (info as { id?: unknown }).id
  return typeof id === "string" && id.length > 0 ? id : undefined
}

function ensureSessionBlockObservers() {
  const state = blockObserverState()
  if (state.initialized) return
  state.initialized = true
  state.unsubscribe.push(
    Bus.subscribe(Permission.Event.Asked, (event) => {
      voidSafe(() => refreshSessionBlockStatus(event.properties.sessionID), "task-queue.block-refresh.permission-asked")
    }),
    Bus.subscribe(Permission.Event.Replied, (event) => {
      voidSafe(
        () => refreshSessionBlockStatus(event.properties.sessionID),
        "task-queue.block-refresh.permission-replied",
      )
    }),
    Bus.subscribe(Question.Event.Asked, (event) => {
      voidSafe(() => refreshSessionBlockStatus(event.properties.sessionID), "task-queue.block-refresh.question-asked")
    }),
    Bus.subscribe(Question.Event.Replied, (event) => {
      voidSafe(() => refreshSessionBlockStatus(event.properties.sessionID), "task-queue.block-refresh.question-replied")
    }),
    Bus.subscribe(Question.Event.Rejected, (event) => {
      voidSafe(
        () => refreshSessionBlockStatus(event.properties.sessionID),
        "task-queue.block-refresh.question-rejected",
      )
    }),
  )
}

async function refreshSessionBlockStatus(sessionID: SessionID) {
  try {
    // Fetch active items first: most permission/question events fire on sessions
    // with no active queue items, and this skips the two global
    // Permission.list()/Question.list() scans when there is nothing to update.
    const active = await activeSessionItems(sessionID)
    if (active.length === 0) return
    const target = await sessionBlockStatus(sessionID)
    await Promise.all(active.map((item) => TaskQueue.refreshExecutionBlockStatus(item, target ?? "running")))
  } catch (error) {
    DiagnosticLog.recordProcess("server.taskQueueBlockRefreshFailed", { sessionID, error })
    log.warn("failed to refresh task queue block status", { sessionID, error })
  }
}

async function sessionBlockStatus(
  sessionID: SessionID,
): Promise<"blocked_permission" | "blocked_question" | undefined> {
  const [permissions, questions] = await Promise.all([Permission.list(), Question.list()])
  if (permissions.some((request) => request.sessionID === sessionID)) return "blocked_permission"
  if (questions.some((request) => request.sessionID === sessionID)) return "blocked_question"
  return undefined
}

function compareQueueItems(a: TaskQueue.Info, b: TaskQueue.Info) {
  return a.position - b.position || b.time.created - a.time.created || b.id.localeCompare(a.id)
}

function queueItemExecution(item: TaskQueue.Info): QueueExecution | undefined {
  switch (item.kind) {
    case "automation":
      return scheduledAutomationExecution(item)
    case "prompt":
    case "followup": {
      if (!item.sessionID) return undefined
      const body = promptBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => runInQueueItemInstance(item, () => SessionPrompt.prompt({ ...body, sessionID: item.sessionID! })),
      }
    }
    case "command": {
      if (!item.sessionID) return undefined
      const body = commandBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => runInQueueItemInstance(item, () => SessionPrompt.command({ ...body, sessionID: item.sessionID! })),
      }
    }
    case "shell": {
      if (!item.sessionID) return undefined
      const body = shellBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => runInQueueItemInstance(item, () => SessionPrompt.shell({ ...body, sessionID: item.sessionID! })),
      }
    }
    case "subagent":
      return subagentExecution(item)
  }
}

const SCHEDULED_REUSE_PREFACE =
  "[scheduled task] New occurrence. Earlier turns in this session are previous runs; fetch current data instead of reusing those answers.\n\n"

function withScheduledReusePreface<T extends { parts?: Array<{ type: string; text?: string }> }>(
  body: T,
  reused: boolean,
): T {
  if (!reused) return body
  const parts = Array.isArray(body.parts) ? [...body.parts] : []
  const first = parts[0]
  if (first && first.type === "text" && typeof first.text === "string") {
    parts[0] = { ...first, text: SCHEDULED_REUSE_PREFACE + first.text }
    return { ...body, parts }
  }
  return { ...body, parts: [{ type: "text" as const, text: SCHEDULED_REUSE_PREFACE.trim() }, ...parts] }
}

function scheduledSessionLockKey(projectID: string, sessionID: SessionID) {
  return `session:${projectID}:${sessionID}`
}

async function sessionStillReusable(
  item: TaskQueue.Info,
  scheduledTaskID: ScheduledTaskID,
  sessionID: SessionID,
  Session: typeof import(".").Session,
  ScheduledTask: typeof import("./scheduled-task").ScheduledTask,
): Promise<boolean> {
  const session = await Session.get(sessionID).catch(() => undefined)
  if (!session || session.time.archived) return false
  if (!Session.isCompatibleWithCurrentProject(session)) return false
  if (sessionPromptBusy(sessionID)) return false
  if ((await activeSessionItems(sessionID)).some((candidate) => candidate.id !== item.id)) return false
  if ((await pendingSessionItems(sessionID)).length > 0) return false
  const priorFires = (await TaskQueue.list({ sessionID, limit: 200 })).filter(
    (candidate) =>
      candidate.kind === "automation" && candidate.sourceTaskID === scheduledTaskID && candidate.id !== item.id,
  ).length
  return priorFires < ScheduledTask.SESSION_REUSE_LIMIT
}

async function resolveReusableScheduledSession(
  item: TaskQueue.Info,
  scheduledTaskID: ScheduledTaskID,
  Session: typeof import(".").Session,
  ScheduledTask: typeof import("./scheduled-task").ScheduledTask,
): Promise<SessionID | undefined> {
  const previous = await ScheduledTask.previousAutomationSessionID(scheduledTaskID, item.id)
  if (!previous) return
  if (!(await sessionStillReusable(item, scheduledTaskID, previous, Session, ScheduledTask))) return
  return previous
}

async function runScheduledPromptAutomation(
  item: TaskQueue.Info,
  scheduledTaskID: ScheduledTaskID,
  execution: QueueExecution,
  attempt: TaskQueue.ExecutionAttempt,
): Promise<unknown> {
  requireActiveQueueItem(attempt)
  const prompt = (sessionID: SessionID, reused: boolean) => {
    const body = promptBodyFromQueueItem(item)
    if (!body) throw new Error(`Scheduled task ${scheduledTaskID} has no executable prompt`)
    return SessionPrompt.prompt({
      ...withScheduledReusePreface(body, reused),
      sessionID,
    })
  }

  if (item.sessionID) {
    const started = await startLocks().run(scheduledSessionLockKey(item.projectID, item.sessionID), async () => {
      requireActiveQueueItem(attempt)
      return { result: prompt(item.sessionID!, false) }
    })
    return started.result
  }

  const { Session } = await import(".")
  const { ScheduledTask } = await import("./scheduled-task")
  const reuseID = await resolveReusableScheduledSession(item, scheduledTaskID, Session, ScheduledTask)
  if (reuseID) {
    const reused = await startLocks().run(scheduledSessionLockKey(item.projectID, reuseID), async () => {
      if (!(await sessionStillReusable(item, scheduledTaskID, reuseID, Session, ScheduledTask))) return
      await TaskQueue.attachSession(attempt, reuseID)
      item.sessionID = reuseID
      execution.sessionID = reuseID
      requireActiveQueueItem(attempt)
      if (sessionPromptBusy(reuseID)) return
      // Serialize admission only. Holding this lock for the entire prompt would
      // prevent a successor from observing timeout cleanup and returning idle-wait.
      return { result: prompt(reuseID, true) }
    })
    if (reused) return reused.result
  }

  const session = await Session.create({ title: item.title })
  try {
    requireActiveQueueItem(attempt)
    await TaskQueue.attachSession(attempt, session.id)
  } catch (error) {
    await Session.remove(session.id).catch((removeError) => {
      log.warn("failed to discard cancelled scheduled session", {
        taskID: item.id,
        sessionID: session.id,
        error: removeError,
      })
    })
    throw error
  }
  item.sessionID = session.id
  execution.sessionID = session.id
  const started = await startLocks().run(scheduledSessionLockKey(item.projectID, session.id), async () => {
    requireActiveQueueItem(attempt)
    return { result: prompt(session.id, false) }
  })
  return started.result
}

function scheduledAutomationExecution(item: TaskQueue.Info): QueueExecution | undefined {
  const scheduledTaskID = item.payload["scheduledTaskID"]
  if (typeof scheduledTaskID !== "string" || !scheduledTaskID.startsWith("sch_")) return undefined
  let workflowRunID: WorkflowRunID | undefined
  const execution: QueueExecution = {
    sessionID: item.sessionID,
    cancel: async (current, options) => {
      if (!workflowRunID) return cancelSession(current, options)
      const { WorkflowScheduler } = await import("../workflow/scheduler")
      return WorkflowScheduler.cancel(workflowRunID)
    },
    run: (attempt) =>
      runInQueueItemInstance(item, async () => {
        const workflowTemplateID = item.payload["workflowTemplateID"]
        if (typeof workflowTemplateID === "string" && workflowTemplateID.length > 0) {
          const { WorkflowTemplate } = await import("../workflow/template")
          const { WorkflowScheduler } = await import("../workflow/scheduler")
          const run = await WorkflowTemplate.createRun({
            templateID: workflowTemplateID,
            sourceTaskID: scheduledTaskID,
          })
          workflowRunID = run.id
          try {
            requireActiveQueueItem(attempt)
          } catch (error) {
            await WorkflowScheduler.cancelUnstarted(run.id).catch((cancelError) => {
              log.warn("failed to cancel timed-out scheduled workflow run", {
                taskID: item.id,
                runID: run.id,
                error: cancelError,
              })
            })
            throw error
          }
          const { ScheduledTask } = await import("./scheduled-task")
          await ScheduledTask.recordWorkflowRun(ScheduledTaskID.make(scheduledTaskID), run.id)
          const detail = await WorkflowScheduler.start(run.id, item.payload["workflowStartOptions"] ?? {}).catch(
            async (error) => {
              // start() can throw before it flips the run to `running`; cancel the
              // never-started run so it does not linger `queued` and unrecoverable.
              await WorkflowScheduler.cancelUnstarted(run.id).catch((cancelError) => {
                log.warn("failed to cancel scheduled workflow run after a start failure", {
                  taskID: item.id,
                  runID: run.id,
                  error: cancelError,
                })
              })
              throw error
            },
          )
          if (detail.status === "failed" || detail.status === "cancelled") {
            throw new Error(detail.error ?? `Scheduled workflow ended with status ${detail.status}`)
          }
          return detail
        }

        return runScheduledPromptAutomation(item, ScheduledTaskID.make(scheduledTaskID), execution, attempt)
      }),
  }
  return execution
}

// Sent when a task's turn was cut off by a backend restart. The cut-off turn
// may already have pushed, commented or opened a pull request, so the resumed
// turn checks for that before acting outside the workspace again.
const RESTART_CONTINUATION_PROMPT =
  `Your previous turn was interrupted by a backend restart. ` +
  `Before repeating any outside action, such as a push, a comment or a pull request, check your working directory, git status and log, and the remote (GitHub comments, pull requests, checks) for what already happened, and repeat it only if it did not. ` +
  `Continue the assigned task and produce the final result. Do not repeat completed work unless you must verify it.`

function subagentExecution(item: TaskQueue.Info): QueueExecution | undefined {
  if (!item.sessionID) return undefined
  const sessionID = item.sessionID
  // One controller per execution: the watchdog's cancel() aborts pending
  // background-shell and nested-subagent waits as well as the child session
  // prompt. The waits and the follow-up prompt stay inside the same execution
  // watchdog, so no additional timeout layer is introduced.
  const controller = new AbortController()
  return {
    sessionID,
    cancel: async (current, options) => {
      controller.abort()
      if (current) await SessionPrompt.cancel(sessionID, options)
    },
    run: (attempt) =>
      runInQueueItemInstance(item, async () => {
        // A background `task` subagent returns from the tool before it runs, so
        // its SubagentStop fires here when the run settles, like the foreground
        // path in tool/task.ts. Workflow children are not task subagents.
        if (item.payload["source"] !== "task") return runSubagent(attempt)
        let status: "completed" | "failed" = "failed"
        try {
          const result = await runSubagent(attempt)
          if (result && !assistantError(result)) status = "completed"
          return result
        } finally {
          const { fireSubagentStop } = await import("../tool/task-shared")
          if (TaskQueue.executionItem(attempt)) await fireSubagentStop({ sessionID, agent: item.agent ?? "", status })
        }
      }),
  }

  async function runSubagent(attempt: TaskQueue.ExecutionAttempt) {
    const body = promptBodyFromQueueItem(item)
    if (!body) throw new Error(`Subagent queue item ${item.id} has no executable prompt`)
    const next = await applyRestartContinuation(item, body)
    const executionStartedAt = Date.now()
    if (!executionIsActive(attempt)) return undefined
    let result = await SessionPrompt.prompt({ ...next, sessionID })
    if (!executionIsActive(attempt)) return result
    const work = assistantError(result) ? undefined : await inspectSubagentBackgroundWork(sessionID, executionStartedAt)
    if (work) {
      const background = await prepareSubagentBackgroundFinalization({
        work,
        startedAt: executionStartedAt,
        executionBudgetMs: item.executionTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
        signal: controller.signal,
        tools: next.tools,
      })
      if (!executionIsActive(attempt)) return result
      result = await SessionPrompt.prompt({
        ...next,
        sessionID,
        toolsScope: "turn",
        tools: background.tools,
        parts: [{ type: "text", text: background.text }],
      })
    }
    // Only the final result is recorded for workflow usage; the interim
    // "work started" turn is not the child's deliverable.
    const workflow = TaskQueue.workflowChild(item)
    if (workflow && executionIsActive(attempt)) await recordWorkflowSubagentUsage(workflow, result)
    return result
  }
}

async function applyRestartContinuation(
  item: TaskQueue.Info,
  body: Omit<SessionPrompt.PromptInput, "sessionID">,
): Promise<Omit<SessionPrompt.PromptInput, "sessionID">> {
  if (item.payload["source"] !== "task" || !item.sessionID) return body
  const { Session } = await import(".")
  const messages = await Session.messages({ sessionID: item.sessionID })
  if (!messages.some((message) => message.info.role === "user" || message.info.role === "assistant")) return body
  return {
    ...body,
    agentRouting: "preserve",
    parts: [
      {
        type: "text",
        text: RESTART_CONTINUATION_PROMPT,
      },
    ],
  }
}

async function runInQueueItemInstance<T>(item: TaskQueue.Info, run: () => Promise<T>): Promise<T> {
  if (item.directory === Instance.directory) return run()
  return Instance.provide({
    directory: item.directory,
    fn: run,
  })
}

async function recordWorkflowSubagentUsage(workflow: TaskQueue.WorkflowChild, result: unknown) {
  const usage = messageBudgetUsage(result)

  const { WorkflowRun } = await import("../workflow/run")
  const artifactIDs: WorkflowArtifactID[] = []
  const evidenceRefs: WorkflowEvidenceRef[] = []
  const outputArtifact = messageOutputArtifact(result, usage ?? EmptyWorkflowSubagentBudgetUsage)
  if (outputArtifact) {
    const artifact = await WorkflowRun.appendArtifact({
      runID: workflow.runID as WorkflowRunID,
      phaseID: workflow.phaseID as WorkflowPhaseID,
      childID: workflow.childID as WorkflowChildID,
      kind: "summary",
      retention: "session",
      summary: outputArtifact.summary,
      payload: outputArtifact.payload,
    })
    artifactIDs.push(artifact.id)
    evidenceRefs.push({ kind: "artifact", id: artifact.id })
  }
  if (usage) {
    const toolCallArtifact = messageToolCallArtifact(result, usage)
    if (toolCallArtifact) {
      const artifact = await WorkflowRun.appendArtifact({
        runID: workflow.runID as WorkflowRunID,
        phaseID: workflow.phaseID as WorkflowPhaseID,
        childID: workflow.childID as WorkflowChildID,
        kind: "metric",
        retention: "session",
        summary: toolCallArtifact.summary,
        payload: toolCallArtifact.payload,
      })
      artifactIDs.push(artifact.id)
      evidenceRefs.push({ kind: "artifact", id: artifact.id })
    }
  }
  await attachWorkflowChildArtifacts(WorkflowRun, {
    runID: workflow.runID as WorkflowRunID,
    childID: workflow.childID as WorkflowChildID,
    artifactIDs,
    evidenceRefs,
  })
  if (!usage) return
  await WorkflowRun.appendBudgetUsage({
    runID: workflow.runID as WorkflowRunID,
    phaseID: workflow.phaseID as WorkflowPhaseID,
    childID: workflow.childID as WorkflowChildID,
    kind: "consume",
    usageDelta: usage,
  })

  const detail = await WorkflowRun.getDetail(workflow.runID as WorkflowRunID)
  const child = detail.children.find((candidate) => candidate.id === workflow.childID)
  if (child?.status === "failed" && child.error?.startsWith("Workflow budget exceeded")) {
    throw new Error(child.error)
  }
}

async function attachWorkflowChildArtifacts(
  WorkflowRun: WorkflowRunApi,
  input: {
    runID: WorkflowRunID
    childID: WorkflowChildID
    artifactIDs: WorkflowArtifactID[]
    evidenceRefs: WorkflowEvidenceRef[]
  },
) {
  if (input.artifactIDs.length === 0 && input.evidenceRefs.length === 0) return
  const detail = await WorkflowRun.getDetail(input.runID)
  const child = detail.children.find((candidate) => candidate.id === input.childID)
  if (!child) return
  await WorkflowRun.setChildStatus({
    id: child.id,
    status: child.status,
    outputSummary: child.outputSummary,
    artifactIDs: uniqueWorkflowArtifactIDs([...child.artifactIDs, ...input.artifactIDs]),
    evidenceRefs: uniqueWorkflowEvidenceRefs([...child.evidenceRefs, ...input.evidenceRefs]),
    error: child.error,
  })
}

function uniqueWorkflowArtifactIDs(ids: WorkflowArtifactID[]): WorkflowArtifactID[] {
  return uniqueItems(ids)
}

function uniqueWorkflowEvidenceRefs(refs: WorkflowEvidenceRef[]): WorkflowEvidenceRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function messageToolCallArtifact(result: unknown, usage: WorkflowSubagentBudgetUsage) {
  if (usage.toolCalls === 0) return undefined
  const parts = result && typeof result === "object" ? (result as { parts?: unknown }).parts : undefined
  const tools = messageToolNames(parts)
  const info = result && typeof result === "object" ? (result as { info?: unknown }).info : undefined
  const messageID = info && typeof info === "object" ? (info as { id?: unknown }).id : undefined
  const label = tools.length > 0 ? tools.join(", ") : "unknown tools"
  return {
    summary: `Tool-call summary: ${usage.toolCalls} call(s) (${label}).`,
    payload: {
      kind: "workflow-tool-call-summary",
      messageID: typeof messageID === "string" ? messageID : undefined,
      toolCalls: usage.toolCalls,
      tools,
      usage,
    },
  }
}

function promptBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueuePromptBody().parse(applyWorkflowPromptPolicy(applyWorkflowEffortPolicy(direct, item), item))
  const text = readPayloadText(item) ?? readPayloadPrompt(item)
  if (!text) return undefined
  return QueuePromptBody().parse(
    applyWorkflowPromptPolicy(
      applyWorkflowEffortPolicy(
        {
          parts: [{ type: "text", text }],
          agent: item.agent,
          agentRouting: "preserve",
          model: modelObject(item.model),
        },
        item,
      ),
      item,
    ),
  )
}

function commandBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueueCommandBody().parse(direct)
  const text = readPayloadText(item)
  if (!text) return undefined
  return QueueCommandBody().parse({
    command: text,
    arguments: "",
    agent: item.agent,
    model: typeof item.model === "string" ? item.model : undefined,
  })
}

function shellBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueueShellBody().parse(direct)
  const text = readPayloadText(item)
  if (!text) return undefined
  return QueueShellBody().parse({
    command: text,
    agent: item.agent ?? "build",
    model: modelObject(item.model),
  })
}

function readPayloadBody(item: TaskQueue.Info) {
  const body = item.payload["body"]
  return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined
}

function readPayloadText(item: TaskQueue.Info) {
  const text = item.payload["text"]
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : undefined
}

function readPayloadPrompt(item: TaskQueue.Info) {
  const prompt = item.payload["prompt"]
  return typeof prompt === "string" && prompt.trim().length > 0 ? prompt.trim() : undefined
}

function applyWorkflowPromptPolicy(body: Record<string, unknown>, item: TaskQueue.Info): Record<string, unknown> {
  const policy = workflowPromptPolicy(item.payload)
  if (!policy) return body

  const next = { ...body }
  const tools = promptToolsFromAllowedTools(policy.allowedTools, policy.escalationPolicy)
  if (tools) {
    next.tools = mergeWorkflowToolPolicy(readBooleanRecord(next.tools), tools)
    next.toolsScope = "turn"
  } else if (readBooleanRecord(next.tools)) {
    next.toolsScope = "turn"
  }

  const isolation = promptIsolationFromWorkflowPolicy(policy)
  if (isolation) next.isolation = mergeWorkflowIsolationPolicy(readPromptIsolationPolicy(next.isolation), isolation)
  return next
}

function workflowPromptPolicy(payload: TaskQueue.Payload) {
  const workflow = payload["workflow"]
  if (!workflow || typeof workflow !== "object") return undefined

  const allowedTools = stringArray(payload["allowedTools"])
  const writePolicy = workflowWritePolicy(payload["writePolicy"])
  const networkPolicy = workflowNetworkPolicy(payload["networkPolicy"])
  const escalationPolicy = workflowEscalationPolicy(payload["escalationPolicy"])
  return { allowedTools, writePolicy, networkPolicy, escalationPolicy }
}

function promptToolsFromAllowedTools(
  allowedTools: string[] | undefined,
  escalationPolicy: "inherit" | "ask" | "deny" | undefined,
): Record<string, boolean> | undefined {
  const tools: Record<string, boolean> = {}
  if (allowedTools?.length) {
    tools["*"] = false
    for (const tool of allowedTools.flatMap(workflowToolPermissionNames)) tools[tool] = true
  }
  if (escalationPolicy === "deny") {
    tools.isolation_escalation = false
  } else if (escalationPolicy === "ask" && allowedTools?.length) {
    // `isolation_escalation` is interactive-only, so an allow rule still asks.
    // This preserves the workflow default while `* = false` denies other tools.
    tools.isolation_escalation = true
  }
  return Object.keys(tools).length > 0 ? tools : undefined
}

function workflowToolPermissionNames(tool: string): string[] {
  const trimmed = tool.trim()
  if (!trimmed) return []
  const names = new Set([trimmed])
  const sanitized = trimmed.replace(/[^A-Za-z0-9_]/g, "_")
  if (sanitized !== trimmed) names.add(sanitized)
  for (const alias of workflowToolAliases(trimmed)) names.add(alias)
  return Array.from(names)
}

function workflowToolAliases(tool: string): string[] {
  switch (tool) {
    case "file.read":
      return ["read"]
    case "file.grep":
    case "rg":
      return ["grep"]
    case "file.glob":
      return ["glob"]
    case "file.list":
      return ["list"]
    default:
      return []
  }
}

function mergeWorkflowToolPolicy(
  existing: Record<string, boolean> | undefined,
  workflow: Record<string, boolean>,
): Record<string, boolean> {
  const merged = { ...workflow }
  for (const [tool, enabled] of Object.entries(existing ?? {})) {
    if (enabled === false) merged[tool] = false
    else if (workflow[tool] === true) merged[tool] = true
  }
  return merged
}

function promptIsolationFromWorkflowPolicy(policy: {
  writePolicy?: "read-only" | "serialized" | "worktree-required"
  networkPolicy?: "inherit" | "disabled" | "allowed"
}): PromptIsolationPolicyType | undefined {
  const isolation: PromptIsolationPolicyType = {}
  if (policy.writePolicy === "read-only") isolation.mode = "read-only"
  if (policy.writePolicy === "serialized" || policy.writePolicy === "worktree-required") {
    isolation.mode = "workspace-write"
  }
  if (policy.networkPolicy === "disabled") isolation.network = false
  if (policy.networkPolicy === "allowed") isolation.network = true
  return Object.keys(isolation).length > 0 ? isolation : undefined
}

function mergeWorkflowIsolationPolicy(
  existing: PromptIsolationPolicyType | undefined,
  workflow: PromptIsolationPolicyType,
): PromptIsolationPolicyType {
  if (!existing) return workflow
  const mode = stricterIsolationMode(workflow.mode, existing.mode)
  const network =
    workflow.network === false || existing.network === false ? false : (workflow.network ?? existing.network)
  return {
    ...(mode ? { mode } : {}),
    ...(network === undefined ? {} : { network }),
  }
}

function stricterIsolationMode(
  a: PromptIsolationPolicyType["mode"],
  b: PromptIsolationPolicyType["mode"],
): PromptIsolationPolicyType["mode"] {
  if (!a) return b
  if (!b) return a
  const rank = { "read-only": 0, "workspace-write": 1, "full-access": 2 } as const
  return rank[a] <= rank[b] ? a : b
}

function readPromptIsolationPolicy(value: unknown): PromptIsolationPolicyType | undefined {
  const parsed = PromptIsolationPolicy.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function readBooleanRecord(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const result: Record<string, boolean> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "boolean") result[key] = item
  }
  return result
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  return items.length ? items : undefined
}

function workflowWritePolicy(value: unknown): "read-only" | "serialized" | "worktree-required" | undefined {
  return value === "read-only" || value === "serialized" || value === "worktree-required" ? value : undefined
}

function workflowNetworkPolicy(value: unknown): "inherit" | "disabled" | "allowed" | undefined {
  return value === "inherit" || value === "disabled" || value === "allowed" ? value : undefined
}

function workflowEscalationPolicy(value: unknown): "inherit" | "ask" | "deny" | undefined {
  return value === "inherit" || value === "ask" || value === "deny" ? value : undefined
}

type WorkflowSubagentBudgetUsage = {
  totalTokens: number
  inputTokens: number
  outputTokens: number
  toolCalls: number
}

const EmptyWorkflowSubagentBudgetUsage: WorkflowSubagentBudgetUsage = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
}

function messageBudgetUsage(result: unknown): WorkflowSubagentBudgetUsage | undefined {
  const tokens = messageTokens(result)
  const toolCalls = messageToolCalls(result)
  if (!tokens && toolCalls === 0) return undefined
  return {
    totalTokens: tokens?.total ?? 0,
    inputTokens: tokens?.input ?? 0,
    outputTokens: tokens?.output ?? 0,
    toolCalls,
  }
}

function messageOutputArtifact(result: unknown, usage: WorkflowSubagentBudgetUsage) {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object" || (info as { role?: unknown }).role !== "assistant") return undefined
  const messageID = info && typeof info === "object" ? (info as { id?: unknown }).id : undefined
  const parts = (result as { parts?: unknown }).parts
  const output = messageTextOutput(parts)
  const tools = messageToolNames(parts)
  const fallback = usage.toolCalls > 0 ? `${usage.toolCalls} tool call(s) completed.` : "Workflow child completed."
  return {
    summary: truncateArtifactSummary(output || fallback),
    payload: {
      messageID: typeof messageID === "string" ? messageID : undefined,
      output: output || undefined,
      tools,
      usage,
    },
  }
}

function messageTokens(result: unknown) {
  if (!result || typeof result !== "object") return undefined
  const info = (result as { info?: unknown }).info
  if (!info || typeof info !== "object") return undefined
  const tokens = (info as { tokens?: unknown }).tokens
  if (!tokens || typeof tokens !== "object") return undefined
  const record = tokens as Record<string, unknown>
  const input = nonNegativeNumber(record.input)
  const output = nonNegativeNumber(record.output)
  const total = nonNegativeNumber(record.total) ?? (input ?? 0) + (output ?? 0)
  if (input === undefined && output === undefined && total === 0) return undefined
  return {
    total,
    input: input ?? 0,
    output: output ?? 0,
  }
}

function messageToolCalls(result: unknown) {
  if (!result || typeof result !== "object") return 0
  const parts = (result as { parts?: unknown }).parts
  if (!Array.isArray(parts)) return 0
  return parts.filter((part) => {
    if (!part || typeof part !== "object") return false
    return (part as { type?: unknown }).type === "tool"
  }).length
}

function messageTextOutput(parts: unknown) {
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part) => {
      if (!part || typeof part !== "object") return ""
      const record = part as { type?: unknown; text?: unknown }
      return record.type === "text" && typeof record.text === "string" ? record.text.trim() : ""
    })
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function messageToolNames(parts: unknown) {
  if (!Array.isArray(parts)) return []
  const tools = stringArray(
    parts.map((part) => {
      if (!part || typeof part !== "object") return undefined
      const record = part as { type?: unknown; tool?: unknown }
      return record.type === "tool" ? record.tool : undefined
    }),
  )
  return uniqueStrings(tools ?? [])
}

function truncateArtifactSummary(text: string) {
  const compact = text.replace(/\s+/g, " ").trim()
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function applyWorkflowEffortPolicy(body: Record<string, unknown>, item: TaskQueue.Info): Record<string, unknown> {
  // Workflow effort (normal/deep/workflow/max-workflow) maps to
  // ReasoningPolicy.Depth so child sessions honour the declared
  // effort instead of always relying on the automatic policy.
  const effort = readWorkflowEffort(item.payload)
  if (!effort) return body
  const depth = mapEffortToDepth(effort)
  if (!depth) return body
  return { ...body, requestedDepth: depth }
}

function readWorkflowEffort(payload: TaskQueue.Payload): string | undefined {
  const effort = payload["effort"]
  return typeof effort === "string" && effort.trim().length > 0 ? effort.trim() : undefined
}

/**
 * Maps workflow model-policy effort values to ReasoningPolicy depth.
 *
 * - `"normal"` — no override; the full auto-policy decides per turn.
 * - `"workflow"` — pins standard depth (predictable, no auto-upgrade).
 * - `"deep"` — forces deep reasoning variant.
 * - `"max-workflow"` — forces maximum depth (xdeep).
 */
function mapEffortToDepth(effort: string): "fast" | "standard" | "deep" | "xdeep" | undefined {
  switch (effort) {
    case "normal":
      return undefined
    case "workflow":
      return "standard"
    case "deep":
      return "deep"
    case "max-workflow":
      return "xdeep"
    default:
      return undefined
  }
}

function modelObject(value: unknown) {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  if (typeof record.providerID !== "string" || typeof record.modelID !== "string") return undefined
  return {
    providerID: record.providerID,
    modelID: record.modelID,
  }
}
