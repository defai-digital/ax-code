export type SubagentTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "cancelled"
  | "canceled"
  | string
  | undefined

export type SubagentRollupTask = {
  id: string
  sessionID?: string
  title?: string
  agent?: string
  modelID?: string
  status?: SubagentTaskStatus
  startedAt?: number
  lastActivityAt?: number
  endedAt?: number
}

export type SubagentRollupSession = {
  id: string
  parentID?: string
  title?: string
  agent?: string
  modelID?: string
  startedAt?: number
  lastActivityAt?: number
}

export type SubagentRollupStatus =
  | {
      type: "idle"
    }
  | {
      type: "retry"
      attempt: number
      message: string
      next: number
    }
  | {
      type: "busy"
      startedAt?: number
      lastActivityAt?: number
      waitState?: "llm" | "tool"
      activeTool?: string
    }

export type SubagentStatusItem = {
  id: string
  sessionID?: string
  title: string
  agent?: string
  model?: string
  active: boolean
  done: boolean
  failed: boolean
  stale: boolean
  startedAt: number
  lastActivityAt: number
  activity: string
  elapsed: string
  label: string
}

export type SubagentStatusView = {
  running: number
  done: number
  failed: number
  total: number
  items: SubagentStatusItem[]
}

const DEFAULT_STALE_AFTER_MS = 90_000
const CHILD_TITLE_SUFFIX = /\s+\(@(.+?)\s+(?:subagent|parallel)\)$/i

