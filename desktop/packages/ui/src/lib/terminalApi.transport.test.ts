import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  applyTerminalTransportCapabilitiesForTests,
  connectTerminalStream,
  disposeTerminalInputTransport,
  getTerminalTransportManagerForTests,
  sendTerminalInput,
} from "./terminalApi"

type MockSocket = {
  readyState: number
  binaryType: string
  sent: unknown[]
  onopen: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  send: (data: unknown) => void
  close: () => void
}

const WS_OPEN = 1
const CONTROL_TAG_JSON = 0x01

const encodeControl = (payload: Record<string, unknown>): ArrayBuffer => {
  const json = new TextEncoder().encode(JSON.stringify(payload))
  const bytes = new Uint8Array(json.length + 1)
  bytes[0] = CONTROL_TAG_JSON
  bytes.set(json, 1)
  return bytes.buffer
}

const decodeSentControl = (data: unknown): Record<string, unknown> | null => {
  if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
    return null
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes[0] !== CONTROL_TAG_JSON) {
    return null
  }
  return JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as Record<string, unknown>
}

describe("terminal transport multi-view subscribe", () => {
  let sockets: MockSocket[] = []
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    disposeTerminalInputTransport()
    sockets = []

    class MockWebSocket {
      readyState = 0
      binaryType = "arraybuffer"
      sent: unknown[] = []
      onopen: ((ev?: unknown) => void) | null = null
      onmessage: ((ev: { data: unknown }) => void) | null = null
      onerror: ((ev?: unknown) => void) | null = null
      onclose: ((ev?: unknown) => void) | null = null

      constructor(url: string) {
        void url
        sockets.push(this as unknown as MockSocket)
        queueMicrotask(() => {
          this.readyState = WS_OPEN
          this.onopen?.(undefined)
        })
      }

      send(data: unknown) {
        this.sent.push(data)
      }

      close() {
        this.readyState = 3
        this.onclose?.(undefined)
      }
    }

    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket)
    fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true }),
    }))
    vi.stubGlobal("fetch", fetchMock)
    // JSDOM / vitest often lack location for ws URL normalization
    if (typeof window !== "undefined") {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: {
          protocol: "http:",
          host: "127.0.0.1:3001",
        },
      })
    }

    applyTerminalTransportCapabilitiesForTests({
      input: {
        preferred: "ws",
        transports: ["ws"],
        ws: { path: "/api/terminal/ws", v: 2, enc: "text+json-bin-control" },
      },
      stream: {
        preferred: "ws",
        transports: ["ws"],
        ws: { path: "/api/terminal/ws", v: 2, enc: "text+json-bin-control" },
      },
    })
  })

  afterEach(() => {
    disposeTerminalInputTransport()
    vi.unstubAllGlobals()
  })

  test("same-buffer subscribers share one data owner without rebinding", async () => {
    const eventsA: string[] = []
    const eventsB: string[] = []

    const closeA = connectTerminalStream(
      "session-1",
      (event) => {
        eventsA.push(event.type)
      },
      undefined,
      { consumerKey: "repo::tab-1" },
    )

    await vi.waitFor(() => expect(sockets.length).toBe(1))
    await vi.waitFor(() => expect(sockets[0].readyState).toBe(WS_OPEN))
    sockets[0].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))

    const bindFramesBefore = sockets[0].sent.map(decodeSentControl).filter((frame) => frame?.t === "b")
    expect(bindFramesBefore).toHaveLength(1)

    // Server ack
    sockets[0].onmessage?.({
      data: encodeControl({ t: "bok", s: "session-1", v: 2, runtime: "node", ptyBackend: "node-pty" }),
    })
    await vi.waitFor(() => expect(eventsA).toContain("connected"))
    expect(getTerminalTransportManagerForTests().getBoundSessionId()).toBe("session-1")

    const sentAfterBind = sockets[0].sent.length

    const closeB = connectTerminalStream(
      "session-1",
      (event) => {
        eventsB.push(event.type)
      },
      undefined,
      { consumerKey: "repo::tab-1" },
    )

    // Second view joins without rebinding
    await vi.waitFor(() => expect(eventsB).toContain("connected"))
    const bindFramesAfter = sockets[0].sent
      .slice(sentAfterBind)
      .map(decodeSentControl)
      .filter((frame) => frame?.t === "b")
    expect(bindFramesAfter).toHaveLength(0)
    expect(getTerminalTransportManagerForTests().getSubscriptionCount()).toBe(2)

    sockets[0].onmessage?.({
      data: encodeControl({ t: "d", s: "session-1", i: 1, d: "hello" }),
    })
    await vi.waitFor(() => {
      expect(eventsA.filter((t) => t === "data").length).toBe(0)
      expect(eventsB.filter((t) => t === "data").length).toBe(1)
    })

    closeB()
    sockets[0].onmessage?.({
      data: encodeControl({ t: "d", s: "session-1", i: 2, d: "again" }),
    })
    await vi.waitFor(() => expect(eventsA.filter((t) => t === "data").length).toBe(1))

    closeA()
    expect(getTerminalTransportManagerForTests().getManagerCount()).toBe(0)
  })

  test("different terminal sessions use independent websocket managers", async () => {
    const eventsA: string[] = []
    const eventsB: string[] = []

    const closeA = connectTerminalStream("session-1", (event) => eventsA.push(`${event.type}:${event.data ?? ""}`))
    const closeB = connectTerminalStream("session-2", (event) => eventsB.push(`${event.type}:${event.data ?? ""}`))

    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    await vi.waitFor(() => expect(sockets.every((socket) => socket.readyState === WS_OPEN)).toBe(true))

    sockets[0].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    sockets[1].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets.every((socket) => socket.sent.length > 0)).toBe(true))

    const firstBind = sockets[0].sent.map(decodeSentControl).find((frame) => frame?.t === "b")
    const secondBind = sockets[1].sent.map(decodeSentControl).find((frame) => frame?.t === "b")
    expect(firstBind?.s).toBe("session-1")
    expect(secondBind?.s).toBe("session-2")

    sockets[0].onmessage?.({ data: encodeControl({ t: "bok", s: "session-1", v: 2 }) })
    sockets[1].onmessage?.({ data: encodeControl({ t: "bok", s: "session-2", v: 2 }) })
    sockets[0].onmessage?.({ data: encodeControl({ t: "d", s: "session-1", i: 1, d: "one" }) })
    sockets[1].onmessage?.({ data: encodeControl({ t: "d", s: "session-2", i: 1, d: "two" }) })

    await vi.waitFor(() => {
      expect(eventsA).toContain("data:one")
      expect(eventsB).toContain("data:two")
    })
    expect(eventsA).not.toContain("data:two")
    expect(eventsB).not.toContain("data:one")
    expect(getTerminalTransportManagerForTests().getManagerCount()).toBe(2)

    closeA()
    closeB()
  })

  test("resubscribing after every view unmounts resumes from the last replay cursor", async () => {
    const closeFirst = connectTerminalStream("session-1", () => {})

    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    await vi.waitFor(() => expect(sockets[0].readyState).toBe(WS_OPEN))
    sockets[0].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
    sockets[0].onmessage?.({ data: encodeControl({ t: "bok", s: "session-1", v: 2 }) })
    sockets[0].onmessage?.({ data: encodeControl({ t: "d", s: "session-1", i: 7, d: "history" }) })

    closeFirst()
    expect(getTerminalTransportManagerForTests().getManagerCount()).toBe(0)

    const closeSecond = connectTerminalStream("session-1", () => {})
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    await vi.waitFor(() => expect(sockets[1].readyState).toBe(WS_OPEN))
    sockets[1].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets[1].sent.length).toBeGreaterThan(0))

    const resumedBind = sockets[1].sent.map(decodeSentControl).find((frame) => frame?.t === "b")
    expect(resumedBind).toMatchObject({ t: "b", s: "session-1", r: 7 })

    closeSecond()
  })

  test("reconnects an active subscription after a websocket error", async () => {
    const events: string[] = []
    const close = connectTerminalStream("session-1", (event) => events.push(event.type), undefined, {
      maxRetries: 1,
      initialRetryDelay: 1,
      maxRetryDelay: 1,
    })

    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    await vi.waitFor(() => expect(sockets[0].readyState).toBe(WS_OPEN))
    sockets[0].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
    sockets[0].onmessage?.({ data: encodeControl({ t: "bok", s: "session-1", v: 2 }) })

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0)
    sockets[0].onerror?.()

    await vi.waitFor(() => expect(events).toContain("reconnecting"))
    await vi.waitFor(() => expect(sockets).toHaveLength(2))

    randomSpy.mockRestore()
    close()
  })

  test("input for an unwatched session uses HTTP without hijacking a live stream", async () => {
    const close = connectTerminalStream("session-1", () => {})

    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    await vi.waitFor(() => expect(sockets[0].readyState).toBe(WS_OPEN))
    sockets[0].onmessage?.({ data: encodeControl({ t: "ok", v: 2 }) })
    await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))
    sockets[0].onmessage?.({ data: encodeControl({ t: "bok", s: "session-1", v: 2 }) })

    const sentBeforeInput = sockets[0].sent.length
    await sendTerminalInput("session-2", "echo isolated")

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/session-2/input",
      expect.objectContaining({ method: "POST", body: "echo isolated" }),
    )
    expect(sockets[0].sent).toHaveLength(sentBeforeInput)
    expect(getTerminalTransportManagerForTests().getBoundSessionId()).toBe("session-1")

    close()
  })
})
