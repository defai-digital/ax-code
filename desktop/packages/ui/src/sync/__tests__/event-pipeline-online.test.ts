import { afterEach, describe, expect, it } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline } from "../event-pipeline"
import {
  installEventPipelineBrowserGlobals,
  restoreBrowserGlobals,
  saveBrowserGlobals,
  setNavigatorOnline,
} from "./event-pipeline-test-helpers"

const savedGlobals = saveBrowserGlobals()

afterEach(() => {
  restoreBrowserGlobals(savedGlobals)
})

describe("createEventPipeline — online event", () => {
  it("does not spin reconnect attempts after the browser reports offline", async () => {
    const { windowTarget } = installEventPipelineBrowserGlobals({ visibilityState: "visible", onLine: true })

    let sdkCallCount = 0
    const sdk = {
      global: {
        event: async (options?: { signal?: AbortSignal }) => {
          sdkCallCount += 1
          const signal = options?.signal
          return {
            stream: (async function* () {
              yield {
                payload: {
                  type: "session.status",
                  properties: { sessionID: "s1", status: { type: "idle" } },
                },
              }
              await new Promise<never>((_, reject) => {
                if (signal?.aborted) {
                  reject(new DOMException("Aborted", "AbortError"))
                  return
                }
                signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
                  once: true,
                })
              })
            })(),
          }
        },
      },
    } as EventPipelineInput["sdk"]

    let cleanup = () => {}
    try {
      await new Promise<void>((resolve) => {
        ;({ cleanup } = createEventPipeline({
          sdk,
          transport: "sse",
          heartbeatTimeoutMs: 60_000,
          reconnectDelayMs: 50,
          onEvent: () => {},
          onReconnect: () => resolve(),
        }))
      })

      setNavigatorOnline(false)
      windowTarget.dispatch("offline")

      await new Promise((resolve) => setTimeout(resolve, 180))

      expect(sdkCallCount).toBe(1)

      setNavigatorOnline(true)
      windowTarget.dispatch("online")

      await new Promise<void>((resolve, reject) => {
        const started = Date.now()
        const tick = () => {
          if (sdkCallCount >= 2) {
            resolve()
            return
          }
          if (Date.now() - started > 500) {
            reject(new Error("online did not wake offline retry sleep"))
            return
          }
          setTimeout(tick, 10)
        }
        tick()
      })
    } finally {
      cleanup()
    }
  })

  it("cuts the inter-attempt wait short when `online` fires after disconnect", async () => {
    const { windowTarget } = installEventPipelineBrowserGlobals({ visibilityState: "visible", onLine: false })

    let sdkCallIndex = 0
    const sdk = {
      global: {
        event: async () => {
          const idx = sdkCallIndex++
          if (idx === 0) {
            // Force a real failure so the loop enters the offline backoff path
            // (computeRetryDelay returns the long cap because navigator.onLine
            // is false). Without our `online` interrupt this would wait the
            // full hidden/offline cap of 60s and the test would time out.
            throw new Error("simulated network error")
          }
          return {
            stream: (async function* () {
              yield {
                payload: {
                  type: "session.status",
                  properties: { sessionID: "s1", status: { type: "idle" } },
                },
              }
              await new Promise(() => {})
            })(),
          }
        },
      },
    } as EventPipelineInput["sdk"]

    const startedAt = Date.now()
    const elapsed = await new Promise<number>((resolve) => {
      let connects = 0
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "sse",
        heartbeatTimeoutMs: 60_000,
        reconnectDelayMs: 60_000,
        onEvent: () => {},
        onDisconnect: () => {
          // We're now inside waitForRetry on the long offline cap.
          // Flip the browser back online and fire the event; waitForRetry
          // should resolve early and the next attempt should fire.
          setTimeout(() => {
            setNavigatorOnline(true)
            windowTarget.dispatch("online")
          }, 30)
        },
        onReconnect: () => {
          connects += 1
          if (connects === 1) {
            cleanup()
            resolve(Date.now() - startedAt)
          }
        },
      })
    })

    // Two attempts: the failed one + the recovery one. If the `online`
    // interrupt didn't fire, the test would have hung on the 60s offline cap.
    expect(sdkCallIndex).toBe(2)
    expect(elapsed).toBeLessThan(2_000)
  })
})
