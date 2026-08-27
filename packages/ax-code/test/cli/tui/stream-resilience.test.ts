import { describe, expect, test } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"
import { runResilientStream, type StreamConnectionStatus } from "../../../src/cli/cmd/tui/util/resilient-stream"

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
