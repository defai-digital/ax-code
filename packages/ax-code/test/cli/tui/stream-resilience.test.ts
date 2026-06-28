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
})
