import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline } from "../event-pipeline"
import { selectIsConnected, useConnectionStore } from "@/lib/event-stream/connection-state"
import {
  FakeWebSocket,
  installFakeWebSocket,
  restoreEnvironment,
  saveEnvironment,
  setNavigatorOnline,
  setVisibilityState,
  type SavedEnvironment,
} from "@/lib/event-stream/test-fakes"

// S4.7 wiring pin: the pipeline (owner of the app's event transport) is the
// single writer of the canonical connection phase. Driving the transport
// through connect/disconnect must move lib/event-stream/connection-state —
// with no involvement from useConfigStore.

const asPipelineSdk = (sdk: {
  global: { event(): Promise<{ stream: AsyncIterable<unknown> }> }
}): EventPipelineInput["sdk"] => sdk as unknown as EventPipelineInput["sdk"]

const idleSdk = asPipelineSdk({
  global: {
    event: async () => ({
      stream: {
        // WS mode never touches the SDK stream; keep it open and empty.
        [Symbol.asyncIterator]() {
          return {
            next: () => new Promise<IteratorResult<unknown>>(() => {}),
          }
        },
      },
    }),
  },
})

let saved: SavedEnvironment
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
const cleanups: Array<() => void> = []

const resetConnectionState = () => {
  useConnectionStore.setState({ phase: "connecting", hasEverConnected: false, lastDisconnectReason: null })
}

const waitFor = async (condition: () => boolean, budgetMs = 2_000) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > budgetMs) {
      throw new Error("waitFor timed out")
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

beforeEach(() => {
  saved = saveEnvironment()
  setNavigatorOnline(true)
  setVisibilityState("visible")
  installFakeWebSocket()
  resetConnectionState()
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  restoreEnvironment(saved)
  resetConnectionState()
  consoleErrorSpy.mockRestore()
})

describe("createEventPipeline — connection-state wiring (S4.7)", () => {
  it("marks the connection store connected on the WS ready acknowledgement", async () => {
    const pipeline = createEventPipeline({
      sdk: idleSdk,
      transport: "ws",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
    })
    cleanups.push(pipeline.cleanup)

    await waitFor(() => FakeWebSocket.instances.length > 0)
    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready", scope: "global" })

    await waitFor(() => selectIsConnected(useConnectionStore.getState()))
    expect(useConnectionStore.getState()).toEqual({
      phase: "connected",
      hasEverConnected: true,
      lastDisconnectReason: null,
    })
  })

  it("marks the connection store reconnecting with the reason when the stream drops", async () => {
    const pipeline = createEventPipeline({
      sdk: idleSdk,
      transport: "ws",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
    })
    cleanups.push(pipeline.cleanup)

    await waitFor(() => FakeWebSocket.instances.length > 0)
    const socket = FakeWebSocket.instances[0]
    socket.emitOpen()
    socket.emitMessage({ type: "ready", scope: "global" })
    await waitFor(() => selectIsConnected(useConnectionStore.getState()))

    socket.emitClose({ code: 1006 })

    await waitFor(() => useConnectionStore.getState().phase === "reconnecting")
    const state = useConnectionStore.getState()
    expect(state.hasEverConnected).toBe(true)
    expect(state.lastDisconnectReason).toBe("ws_closed:code=1006")
  })

  it("stays in connecting (not reconnecting) when the stream fails before the first connect", async () => {
    const pipeline = createEventPipeline({
      sdk: idleSdk,
      transport: "ws",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
    })
    cleanups.push(pipeline.cleanup)

    await waitFor(() => FakeWebSocket.instances.length > 0)
    FakeWebSocket.instances[0].emitClose({ code: 1006 })

    await waitFor(() => useConnectionStore.getState().lastDisconnectReason !== null)
    const state = useConnectionStore.getState()
    expect(state.phase).toBe("connecting")
    expect(state.hasEverConnected).toBe(false)
  })
})
