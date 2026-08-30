/**
 * Event Pipeline — transport connection, event coalescing, and batched flush.
 *
 * This module must not make state-dependent decisions about event validity.
 * For example, deciding whether a delta is already represented by a full part
 * snapshot belongs in the reducer, which has access to the current state.
 *
 * Plain closure API:
 *   const { cleanup } = createEventPipeline({ sdk, onEvent })
 *
 * No class, no start/stop lifecycle. One pipeline per mount.
 * Abort controller created once at init, cleaned up via returned cleanup fn.
 */

import type { Event, AxCodeClient, SessionStatus } from "@ax-code/sdk/v2/client"
import { axCodeClient } from "@/lib/ax-code/client"
import { syncDebug } from "./debug"
import { API_PATHS } from "@/lib/http"
import { createMetricsTracker, type MetricsTracker } from "./streaming-metrics"
import { createEventTransport } from "@/lib/event-stream/client"
import { markStreamConnected, markStreamDisconnected } from "@/lib/event-stream/connection-state"
import { isAbortError, type SdkSseDriver, type TransportError, type WsDriver } from "@/lib/event-stream/types"
import type { MessageStreamWsFrame } from "@/lib/event-stream/adapters/websocket"
import { SYNC_RETRY_NOW_EVENT as TRANSPORT_SYNC_RETRY_NOW_EVENT } from "@/lib/event-stream/visibility"

export type QueuedEvent = {
  directory: string
  payload: Event
}

export type FlushHandler = (events: QueuedEvent[]) => void

const FLUSH_FRAME_MS = 33
const BACKPRESSURE_FLUSH_FRAME_MS = 200
const BACKPRESSURE_MODE_MS = 10_000
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000
const DEFAULT_WS_READY_TIMEOUT_MS = 2_000
const ACTIVE_TOOL_STATUSES = new Set(["pending", "running", "started"])
const FINAL_TOOL_STATUSES = new Set(["completed", "error", "aborted", "failed", "timeout", "cancelled"])
// Retry pacing, handed to the event transport verbatim. Visible+online tabs
// probe quickly so the user sees connection recovery in under a second of
// real outage; hidden/offline tabs back off further so a backgrounded browser
// tab on a flaky link doesn't burn battery probing a dead network every few
// seconds. The browser would throttle hidden-tab timers anyway, but this
// keeps the intent explicit and shrinks server load from idle tabs.
const RETRY_BACKOFF_BASE_MS = 250
const RETRY_BACKOFF_CAP_VISIBLE_MS = 5_000
const RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS = 60_000
const RETRY_BACKOFF_MAX_EXPONENT = 8
const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//

/**
 * Window event the UI dispatches to interrupt the reconnect backoff and force
 * an immediate reconnect attempt (e.g. a "retry now" action on the reconnect
 * banner). Handled exactly like `openchamber:system-resume`.
 */
export const SYNC_RETRY_NOW_EVENT = TRANSPORT_SYNC_RETRY_NOW_EVENT

/** Ask the active event pipeline to reconnect immediately. */
export function requestSyncRetryNow(): void {
  if (typeof globalThis.window !== "undefined") {
    globalThis.window.dispatchEvent(new Event(SYNC_RETRY_NOW_EVENT))
  }
}

export type EventPipelineInput = {
  sdk: AxCodeClient
  onEvent: (directory: string, payload: Event) => void
  routeDirectory?: (directory: string, payload: Event) => string
  /** Called after stream reconnects (visibility restore or heartbeat timeout). */
  onReconnect?: () => void
  /** Called when the stream disconnects (heartbeat timeout, network error, or transport failure). */
  onDisconnect?: (reason: string) => void
  /** Called when transport switches (e.g. WS timeout → SSE fallback) without actual disconnection. */
  onTransportSwitch?: () => void
  transport?: "auto" | "ws" | "sse"
  heartbeatTimeoutMs?: number
  reconnectDelayMs?: number
  wsReadyTimeoutMs?: number
}

export type EventPipeline = {
  cleanup: () => void
  reconnect: (reason?: string) => void
  metrics: MetricsTracker
}

