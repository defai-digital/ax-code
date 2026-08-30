/**
 * S2.6 (SPEC-2026-08-29-desktop-process-model-collapse §2 D6): fan-out point
 * for runtime scheduled-task events. The events (`scheduled.task.*`,
 * packages/ax-code/src/session/scheduled-task.ts Event definitions) arrive on
 * the shared unified event stream (sync/event-pipeline → sync-context-impl
 * onEvent); this registry lets the scheduled-tasks dialog and the session
 * sidebar react without opening their own EventSource — the retired desktop
 * engine's `/api/openchamber/events` channel is gone.
 */

export type ScheduledTaskEventStatus = "running" | "success" | "error" | "changed"

export type ScheduledTaskEvent = {
  /** Runtime event type, e.g. "scheduled.task.fired". */
  type: string
  /** Task directory when the payload carries one (deleted events do not). */
  directory?: string
  taskId?: string
  /** fired→running, succeeded→success, failed/failed_persistently→error, else changed. */
  status: ScheduledTaskEventStatus
}

type Listener = (event: ScheduledTaskEvent) => void

const listeners = new Set<Listener>()

const RUNTIME_EVENT_TYPES = new Set([
  "scheduled.task.created",
  "scheduled.task.updated",
  "scheduled.task.deleted",
  "scheduled.task.fired",
  "scheduled.task.succeeded",
  "scheduled.task.failed",
  "scheduled.task.skipped",
  "scheduled.task.failed_persistently",
])

export const isScheduledTaskRuntimeEventType = (type: unknown): type is string =>
  typeof type === "string" && RUNTIME_EVENT_TYPES.has(type)

const statusForType = (type: string): ScheduledTaskEventStatus => {
  if (type === "scheduled.task.fired") return "running"
  if (type === "scheduled.task.succeeded") return "success"
  if (type === "scheduled.task.failed" || type === "scheduled.task.failed_persistently") return "error"
  return "changed"
}

type RuntimeEventPayload = {
  type?: unknown
  properties?: unknown
}

/**
 * Map a raw unified-stream payload to a ScheduledTaskEvent and notify
 * listeners. No-op for unrelated payloads, so callers can forward every
 * event. Called from sync-context-impl's onEvent.
 */
export const ingestScheduledTaskRuntimeEvent = (payload: RuntimeEventPayload): void => {
  if (!payload || !isScheduledTaskRuntimeEventType(payload.type)) return
  const properties =
    payload.properties && typeof payload.properties === "object"
      ? (payload.properties as { task?: { id?: unknown; directory?: unknown }; id?: unknown })
      : null
  const task = properties?.task && typeof properties.task === "object" ? properties.task : null
  const directory = typeof task?.directory === "string" && task.directory.length > 0 ? task.directory : undefined
  const taskId =
    typeof task?.id === "string" && task.id.length > 0
      ? task.id
      : typeof properties?.id === "string" && properties.id.length > 0
        ? properties.id
        : undefined
  const event: ScheduledTaskEvent = {
    type: payload.type,
    status: statusForType(payload.type),
    ...(directory ? { directory } : {}),
    ...(taskId ? { taskId } : {}),
  }
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.error("[scheduled-task-events] listener threw", error)
    }
  }
}

export const subscribeScheduledTaskEvents = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
