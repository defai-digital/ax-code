import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline } from "../event-pipeline"
import {
  FakeWebSocket,
  installFakeWebSocket,
  restoreEnvironment,
  saveEnvironment,
  setNavigatorOnline,
  setVisibilityState,
  type SavedEnvironment,
} from "@/lib/event-stream/test-fakes"

// Pins two transport-error behaviors against realistic SDK/driver shapes:
//  1. The SDK's SSE client is lazy — HTTP failures surface via onSseError and
//     the generator then ends cleanly (createSseClient with
//     sseMaxRetryAttempts: 0). A frame-less clean end after such an error is
//     an attempt failure (status-classified backoff + onDisconnect), not a
//     clean completion.
//  2. The exact onDisconnect reason strings for WS-only failures.

type SseOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
  onSseEvent?: (event: { id?: string }) => void
  onSseError?: (error: unknown) => void
}

const asPipelineSdk = (sdk: {
  global: { event(options?: SseOptions): Promise<{ stream: AsyncIterable<unknown> }> }
}): EventPipelineInput["sdk"] => sdk as unknown as EventPipelineInput["sdk"]

let saved: SavedEnvironment
let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  saved = saveEnvironment()
  setNavigatorOnline(true)
  setVisibilityState("visible")
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  restoreEnvironment(saved)
  consoleErrorSpy.mockRestore()
})

const waitFor = async (condition: () => boolean, budgetMs = 2_000) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > budgetMs) {
      throw new Error("waitFor timed out")
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("createEventPipeline — lazy SDK SSE failures", () => {
  it("treats a frame-less stream that ends after onSseError as a failed attempt (404 → long cap)", async () => {
    let sdkCalls = 0
    const sdk = asPipelineSdk({
      global: {
        event: async (options?: SseOptions) => {
          sdkCalls += 1
          // Mirrors createSseClient: the fetch fails inside the generator, the
          // error is reported via onSseError as a plain message-only Error,
          // and the stream then ends without yielding anything.
          return {
            stream: {
              [Symbol.asyncIterator]() {
                let reported = false
                return {
                  async next() {
                    if (!reported) {
                      reported = true
                      options?.onSseError?.(new Error("SSE failed: 404 Not Found"))
                    }
                    return { done: true, value: undefined }
                  },
                }
              },
            },
          }
        },
      },
    })

    const reasons: string[] = []
    const { cleanup } = createEventPipeline({
      sdk,
      transport: "sse",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
      onDisconnect: (reason) => reasons.push(reason),
    })

    try {
      await waitFor(() => reasons.length > 0)
      expect(reasons[0]).toBe("sse_error:SSE failed: 404 Not Found")

      // Permanent 4xx → 60s long cap: no hot 250ms retry loop.
      await new Promise((resolve) => setTimeout(resolve, 600))
      expect(sdkCalls).toBe(1)
    } finally {
      cleanup()
    }
  })

  it("keeps clean-completion behavior when the stream delivered frames before ending", async () => {
    let sdkCalls = 0
    const sdk = asPipelineSdk({
      global: {
        event: async (options?: SseOptions) => {
          sdkCalls += 1
          return {
            stream: (async function* () {
              yield {
                payload: {
                  type: "session.status",
                  properties: { sessionID: "s1", status: { type: "idle" } },
                },
              }
              // Mid-stream server close: the SDK reports it and ends cleanly.
              options?.onSseError?.(new Error("SSE stream ended"))
            })(),
          }
        },
      },
    })

    const reasons: string[] = []
    const { cleanup } = createEventPipeline({
      sdk,
      transport: "sse",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
      onDisconnect: (reason) => reasons.push(reason),
    })

    try {
      // Clean completion re-loops on the 250ms base — no failure classification.
      await waitFor(() => sdkCalls >= 2)
      expect(reasons).toEqual([])
    } finally {
      cleanup()
    }
  })
})

describe("createEventPipeline — WS-only failure reason strings", () => {
  const sseNeverUsedSdk = asPipelineSdk({
    global: {
      event: async () => {
        throw new Error("SSE should not be used in ws mode")
      },
    },
  })

  it("reports ws_error:<message> when the ready wait times out", async () => {
    installFakeWebSocket()

    const reasons: string[] = []
    const { cleanup } = createEventPipeline({
      sdk: sseNeverUsedSdk,
      transport: "ws",
      wsReadyTimeoutMs: 20,
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
      onDisconnect: (reason) => reasons.push(reason),
    })

    try {
      await waitFor(() => reasons.length > 0)
      expect(reasons[0]).toBe("ws_error:Message stream WebSocket ready timeout")
    } finally {
      cleanup()
    }
  })

  it("reports ws_closed_before_ready when the socket closes before the ready frame", async () => {
    installFakeWebSocket()

    const reasons: string[] = []
    const { cleanup } = createEventPipeline({
      sdk: sseNeverUsedSdk,
      transport: "ws",
      heartbeatTimeoutMs: 60_000,
      onEvent: () => {},
      onDisconnect: (reason) => reasons.push(reason),
    })

    try {
      await Promise.resolve()
      FakeWebSocket.instances[0].emitClose({ code: 1006 })
      await waitFor(() => reasons.length > 0)
      expect(reasons[0]).toBe("ws_closed_before_ready")
    } finally {
      cleanup()
    }
  })
})
