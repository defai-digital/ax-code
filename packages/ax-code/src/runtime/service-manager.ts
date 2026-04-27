import z from "zod"

interface ManagerState {
  nextTaskID: number
  services: Map<string, ServiceManager.ServiceStatus>
  tasks: Map<string, ServiceManager.BackgroundTaskStatus>
}

const registry = new Map<string, ManagerState>()

function createState(): ManagerState {
  return {
    nextTaskID: 0,
    services: new Map(),
    tasks: new Map(),
  }
}

function ensureState(directory: string) {
  const existing = registry.get(directory)
  if (existing) return existing
  const next = createState()
  registry.set(directory, next)
  return next
}

function pendingCount(state: ManagerState, service: string) {
  let count = 0
  for (const task of state.tasks.values()) {
    if (task.service !== service) continue
    if (task.state === "completed" || task.state === "failed" || task.state === "aborted") continue
    count++
  }
  return count
}

function cloneService(state: ManagerState, status: ServiceManager.ServiceStatus): ServiceManager.ServiceStatus {
  return ServiceManager.createServiceStatus({
    ...status,
    pendingTasks: pendingCount(state, status.name),
  })
}

function cloneTask(status: ServiceManager.BackgroundTaskStatus): ServiceManager.BackgroundTaskStatus {
  return ServiceManager.createBackgroundTaskStatus(status)
}

function sortService(a: ServiceManager.ServiceStatus, b: ServiceManager.ServiceStatus) {
  return a.name.localeCompare(b.name)
}

function sortTask(a: ServiceManager.BackgroundTaskStatus, b: ServiceManager.BackgroundTaskStatus) {
  const aTime = a.queuedAt ?? a.startedAt ?? Number.MAX_SAFE_INTEGER
  const bTime = b.queuedAt ?? b.startedAt ?? Number.MAX_SAFE_INTEGER
  return aTime - bTime || a.id.localeCompare(b.id)
}

function updateService(
  state: ManagerState,
  name: string,
  mutate: (current: ServiceManager.ServiceStatus) => ServiceManager.ServiceStatus,
) {
  const current = state.services.get(name) ?? ServiceManager.createServiceStatus({ name })
  const next = ServiceManager.createServiceStatus(mutate(cloneService(state, current)))
  state.services.set(name, next)
  return next
}

function updateTask(
  state: ManagerState,
  id: string,
  mutate: (current: ServiceManager.BackgroundTaskStatus) => ServiceManager.BackgroundTaskStatus,
) {
  const current = state.tasks.get(id)
  if (!current) {
    throw new Error(`Unknown runtime task: ${id}`)
  }
  const next = ServiceManager.createBackgroundTaskStatus(mutate(cloneTask(current)))
  state.tasks.set(id, next)
  return next
}

function snapshotFromState(state: ManagerState): ServiceManager.Snapshot {
  return ServiceManager.createSnapshot({
    services: [...state.services.values()].map((item) => cloneService(state, item)).sort(sortService),
    tasks: [...state.tasks.values()].map(cloneTask).sort(sortTask),
  })
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name
  }
  return String(error)
}

