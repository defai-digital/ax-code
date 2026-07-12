import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  applyTerminalTransportCapabilitiesForTests,
  connectTerminalStream,
  disposeTerminalInputTransport,
  getTerminalTransportManagerForTests,
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

      constructor(_url: string) {
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

  test("second subscriber of the same session does not send another bind frame", async () => {
    const eventsA: string[] = []
    const eventsB: string[] = []

    const closeA = connectTerminalStream("session-1", (event) => {
      eventsA.push(event.type)
    })

    // Let the socket open and the first bind go out
    await vi.waitFor(() => expect(sockets.length).toBe(1))
    await vi.waitFor(() => expect(sockets[0].readyState).toBe(WS_OPEN))
    await vi.waitFor(() => expect(sockets[0].sent.length).toBeGreaterThan(0))

    const bindFramesBefore = sockets[0].sent
      .map(decodeSentControl)
      .filter((frame) => frame?.t === "b")
    expect(bindFramesBefore).toHaveLength(1)

    // Server ack
    sockets[0].onmessage?.({
      data: encodeControl({ t: "bok", s: "session-1", v: 2, runtime: "node", ptyBackend: "node-pty" }),
    })
    await vi.waitFor(() => expect(eventsA).toContain("connected"))
    expect(getTerminalTransportManagerForTests().getBoundSessionId()).toBe("session-1")

    const sentAfterBind = sockets[0].sent.length

    const closeB = connectTerminalStream("session-1", (event) => {
      eventsB.push(event.type)
    })

    // Second view joins without rebinding
    await vi.waitFor(() => expect(eventsB).toContain("connected"))
    const bindFramesAfter = sockets[0].sent
      .slice(sentAfterBind)
      .map(decodeSentControl)
      .filter((frame) => frame?.t === "b")
    expect(bindFramesAfter).toHaveLength(0)
    expect(getTerminalTransportManagerForTests().getSubscriptionCount()).toBe(2)

    // Live data fans out to both without replay storm
    sockets[0].onmessage?.({
      data: encodeControl({ t: "d", s: "session-1", i: 1, d: "hello" }),
    })
    await vi.waitFor(() => {
      expect(eventsA.filter((t) => t === "data").length).toBe(1)
      expect(eventsB.filter((t) => t === "data").length).toBe(1)
    })

    closeA()
    closeB()
  })
})
