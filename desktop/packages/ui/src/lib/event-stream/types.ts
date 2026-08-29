/**
 * Unified event transport — shared types for the desktop server→client JSON
 * event streams (domain events, app events, notifications).
 *
 * Implements SPEC-2026-08-29-desktop-unified-event-transport (Slice 1).
 */

export type TransportState = "idle" | "connecting" | "open" | "backoff" | "closed"

export type TransportErrorCode =
  | "ws_ready_timeout"
  | "ws_closed_before_ready"
  | "ws_closed"
  | "ws_error_frame"
  | "sse_error"
  | "heartbeat_timeout"
  | "http_permanent"
  | "offline"
  | "system_resume"
  | "manual_retry"
  | "aborted"

export type TransportError = {
  code: TransportErrorCode
  transport: "ws" | "sse"
  httpStatus?: number
  closeCode?: number
  message: string
}

// Driver descriptors preserve BOTH existing SSE mechanisms plus WS.
export type WsDriver = { kind: "ws"; url: (cursor?: string) => string }
export type EventSourceDriver = { kind: "sse-eventsource"; url: string }
export type SdkSseDriver = {
  kind: "sse-sdk"
  open: (opts: {
    signal: AbortSignal
    headers?: Record<string, string>
    onSseEvent: (e: { id?: string }) => void
  }) => Promise<{ stream: AsyncIterable<unknown> }>
}
export type StreamDriver = WsDriver | EventSourceDriver | SdkSseDriver

export type BackoffProfile = {
  baseMs: number
  capVisibleMs: number
  capHiddenMs: number
  maxExponent: number
}

export type EventTransportConfig = {
  drivers: { primary: StreamDriver; fallback?: StreamDriver }
  transport?: "auto" | "ws" | "sse" // default "auto"
  heartbeatTimeoutMs?: number // undefined = disabled (notifications)
  backoff: BackoffProfile
  wsReadyTimeoutMs?: number // default 2000
  wsFallbackWindowMs?: number // default 60_000
  unstableReadyWindowMs?: number // default 2000
  cursor?: { get(): string | undefined; set(id: string): void }
  permanentHttpStatus?: (status: number) => boolean // default: 4xx except 408/429
  interruptSignals?: boolean // online/offline/visibility/pageshow/
  // system-resume/retry-now; default true
}

export type EventTransportHooks = {
  onFrame: (frame: unknown, meta: { transport: "ws" | "sse"; eventId?: string }) => void
  onConnected: (info: { first: boolean; transport: "ws" | "sse" }) => void
  onDisconnected?: (err: TransportError) => void
  onTransportSwitch?: () => void
  onStateChange?: (s: TransportState) => void
  onGap?: (prevId: string, nextId: string) => void // opt-in, default off
}

export type EventTransport = {
  state(): TransportState
  reconnect(reason?: string): void
  close(): void
}

/**
 * Internal context handed to the driver adapters for one connection attempt.
 * Not part of the public transport API.
 */
export type AttemptContext = {
  signal: AbortSignal
  /** Resume cursor (last delivered event id) captured at attempt start. */
  cursor(): string | undefined
  /** Record a resume cursor delivered by the stream. */
  setCursor(id: string): void
  /** Stream activity — arms/rearms the heartbeat and the stale-visibility clock. */
  activity(): void
  /** The server acknowledged the subscription (WS ready frame / first SSE frame). */
  ready(): void
  /** Deliver a raw stream frame to the consumer. */
  deliver(frame: unknown, eventId?: string): void
  /** Resume headers (Last-Event-ID) for SSE drivers, captured at attempt start. */
  headers?: Record<string, string>
  wsReadyTimeoutMs: number
  unstableReadyWindowMs: number
  /** WS-only: whether a pre-ready/unstable failure may trigger the SSE fallback window. */
  wsFallbackAllowed: boolean
}

const TRANSPORT_ERROR_BRAND = "ax-code-event-transport-error"

/** Internal attempt error: adapters reject with this shape. */
export type AttemptError = TransportError & {
  [TRANSPORT_ERROR_BRAND]: true
  /** WS failures that qualify for the WS→SSE fallback window. */
  fallbackEligible?: boolean
}

export function createTransportError(
  code: TransportErrorCode,
  transport: "ws" | "sse",
  message: string,
  extras: { httpStatus?: number; closeCode?: number; fallbackEligible?: boolean } = {},
): AttemptError {
  return {
    [TRANSPORT_ERROR_BRAND]: true,
    code,
    transport,
    message,
    ...(extras.httpStatus !== undefined ? { httpStatus: extras.httpStatus } : {}),
    ...(extras.closeCode !== undefined ? { closeCode: extras.closeCode } : {}),
    ...(extras.fallbackEligible ? { fallbackEligible: true } : {}),
  }
}

export function isTransportError(error: unknown): error is AttemptError {
  return (
    typeof error === "object" && error !== null && (error as Record<string, unknown>)[TRANSPORT_ERROR_BRAND] === true
  )
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError")
  )
}
