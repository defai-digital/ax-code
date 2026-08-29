/**
 * createEventTransport — the connection lifecycle loop shared by the desktop
 * event streams. Ported verbatim from the event-pipeline.ts reconnect loop:
 * driver resolution (WS-first with a 60s SSE fallback window), per-attempt
 * abort controllers, lazily-armed heartbeat, exponential backoff with
 * visible/hidden/offline caps, permanent-4xx long-cap handling, and the
 * browser lifecycle interrupt signals.
 *
 * The transport delivers raw frames only; domain logic (queueing, coalescing,
 * flush ordering, acknowledgement semantics beyond "connected") stays in the
 * consumers.
 */

import { computeBackoffDelay, defaultIsPermanentHttpStatus, extractHttpStatus } from "./backoff"
import { createHeartbeat, type Heartbeat } from "./heartbeat"
import { SYNC_RETRY_NOW_EVENT, SYSTEM_RESUME_EVENT, isHidden, isOffline, waitForRetry } from "./visibility"
import { runWebSocketAttempt } from "./adapters/websocket"
import { runEventSourceAttempt } from "./adapters/event-source"
import { runSdkSseAttempt } from "./adapters/sdk-sse"
import {
  createTransportError,
  isAbortError,
  isTransportError,
  type AttemptContext,
  type AttemptError,
  type EventTransport,
  type EventTransportConfig,
  type EventTransportHooks,
  type StreamDriver,
  type TransportErrorCode,
  type TransportState,
} from "./types"

const DEFAULT_WS_READY_TIMEOUT_MS = 2_000
const DEFAULT_WS_FALLBACK_WINDOW_MS = 60_000
const DEFAULT_UNSTABLE_READY_WINDOW_MS = 2_000

type PendingInterrupt = {
  code: TransportErrorCode
  detail?: string
}

