import { describe, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { runResilientStream, type StreamConnectionStatus } from "../../../src/cli/tui/util/resilient-stream"

describe("runResilientStream", () => {
  test("retries after a connect timeout and resumes the stream", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const statuses: StreamConnectionStatus[] = []
    let attempts = 0

    await runResilientStream<string>({
      signal: abort.signal,
      connectTimeoutMs: 20,
      watchdogMs: 1_000,
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      onEvent: (event) => {
        events.push(event)
        abort.abort()
      },
      onStatus: (status) => {
        statuses.push(status)
      },
      subscribe: async (signal) => {
        attempts += 1
        if (attempts === 1) {
          return new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("connect aborted")), { once: true })
          })
        }
        return {
          stream: (async function* () {
            yield "recovered"
          })(),
        }
      },
    })

    expect(attempts).toBe(2)
    expect(events).toEqual(["recovered"])
    expect(statuses.some((status) => status.reason === "connect-timeout")).toBe(true)
    expect(statuses.filter((status) => status.phase === "connected")).toHaveLength(1)
  })

  test("enforces connect timeout when subscribe ignores abort", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const statuses: StreamConnectionStatus[] = []
    let attempts = 0

    const result = await Promise.race([
      runResilientStream<string>({
        signal: abort.signal,
        connectTimeoutMs: 10,
        watchdogMs: 1_000,
        reconnectBaseMs: 1,
        reconnectMaxMs: 2,
        onEvent: (event) => {
          events.push(event)
          abort.abort()
        },
        onStatus: (status) => {
          statuses.push(status)
        },
        subscribe: async () => {
          attempts += 1
          if (attempts === 1) {
            return new Promise<never>(() => {})
          }
          return {
            stream: (async function* () {
              yield "recovered"
            })(),
          }
        },
      }).then(() => "completed"),
      sleep(100).then(() => {
        abort.abort()
        return "timed-out"
      }),
    ])

    expect(result).toBe("completed")
    expect(attempts).toBe(2)
    expect(events).toEqual(["recovered"])
    expect(statuses.some((status) => status.reason === "connect-timeout")).toBe(true)
  })

  test("reconnects after a stream error instead of exiting the loop", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const statuses: StreamConnectionStatus[] = []
    let attempts = 0

    await runResilientStream<string>({
      signal: abort.signal,
      connectTimeoutMs: 1_000,
      watchdogMs: 1_000,
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      onEvent: (event) => {
        events.push(event)
        if (event === "second") abort.abort()
      },
      onStatus: (status) => {
        statuses.push(status)
      },
      subscribe: async () => {
        attempts += 1
        if (attempts === 1) {
          return {
            stream: (async function* () {
              yield "first"
              throw new Error("boom")
            })(),
          }
        }
        return {
          stream: (async function* () {
            yield "second"
          })(),
        }
      },
    })

    expect(events).toEqual(["first", "second"])
    expect(attempts).toBe(2)
    expect(statuses.filter((status) => status.phase === "connected")).toHaveLength(2)
    expect(statuses.some((status) => status.reason === "error")).toBe(true)
  })

  test("aborts and reconnects when a live stream stops emitting events", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const statuses: StreamConnectionStatus[] = []
    let attempts = 0

    await runResilientStream<string>({
      signal: abort.signal,
      connectTimeoutMs: 1_000,
      watchdogMs: 20,
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      onEvent: (event) => {
        events.push(event)
        abort.abort()
      },
      onStatus: (status) => {
        statuses.push(status)
      },
      subscribe: async (signal) => {
        attempts += 1
        if (attempts === 1) {
          return {
            stream: (async function* () {
              await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("watchdog aborted")), { once: true })
              })
            })(),
          }
        }
        return {
          stream: (async function* () {
            yield "recovered"
          })(),
        }
      },
    })

    expect(attempts).toBe(2)
    expect(events).toEqual(["recovered"])
    expect(statuses.some((status) => status.reason === "watchdog-timeout")).toBe(true)
  })

  test("reports connected only after the server subscription acknowledgement", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const connectedAtEvent: boolean[] = []
    let connected = false

    await runResilientStream<string>({
      signal: abort.signal,
      isReadyEvent: (event) => event === "server.connected",
      onStatus: (status) => {
        connected = status.connected
      },
      onEvent: (event) => {
        events.push(event)
        connectedAtEvent.push(connected)
        if (event === "server.connected") abort.abort()
      },
      subscribe: async () => ({
        stream: (async function* () {
          yield "replayed-event"
          yield "server.connected"
        })(),
      }),
    })

    expect(events).toEqual(["replayed-event", "server.connected"])
    expect(connectedAtEvent).toEqual([false, true])
  })

  test("reconnects when a lazy stream never reaches its subscription acknowledgement", async () => {
    const abort = new AbortController()
    const events: string[] = []
    const statuses: StreamConnectionStatus[] = []
    let attempts = 0

    await runResilientStream<string>({
      signal: abort.signal,
      connectTimeoutMs: 20,
      watchdogMs: 1_000,
      reconnectBaseMs: 1,
      reconnectMaxMs: 2,
      isReadyEvent: (event) => event === "server.connected",
      onStatus: (status) => statuses.push(status),
      onEvent: (event) => {
        events.push(event)
        if (event === "server.connected") abort.abort()
      },
      subscribe: async (signal) => {
        attempts++
        if (attempts === 1) {
          return {
            stream: (async function* () {
              yield "pre-ack-event"
              await new Promise((_, reject) => {
                signal.addEventListener("abort", () => reject(new Error("connect aborted")), { once: true })
              })
            })(),
          }
        }
        return {
          stream: (async function* () {
            yield "server.connected"
          })(),
        }
      },
    })

    expect(attempts).toBe(2)
    expect(events).toEqual(["pre-ack-event", "server.connected"])
    expect(statuses.some((status) => status.reason === "connect-timeout")).toBe(true)
    expect(statuses.filter((status) => status.phase === "connected")).toHaveLength(1)
  })
})