function formatDuration(value: number) {
  const totalSeconds = Math.max(1, Math.floor(value / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`
}

function formatElapsed(startedAt: number | undefined, endedAt: number) {
  if (!startedAt) return ""
  return formatDuration(Math.max(0, endedAt - startedAt))
}

function toolLabel(tool?: string) {
  if (!tool) return "Using tool"
  const normalized = tool.replace(/[_-]+/g, " ").trim().toLowerCase()
  if (["grep", "glob", "read", "scan", "list"].some((name) => normalized.includes(name))) return "Scanning files"
  if (["bash", "shell", "terminal", "command"].some((name) => normalized.includes(name))) return "Running command"
  if (["edit", "write", "patch", "diff"].some((name) => normalized.includes(name))) return "Editing files"
  if (["lsp", "code intelligence", "codesearch"].some((name) => normalized.includes(name))) return "Analyzing code"
  if (["web", "fetch", "search"].some((name) => normalized.includes(name))) return "Searching web"
  return `Running ${normalized}`
}

function statusStartedAt(status: SubagentRollupStatus | undefined) {
  return status?.type === "busy" ? status.startedAt : undefined
}

function statusLastActivityAt(status: SubagentRollupStatus | undefined) {
  return status?.type === "busy" ? status.lastActivityAt : undefined
}

function taskIsActive(status: SubagentTaskStatus) {
  return status === "running" || status === "pending"
}

function taskFailed(status: SubagentTaskStatus) {
  return status === "error" || status === "cancelled" || status === "canceled"
}

function sessionPresentation(session: SubagentRollupSession | undefined) {
  const title = session?.title?.trim()
  if (!title) return { title: undefined, agent: session?.agent }
  const match = title.match(CHILD_TITLE_SUFFIX)
  return {
    title: match ? title.slice(0, match.index).trim() : title,
    agent: session?.agent ?? match?.[1],
  }
}

function activityLabel(input: {
  status: SubagentRollupStatus | undefined
  taskStatus: SubagentTaskStatus
  active: boolean
  done: boolean
  failed: boolean
}) {
  if (input.failed) return "Failed"
  if (input.done) return "Completed"
  if (input.status?.type === "retry") return `Retrying (${input.status.attempt})`
  if (input.status?.type === "busy") {
    if (input.status.waitState === "tool") return toolLabel(input.status.activeTool)
    if (input.status.waitState === "llm") return "Thinking"
    return "Working"
  }
  if (input.active || taskIsActive(input.taskStatus)) return "Starting"
  return "Waiting"
}

export function buildSubagentStatusView(input: {
  tasks: SubagentRollupTask[]
  childSessions: SubagentRollupSession[]
  statuses: Record<string, SubagentRollupStatus | undefined>
  parentSessionID: string
  now?: number
  staleAfterMs?: number
}): SubagentStatusView {
  const now = input.now ?? Date.now()
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS
  const taskBySessionID = new Map<string, SubagentRollupTask>()
  const unboundTasks: SubagentRollupTask[] = []

  for (const task of input.tasks) {
    if (task.sessionID) taskBySessionID.set(task.sessionID, task)
    else unboundTasks.push(task)
  }

  const childSessions = input.childSessions.filter((item) => item.parentID === input.parentSessionID)
  const childByID = new Map(childSessions.map((item) => [item.id, item]))
  const ids = new Set([...childSessions.map((item) => item.id), ...taskBySessionID.keys()])
  const boundItems = [...ids].map((id): SubagentStatusItem => {
    const child = childByID.get(id)
    const task = taskBySessionID.get(id)
    const status = input.statuses[id]
    const active = status?.type === "busy" || status?.type === "retry" || taskIsActive(task?.status)
    const failed = taskFailed(task?.status)
    const done = !failed && (task?.status === "completed" || (!active && !!child))
    const startedAt = statusStartedAt(status) ?? task?.startedAt ?? child?.startedAt
    const lastActivityAt =
      statusLastActivityAt(status) ?? task?.lastActivityAt ?? child?.lastActivityAt ?? startedAt ?? 0
    const endedAt = active ? now : (task?.endedAt ?? task?.lastActivityAt ?? child?.lastActivityAt ?? now)
    const elapsed = formatElapsed(startedAt, endedAt)
    const inactive = lastActivityAt ? now - lastActivityAt : 0
    const stale = active && status?.type !== "retry" && !!lastActivityAt && inactive >= staleAfterMs
    const activity = activityLabel({ status, taskStatus: task?.status, active, done, failed })
    const staleSuffix = stale ? ` · no update ${formatDuration(inactive)}` : ""
    const elapsedSuffix = elapsed ? ` · ${elapsed}` : ""
    const presentation = sessionPresentation(child)
    const agent = task?.agent ?? presentation.agent
    return {
      id,
      sessionID: id,
      title: task?.title?.trim() || presentation.title || "Subagent",
      agent,
      model: task?.modelID ?? child?.modelID,
      active,
      done,
      failed,
      stale,
      startedAt: startedAt ?? 0,
      lastActivityAt,
      activity,
      elapsed,
      label: `${agent ? `${agent}: ` : ""}${activity}${elapsedSuffix}${staleSuffix}`,
    }
  })

  const unboundItems = unboundTasks.map((task): SubagentStatusItem => {
    const active = taskIsActive(task.status)
    const failed = taskFailed(task.status)
    const done = task.status === "completed"
    const endedAt = active ? now : (task.endedAt ?? task.lastActivityAt ?? now)
    const elapsed = formatElapsed(task.startedAt, endedAt)
    const inactive = task.lastActivityAt ? now - task.lastActivityAt : 0
    const stale = active && !!task.lastActivityAt && inactive >= staleAfterMs
    const activity = activityLabel({ status: undefined, taskStatus: task.status, active, done, failed })
    const staleSuffix = stale ? ` · no update ${formatDuration(inactive)}` : ""
    const elapsedSuffix = elapsed ? ` · ${elapsed}` : ""
    return {
      id: task.id,
      title: task.title ?? "Subagent",
      agent: task.agent,
      model: task.modelID,
      active,
      done,
      failed,
      stale,
      startedAt: task.startedAt ?? 0,
      lastActivityAt: task.lastActivityAt ?? task.startedAt ?? 0,
      activity,
      elapsed,
      label: `${task.agent ? `${task.agent}: ` : ""}${activity}${elapsedSuffix}${staleSuffix}`,
    }
  })

  const items = [...boundItems, ...unboundItems].toSorted((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    const agent = (a.agent ?? "").localeCompare(b.agent ?? "")
    if (agent !== 0) return agent
    if (a.startedAt !== b.startedAt) return b.startedAt - a.startedAt
    return a.id.localeCompare(b.id)
  })
  const running = items.filter((item) => item.active).length
  const done = items.filter((item) => item.done).length
  const failed = items.filter((item) => item.failed).length

  return { running, done, failed, total: items.length, items }
}

const QUEUE_KINDS = new Set(["subagent", "automation"])

export type SubagentQueueItem = {
  id: string
  sessionID?: string
  kind?: string
  status?: string
  title?: string
  agent?: string
  model?: unknown
  time?: {
    started?: number
    updated?: number
    completed?: number
  }
}

export function queueStatusToTaskStatus(status: string | undefined): SubagentTaskStatus {
  switch (status) {
    case "queued":
    case "waiting_for_idle":
    case "paused":
      return "pending"
    case "running":
    case "blocked_permission":
    case "blocked_question":
      return "running"
    case "completed":
      return "completed"
    case "failed":
      return "error"
    case "cancelled":
      return "cancelled"
    default:
      return status
  }
}

function queueModelID(model: unknown): string | undefined {
  if (typeof model === "string" && model.trim()) return model
  if (!model || typeof model !== "object") return undefined
  const record = model as { modelID?: unknown; id?: unknown }
  if (typeof record.modelID === "string" && record.modelID.trim()) return record.modelID
  if (typeof record.id === "string" && record.id.trim()) return record.id
  return undefined
}

/** Project TaskQueue rows that should appear on the running-subagent rail. */
export function taskQueueItemsToRollupTasks(items: readonly SubagentQueueItem[]): SubagentRollupTask[] {
  return items.flatMap((item) => {
    if (!item.kind || !QUEUE_KINDS.has(item.kind)) return []
    return [
      {
        id: item.id,
        sessionID: item.sessionID,
        title: item.title,
        agent: item.agent,
        modelID: queueModelID(item.model),
        status: queueStatusToTaskStatus(item.status),
        startedAt: item.time?.started,
        lastActivityAt: item.time?.updated ?? item.time?.completed ?? item.time?.started,
        endedAt: item.time?.completed,
      } satisfies SubagentRollupTask,
    ]
  })
}

/** Prefer live tool-part tasks when both a tool part and a queue row share a session. */
export function mergeSubagentRollupTasks(
  toolTasks: readonly SubagentRollupTask[],
  queueTasks: readonly SubagentRollupTask[],
): SubagentRollupTask[] {
  const seen = new Set<string>()
  const out: SubagentRollupTask[] = []
  for (const task of [...toolTasks, ...queueTasks]) {
    const key = task.sessionID ?? `unbound:${task.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(task)
  }
  return out
}

export function queueItemsForSessionTree(
  items: readonly SubagentQueueItem[],
  input: { parentSessionID: string; childSessionIDs: readonly string[] },
): SubagentQueueItem[] {
  const children = new Set(input.childSessionIDs)
  return items.filter((item) => {
    if (!item.sessionID) return true
    return item.sessionID === input.parentSessionID || children.has(item.sessionID)
  })
}
