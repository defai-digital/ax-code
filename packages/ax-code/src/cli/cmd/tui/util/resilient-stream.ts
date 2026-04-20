import { setTimeout as sleep } from "node:timers/promises"

export type StreamDisconnectReason = "connect-timeout" | "watchdog-timeout" | "stream-ended" | "error"

export type StreamConnectionStatus = {
  connected: boolean
  phase: "connecting" | "connected" | "reconnecting" | "stopped"
  attempt: number
  reason?: StreamDisconnectReason
  error?: string
}

type StreamSubscription<T> = {
  stream: AsyncIterable<T>
}

export type ResilientStreamOptions<T> = {
  signal: AbortSignal
  subscribe: (signal: AbortSignal) => Promise<StreamSubscription<T>>
  onEvent: (event: T) => void | Promise<void>
  onStatus?: (status: StreamConnectionStatus) => void
  onError?: (error: unknown, status: StreamConnectionStatus) => void
  connectTimeoutMs?: number
  watchdogMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

export const STREAM_CONNECT_TIMEOUT_MS = 10_000
export const STREAM_WATCHDOG_MS = 60_000
export const STREAM_RECONNECT_BASE_MS = 2_000
export const STREAM_RECONNECT_MAX_MS = 30_000

async function sleepInterruptibly(signal: AbortSignal, ms: number) {
  try {
    await sleep(ms, undefined, { signal })
  } catch {
    // Ignore aborts from reconnect delay cancellation.
  }
}

export async function runResilientStream<T>(options: ResilientStreamOptions<T>) {
  const connectTimeoutMs = options.connectTimeoutMs ?? STREAM_CONNECT_TIMEOUT_MS
  const watchdogMs = options.watchdogMs ?? STREAM_WATCHDOG_MS
  const reconnectBaseMs = options.reconnectBaseMs ?? STREAM_RECONNECT_BASE_MS
  const reconnectMaxMs = options.reconnectMaxMs ?? STREAM_RECONNECT_MAX_MS

  let reconnectDelay = reconnectBaseMs
  let attempt = 0
  let lastReason: StreamDisconnectReason | undefined

  while (!options.signal.aborted) {
    attempt += 1
    options.onStatus?.({
      connected: false,
      phase: attempt === 1 ? "connecting" : "reconnecting",
      attempt,
      reason: lastReason,
    })

    const connectionAbort = new AbortController()
    const forwardAbort = () => connectionAbort.abort()
    options.signal.addEventListener("abort", forwardAbort, { once: true })

    let connectTimer: ReturnType<typeof setTimeout> | undefined
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let abortReason: StreamDisconnectReason | undefined

    const abortConnection = (reason: StreamDisconnectReason) => {
      abortReason = reason
      if (!connectionAbort.signal.aborted) connectionAbort.abort()
    }
    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog)
      watchdog = setTimeout(() => abortConnection("watchdog-timeout"), watchdogMs)
    }

    try {
      connectTimer = setTimeout(() => abortConnection("connect-timeout"), connectTimeoutMs)
      const subscription = await options.subscribe(connectionAbort.signal)
      if (connectTimer) clearTimeout(connectTimer)

      reconnectDelay = reconnectBaseMs
      options.onStatus?.({
        connected: true,
        phase: "connected",
        attempt,
      })
      resetWatchdog()

      for await (const event of subscription.stream) {
        if (options.signal.aborted || connectionAbort.signal.aborted) break
        resetWatchdog()
        await options.onEvent(event)
      }

      if (options.signal.aborted) break
      lastReason = abortReason ?? "stream-ended"
    } catch (error) {
      if (options.signal.aborted) break
      lastReason = abortReason ?? "error"
      options.onError?.(error, {
        connected: false,
        phase: "reconnecting",
        attempt,
        reason: lastReason,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (connectTimer) clearTimeout(connectTimer)
      if (watchdog) clearTimeout(watchdog)
      options.signal.removeEventListener("abort", forwardAbort)
    }

    if (options.signal.aborted) break

    options.onStatus?.({
      connected: false,
      phase: "reconnecting",
      attempt,
      reason: lastReason,
    })
    await sleepInterruptibly(options.signal, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs)
  }

  options.onStatus?.({
    connected: false,
    phase: "stopped",
    attempt,
    reason: lastReason,
  })
}
