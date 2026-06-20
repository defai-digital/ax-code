import { describe, expect, test } from "vitest"
import { runHeadlessSession, type HeadlessAgentRuntime } from "../../../src/runtime/headless"

type Session = { id: string }
type Todo = { id: string }
type Diff = { path: string }
type Status = { type: "idle" | "busy" }
type Message = { id: string; sessionID: string }
type Part = { id: string; messageID: string }

describe("headless runner", () => {
  test("writes raw events to the sink before applying projection and stopping", async () => {
    const rawEvent = {
      details: {
        type: "session.status",
        properties: {
          sessionID: "ses_1",
          status: {
            type: "idle",
          },
        },
      },
    }
    const written: unknown[] = []
    let closed = 0
    const runtime = createRuntimeFromEvents([rawEvent])
    const result = await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      eventSink: {
        write(record) {
          written.push(record)
        },
        close() {
          closed++
        },
      },
      stopWhen({ event }) {
        return event.type === "session.status"
      },
    })

    expect(result.stopped).toBe("predicate")
    expect(written).toEqual([rawEvent])
    expect(result.state.session_status).toEqual({
      ses_1: {
        type: "idle",
      },
    })
    expect(closed).toBe(1)
  })

  test("closes event sinks when cancellation stops the subscription", async () => {
    const abort = new AbortController()
    let closed = 0
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async () => undefined,
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return new Promise<void>((resolve) => {
          if (input.signal.aborted) {
            resolve()
            return
          }
          input.signal.addEventListener("abort", () => resolve(), { once: true })
        })
      },
    } as unknown as HeadlessAgentRuntime

    const pending = runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: abort.signal,
      eventSink: {
        write: () => undefined,
        close() {
          closed++
        },
      },
    })

    await Promise.resolve()
    abort.abort()

    const result = await pending

    expect(result.stopped).toBe("signal")
    expect(closed).toBe(1)
  })

  test("supports transport-only subscriptions without sending commands", async () => {
    let sendCount = 0
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async () => {
        sendCount++
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "server.connected",
            properties: {},
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    const result = await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      stopWhen({ event }) {
        return event.type === "server.connected"
      },
    })

    expect(result.stopped).toBe("predicate")
    expect(sendCount).toBe(0)
  })

  test("sends commands even when the subscription stop predicate fires on the first event", async () => {
    let sendCount = 0
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async () => {
        sendCount++
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "server.connected",
            properties: {},
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    const result = await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      command: {
        type: "session.abort",
        sessionID: "ses_1",
      },
      stopWhen({ event }) {
        return event.type === "server.connected"
      },
    })

    expect(result.stopped).toBe("predicate")
    expect(sendCount).toBe(1)
  })

  test("aborts subscriptions and closes event sinks when command send fails", async () => {
    const sendFailure = new Error("send failed")
    let subscriptionAborted = false
    let closed = 0
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async () => {
        throw sendFailure
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return new Promise<void>((resolve) => {
          if (input.signal.aborted) {
            subscriptionAborted = true
            resolve()
            return
          }
          input.signal.addEventListener(
            "abort",
            () => {
              subscriptionAborted = true
              resolve()
            },
            { once: true },
          )
        })
      },
    } as unknown as HeadlessAgentRuntime

    let thrown: unknown
    try {
      await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
        baseUrl: "http://localhost",
        directory: process.cwd(),
        fetch: globalThis.fetch,
        runtime,
        signal: new AbortController().signal,
        command: {
          type: "session.abort",
          sessionID: "ses_1",
        },
        eventSink: {
          write: () => undefined,
          close() {
            closed++
          },
        },
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(sendFailure)
    expect(subscriptionAborted).toBe(true)
    expect(closed).toBe(1)
  })
})

function createRuntimeFromEvents(events: unknown[]): HeadlessAgentRuntime {
  return {
    client: undefined as never,
    createSession: async () => ({ id: "ses_1" }),
    send: async () => undefined,
    subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
      return (async () => {
        for (const event of events) {
          if (input.signal.aborted) return
          await input.onEvent(event as never)
        }
      })()
    },
  } as unknown as HeadlessAgentRuntime
}
