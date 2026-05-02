export type SubagentTaskStatus = "pending" | "running" | "completed" | "error" | string | undefined

export type SubagentRollupTask = {
  id: string
  sessionID?: string
  title?: string
  agent?: string
  status?: SubagentTaskStatus
  startedAt?: number
  lastActivityAt?: number
}

export type SubagentRollupSession = {
  id: string
  parentID?: string
  title?: string
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
  title: string
  agent?: string
  active: boolean
  done: boolean
  stale: boolean
  lastActivityAt: number
  label: string
}

export type SubagentStatusView = {
  running: number
  done: number
  total: number
  items: SubagentStatusItem[]
}

const DEFAULT_STALE_AFTER_MS = 90_000

function formatElapsed(now: number, value?: number) {
  if (!value) return ""
  const totalSeconds = Math.max(1, Math.floor((now - value) / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, "0")}s` : `${seconds}s`
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
  let running = 0
  let done = 0

  for (const task of input.tasks) {
    if (task.status === "running" || task.status === "pending") running++
    else if (task.status === "completed") done++
    if (task.sessionID) taskBySessionID.set(task.sessionID, task)
    else unboundTasks.push(task)
  }

  const childSessions = input.childSessions.filter((item) => item.parentID === input.parentSessionID)
  const ids = new Set([...childSessions.map((item) => item.id), ...taskBySessionID.keys()])
  const boundItems = [...ids].map((id): SubagentStatusItem => {
      const child = childSessions.find((item) => item.id === id)
      const task = taskBySessionID.get(id)
      const status = input.statuses[id]
      const active =
        status?.type === "busy" || status?.type === "retry" || task?.status === "running" || task?.status === "pending"
      const startedAt = statusStartedAt(status) ?? task?.startedAt
      const lastActivityAt = statusLastActivityAt(status) ?? task?.lastActivityAt
      const elapsed = formatElapsed(now, startedAt)
      const inactive = lastActivityAt ? now - lastActivityAt : 0
      const stale = active && inactive >= staleAfterMs
      const activity = (() => {
        if (status?.type === "retry") return "Retrying"
        if (status?.type !== "busy") return task?.status === "completed" ? "Completed" : active ? "Starting" : "Waiting"
        if (status.waitState === "tool") return toolLabel(status.activeTool)
        if (status.waitState === "llm") return "Thinking"
        return "Working"
      })()
      const staleSuffix = stale ? ` · no update ${formatElapsed(now, lastActivityAt)}` : ""
      const elapsedSuffix = elapsed ? ` · ${elapsed}` : ""
      return {
        id,
        title: task?.title ?? child?.title ?? "Subagent",
        agent: task?.agent,
        active,
        done: task?.status === "completed" || (!active && status?.type === "idle"),
        stale,
        lastActivityAt: lastActivityAt ?? startedAt ?? 0,
        label: `${task?.agent ? `${task.agent}: ` : ""}${activity}${elapsedSuffix}${staleSuffix}`,
      }
    })

  const unboundItems = unboundTasks.map((task): SubagentStatusItem => {
    const active = task.status === "running" || task.status === "pending"
    const elapsed = formatElapsed(now, task.startedAt)
    const inactive = task.lastActivityAt ? now - task.lastActivityAt : 0
    const stale = active && inactive >= staleAfterMs
    const activity = task.status === "completed" ? "Completed" : active ? "Starting" : "Waiting"
    const staleSuffix = stale ? ` · no update ${formatElapsed(now, task.lastActivityAt)}` : ""
    const elapsedSuffix = elapsed ? ` · ${elapsed}` : ""
    return {
      id: task.id,
      title: task.title ?? "Subagent",
      agent: task.agent,
      active,
      done: task.status === "completed",
      stale,
      lastActivityAt: task.lastActivityAt ?? task.startedAt ?? 0,
      label: `${task.agent ? `${task.agent}: ` : ""}${activity}${elapsedSuffix}${staleSuffix}`,
    }
  })

  const items = [...boundItems, ...unboundItems]
    .toSorted((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.lastActivityAt - a.lastActivityAt
    })

  return { running, done, total: running + done, items }
}