function createManager(state: ManagerState): ServiceManager.Manager {
  return {
    ensureService(name: string) {
      return updateService(state, name, (current) => current)
    },
    start(name: string, time = Date.now()) {
      return updateService(state, name, (current) => ({
        ...current,
        state: "starting",
        startedAt: current.startedAt ?? time,
        stoppedAt: undefined,
      }))
    },
    running(name: string, time = Date.now()) {
      return updateService(state, name, (current) => ({
        ...current,
        state: "running",
        startedAt: current.startedAt ?? time,
        stoppedAt: undefined,
      }))
    },
    stopping(name: string, time = Date.now()) {
      return updateService(state, name, (current) => ({
        ...current,
        state: "stopping",
        stoppedAt: current.stoppedAt ?? time,
      }))
    },
    stopped(name: string, time = Date.now()) {
      return updateService(state, name, (current) => ({
        ...current,
        state: "stopped",
        stoppedAt: time,
      }))
    },
    fail(name: string, error: unknown, time = Date.now()) {
      const message = ServiceManager.errorMessage(error)
      return updateService(state, name, (current) => ({
        ...current,
        state: "failed",
        startedAt: current.startedAt ?? time,
        lastError: message,
      }))
    },
    async track<T>(input: ServiceManager.TrackInput<T>) {
      const startedAt = Date.now()
      const service = createManager(state).start(input.service, startedAt)
      const id = `${input.service}:${++state.nextTaskID}`

      if (state.tasks.size > 1000) {
        for (const [taskId, task] of state.tasks) {
          if (task.state === "completed" || task.state === "failed" || task.state === "aborted") {
            state.tasks.delete(taskId)
          }
        }
      }

      state.tasks.set(
        id,
        ServiceManager.createBackgroundTaskStatus({
          id,
          service: input.service,
          label: input.label,
          state: "running",
          queuedAt: startedAt,
          startedAt,
          timeoutMs: input.timeoutMs,
        }),
      )
      updateService(state, input.service, (current) => ({
        ...current,
        state: service.state,
        startedAt: current.startedAt ?? startedAt,
      }))

      const controller = new AbortController()
      let timedOut = false
      let settled = false
      const abortFromParent = () => {
        if (!controller.signal.aborted) {
          controller.abort(input.signal?.reason)
        }
      }

      if (input.signal) {
        input.signal.addEventListener("abort", abortFromParent, { once: true })
        if (input.signal.aborted) {
          controller.abort(input.signal.reason)
        }
      }

      const timeout = input.timeoutMs
        ? setTimeout(() => {
            if (settled) return
            timedOut = true
            const message = `Timed out after ${input.timeoutMs}ms`
            updateTask(state, id, (current) => ({
              ...current,
              lastError: current.lastError ?? message,
            }))
            updateService(state, input.service, (current) => ({
              ...current,
              lastError: current.lastError ?? message,
            }))
            if (!controller.signal.aborted) {
              controller.abort(new Error(message))
            }
            input.onTimeout?.(snapshotFromState(state))
          }, input.timeoutMs)
        : undefined

      timeout?.unref?.()

      try {
        if (controller.signal.aborted) {
          throw controller.signal.reason ?? new Error(`Task aborted before start: ${input.label}`)
        }

        const result = await input.task(controller.signal)
        settled = true
        const endedAt = Date.now()

        updateTask(state, id, (current) => ({
          ...current,
          state: "completed",
          endedAt,
        }))
        updateService(state, input.service, (current) => ({
          ...current,
          state: "running",
          startedAt: current.startedAt ?? startedAt,
        }))

        return result
      } catch (error) {
        settled = true
        const endedAt = Date.now()
        const aborted = controller.signal.aborted && !timedOut
        const message = timedOut && input.timeoutMs ? `Timed out after ${input.timeoutMs}ms` : describeError(error)

        updateTask(state, id, (current) => ({
          ...current,
          state: aborted ? "aborted" : "failed",
          endedAt,
          lastError: current.lastError ?? message,
        }))

        if (aborted) {
          updateService(state, input.service, (current) => ({
            ...current,
            state: "stopped",
            stoppedAt: endedAt,
            lastError: current.lastError ?? message,
          }))
          input.onAbort?.(error, snapshotFromState(state))
        } else {
          updateService(state, input.service, (current) => ({
            ...current,
            state: "failed",
            startedAt: current.startedAt ?? startedAt,
            lastError: current.lastError ?? message,
          }))
          input.onFailure?.(error, snapshotFromState(state))
        }

        throw error
      } finally {
        settled = true
        if (timeout) {
          clearTimeout(timeout)
        }
        if (input.signal) {
          input.signal.removeEventListener("abort", abortFromParent)
        }
        updateService(state, input.service, (current) => ({
          ...current,
          pendingTasks: pendingCount(state, input.service),
        }))
      }
    },
    snapshot() {
      return snapshotFromState(state)
    },
  }
}

export namespace ServiceManager {
  export const ServiceState = z
    .enum(["idle", "starting", "running", "stopping", "stopped", "failed"])
    .describe("Lifecycle state for a runtime service")
  export type ServiceState = z.infer<typeof ServiceState>

  export const BackgroundTaskState = z
    .enum(["queued", "running", "completed", "failed", "aborted"])
    .describe("Lifecycle state for a tracked background task")
  export type BackgroundTaskState = z.infer<typeof BackgroundTaskState>

