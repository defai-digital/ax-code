// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline } from "../event-pipeline"

const originalDocument = globalThis.document
const originalWindow = globalThis.window
const originalWebSocket = globalThis.WebSocket

// These fixtures intentionally include partial and legacy-compatible event
// shapes so the pipeline normalization paths are exercised.
type TestEventPayload = {
  type: string
  properties: Record<string, unknown>
}

type SdkStreamEvent = {
  directory?: string
  payload: TestEventPayload
}

type ReceivedEvent = {
  directory: string
  payload: TestEventPayload
}

type ToolPartProperties = {
  part: {
    text?: string
    state: {
      status?: string
      time: { end?: number }
    }
  }
}

type SessionStatusProperties = {
  status: { type: string }
}

type SdkEventOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
}

type TestSdk = {
  global: {
    event(options?: SdkEventOptions): Promise<{ stream: AsyncIterable<SdkStreamEvent> } | never>
  }
}

const asPipelineSdk = (sdk: TestSdk): EventPipelineInput["sdk"] => sdk as unknown as EventPipelineInput["sdk"]
const asProperties = <T extends object>(payload: TestEventPayload): T => payload.properties as T

function installDomStubs() {
  // jsdom provides a WebSocket constructor that silently hangs when there is
  // no server — the pipeline would try WS first and never fall back to SSE
  // within the test timeout.  Force the SSE path by removing WebSocket.
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: undefined,
  })

  globalThis.document = {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Document

  globalThis.window = {
    location: {
      href: "http://127.0.0.1:3000/",
      origin: "http://127.0.0.1:3000",
    },
    addEventListener() {},
    removeEventListener() {},
  } as unknown as Window & typeof globalThis
}

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string | URL
  readyState = FakeWebSocket.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string | URL) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
  }

  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  emitMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  emitClose(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

afterEach(() => {
  globalThis.document = originalDocument
  globalThis.window = originalWindow
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    writable: true,
    value: originalWebSocket,
  })
  FakeWebSocket.instances = []
})

