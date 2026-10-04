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

  test("autonomous asks auto-reply through the runtime by default", async () => {
    const sent: unknown[] = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async (command: unknown) => {
        sent.push(command)
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: "ses_1",
              permission: "edit",
              patterns: ["*"],
              metadata: {},
              always: ["*"],
            },
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      autonomous: true,
      stopWhen({ event }) {
        return event.type === "permission.asked"
      },
    })

    expect(sent).toEqual([{ type: "permission.reply", body: { requestID: "perm_1", reply: "once" } }])
  })

  test("interactive-only asks stay pending in autonomous mode", async () => {
    const sent: unknown[] = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async (command: unknown) => {
        sent.push(command)
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "permission.asked",
            properties: {
              id: "perm_webmcp",
              sessionID: "ses_1",
              permission: "webmcp",
              patterns: ["bridge_execute_webmcp_tool"],
              metadata: {},
              always: [],
            },
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
      autonomous: true,
      stopWhen({ event }) {
        return event.type === "permission.asked"
      },
    })

    expect(sent).toEqual([])
    expect(result.state.permission["ses_1"]).toHaveLength(1)
  })

  test("interactive-only asks stay pending even when always patterns are present", async () => {
    const sent: unknown[] = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async (command: unknown) => {
        sent.push(command)
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "permission.asked",
            properties: {
              id: "perm_webmcp",
              sessionID: "ses_1",
              permission: "webmcp",
              patterns: ["bridge_execute_webmcp_tool"],
              metadata: {},
              always: ["*"],
            },
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
      autonomous: true,
      stopWhen({ event }) {
        return event.type === "permission.asked"
      },
    })

    // The pending decision keys on the interactive-only permission name, not
    // on an empty always list: a forged always pattern must not auto-approve.
    expect(sent).toEqual([])
    expect(result.state.permission["ses_1"]).toHaveLength(1)
  })

  test("explicit undefined handlers do not wipe the auto-reply defaults", async () => {
    const sent: unknown[] = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async (command: unknown) => {
        sent.push(command)
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: "ses_1",
              permission: "edit",
              patterns: ["*"],
              metadata: {},
              always: ["*"],
            },
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      autonomous: true,
      effects: { replyPermission: undefined, replyQuestion: undefined },
      stopWhen({ event }) {
        return event.type === "permission.asked"
      },
    })

    expect(sent).toEqual([{ type: "permission.reply", body: { requestID: "perm_1", reply: "once" } }])
  })

  test("autonomous questions auto-reply through the runtime by default", async () => {
    const sent: unknown[] = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async (command: unknown) => {
        sent.push(command)
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "question.asked",
            properties: {
              id: "q_1",
              sessionID: "ses_1",
              questions: [{ question: "Pick one", options: [{ label: "Recommended default" }] }],
            },
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      autonomous: true,
      stopWhen({ event }) {
        return event.type === "question.asked"
      },
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: "question.reply", body: { requestID: "q_1" } })
    expect((sent[0] as { body: { answers: unknown[] } }).body.answers).toHaveLength(1)
  })

  test("rejected auto-reply delivery warns instead of crashing", async () => {
    const warnings: Array<[string, unknown]> = []
    const runtime = {
      client: undefined as never,
      createSession: async () => ({ id: "ses_1" }),
      send: async () => {
        throw new Error("backend closed")
      },
      subscribe(input: Parameters<HeadlessAgentRuntime["subscribe"]>[0]) {
        return input.onEvent({
          details: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: "ses_1",
              permission: "edit",
              patterns: ["*"],
              metadata: {},
              always: ["*"],
            },
          },
        } as never) as Promise<void>
      },
    } as unknown as HeadlessAgentRuntime

    await runHeadlessSession<Session, Todo, Diff, Status, Message, Part>({
      baseUrl: "http://localhost",
      directory: process.cwd(),
      fetch: globalThis.fetch,
      runtime,
      signal: new AbortController().signal,
      autonomous: true,
      effects: {
        onWarn: (label, error) => {
          warnings.push([label, error])
        },
      },
      stopWhen({ event }) {
        return event.type === "permission.asked"
      },
    })

    // The projection executor catches handler rejections; a failing backend
    // surfaces as a warning, never an unhandled rejection crash.
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(warnings).toHaveLength(1)
    expect(warnings[0][0]).toBe("autonomous permission reply failed")
    expect((warnings[0][1] as Error).message).toBe("backend closed")
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