  export const ServiceStatus = z
    .object({
      name: z.string().min(1).describe("Stable runtime service name"),
      state: ServiceState.describe("Current lifecycle state"),
      startedAt: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Unix time in milliseconds when the service started"),
      stoppedAt: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Unix time in milliseconds when the service stopped"),
      lastError: z.string().optional().describe("Metadata-safe description of the last service error"),
      pendingTasks: z
        .number()
        .int()
        .nonnegative()
        .describe("Number of tracked background tasks that are not yet in a terminal state"),
    })
    .strict()
  export type ServiceStatus = z.infer<typeof ServiceStatus>

  export const BackgroundTaskStatus = z
    .object({
      id: z.string().min(1).describe("Stable background task identifier"),
      service: z.string().min(1).describe("Owning runtime service name"),
      label: z.string().min(1).describe("Metadata-safe task label"),
      state: BackgroundTaskState.describe("Current lifecycle state for the background task"),
      queuedAt: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Unix time in milliseconds when the task was queued"),
      startedAt: z.number().int().nonnegative().optional().describe("Unix time in milliseconds when the task started"),
      endedAt: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe("Unix time in milliseconds when the task reached a terminal state"),
      timeoutMs: z.number().int().positive().optional().describe("Timeout budget for the task in milliseconds"),
      lastError: z.string().optional().describe("Metadata-safe description of the last task error"),
    })
    .strict()
  export type BackgroundTaskStatus = z.infer<typeof BackgroundTaskStatus>

  export const Snapshot = z
    .object({
      services: z.array(ServiceStatus).describe("Runtime service status rows included in the snapshot"),
      tasks: z.array(BackgroundTaskStatus).describe("Tracked background task rows included in the snapshot"),
    })
    .strict()
  export type Snapshot = z.infer<typeof Snapshot>

  export interface TrackInput<T> {
    service: string
    label: string
    task: (signal: AbortSignal) => Promise<T> | T
    timeoutMs?: number
    signal?: AbortSignal
    onFailure?: (error: unknown, snapshot: Snapshot) => void
    onTimeout?: (snapshot: Snapshot) => void
    onAbort?: (error: unknown, snapshot: Snapshot) => void
  }

  export interface Manager {
    ensureService(name: string): ServiceStatus
    start(name: string, time?: number): ServiceStatus
    running(name: string, time?: number): ServiceStatus
    stopping(name: string, time?: number): ServiceStatus
    stopped(name: string, time?: number): ServiceStatus
    fail(name: string, error: unknown, time?: number): ServiceStatus
    track<T>(input: TrackInput<T>): Promise<T>
    snapshot(): Snapshot
  }

  export interface Service {
    name: string
    init(signal: AbortSignal): Promise<void>
    dispose(): Promise<void>
    status(): ServiceStatus
  }

  export function createServiceStatus(input: {
    name: string
    state?: ServiceState
    startedAt?: number
    stoppedAt?: number
    lastError?: string
    pendingTasks?: number
  }): ServiceStatus {
    return ServiceStatus.parse({
      name: input.name,
      state: input.state ?? "idle",
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt,
      lastError: input.lastError,
      pendingTasks: input.pendingTasks ?? 0,
    })
  }

  export function createBackgroundTaskStatus(input: {
    id: string
    service: string
    label: string
    state?: BackgroundTaskState
    queuedAt?: number
    startedAt?: number
    endedAt?: number
    timeoutMs?: number
    lastError?: string
  }): BackgroundTaskStatus {
    return BackgroundTaskStatus.parse({
      id: input.id,
      service: input.service,
      label: input.label,
      state: input.state ?? "queued",
      queuedAt: input.queuedAt,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      timeoutMs: input.timeoutMs,
      lastError: input.lastError,
    })
  }

  export function createSnapshot(input?: { services?: ServiceStatus[]; tasks?: BackgroundTaskStatus[] }): Snapshot {
    return Snapshot.parse({
      services: input?.services ?? [],
      tasks: input?.tasks ?? [],
    })
  }

  export function errorMessage(error: unknown) {
    return describeError(error)
  }

  export function create() {
    return createManager(createState())
  }

  export function forDirectory(directory: string) {
    return createManager(ensureState(directory))
  }

  export function peek(directory: string) {
    const state = registry.get(directory)
    if (!state) return
    return createManager(state)
  }

  export function reset(directory: string) {
    const state = createState()
    registry.set(directory, state)
    return createManager(state)
  }

  export function clear(directory: string) {
    registry.delete(directory)
  }

  export function snapshot(directory: string) {
    return snapshotFromState(ensureState(directory))
  }
}
