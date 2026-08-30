import { axCodeClient } from "@/lib/ax-code/client"
import { API_ENDPOINTS, HTTP_DEFAULTS } from "@/lib/http"
import type {
  CatchUpPolicy,
  RuntimeModelRef,
  RuntimeSchedule,
  RuntimeTaskPayload,
  RuntimeTaskStatus,
} from "@/lib/scheduledTaskTransform"

// S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): this module
// talks to the ax-code runtime `/scheduled-task` routes (via the SDK, with
// `directory` = the project path). The retired desktop endpoints under
// `/api/projects/:projectId/scheduled-tasks` are gone.

export type ScheduledTaskRunDisplayStatus = "idle" | "running" | "success" | "error"

export type ScheduledTask = {
  id: string
  directory: string
  title: string
  prompt: string
  schedule: RuntimeSchedule
  status: RuntimeTaskStatus
  agent?: string
  model?: RuntimeModelRef
  catchUpPolicy: CatchUpPolicy
  nextRunAt?: number
  lastRunAt?: number
  /** Latest run outcome, derived from `GET /scheduled-task/:id/runs` (limit 1). */
  lastRunStatus: ScheduledTaskRunDisplayStatus
  lastError?: string
  time: {
    created: number
    updated?: number
  }
}

type RuntimeTaskInfo = {
  id: string
  directory: string
  title: string
  prompt: string
  schedule: RuntimeSchedule
  status: RuntimeTaskStatus
  agent?: string
  model?: unknown
  catchUpPolicy: CatchUpPolicy
  nextRunAt?: number
  lastRunAt?: number
  error?: string
  time: { created: number; updated?: number }
}

type RuntimeRunInfo = {
  status: "running" | "completed" | "failed" | "timeout" | "skipped_overlap" | "missed_skip"
  error?: string
  timeCompleted?: number
  time: { created: number }
}

const RUN_FETCH_CONCURRENCY = 6

const formatSdkError = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; error?: unknown }
    if (typeof record.message === "string" && record.message.trim()) return record.message
    if (typeof record.error === "string" && record.error.trim()) return record.error
    if (record.error && typeof record.error === "object") {
      const nested = (record.error as { message?: unknown }).message
      if (typeof nested === "string" && nested.trim()) return nested
    }
  }
  return fallback
}

const ensureDirectory = (directory: string): string => {
  const trimmed = typeof directory === "string" ? directory.trim() : ""
  if (!trimmed) {
    throw new Error("directory is required")
  }
  return trimmed
}

const clientFor = (directory: string) => axCodeClient.getScopedApiClient(ensureDirectory(directory))

const toModelRef = (model: unknown): RuntimeModelRef | undefined => {
  if (!model || typeof model !== "object") return undefined
  const record = model as { providerID?: unknown; modelID?: unknown }
  if (typeof record.providerID !== "string" || typeof record.modelID !== "string") return undefined
  return { providerID: record.providerID, modelID: record.modelID }
}

const toScheduledTask = (info: RuntimeTaskInfo): ScheduledTask => ({
  id: info.id,
  directory: info.directory,
  title: info.title,
  prompt: info.prompt,
  schedule: info.schedule,
  status: info.status,
  ...(info.agent ? { agent: info.agent } : {}),
  ...(toModelRef(info.model) ? { model: toModelRef(info.model) } : {}),
  catchUpPolicy: info.catchUpPolicy === "skip" ? "skip" : "run_once",
  ...(typeof info.nextRunAt === "number" ? { nextRunAt: info.nextRunAt } : {}),
  ...(typeof info.lastRunAt === "number" ? { lastRunAt: info.lastRunAt } : {}),
  lastRunStatus: info.error ? "error" : info.lastRunAt ? "success" : "idle",
  ...(info.error ? { lastError: info.error } : {}),
  time: info.time,
})

const runDisplayStatus = (run: RuntimeRunInfo): ScheduledTaskRunDisplayStatus => {
  if (run.status === "running") return "running"
  if (run.status === "completed") return "success"
  if (run.status === "failed" || run.status === "timeout") return "error"
  return "idle"
}

const mapWithConcurrency = async <T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length)
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const current = index
      index += 1
      results[current] = await fn(items[current])
    }
  }
  const workers = []
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

const withLatestRun = async (directory: string, task: ScheduledTask): Promise<ScheduledTask> => {
  try {
    const response = await clientFor(directory).scheduledTask.listRuns({ scheduledTaskID: task.id, limit: 1 })
    const runs = Array.isArray(response.data) ? (response.data as RuntimeRunInfo[]) : []
    const latest = runs[0]
    if (!latest) return task
    return {
      ...task,
      lastRunStatus: runDisplayStatus(latest),
      ...(latest.error ? { lastError: latest.error } : {}),
    }
  } catch {
    // Run history is display-only; keep the list row usable without it.
    return task
  }
}