const normalizeOpenChamberSessionStatus = (payload: Event): Event | null => {
  const record = payload as unknown as {
    id?: unknown
    type?: unknown
    properties?: {
      sessionID?: unknown
      sessionId?: unknown
      status?: unknown
      metadata?: {
        attempt?: unknown
        message?: unknown
        next?: unknown
      }
    }
  }

  if (record.type !== "openchamber:session-status") return null

  const sessionID =
    typeof record.properties?.sessionID === "string" && record.properties.sessionID.length > 0
      ? record.properties.sessionID
      : typeof record.properties?.sessionId === "string" && record.properties.sessionId.length > 0
        ? record.properties.sessionId
        : ""
  const rawStatus = typeof record.properties?.status === "string" ? record.properties.status : ""
  if (!sessionID || !rawStatus) return null

  let status: SessionStatus | null = null
  if (rawStatus === "idle" || rawStatus === "busy") {
    status = { type: rawStatus }
  } else if (rawStatus === "retry") {
    const metadata = record.properties?.metadata
    if (
      typeof metadata?.attempt === "number" &&
      typeof metadata.message === "string" &&
      typeof metadata.next === "number"
    ) {
      status = {
        type: "retry",
        attempt: metadata.attempt,
        message: metadata.message,
        next: metadata.next,
      }
    }
  }
  if (!status) return null

  return {
    id:
      typeof record.id === "string" && record.id.length > 0
        ? record.id
        : `openchamber-status-${sessionID}-${Date.now()}`,
    type: "session.status",
    properties: {
      sessionID,
      status,
    },
  } as Event
}

const normalizeEventType = (payload: Event): Event => {
  const normalizedOpenChamberStatus = normalizeOpenChamberSessionStatus(payload)
  if (normalizedOpenChamberStatus) {
    return normalizedOpenChamberStatus
  }

  const type = (payload as { type?: unknown }).type
  if (typeof type !== "string") {
    return payload
  }

  const match = /^(.*)\.(\d+)$/.exec(type)
  if (!match || !match[1]) {
    return payload
  }

  return {
    ...payload,
    type: match[1] as Event["type"],
  } as unknown as Event
}

function resolveEventDirectory(event: unknown, payload: Event): string {
  const directDirectory =
    typeof event === "object" && event !== null && typeof (event as { directory?: unknown }).directory === "string"
      ? (event as { directory: string }).directory
      : null

  if (directDirectory && directDirectory.length > 0) {
    return directDirectory
  }

  const properties =
    typeof payload.properties === "object" && payload.properties !== null
      ? (payload.properties as Record<string, unknown>)
      : null
  const propertyDirectory = typeof properties?.directory === "string" ? properties.directory : null

  return propertyDirectory && propertyDirectory.length > 0 ? propertyDirectory : "global"
}

function resolveEventPayload(payload: unknown): Event | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const record = payload as { type?: unknown; payload?: unknown }
  if (typeof record.type === "string") {
    return payload as Event
  }

  if (
    record.payload &&
    typeof record.payload === "object" &&
    typeof (record.payload as { type?: unknown }).type === "string"
  ) {
    return record.payload as Event
  }

  return null
}

function resolveAbsoluteUrl(candidate: string): string {
  const normalized = typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : API_PATHS.base
  if (ABSOLUTE_URL_PATTERN.test(normalized)) {
    return normalized
  }

  if (typeof window === "undefined") {
    return normalized
  }

  const baseReference = window.location?.href || window.location?.origin
  if (!baseReference) {
    return normalized
  }

  return new URL(normalized, baseReference).toString()
}

