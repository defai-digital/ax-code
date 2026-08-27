import { describe, expect, test } from "vitest"
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
    expect(sleepDelays).toEqual([10, 10])
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
})