function createSdkWithSingleEvent(event: SdkStreamEvent, hold: Promise<void>): EventPipelineInput["sdk"] {
  return asPipelineSdk({
    global: {
      event: async () => ({
        stream: (async function* () {
          yield event
          await hold
        })(),
      }),
    },
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

// Helper to create an SDK that yields multiple events in sequence, then holds.
function createSdkWithEvents(events: SdkStreamEvent[], hold: Promise<void>): EventPipelineInput["sdk"] {
  return asPipelineSdk({
    global: {
      event: async () => ({
        stream: (async function* () {
          for (const event of events) {
            yield event
          }
          await hold
        })(),
      }),
    },
  })
}

// Run a pipeline against a pre-seeded event stream, collect every dispatched
// event, wait long enough for the 16ms flush window to elapse, then tear it
// down. Returns the list of { directory, payload } that onEvent saw.
async function runPipelineWithEvents(events: SdkStreamEvent[], waitMs = 80): Promise<ReceivedEvent[]> {
  installDomStubs()

  let releaseStream: VoidFunction = () => undefined
  const hold = new Promise<void>((resolve) => {
    releaseStream = resolve
  })

  const received: ReceivedEvent[] = []
  const sdk = createSdkWithEvents(events, hold)
  const { cleanup } = createEventPipeline({
    sdk,
    onEvent: (directory, payload) => {
      received.push({ directory, payload })
    },
  })

  await new Promise((resolve) => setTimeout(resolve, waitMs))
  cleanup()
  releaseStream()

  return received
}

describe("createEventPipeline", () => {
  it("falls back to payload.properties.directory when the SDK event omits top-level directory", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        payload: {
          type: "session.status",
          properties: {
            directory: "C:/Users/daveotero/localdev/openchamber",
            sessionID: "session-1",
            status: { type: "busy" },
          },
        },
      },
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    expect(received).toHaveLength(1)
    expect(received[0].directory).toBe("C:/Users/daveotero/localdev/openchamber")
    expect(received[0].payload.type).toBe("session.status")
  })

  it("prefers the explicit top-level event directory when present", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        directory: "C:/top-level",
        payload: {
          type: "session.status",
          properties: {
            directory: "C:/nested",
            sessionID: "session-2",
            status: { type: "busy" },
          },
        },
      },
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    expect(received).toHaveLength(1)
    expect(received[0].directory).toBe("C:/top-level")
    expect(received[0].payload.type).toBe("session.status")
  })

  it("uses payload.properties.directory when the top-level directory is an empty string", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        directory: "",
        payload: {
          type: "message.part.updated",
          properties: {
            directory: "C:/fallback-dir",
            part: {
              id: "part-1",
              type: "text",
              messageID: "message-1",
            },
          },
        },
      },
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    expect(received).toHaveLength(1)
    expect(received[0].directory).toBe("C:/fallback-dir")
    expect(received[0].payload.type).toBe("message.part.updated")
  })

  it("keeps truly global events on the global channel when no directory is present anywhere", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        payload: {
          type: "server.connected",
          properties: {},
        },
      },
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    expect(received).toHaveLength(1)
    expect(received[0].directory).toBe("global")
    expect(received[0].payload.type).toBe("server.connected")
  })

  it("keeps message.part.delta events when a newer message.part.updated is queued for the same field", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []

    // The pipeline only routes/coalesces events. Whether this delta is already
    // represented by the newer snapshot is reducer state, not queue state.
    const directory = "/test/dir"
    const sdk = createSdkWithEvents(
      [
        // T0: message.part.updated for part-A
        {
          payload: {
            type: "message.part.updated",
            properties: {
              directory,
              part: { id: "part-A", type: "text", messageID: "msg-1" },
            },
          },
        },
        // T1: message.part.delta for part-A
        {
          payload: {
            type: "message.part.delta",
            properties: {
              directory,
              messageID: "msg-1",
              partID: "part-A",
              field: "text",
              delta: " world",
            },
          },
        },
        // T2: message.part.updated for part-A. This must stay after T1:
        // replacing T0 with this newer snapshot would make the reducer apply the
        // delta after a snapshot that may already include it.
        {
          payload: {
            type: "message.part.updated",
            properties: {
              directory,
              part: { id: "part-A", type: "text", messageID: "msg-1" },
            },
          },
        },
      ],
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload })
          if (received.length === 3) {
            cleanup()
            releaseStream()
            resolve()
          }
        },
      })
    })

    await delivered

    expect(received.length).toBe(3)
    expect(received[0].payload.type).toBe("message.part.updated")
    expect(received[1].payload.type).toBe("message.part.delta")
    expect(received[1].payload.properties.delta).toBe(" world")
    expect(received[2].payload.type).toBe("message.part.updated")
  })

  it("keeps delta events for other fields on the same part", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "reasoning",
            delta: "before",
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: { id: "part-1", type: "text", messageID: "msg-1" },
          },
        },
      },
    ])

    expect(received).toHaveLength(2)
    expect(received[0].payload.type).toBe("message.part.delta")
    expect(received[0].payload.properties.field).toBe("reasoning")
    expect(received[1].payload.type).toBe("message.part.updated")
  })

  it("keeps text delta after an initial part.updated when no newer part.updated replaced it", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: { id: "part-1", type: "text", messageID: "msg-1" },
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "hello",
          },
        },
      },
    ])

    expect(received).toHaveLength(2)
    expect(received[0].payload.type).toBe("message.part.updated")
    expect(received[1].payload.type).toBe("message.part.delta")
    expect(received[1].payload.properties.delta).toBe("hello")
  })

  it("coalesces message.part.updated events for the same part", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const directory = "/test/dir"

    const sdk = createSdkWithEvents(
      [
        {
          payload: {
            type: "message.part.updated",
            properties: {
              directory,
              part: { id: "part-A", type: "text", messageID: "msg-1" },
            },
          },
        },
        {
          payload: {
            type: "message.part.updated",
            properties: {
              directory,
              part: { id: "part-A", type: "text", messageID: "msg-1" },
            },
          },
        },
      ],
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    // Only 1 event should be delivered (coalesced)
    expect(received.length).toBe(1)
    expect(received[0].payload.type).toBe("message.part.updated")
  })

  it("keeps a completed tool part when a stale running update is coalesced in the same frame", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              type: "tool",
              messageID: "msg-1",
              tool: "bash",
              state: {
                status: "completed",
                time: { start: 10, end: 20 },
              },
            },
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              type: "tool",
              messageID: "msg-1",
              tool: "bash",
              state: {
                status: "running",
                time: { start: 10, end: 15 },
              },
            },
          },
        },
      },
    ])

    expect(received).toHaveLength(1)
    expect(received[0].payload.type).toBe("message.part.updated")
    const properties = asProperties<ToolPartProperties>(received[0].payload)
    expect(properties.part.state.status).toBe("completed")
    expect(properties.part.state.time.end).toBe(20)
  })

  it("does not treat invalid tool end times as final during coalescing", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              type: "tool",
              messageID: "msg-1",
              tool: "bash",
              state: {
                time: { start: 20, end: 10 },
              },
            },
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part-1",
              type: "tool",
              messageID: "msg-1",
              tool: "bash",
              state: {
                status: "running",
                time: { start: 20 },
              },
            },
          },
        },
      },
    ])

    expect(received).toHaveLength(1)
    expect(received[0].payload.type).toBe("message.part.updated")
    const properties = asProperties<ToolPartProperties>(received[0].payload)
    expect(properties.part.state.status).toBe("running")
    expect(properties.part.state.time.end).toBeUndefined()
  })

  it("routes events before queueing so coalescing happens on the resolved directory", async () => {
    installDomStubs()

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithEvents(
      [
        {
          directory: "global",
          payload: {
            type: "message.part.updated",
            properties: {
              part: { id: "part-A", type: "text", messageID: "msg-1" },
            },
          },
        },
        {
          directory: "/real-dir",
          payload: {
            type: "message.part.updated",
            properties: {
              part: { id: "part-A", type: "text", messageID: "msg-1", text: "next" },
            },
          },
        },
      ],
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        routeDirectory: (directory, payload) => {
          if (payload.type === "message.part.updated") {
            return "/resolved-dir"
          }
          return directory
        },
        onEvent: (dir, payload) => {
          received.push({ directory: dir, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await delivered

    expect(received).toHaveLength(1)
    expect(received[0].directory).toBe("/resolved-dir")
    expect(received[0].payload.type).toBe("message.part.updated")
    const properties = asProperties<ToolPartProperties>(received[0].payload)
    expect(properties.part.text).toBe("next")
  })

  it("consumes websocket message stream frames when transport is ws", async () => {
    installDomStubs()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const received: ReceivedEvent[] = []
    const sdk = asPipelineSdk({
      global: {
        event: async () => {
          throw new Error("SSE should not be used in ws mode")
        },
      },
    })

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "ws",
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          resolve()
        },
      })
    })

    await Promise.resolve()

    const socket = FakeWebSocket.instances[0]
    expect(socket?.url).toContain("/api/global/event/ws")

    socket.emitOpen()
    socket.emitMessage({ type: "ready", scope: "global" })
    socket.emitMessage({
      type: "event",
      eventId: "evt-1",
      directory: "/tmp/project",
      payload: {
        type: "session.status",
        properties: {
          sessionID: "session-1",
        },
      },
    })

    await delivered

    expect(received).toEqual([
      {
        directory: "/tmp/project",
        payload: {
          type: "session.status",
          properties: {
            sessionID: "session-1",
          },
        },
      },
    ])
  })

  it("falls back to SSE when websocket closes before ready in auto mode", async () => {
    installDomStubs()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        payload: {
          type: "server.connected",
          properties: {},
        },
      },
      hold,
    )

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "auto",
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    await Promise.resolve()
    const socket = FakeWebSocket.instances[0]
    socket.emitClose()

    await delivered

    expect(received).toEqual([
      {
        directory: "global",
        payload: {
          type: "server.connected",
          properties: {},
        },
      },
    ])
  })

  it("falls back to SSE when websocket does not become ready in auto mode", async () => {
    installDomStubs()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const received: ReceivedEvent[] = []
    const sdk = createSdkWithSingleEvent(
      {
        payload: {
          type: "server.connected",
          properties: {},
        },
      },
      hold,
    )

    let cleanup: VoidFunction = () => undefined
    const delivered = new Promise<void>((resolve) => {
      const pipeline = createEventPipeline({
        sdk,
        transport: "auto",
        wsReadyTimeoutMs: 20,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          resolve()
        },
      })
      cleanup = pipeline.cleanup
    })

    await Promise.resolve()
    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()

    try {
      await withTimeout(delivered, 500, "timed out waiting for websocket-ready SSE fallback")
    } finally {
      cleanup()
      releaseStream()
    }

    expect(received).toEqual([
      {
        directory: "global",
        payload: {
          type: "server.connected",
          properties: {},
        },
      },
    ])
  })

  it("passes the last websocket event id when falling back to SSE", async () => {
    installDomStubs()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const originalConsoleError = console.error
    console.error = () => {}

    let releaseStream: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      releaseStream = resolve
    })

    const eventOptions: SdkEventOptions[] = []
    const received: ReceivedEvent[] = []
    const sdk = asPipelineSdk({
      global: {
        event: async (options?: SdkEventOptions) => {
          if (!options) throw new Error("expected event options")
          eventOptions.push(options)
          return {
            stream: (async function* () {
              yield {
                payload: {
                  type: "server.connected",
                  properties: {},
                },
              }
              await hold
            })(),
          }
        },
      },
    })

    const delivered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "auto",
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: (directory, payload) => {
          received.push({ directory, payload })
          if (payload.type !== "server.connected") {
            return
          }
          cleanup()
          releaseStream()
          resolve()
        },
      })
    })

    try {
      await Promise.resolve()

      const firstSocket = FakeWebSocket.instances[0]
      firstSocket.emitOpen()
      firstSocket.emitMessage({ type: "ready", scope: "global" })
      firstSocket.emitMessage({
        type: "event",
        eventId: "evt-1",
        directory: "/tmp/project",
        payload: {
          type: "session.status",
          properties: {
            sessionID: "session-1",
          },
        },
      })
      firstSocket.emitClose()

      await new Promise((resolve) => setTimeout(resolve, 40))
      await delivered

      expect(eventOptions[0]?.headers?.["Last-Event-ID"]).toBe("evt-1")
      expect(received.some((entry) => entry.payload.type === "server.connected")).toBe(true)
    } finally {
      console.error = originalConsoleError
    }
  })

  it("marks the pipeline disconnected on heartbeat timeout and recovers on the next websocket connect", async () => {
    installDomStubs()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const disconnectReasons: string[] = []
    let reconnectCount = 0

    const sdk = asPipelineSdk({
      global: {
        event: async () => {
          throw new Error("SSE should not be used in ws mode")
        },
      },
    })

    const recovered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "ws",
        heartbeatTimeoutMs: 20,
        reconnectDelayMs: 0,
        wsReadyTimeoutMs: 20,
        onEvent: () => {},
        onDisconnect: (reason) => {
          disconnectReasons.push(reason)
        },
        onReconnect: () => {
          reconnectCount += 1
          if (reconnectCount === 2) {
            cleanup()
            resolve()
          }
        },
      })
    })

    await Promise.resolve()

    const firstSocket = FakeWebSocket.instances[0]
    firstSocket.emitOpen()
    firstSocket.emitMessage({ type: "ready", scope: "global" })

    await new Promise((resolve) => setTimeout(resolve, 35))

    const secondSocket = FakeWebSocket.instances[1]
    expect(secondSocket).toBeDefined()

    secondSocket.emitOpen()
    secondSocket.emitMessage({ type: "ready", scope: "global" })

    await recovered

    expect(disconnectReasons).toEqual(["ws_heartbeat_timeout"])
    expect(reconnectCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// P1 — Per-directory queue isolation
// ---------------------------------------------------------------------------

describe("createEventPipeline — per-directory isolation (P1)", () => {
  it("delivers events from two directories without losing either", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s-a", status: { type: "busy" } },
        },
      },
      {
        directory: "dir-b",
        payload: {
          type: "session.status",
          properties: { sessionID: "s-b", status: { type: "idle" } },
        },
      },
    ])

    const dirs = received.map((r) => r.directory).sort()
    expect(dirs).toEqual(["dir-a", "dir-b"])
  })

  it("keeps distinct sessionIDs in the same directory as independent coalesce slots", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "busy" } },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s2", status: { type: "busy" } },
        },
      },
    ])

    expect(received).toHaveLength(2)
    const sessionIds = received.map((r) => r.payload.properties.sessionID).sort()
    expect(sessionIds).toEqual(["s1", "s2"])
  })

  it("collapses repeated session.status for the same session down to the latest", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "busy" } },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "idle" } },
        },
      },
    ])

    expect(received).toHaveLength(1)
    expect(asProperties<SessionStatusProperties>(received[0].payload).status.type).toBe("idle")
  })
})