/**
 * Pre-expand `#snippet` references in a prompt before it is stored in the
 * runtime. The retired desktop engine expanded snippets at run time; the
 * runtime scheduler stores and executes the prompt verbatim, so expansion
 * must happen at save time (same semantics as the S2.6 migration). Failures
 * fall back to the raw prompt — blocking task creation on a snippet-endpoint
 * hiccup is worse than storing one unexpanded reference.
 */
export const expandPromptSnippets = async (directory: string, prompt: string): Promise<string> => {
  if (!/#[a-z0-9_-]+/i.test(prompt)) return prompt
  try {
    const safeDirectory = ensureDirectory(directory)
    const response = await fetch(
      `${API_ENDPOINTS.config.snippetExpand}?directory=${encodeURIComponent(safeDirectory)}`,
      {
        method: HTTP_DEFAULTS.method.post,
        headers: {
          ...HTTP_DEFAULTS.headers.acceptAndContentTypeJson,
          "x-ax-code-directory": safeDirectory,
        },
        body: JSON.stringify({ text: prompt }),
      },
    )
    if (!response.ok) {
      response.body?.cancel()
      return prompt
    }
    const parsed = (await response.json().catch(() => null)) as { text?: unknown } | null
    return typeof parsed?.text === "string" && parsed.text.trim().length > 0 ? parsed.text : prompt
  } catch {
    return prompt
  }
}

export const fetchScheduledTasks = async (directory: string): Promise<ScheduledTask[]> => {
  const client = clientFor(directory)
  const response = await client.scheduledTask.list()
  if (response.error) {
    throw new Error(formatSdkError(response.error, "Failed to load scheduled tasks"))
  }
  const infos = (Array.isArray(response.data) ? response.data : []) as RuntimeTaskInfo[]
  const tasks = infos.map(toScheduledTask)
  return mapWithConcurrency(tasks, RUN_FETCH_CONCURRENCY, (task) => withLatestRun(directory, task))
}

/**
 * Create the payloads produced by buildRuntimeScheduledTaskPayloads. When
 * `pause` is set (the editor's enabled checkbox was off), each task is paused
 * right after creation — the runtime create route always starts tasks active.
 */
export const createScheduledTasks = async (
  directory: string,
  payloads: RuntimeTaskPayload[],
  options?: { pause?: boolean },
): Promise<void> => {
  const client = clientFor(directory)
  for (const payload of payloads) {
    const response = await client.scheduledTask.create(payload)
    if (response.error || !response.data) {
      throw new Error(formatSdkError(response.error, "Failed to save scheduled task"))
    }
    if (options?.pause) {
      const created = response.data as RuntimeTaskInfo
      const paused = await client.scheduledTask.pause({ scheduledTaskID: created.id })
      if (paused.error) {
        throw new Error(formatSdkError(paused.error, "Task was created but could not be paused"))
      }
    }
  }
}

export const updateScheduledTask = async (
  directory: string,
  taskID: string,
  patch: {
    title?: string
    prompt?: string
    schedule?: RuntimeSchedule
    status?: RuntimeTaskStatus
    agent?: string
    model?: RuntimeModelRef
    catchUpPolicy?: CatchUpPolicy
  },
): Promise<void> => {
  const client = clientFor(directory)
  const response = await client.scheduledTask.update({ scheduledTaskID: taskID, ...patch })
  if (response.error) {
    throw new Error(formatSdkError(response.error, "Failed to save scheduled task"))
  }
}

export const setScheduledTaskEnabled = async (directory: string, taskID: string, enabled: boolean): Promise<void> => {
  const client = clientFor(directory)
  const response = enabled
    ? await client.scheduledTask.resume({ scheduledTaskID: taskID })
    : await client.scheduledTask.pause({ scheduledTaskID: taskID })
  if (response.error) {
    throw new Error(formatSdkError(response.error, "Failed to update scheduled task"))
  }
}

export const deleteScheduledTask = async (directory: string, taskID: string): Promise<void> => {
  const client = clientFor(directory)
  const response = await client.scheduledTask.delete({ scheduledTaskID: taskID })
  if (response.error) {
    throw new Error(formatSdkError(response.error, "Failed to delete scheduled task"))
  }
}

export const runScheduledTaskNow = async (directory: string, taskID: string): Promise<void> => {
  const client = clientFor(directory)
  const response = await client.scheduledTask.runNow({ scheduledTaskID: taskID })
  if (response.error) {
    throw new Error(formatSdkError(response.error, "Failed to run scheduled task"))
  }
}