test.each(["connect-timeout", "watchdog-timeout"] as const)(
  "%s reconnects even when the iterator ignores cancellation",
  async (reason) => {
    const abort = new AbortController()
    const stalled = Promise.withResolvers<IteratorResult<string>>()
    const closing = Promise.withResolvers<IteratorResult<string>>()
    const closeIterator = vi.fn(() => closing.promise)
    const statuses: StreamConnectionStatus[] = []
    const events: string[] = []
    let attempts = 0
    const done = runResilientStream<string>({
      signal: abort.signal,
      connectTimeoutMs: 20,
      watchdogMs: 20,
      reconnectBaseMs: 1,
      reconnectMaxMs: 1,
      ...(reason === "connect-timeout" ? { isReadyEvent: (event: string) => event === "ready" } : {}),
      onStatus: (status) => statuses.push(status),
      onEvent: (event) => {
        events.push(event)
        abort.abort()
      },
      subscribe: async () => {
        if (++attempts === 1)
          return {
            stream: { [Symbol.asyncIterator]: () => ({ next: () => stalled.promise, return: closeIterator }) },
          }
        return {
          stream: (async function* () {
            yield "ready"
          })(),
        }
      },
    })
    try {
      await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 500 })
      await done
      expect(events).toEqual(["ready"])
      expect(closeIterator).toHaveBeenCalledTimes(1)
      expect(statuses.some((status) => status.reason === reason)).toBe(true)
    } finally {
      abort.abort()
      stalled.resolve({ done: true, value: undefined })
      closing.resolve({ done: true, value: undefined })
      await done
    }
  },
)

test("cancelling an uncooperative subscription stops promptly and cleans its late result", async () => {
  const abort = new AbortController()
  const late = Promise.withResolvers<{ stream: AsyncIterable<string>; unsubscribe: () => void }>()
  const unsubscribe = vi.fn()
  const statuses: StreamConnectionStatus[] = []
  const done = runResilientStream<string>({
    signal: abort.signal,
    connectTimeoutMs: 10_000,
    onEvent: () => {},
    onStatus: (status) => statuses.push(status),
    subscribe: () => late.promise,
  })
  abort.abort()
  try {
    await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe("stopped"), { timeout: 500 })
  } finally {
    late.resolve({ stream: (async function* () {})(), unsubscribe })
    await done
  }
  expect(unsubscribe).toHaveBeenCalledTimes(1)
  expect(statuses.some((status) => status.connected)).toBe(false)
})

test("subscription setup and acknowledgement share one connect deadline", async () => {
  vi.useFakeTimers()
  const abort = new AbortController()
  const stalled = Promise.withResolvers<IteratorResult<string>>()
  const subscription = Promise.withResolvers<{ stream: AsyncIterable<string> }>()
  const statuses: StreamConnectionStatus[] = []
  const done = runResilientStream<string>({
    signal: abort.signal,
    connectTimeoutMs: 100,
    reconnectBaseMs: 1,
    isReadyEvent: (event) => event === "ready",
    onEvent: () => {},
    onStatus: (status) => statuses.push(status),
    subscribe: () => subscription.promise,
  })
  try {
    await vi.advanceTimersByTimeAsync(60)
    subscription.resolve({ stream: { [Symbol.asyncIterator]: () => ({ next: () => stalled.promise }) } })
    await vi.advanceTimersByTimeAsync(40)
    expect(statuses.some((status) => status.reason === "connect-timeout")).toBe(true)
    expect(statuses.some((status) => status.connected)).toBe(false)
  } finally {
    abort.abort()
    stalled.resolve({ done: true, value: undefined })
    await done
    vi.useRealTimers()
  }
})