// ---------------------------------------------------------------------------
// Option C — message.part.delta coalescing
// ---------------------------------------------------------------------------

describe("createEventPipeline — delta coalescing (Option C)", () => {
  it("accumulates consecutive deltas for the same (messageID, partID, field) into one event", async () => {
    const events = ["Hello ", "world", ", ", "how ", "are ", "you?"].map((chunk) => ({
      directory: "dir-a",
      payload: {
        type: "message.part.delta",
        properties: {
          messageID: "msg-1",
          partID: "part-1",
          field: "text",
          delta: chunk,
        },
      },
    }))

    const received = await runPipelineWithEvents(events)

    expect(received).toHaveLength(1)
    expect(received[0].payload.type).toBe("message.part.delta")
    expect(received[0].payload.properties.delta).toBe("Hello world, how are you?")
    expect(received[0].payload.properties.messageID).toBe("msg-1")
    expect(received[0].payload.properties.partID).toBe("part-1")
    expect(received[0].payload.properties.field).toBe("text")
  })

  it("does NOT merge deltas across different fields on the same part", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "A",
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "reasoning",
            delta: "B",
          },
        },
      },
    ])

    expect(received).toHaveLength(2)
    const fieldDelta = received.map((r) => [r.payload.properties.field, r.payload.properties.delta]).sort()
    expect(fieldDelta).toEqual([
      ["reasoning", "B"],
      ["text", "A"],
    ])
  })

  it("does NOT merge deltas across different parts on the same message", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "AAA",
          },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-2",
            field: "text",
            delta: "BBB",
          },
        },
      },
    ])

    expect(received).toHaveLength(2)
    const byPart = Object.fromEntries(received.map((r) => [r.payload.properties.partID, r.payload.properties.delta]))
    expect(byPart["part-1"]).toBe("AAA")
    expect(byPart["part-2"]).toBe("BBB")
  })

  it("does NOT merge deltas across different directories (per-directory queues)", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "from-a",
          },
        },
      },
      {
        directory: "dir-b",
        payload: {
          type: "message.part.delta",
          properties: {
            messageID: "msg-1",
            partID: "part-1",
            field: "text",
            delta: "from-b",
          },
        },
      },
    ])

    expect(received).toHaveLength(2)
    const byDir = Object.fromEntries(received.map((r) => [r.directory, r.payload.properties.delta]))
    expect(byDir["dir-a"]).toBe("from-a")
    expect(byDir["dir-b"]).toBe("from-b")
  })

  it("does not touch non-delta events (session.status still replaced, not concatenated)", async () => {
    const received = await runPipelineWithEvents([
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "busy" } },
        },
      },
      {
        directory: "dir-a",
        payload: {
          type: "session.status",
          properties: { sessionID: "s1", status: { type: "idle" } },
        },
      },
    ])

    expect(received).toHaveLength(1)
    expect(asProperties<SessionStatusProperties>(received[0].payload).status.type).toBe("idle")
  })
})