function toWebSocketUrl(candidate: string): string {
  const url = new URL(resolveAbsoluteUrl(candidate))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

function buildGlobalEventWsUrl(lastEventId?: string): string {
  let baseUrl: string = API_PATHS.base
  try {
    const client = axCodeClient as { getBaseUrl?: () => string }
    if (typeof client.getBaseUrl === "function") {
      baseUrl = client.getBaseUrl()
    }
  } catch {
    baseUrl = API_PATHS.base
  }
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  const httpUrl = new URL("global/event/ws", resolveAbsoluteUrl(normalizedBase))
  if (lastEventId && lastEventId.length > 0) {
    httpUrl.searchParams.set("lastEventId", lastEventId)
  }
  return toWebSocketUrl(httpUrl.toString())
}

type DirectoryQueue = {
  queue: Event[]
  buffer: Event[]
  coalesced: Map<string, number>
  timer: ReturnType<typeof setTimeout> | undefined
  last: number
}

type CoalescedPart = {
  type?: unknown
  state?: {
    status?: unknown
    time?: {
      start?: unknown
      end?: unknown
    }
  }
  time?: {
    start?: unknown
    end?: unknown
  }
}

function getUpdatedPart(payload: Event): CoalescedPart | undefined {
  if (payload.type !== "message.part.updated") return undefined
  const part = (payload.properties as { part?: unknown }).part
  return typeof part === "object" && part !== null ? (part as CoalescedPart) : undefined
}

function getToolStatus(part: CoalescedPart): string | undefined {
  if (part.type !== "tool") return undefined
  const status = part.state?.status
  return typeof status === "string" ? status : undefined
}

function getPartEndTime(part: CoalescedPart): number | undefined {
  const stateEnd = part.state?.time?.end
  if (typeof stateEnd === "number") return stateEnd

  const timeEnd = part.time?.end
  return typeof timeEnd === "number" ? timeEnd : undefined
}

function getPartStartTime(part: CoalescedPart): number | undefined {
  const stateStart = part.state?.time?.start
  if (typeof stateStart === "number") return stateStart

  const timeStart = part.time?.start
  return typeof timeStart === "number" ? timeStart : undefined
}

function getValidPartEndTime(part: CoalescedPart | undefined): number | undefined {
  if (!part) return undefined

  const endTime = getPartEndTime(part)
  if (typeof endTime !== "number") return undefined

  const startTime = getPartStartTime(part)
  if (typeof startTime === "number" && endTime < startTime) return undefined

  return endTime
}

function isFinalToolPart(part: CoalescedPart | undefined): boolean {
  if (!part || part.type !== "tool") return false

  const status = getToolStatus(part)
  if (status && ACTIVE_TOOL_STATUSES.has(status)) return false
  if (status && FINAL_TOOL_STATUSES.has(status)) return true

  return typeof getValidPartEndTime(part) === "number"
}

function shouldPreservePreviousPartUpdate(
  previousPart: CoalescedPart | undefined,
  nextPart: CoalescedPart | undefined,
) {
  if (!previousPart || !nextPart || previousPart.type !== "tool" || nextPart.type !== "tool") {
    return false
  }

  if (isFinalToolPart(previousPart) && !isFinalToolPart(nextPart)) {
    return true
  }

  const previousEnd = getValidPartEndTime(previousPart)
  const nextEnd = getValidPartEndTime(nextPart)
  if (typeof previousEnd !== "number") {
    return false
  }
  if (typeof nextEnd !== "number") {
    return true
  }
  return previousEnd > nextEnd
}

export function coalesceQueuedEvent(previous: Event, next: Event): Event {
  if (previous.type !== "message.part.updated" || next.type !== "message.part.updated") {
    return next
  }

  const previousPart = getUpdatedPart(previous)
  const nextPart = getUpdatedPart(next)
  if (shouldPreservePreviousPartUpdate(previousPart, nextPart)) {
    return previous
  }

  return next
}

export function createEventPipeline(input: EventPipelineInput): EventPipeline {
  const {
    sdk,
    onEvent,
    onReconnect,
    onDisconnect,
    onTransportSwitch,
    routeDirectory,
    transport = "auto",
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    wsReadyTimeoutMs = DEFAULT_WS_READY_TIMEOUT_MS,
  } = input
  const metrics = createMetricsTracker()
  let disconnected = false
  let backpressureUntil = 0

  // One entry per connected workspace directory. Cardinality is bounded by
  // the number of workspace roots open in the desktop (typically 1-3).
  // Entries are not evicted during a pipeline lifetime because the pipeline
  // itself is per-mount; the entire Map is GC'd when cleanup() is called.
  const directories = new Map<string, DirectoryQueue>()

  const getOrCreateDir = (directory: string): DirectoryQueue => {
    let d = directories.get(directory)
    if (d) return d
    d = {
      queue: [],
      buffer: [],
      coalesced: new Map(),
      timer: undefined,
      last: 0,
    }
    directories.set(directory, d)
    return d
  }

  const key = (payload: Event): string | undefined => {
    if (payload.type === "session.status") {
      const props = payload.properties as { sessionID: string }
      return `session.status:${props.sessionID}`
    }
    if (payload.type === "lsp.updated") {
      return "lsp.updated"
    }
    if (payload.type === "message.part.delta") {
      const props = payload.properties as { messageID: string; partID: string; field: string }
      return `message.part.delta:${props.messageID}:${props.partID}:${props.field}`
    }
    if (payload.type === "message.part.updated") {
      const props = payload.properties as { part?: { id?: string; messageID?: string } }
      const partID = props.part?.id
      const messageID = props.part?.messageID
      if (typeof partID === "string" && typeof messageID === "string") {
        return `message.part.updated:${messageID}:${partID}`
      }
    }
    return undefined
  }

  const updatedPartKeyForDelta = (payload: Event): string | undefined => {
    if (payload.type !== "message.part.delta") return undefined
    const props = payload.properties as { messageID?: string; partID?: string }
    if (typeof props.messageID !== "string" || typeof props.partID !== "string") return undefined
    return `message.part.updated:${props.messageID}:${props.partID}`
  }

  // Inverse of updatedPartKeyForDelta: a full part snapshot supersedes any
  // pending deltas for that part. Returns the coalesce-key PREFIX (all fields)
  // so the deltas' slots can be invalidated — otherwise a delta arriving after
  // the snapshot would merge into a pre-snapshot delta slot, reordering it
  // ahead of the snapshot and losing the post-snapshot delta.
  const deltaKeyPrefixForUpdated = (payload: Event): string | undefined => {
    if (payload.type !== "message.part.updated") return undefined
    const props = payload.properties as { part?: { id?: string; messageID?: string } }
    const partID = props.part?.id
    const messageID = props.part?.messageID
    if (typeof partID !== "string" || typeof messageID !== "string") return undefined
    return `message.part.delta:${messageID}:${partID}:`
  }

  /**
   * Extract a session-level identifier from a delta event for metrics tracking.
   * The SDK delta events carry messageID but may also carry sessionID as an
   * untyped property. Falls back to using messageID as the grouping key since
   * each message belongs to exactly one session and metrics are per-turn.
   */
  const extractSessionIdFromDelta = (payload: Event): string | null => {
    const props = payload.properties as { sessionID?: unknown; messageID?: unknown }
    if (typeof props.sessionID === "string" && props.sessionID.length > 0) {
      return props.sessionID
    }
    if (typeof props.messageID === "string" && props.messageID.length > 0) {
      return props.messageID
    }
    return null
  }

  const flushDir = (directory: string) => {
    const d = directories.get(directory)
    if (!d) return
    if (d.timer) {
      clearTimeout(d.timer)
      d.timer = undefined
    }
    if (d.queue.length === 0) return

    const events = d.queue
    d.queue = d.buffer
    d.buffer = events
    d.queue.length = 0
    d.coalesced.clear()

    d.last = Date.now()
    syncDebug.pipeline.flush(events.length)
    try {
      for (const payload of events) {
        // Isolate each event: a reducer throw on one malformed event (e.g.
        // a version-skewed backend sending an unexpected properties shape)
        // must not discard the rest of the batch coalesced into this frame —
        // dropping in-flight streaming deltas corrupts the visible chat.
        try {
          onEvent(directory, payload)
        } catch (error) {
          console.error("[event-pipeline] event handler threw during flush", error)
        }
      }
    } finally {
      // Clearing the buffer even on unexpected throws keeps the pipeline
      // from re-delivering the same events on the next flush — a
      // deterministic throw would otherwise enter an infinite loop.
      d.buffer.length = 0
    }
  }

  const flushAll = () => {
    for (const directory of directories.keys()) {
      try {
        flushDir(directory)
      } catch (error) {
        // One directory's failure must not prevent others from flushing.
        console.error("[event-pipeline] flushDir failed for directory", directory, error)
      }
    }
  }

  const scheduleDir = (directory: string) => {
    const d = getOrCreateDir(directory)
    if (d.timer) return
    const elapsed = Date.now() - d.last
    const flushFrameMs = Date.now() < backpressureUntil ? BACKPRESSURE_FLUSH_FRAME_MS : FLUSH_FRAME_MS
    d.timer = setTimeout(() => flushDir(directory), Math.max(0, flushFrameMs - elapsed))
  }

  let streamErrorLogged = false
  const notifyDisconnected = (reason: string) => {
    if (disconnected) {
      return
    }
    disconnected = true
    // Single writer of the canonical connection phase (S4.7): the pipeline
    // owns the transport, so it is the only module allowed to mark the
    // stream disconnected.
    markStreamDisconnected(reason)
    onDisconnect?.(reason)
  }

  const markConnected = () => {
    disconnected = false
    // Single writer of the canonical connection phase (S4.7): mark the
    // stream connected before consumers react, so UI gating on the
    // connection store never lags the pipeline's own recovery work.
    markStreamConnected()
    // Fire onReconnect on every successful connect — including the very
    // first one. Consumer state (the connection store) starts at
    // "connecting" and needs to be flipped positively; without this the
    // send button throws "Connection lost" until something else (HTTP
    // health check) happens to race a connect through.
    onReconnect?.()
  }

  const enqueueEvent = (directory: string, payload: Event) => {
    const normalizedPayload = normalizeEventType(payload)
    const routedDirectory =
      normalizedPayload.type === "server.resync_required"
        ? "global"
        : routeDirectory?.(directory, normalizedPayload) || directory

    // Track streaming metrics from session status and delta events
    if (normalizedPayload.type === "session.status") {
      const statusProps = normalizedPayload.properties as { sessionID: string; status: SessionStatus }
      if (statusProps.status?.type === "busy") {
        metrics.onSessionBusy(statusProps.sessionID)
      } else if (statusProps.status?.type === "idle") {
        metrics.onSessionIdle(statusProps.sessionID)
      }
    } else if (normalizedPayload.type === "session.error") {
      const errorProps = normalizedPayload.properties as { sessionID: string }
      metrics.onSessionIdle(errorProps.sessionID)
    } else if (normalizedPayload.type === "message.part.delta") {
      const deltaProps = normalizedPayload.properties as { delta: string }
      const sessionID = extractSessionIdFromDelta(normalizedPayload)
      if (sessionID) {
        metrics.onDelta(sessionID, deltaProps.delta?.length ?? 0)
      }
    }

    const d = getOrCreateDir(routedDirectory)
    const updatedKeyInterruptedByDelta = updatedPartKeyForDelta(normalizedPayload)
    if (updatedKeyInterruptedByDelta) {
      d.coalesced.delete(updatedKeyInterruptedByDelta)
    }
    const deltaPrefixInterruptedByUpdated = deltaKeyPrefixForUpdated(normalizedPayload)
    if (deltaPrefixInterruptedByUpdated) {
      for (const existingKey of d.coalesced.keys()) {
        if (existingKey.startsWith(deltaPrefixInterruptedByUpdated)) {
          d.coalesced.delete(existingKey)
        }
      }
    }
    const k = key(normalizedPayload)
    if (k) {
      const i = d.coalesced.get(k)
      if (i !== undefined) {
        if (normalizedPayload.type === "message.part.delta") {
          const prev = d.queue[i] as unknown as { properties: { delta: string } }
          const inc = normalizedPayload.properties as { delta: string }
          d.queue[i] = {
            ...normalizedPayload,
            properties: {
              ...(normalizedPayload.properties as object),
              delta: prev.properties.delta + inc.delta,
            },
          } as unknown as Event
        } else {
          d.queue[i] = coalesceQueuedEvent(d.queue[i], normalizedPayload)
        }
        syncDebug.pipeline.coalesced(normalizedPayload.type, k)
        return
      }
      d.coalesced.set(k, d.queue.length)
    }

    d.queue.push(normalizedPayload)
    scheduleDir(routedDirectory)
  }

  const wsDriver: WsDriver = {
    kind: "ws",
    url: (cursor) => buildGlobalEventWsUrl(cursor),
  }

  const sseDriver: SdkSseDriver = {
    kind: "sse-sdk",
    open: async (opts) => {
      // The SDK's SSE client is lazy: the fetch happens inside the generator
      // and, with sseMaxRetryAttempts: 0, an HTTP/network failure is reported
      // through onSseError and the generator then ends CLEANLY. Capture that
      // error; if the stream ends without delivering a single frame, rethrow
      // it so the transport classifies the failure (permanent 4xx → long
      // backoff cap + disconnect notification) instead of treating a dead
      // stream as a clean completion and hot-looping on the base delay. A
      // stream that delivered frames before ending stays a clean completion —
      // a mid-stream server close is a normal reconnect case.
      let sseFailure: unknown
      let hasSseFailure = false
      const result = await sdk.global.event({
        signal: opts.signal,
        sseMaxRetryAttempts: 0,
        ...(opts.headers ? { headers: opts.headers } : {}),
        onSseEvent: (event: { id?: unknown }) => {
          opts.onSseEvent({ id: typeof event.id === "string" && event.id.length > 0 ? event.id : undefined })
        },
        onSseError: (error: unknown) => {
          if (isAbortError(error)) return
          if (!hasSseFailure) {
            hasSseFailure = true
            sseFailure = error
          }
          if (streamErrorLogged) return
          streamErrorLogged = true
          console.error("[event-pipeline] SSE stream error", error)
        },
      })
      const upstream = result.stream
      return {
        stream: (async function* () {
          let delivered = false
          for await (const event of upstream) {
            delivered = true
            yield event
          }
          if (!delivered && hasSseFailure) {
            throw sseFailure
          }
        })(),
      }
    },
  }

  // Map the transport's error taxonomy back onto the reason strings the
  // pipeline has always reported to onDisconnect consumers.
  const reasonFromTransportError = (error: TransportError): string => {
    switch (error.code) {
      case "ws_closed":
        return `ws_closed:code=${error.closeCode ?? "?"}`
      case "ws_closed_before_ready":
        return "ws_closed_before_ready"
      case "ws_error_frame":
        return `ws_error_frame:${error.message || "unknown"}`
      case "ws_ready_timeout":
        // Legacy display string in WS-only mode (no fallback): the untagged
        // error message under the generic `<transport>_error:` prefix.
        return `${error.transport}_error:${error.message.slice(0, 80)}`
      case "heartbeat_timeout":
      case "system_resume":
      case "offline":
        return `${error.transport}_${error.code}`
      case "manual_retry":
        return `${error.transport}_${error.message || "manual"}`
      default:
        return error.message.length > 0
          ? `${error.transport}_error:${error.message.slice(0, 80)}`
          : `${error.transport}_error:unknown`
    }
  }

  const transportHandle = createEventTransport(
    {
      drivers: transport === "sse" ? { primary: sseDriver } : { primary: wsDriver, fallback: sseDriver },
      transport,
      heartbeatTimeoutMs,
      backoff: {
        baseMs: RETRY_BACKOFF_BASE_MS,
        capVisibleMs: RETRY_BACKOFF_CAP_VISIBLE_MS,
        capHiddenMs: RETRY_BACKOFF_CAP_HIDDEN_OR_OFFLINE_MS,
        maxExponent: RETRY_BACKOFF_MAX_EXPONENT,
      },
      wsReadyTimeoutMs,
    },
    {
      onFrame: (frame, meta) => {
        streamErrorLogged = false
        if (meta.transport === "ws") {
          const wsFrame = frame as MessageStreamWsFrame
          if (wsFrame.type === "backpressure") {
            backpressureUntil = Date.now() + BACKPRESSURE_MODE_MS
            return
          }
          if (wsFrame.type !== "event") {
            return
          }
          const payload = resolveEventPayload(wsFrame.payload)
          if (!payload) {
            return
          }
          const directory = resolveEventDirectory({ directory: wsFrame.directory, payload }, payload)
          enqueueEvent(directory, payload)
          return
        }

        const payload = resolveEventPayload((frame as { payload?: Event }).payload ?? frame)
        if (!payload) {
          return
        }
        const directory = resolveEventDirectory(frame, payload)
        enqueueEvent(directory, payload)

        if (payload.type === "server.connected") {
          // The SDK returns a lazy async generator before it performs fetch.
          // This frame is the server's actual subscription acknowledgement.
          // Flush any replayed events first, then let reconnect recovery
          // fetch authoritative snapshots without racing ahead of the
          // subscription.
          flushAll()
          markConnected()
        }
      },
      onConnected: (info) => {
        // WS: the ready frame is the subscription acknowledgement. (The SSE
        // acknowledgement is the server.connected frame, handled in onFrame.)
        if (info.transport !== "ws") {
          return
        }
        flushAll()
        markConnected()
      },
      onDisconnected: (error) => {
        notifyDisconnected(reasonFromTransportError(error))
      },
      onTransportSwitch: () => {
        // A transport switch (WS → SSE fallback) is not a disconnection: the
        // stream is about to re-establish on the fallback driver, so the
        // canonical phase stays/flips to connected (S4.7).
        markStreamConnected()
        onTransportSwitch?.()
      },
    },
  )

  const reconnect = (reason = "manual") => {
    transportHandle.reconnect(reason)
  }

  const cleanup = () => {
    transportHandle.close()
    flushAll()
  }

  return { cleanup, reconnect, metrics }
}
