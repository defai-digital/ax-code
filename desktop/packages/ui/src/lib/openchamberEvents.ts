import { API_ENDPOINTS } from "./http"
import { subscribeEventStream } from "./event-stream/subscribe"

export type ScheduledTaskRanEvent = {
  type: "scheduled-task-ran"
  projectId: string
  taskId: string
  ranAt: number
  status: "running" | "success" | "error"
  sessionId?: string
}

type OpenChamberEvent = ScheduledTaskRanEvent
type Listener = (event: OpenChamberEvent) => void

const HEARTBEAT_TIMEOUT_MS = 45_000

// Reconnect profile ported from the previous inline loop: 1s base doubling to
// a 30s cap (exponent capped at 5, though the 30s cap binds first).
const RECONNECT_BACKOFF = {
  baseMs: 1_000,
  capVisibleMs: 30_000,
  capHiddenMs: 30_000,
  maxExponent: 5,
}

const toScheduledTaskRanEvent = (properties: unknown): ScheduledTaskRanEvent | null => {
  const parsed = properties && typeof properties === "object" ? (properties as Record<string, unknown>) : null
  const projectId = typeof parsed?.projectId === "string" ? parsed.projectId : ""
  const taskId = typeof parsed?.taskId === "string" ? parsed.taskId : ""
  const ranAt = typeof parsed?.ranAt === "number" ? parsed.ranAt : Date.now()
  const rawStatus = parsed?.status
  const status = rawStatus === "running" || rawStatus === "error" ? rawStatus : "success"
  if (!projectId || !taskId) {
    return null
  }

  return {
    type: "scheduled-task-ran",
    projectId,
    taskId,
    ranAt,
    status,
    ...(typeof parsed?.sessionId === "string" && parsed.sessionId.length > 0 ? { sessionId: parsed.sessionId } : {}),
  }
}

export const subscribeOpenchamberEvents = (listener: Listener): (() => void) => {
  return subscribeEventStream({
    url: API_ENDPOINTS.openchamber.events,
    heartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    backoff: RECONNECT_BACKOFF,
    onEnvelope: (envelope) => {
      // The event-stream-ready envelope is consumed by the facade (it resets
      // the reconnect backoff); heartbeats only feed the silence watchdog.
      if (envelope.type === "openchamber:heartbeat") {
        return
      }
      if (envelope.type !== "openchamber:scheduled-task-ran") {
        return
      }
      const event = toScheduledTaskRanEvent(envelope.properties)
      if (event) {
        listener(event)
      }
    },
  })
}