export function createEventTransport(config: EventTransportConfig, hooks: EventTransportHooks): EventTransport {
  const mode = config.transport ?? "auto"
  const interruptSignals = config.interruptSignals ?? true
  const heartbeatTimeoutMs = config.heartbeatTimeoutMs
  const wsReadyTimeoutMs = config.wsReadyTimeoutMs ?? DEFAULT_WS_READY_TIMEOUT_MS
  const wsFallbackWindowMs = config.wsFallbackWindowMs ?? DEFAULT_WS_FALLBACK_WINDOW_MS
  const unstableReadyWindowMs = config.unstableReadyWindowMs ?? DEFAULT_UNSTABLE_READY_WINDOW_MS
  const isPermanentHttpStatus = config.permanentHttpStatus ?? defaultIsPermanentHttpStatus
  const abort = new AbortController()

  let state: TransportState = "idle"
  let wsFallbackUntil = 0
  let consecutiveFailures = 0
  let attempt: AbortController | undefined
  let attemptKind: "ws" | "sse" = mode === "ws" ? "ws" : "sse"
  let pendingInterrupt: PendingInterrupt | null = null
  let disconnectedCycle = false
  let firstConnect = true
  let lastActivityAt = Date.now()
  let streamErrorLogged = false
  let internalCursor: string | undefined

  // Single cursor owner: every driver reads/writes the resume cursor through
  // these two accessors (WS query param, SSE Last-Event-ID header, SDK
  // onSseEvent ids).
  const cursorGet = (): string | undefined => (config.cursor ? config.cursor.get() : internalCursor)
  const cursorSet = (id: string): void => {
    const prev = cursorGet()
    if (config.cursor) {
      config.cursor.set(id)
    } else {
      internalCursor = id
    }
    if (hooks.onGap && prev && prev !== id) {
      const previousSeq = Number(prev)
      const nextSeq = Number(id)
      if (Number.isInteger(previousSeq) && Number.isInteger(nextSeq) && nextSeq > previousSeq + 1) {
        hooks.onGap(prev, id)
      }
    }
  }

  const heartbeat: Heartbeat | null =
    heartbeatTimeoutMs !== undefined
      ? createHeartbeat(heartbeatTimeoutMs, () => {
          pendingInterrupt = { code: "heartbeat_timeout" }
          attempt?.abort()
        })
      : null

  const setState = (next: TransportState) => {
    if (state === next) return
    state = next
    hooks.onStateChange?.(next)
  }

  const activity = () => {
    lastActivityAt = Date.now()
    streamErrorLogged = false
    heartbeat?.reset()
  }

  const resolveDriver = (): { driver: StreamDriver; kind: "ws" | "sse" } => {
    const { primary, fallback } = config.drivers
    const primaryKind = primary.kind === "ws" ? "ws" : "sse"
    if (primaryKind === "ws" && typeof WebSocket !== "function" && fallback) {
      return { driver: fallback, kind: "sse" }
    }
    if (mode === "auto" && primaryKind === "ws" && fallback && wsFallbackUntil > Date.now()) {
      return { driver: fallback, kind: "sse" }
    }
    return { driver: primary, kind: primaryKind }
  }

  const toAttemptError = (error: unknown, kind: "ws" | "sse"): AttemptError => {
    if (isTransportError(error)) return error
    const message =
      typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : ""
    // Raw driver errors carry no code of their own; label them by the driver
    // kind so the transport/code pair never contradicts itself.
    return createTransportError(kind === "ws" ? "ws_closed" : "sse_error", kind, message, {
      httpStatus: extractHttpStatus(error),
    })
  }

  // Accessor indirection: pendingInterrupt is assigned by heartbeat/lifecycle
  // closures, which TS control-flow narrowing cannot see — direct reads after
  // the loop-top `null` reset would narrow to `never` in the truthy branch.
  const takePendingInterrupt = (): PendingInterrupt | null => {
    const value = pendingInterrupt
    pendingInterrupt = null
    return value
  }

  void (async () => {
    while (!abort.signal.aborted) {
      attempt = new AbortController()
      lastActivityAt = Date.now()
      pendingInterrupt = null
      // Clean completion and silent aborts re-loop on the backoff base, like
      // the previous loop did on its initial retry delay.
      let retryDelayMs = config.backoff.baseMs
      const { driver, kind } = resolveDriver()
      attemptKind = kind
      setState("connecting")
      const onAbort = () => {
        attempt?.abort()
      }
      abort.signal.addEventListener("abort", onAbort)

      const cursor = cursorGet()
      const ctx: AttemptContext = {
        signal: attempt.signal,
        cursor: cursorGet,
        setCursor: cursorSet,
        activity,
        ready: () => {
          disconnectedCycle = false
          consecutiveFailures = 0
          streamErrorLogged = false
          setState("open")
          // Fire onConnected on every successful connect — including the very
          // first one. Consumer state (isConnected) starts at false and needs
          // to be flipped positively.
          hooks.onConnected({ first: firstConnect, transport: kind })
          firstConnect = false
        },
        deliver: (frame, eventId) => {
          streamErrorLogged = false
          hooks.onFrame(frame, eventId ? { transport: kind, eventId } : { transport: kind })
        },
        ...(kind === "sse" && cursor ? { headers: { "Last-Event-ID": cursor } } : {}),
        wsReadyTimeoutMs,
        unstableReadyWindowMs,
        wsFallbackAllowed: mode === "auto" && config.drivers.fallback !== undefined,
      }

      try {
        if (driver.kind === "ws") {
          await runWebSocketAttempt(driver, ctx)
        } else if (driver.kind === "sse-eventsource") {
          await runEventSourceAttempt(driver, ctx)
        } else {
          await runSdkSseAttempt(driver, ctx)
        }
      } catch (error) {
        const attemptError = toAttemptError(error, kind)
        if (attemptError.fallbackEligible && mode === "auto" && config.drivers.fallback) {
          retryDelayMs = 0
          wsFallbackUntil = Date.now() + wsFallbackWindowMs
          // Transport switch (WS → SSE fallback), not a real disconnection.
          // The consumer still gets a hook so it can resync authoritative
          // state; real networks can lose/buffer events around transport flips.
          hooks.onTransportSwitch?.()
        } else if (!isAbortError(error)) {
          consecutiveFailures += 1
          if (!streamErrorLogged) {
            streamErrorLogged = true
            console.error("[event-transport] stream failed")
          }
          // Notify the consumer that the stream has disconnected, so it can
          // update connection state (e.g. set isConnected = false).
          disconnectedCycle = true
          hooks.onDisconnected?.(attemptError)

          // Exponential backoff so a hard-down server / dead network doesn't
          // spin the event loop. Caps lower when the user is foreground and
          // the browser thinks it's online; caps higher when hidden or
          // offline. The interruptible wait below resolves early on `online`
          // or visibility-visible so recovery is still fast.
          //
          // Override for permanent 4xx errors: stuck-path / bad-auth scenarios
          // won't recover from blind retry. Use the long cap immediately so
          // the client doesn't pound the server log. The wait interrupters
          // still apply, so a fix on the other end followed by
          // `online`/visibility recovery probes promptly.
          const status = attemptError.httpStatus
          retryDelayMs =
            status !== undefined && isPermanentHttpStatus(status)
              ? config.backoff.capHiddenMs
              : computeBackoffDelay(consecutiveFailures, config.backoff, { offline: isOffline(), hidden: isHidden() })
        }
      } finally {
        abort.signal.removeEventListener("abort", onAbort)
        attempt = undefined
        heartbeat?.clear()
      }

      if (abort.signal.aborted) return
      const interrupt = takePendingInterrupt()
      if (interrupt) {
        disconnectedCycle = true
        hooks.onDisconnected?.(createTransportError(interrupt.code, attemptKind, interrupt.detail ?? interrupt.code))
        retryDelayMs =
          interrupt.code === "offline"
            ? computeBackoffDelay(Math.max(1, consecutiveFailures), config.backoff, {
                offline: isOffline(),
                hidden: isHidden(),
              })
            : 0
      }
      if (retryDelayMs > 0) {
        setState("backoff")
        await waitForRetry(retryDelayMs, abort.signal, { interruptSignals })
      }
    }
  })()

  const onVisibility = () => {
    if (typeof document === "undefined") return
    if (document.visibilityState !== "visible") return
    if (heartbeatTimeoutMs === undefined) return
    if (Date.now() - lastActivityAt < heartbeatTimeoutMs) return
    attempt?.abort()
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return
    attempt?.abort()
  }

  // OS wake-from-sleep (Electron powerMonitor.resume). The connection is
  // almost certainly dead after sleep — abort immediately so the reconnect
  // loop fires on the next tick with retryDelayMs = 0.
  const onSystemResume = () => {
    pendingInterrupt = { code: "system_resume" }
    attempt?.abort()
  }

  // UI-triggered "retry now" (e.g. the reconnect banner). Same effect as
  // system-resume: abort any in-flight attempt so the loop reconnects
  // immediately; the interruptible wait also listens for the event, so an
  // inter-attempt backoff sleep ends now too.
  const onRetryNow = () => {
    pendingInterrupt = { code: "manual_retry", detail: "manual_retry" }
    attempt?.abort()
  }

  // Browser told us the network is back. If we're already in a disconnected
  // cycle, abort the (stale) attempt and let the loop probe immediately; the
  // interruptible wait also resolves early on `online`, so any inter-attempt
  // sleep ends now. Guard on disconnectedCycle so a spurious `online` from the
  // browser doesn't disrupt a healthy connection.
  const onOnline = () => {
    if (!disconnectedCycle) return
    attempt?.abort()
  }

  // Browser told us we're offline. Abort the current attempt — its socket /
  // fetch will throw soon anyway, this just stops sooner. The backoff then
  // returns the long cap so we wait for `online` instead of hammering a dead
  // network.
  const onOffline = () => {
    pendingInterrupt = { code: "offline" }
    attempt?.abort()
  }

  if (interruptSignals) {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility)
      window.addEventListener("pageshow", onPageShow)
    }

    // Use globalThis (not window) for these listeners so that test
    // environments can replace globalThis.window with a stub.
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.addEventListener(SYSTEM_RESUME_EVENT, onSystemResume)
      globalThis.window.addEventListener(SYNC_RETRY_NOW_EVENT, onRetryNow)
      globalThis.window.addEventListener("online", onOnline)
      globalThis.window.addEventListener("offline", onOffline)
    }
  }

  const removeListeners = () => {
    if (!interruptSignals) return
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pageshow", onPageShow)
    }
    if (typeof globalThis.window !== "undefined") {
      globalThis.window.removeEventListener(SYSTEM_RESUME_EVENT, onSystemResume)
      globalThis.window.removeEventListener(SYNC_RETRY_NOW_EVENT, onRetryNow)
      globalThis.window.removeEventListener("online", onOnline)
      globalThis.window.removeEventListener("offline", onOffline)
    }
  }

  const reconnect = (reason = "manual") => {
    pendingInterrupt = { code: "manual_retry", detail: reason }
    attempt?.abort()
  }

  const close = () => {
    if (state === "closed") return
    setState("closed")
    removeListeners()
    abort.abort()
  }

  return {
    state: () => state,
    reconnect,
    close,
  }
}
