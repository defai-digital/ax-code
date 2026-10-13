import { describe, expect, test, vi } from "vitest"
import { createSseClient as createV1SseClient } from "../src/gen/core/serverSentEvents.gen.js"
import { createSseClient as createV2SseClient } from "../src/v2/gen/core/serverSentEvents.gen.js"

const clients = [
  ["v1", createV1SseClient],
  ["v2", createV2SseClient],
] as const

describe.each(clients)("generated SSE client %s", (_name, createSseClient) => {
  test("resets retry attempts after a connection succeeds", async () => {
    let fetchCalls = 0
    const sleepDelays: number[] = []

    const fetch: typeof globalThis.fetch = async () => {
      fetchCalls++
      if (fetchCalls === 1) {
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream failed"))
            },
          }),
        )
      }

      throw new Error("connect failed")
    }

    const { stream } = createSseClient({
      fetch,
      sseDefaultRetryDelay: 10,
      sseMaxRetryAttempts: 2,
      sseSleepFn: async (delay) => {
        sleepDelays.push(delay)
      },
      url: "http://localhost/events",
    })

    for await (const _event of stream) {
      throw new Error("unexpected event")
    }

    expect(fetchCalls).toBe(3)
    // First failure after the reset gets the base delay (10); the second
    // consecutive failure (no success in between) doubles it (20).
    expect(sleepDelays).toEqual([10, 20])
  })

  test("cancels the response body when the consumer stops early", async () => {
    let cancelled = false

    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'))
          },
          cancel() {
            cancelled = true
          },
        }),
      )

    const { stream } = createSseClient<{ ok: boolean }>({
      fetch,
      url: "http://localhost/events",
    })

    await expect(stream.next()).resolves.toEqual({
      done: false,
      value: { ok: true },
    })

    await stream.return(undefined)

    expect(cancelled).toBe(true)
  })

  test("reconnects a cleanly closed stream with Last-Event-ID", async () => {
    const lastEventIDs: Array<string | null> = []
    let fetchCalls = 0

    const fetch: typeof globalThis.fetch = async (input) => {
      const request = input instanceof Request ? input : new Request(input)
      lastEventIDs.push(request.headers.get("Last-Event-ID"))
      fetchCalls += 1
      const id = `evt-${fetchCalls}`
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`id: ${id}\ndata: {"id":"${id}"}\n\n`))
            controller.close()
          },
        }),
      )
    }

    const { stream } = createSseClient<{ id: string }>({
      fetch,
      sseDefaultRetryDelay: 0,
      sseIdleTimeout: 0,
      url: "http://localhost/events",
    })

    await expect(stream.next()).resolves.toEqual({ done: false, value: { id: "evt-1" } })
    await expect(stream.next()).resolves.toEqual({ done: false, value: { id: "evt-2" } })
    await stream.return(undefined)

    expect(lastEventIDs.slice(0, 2)).toEqual([null, "evt-1"])
  })

  test("reconnects a stream that stops receiving bytes", async () => {
    const errors: string[] = []
    let fetchCalls = 0

    const fetch: typeof globalThis.fetch = async () => {
      fetchCalls += 1
      if (fetchCalls === 1) {
        return new Response(new ReadableStream({ start() {} }))
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"reconnected":true}\n\n'))
          },
        }),
      )
    }

    const { stream } = createSseClient<{ reconnected: boolean }>({
      fetch,
      onSseError(error) {
        errors.push(error instanceof Error ? error.message : String(error))
      },
      sseDefaultRetryDelay: 0,
      sseIdleTimeout: 5,
      url: "http://localhost/events",
    })

    await expect(stream.next()).resolves.toEqual({ done: false, value: { reconnected: true } })
    await stream.return(undefined)

    expect(fetchCalls).toBe(2)
    expect(errors[0]).toBe("SSE stream idle for 5ms")
  })

  test("CRLF framing remains correct at every byte boundary", async () => {
    const bytes = new TextEncoder().encode('id: evt😀\r\ndata: {"value":\r\ndata: "😀"}\r\n\r\n')
    for (let split = 1; split < bytes.length; split++) {
      const { stream } = createSseClient({
        url: "http://localhost/events",
        sseIdleTimeout: 0,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(bytes.slice(0, split))
                c.enqueue(bytes.slice(split))
                c.close()
              },
            }),
          ),
      })
      await expect(stream.next()).resolves.toEqual({ done: false, value: { value: "😀" } })
      await stream.return(undefined)
    }
  })

  test("one-byte input preserves field spaces, empty data, CR and invalid id/retry rules", async () => {
    const events: Array<{ id?: string; retry?: number }> = []
    const bytes = new TextEncoder().encode("id: valid\rid: bad\0id\rretry: 2oops\rdata:  keep spaces\r\rdata:\n\n")
    const { stream } = createSseClient({
      url: "http://localhost/events",
      sseDefaultRetryDelay: 7,
      sseIdleTimeout: 0,
      onSseEvent(event) {
        events.push(event)
      },
      fetch: async () =>
        new Response(
          new ReadableStream({
            start(c) {
              for (const byte of bytes) c.enqueue(new Uint8Array([byte]))
              c.close()
            },
          }),
        ),
    })
    await expect(stream.next()).resolves.toEqual({ done: false, value: " keep spaces" })
    await expect(stream.next()).resolves.toEqual({ done: false, value: "" })
    await stream.return(undefined)
    expect(events[0]).toMatchObject({ id: "valid", retry: 7 })
  })

  test("oversized frames cancel the body and fail without reconnecting", async () => {
    const cancelled = vi.fn(),
      fetch = vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("data: " + "x".repeat(200)))
              },
              cancel: cancelled,
            }),
          ),
      )
    const errors: unknown[] = []
    const { stream } = createSseClient({
      url: "http://localhost/events",
      fetch,
      sseMaxEventCharacters: 64,
      onSseError: (e) => errors.push(e),
    })
    await expect(stream.next()).rejects.toThrow("SSE event exceeds")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(cancelled).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(1)
  })

  test("valid events in a large transport chunk use independent frame budgets", async () => {
    const { stream } = createSseClient({
      url: "http://localhost/events",
      sseIdleTimeout: 0,
      sseMaxEventCharacters: 20,
      fetch: async () => new Response('data: "a"\n\ndata: "b"\n\ndata: "c"\n\n'),
    })
    for (const value of ["a", "b", "c"]) await expect(stream.next()).resolves.toEqual({ done: false, value })
    await stream.return(undefined)
  })

  test("aborting a long retry wait settles immediately without another request", async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const fetch = vi.fn(async () => {
        throw new Error("offline")
      })
      const { stream } = createSseClient({
        url: "http://localhost/events",
        fetch,
        signal: controller.signal,
        sseDefaultRetryDelay: 30000,
      })
      const next = stream.next()
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()
      await expect(next).resolves.toEqual({ done: true, value: undefined })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("abort also settles a custom retry sleeper that never completes", async () => {
    const controller = new AbortController()
    let entered!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { stream } = createSseClient({
      url: "http://localhost/events",
      signal: controller.signal,
      fetch: async () => {
        throw new Error("offline")
      },
      sseSleepFn: () => {
        entered()
        return new Promise(() => {})
      },
    })
    const next = stream.next()
    await waiting
    controller.abort()
    await expect(next).resolves.toEqual({ done: true, value: undefined })
  })

  test("reconnection does not mutate caller-owned headers", async () => {
    const headers = new Headers({ "Last-Event-ID": "caller" })
    const sent: Array<string | null> = []
    let calls = 0
    const { stream } = createSseClient({
      url: "http://localhost/events",
      headers,
      sseIdleTimeout: 0,
      sseDefaultRetryDelay: 0,
      fetch: async (input) => {
        sent.push((input as Request).headers.get("Last-Event-ID"))
        calls++
        return new Response(`id: server${calls}\ndata: ${calls}\n\n`)
      },
    })
    await stream.next()
    await stream.next()
    await stream.return(undefined)
    expect(sent).toEqual(["caller", "server1"])
    expect(headers.get("Last-Event-ID")).toBe("caller")
  })

  test("invalid frame limits fail before opening a connection", () => {
    const fetch = vi.fn()
    for (const limit of [0, -1, NaN, Infinity, 1.5])
      expect(() => createSseClient({ url: "http://localhost/events", fetch, sseMaxEventCharacters: limit })).toThrow(
        "Invalid SSE event",
      )
    expect(fetch).not.toHaveBeenCalled()
  })
})
