import { Bus } from "@/bus"
import { DiagnosticLog } from "@/debug/diagnostic-log"
import { Permission } from "@/permission"
import { Instance } from "@/project/instance"
import { Question } from "@/question"
import { Log } from "@/util/log"
import { NamedError } from "@ax-code/util/error"
import { lazy } from "../util/lazy"
import { SessionPrompt } from "./prompt"
import { TaskQueue } from "./task-queue"
import type { SessionID, TaskQueueID } from "./schema"

const log = Log.create({ service: "session.task-queue-executor" })

// Lazy: session/prompt has a circular dep with session/index. Evaluating these
// schemas at module load can race the circular load cycle in the full test suite.
const QueuePromptBody = lazy(() => SessionPrompt.PromptInput.omit({ sessionID: true }))
const QueueCommandBody = lazy(() => SessionPrompt.CommandInput.omit({ sessionID: true }))
const QueueShellBody = lazy(() => SessionPrompt.ShellInput.omit({ sessionID: true }))

type QueueExecution = {
  sessionID: SessionID
  run: () => Promise<unknown>
}

const activeStatuses = ["running", "blocked_permission", "blocked_question"] as const

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

  export async function sendNow(id: TaskQueueID): Promise<TaskQueue.Info> {
    const item = await TaskQueue.sendNow(id)
    return start(item)
  }

  export async function start(item: TaskQueue.Info): Promise<TaskQueue.Info> {
    ensureSessionBlockObservers()
    const execution = queueItemExecution(item)
    if (!execution) return item
    if (item.status !== "queued" && item.status !== "waiting_for_idle") return item

    if (await shouldWaitForIdle(execution.sessionID, item.id)) {
      return item.status === "waiting_for_idle"
        ? item
        : TaskQueue.setStatus({ id: item.id, status: "waiting_for_idle" })
    }

    const running = await TaskQueue.claimForExecution(item.id)
    if (!running) return TaskQueue.get(item.id)

    startDetachedQueueTask(async () => {
      await executeClaimedItem(running, execution)
    })
    return running
  }

  export async function drainNextForSession(sessionID: SessionID): Promise<TaskQueue.Info | undefined> {
    const pending = await pendingSessionItems(sessionID)
    for (const item of pending) {
      if (!queueItemExecution(item)) continue
      return start(item)
    }
    return undefined
  }
}

async function executeClaimedItem(item: TaskQueue.Info, execution: QueueExecution) {
  try {
    await execution.run()
    await finishIfRunning(item, { status: "completed" })
  } catch (error) {
    DiagnosticLog.recordProcess("server.taskQueueTaskFailed", {
      taskID: item.id,
      sessionID: item.sessionID,
      kind: item.kind,
      error,
    })
    await finishIfRunning(item, {
      status: "failed",
      error: NamedError.message(error),
    })
    log.error("task queue item execution failed", { taskID: item.id, sessionID: item.sessionID, error })
  } finally {
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
  }
}

async function finishIfRunning(
  item: TaskQueue.Info,
  input: { status: Extract<TaskQueue.Status, "completed" | "failed">; error?: string },
) {
  const current = await TaskQueue.get(item.id)
  if (!isActiveQueueStatus(current.status)) return current
  return TaskQueue.setStatus({ id: item.id, status: input.status, error: input.error })
}

function startDetachedQueueTask(task: () => Promise<void>) {
  setTimeout(() => {
    void task().catch((error) => {
      DiagnosticLog.recordProcess("server.taskQueueTaskUnhandledFailure", { error })
      log.error("detached task queue execution failed", { error })
    })
  }, 0)
}

async function shouldWaitForIdle(sessionID: SessionID, currentTaskID: TaskQueueID) {
  if (sessionPromptBusy(sessionID)) return true
  const active = await activeSessionItems(sessionID)
  return active.some((item) => item.id !== currentTaskID)
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
  const [queued, waiting] = await Promise.all([
    TaskQueue.list({ sessionID, status: "queued", limit: 100 }),
    TaskQueue.list({ sessionID, status: "waiting_for_idle", limit: 100 }),
  ])
  return [...queued, ...waiting].sort(compareQueueItems)
}

async function activeSessionItems(sessionID: SessionID) {
  const items = await Promise.all(activeStatuses.map((status) => TaskQueue.list({ sessionID, status, limit: 100 })))
  return items.flat()
}

function isActiveQueueStatus(status: TaskQueue.Status) {
  return activeStatuses.includes(status as (typeof activeStatuses)[number])
}

function ensureSessionBlockObservers() {
  const state = blockObserverState()
  if (state.initialized) return
  state.initialized = true
  state.unsubscribe.push(
    Bus.subscribe(Permission.Event.Asked, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Permission.Event.Replied, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Asked, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Replied, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
    Bus.subscribe(Question.Event.Rejected, (event) => {
      void refreshSessionBlockStatus(event.properties.sessionID)
    }),
  )
}

async function refreshSessionBlockStatus(sessionID: SessionID) {
  try {
    const target = await sessionBlockStatus(sessionID)
    const active = await activeSessionItems(sessionID)
    await Promise.all(
      active.map((item) => {
        const status = target ?? "running"
        return item.status === status ? item : TaskQueue.setStatus({ id: item.id, status })
      }),
    )
  } catch (error) {
    DiagnosticLog.recordProcess("server.taskQueueBlockRefreshFailed", { sessionID, error })
    log.warn("failed to refresh task queue block status", { sessionID, error })
  }
}

async function sessionBlockStatus(sessionID: SessionID): Promise<TaskQueue.Status | undefined> {
  const [permissions, questions] = await Promise.all([Permission.list(), Question.list()])
  if (permissions.some((request) => request.sessionID === sessionID)) return "blocked_permission"
  if (questions.some((request) => request.sessionID === sessionID)) return "blocked_question"
  return undefined
}

function compareQueueItems(a: TaskQueue.Info, b: TaskQueue.Info) {
  return a.position - b.position || b.time.created - a.time.created || b.id.localeCompare(a.id)
}

function queueItemExecution(item: TaskQueue.Info): QueueExecution | undefined {
  if (!item.sessionID) return undefined
  switch (item.kind) {
    case "prompt":
    case "followup": {
      const body = promptBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.prompt({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "command": {
      const body = commandBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.command({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "shell": {
      const body = shellBodyFromQueueItem(item)
      if (!body) return undefined
      return {
        sessionID: item.sessionID,
        run: () => SessionPrompt.shell({ ...body, sessionID: item.sessionID! }),
      }
    }
    case "subagent":
      return workflowSubagentExecution(item)
    case "review":
    case "automation":
      return undefined
  }
}

function workflowSubagentExecution(item: TaskQueue.Info): QueueExecution | undefined {
  if (!isWorkflowQueueItem(item)) return undefined
  const body = promptBodyFromQueueItem(item)
  if (!body) return undefined
  return {
    sessionID: item.sessionID!,
    run: () => SessionPrompt.prompt({ ...body, sessionID: item.sessionID! }),
  }
}

function promptBodyFromQueueItem(item: TaskQueue.Info) {
  const direct = readPayloadBody(item)
  if (direct) return QueuePromptBody().parse(direct)
  const text = readPayloadText(item) ?? readPayloadPrompt(item)
  if (!text) return undefined
  return QueuePromptBody().parse({
    parts: [{ type: "text", text }],
    agent: item.agent,
    agentRouting: "preserve",
    model: modelObject(item.model),
  })
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

function isWorkflowQueueItem(item: TaskQueue.Info) {
  const workflow = item.payload["workflow"]
  return !!workflow && typeof workflow === "object"
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
