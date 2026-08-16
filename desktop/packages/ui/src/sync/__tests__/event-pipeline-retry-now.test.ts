import { afterEach, describe, expect, it } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline, requestSyncRetryNow, SYNC_RETRY_NOW_EVENT } from "../event-pipeline"
import { createEventTarget, type TestEventTarget } from "./event-pipeline-test-helpers"

const savedDocument = globalThis.document
const savedWindow = globalThis.window
const savedNavigator = globalThis.navigator

afterEach(() => {
  globalThis.document = savedDocument
  globalThis.window = savedWindow
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: savedNavigator,
  })
})

describe("createEventPipeline — UI-triggered retry now", () => {
  it("wakes a disconnected retry sleep on openchamber:sync-retry-now event", async () => {
    globalThis.document = {
      visibilityState: "hidden",
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Document
    const windowTarget: TestEventTarget = createEventTarget({
      location: {
        href: "http://127.0.0.1:3000/",
        origin: "http://127.0.0.1:3000",
      },
    })
    // Bridge the real DOM API used by requestSyncRetryNow onto the fake target.
    windowTarget.dispatchEvent = (event: { type: string }) => windowTarget.dispatch(event.type)
    globalThis.window = windowTarget as unknown as Window & typeof globalThis
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    })

    let cleanup = () => {}
    let sdkCallCount = 0
    let resolveSecondAttempt: () => void = () => {}
    const secondAttemptStarted = new Promise<void>((resolve) => {
      resolveSecondAttempt = resolve
    })

    const sdk = {
      global: {
        event: async () => {
          sdkCallCount += 1
          if (sdkCallCount === 1) {
            throw new Error("offline")
          }
          resolveSecondAttempt()
          return {
            stream: (async function* () {
              yield {
                payload: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
              }
              await new Promise(() => {})
            })(),
          }
        },
      },
    } as EventPipelineInput["sdk"]

    try {
      ;({ cleanup } = createEventPipeline({
        sdk,
        transport: "sse",
        heartbeatTimeoutMs: 60_000,
        reconnectDelayMs: 60_000,
        onEvent: () => {},
      }))

      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(SYNC_RETRY_NOW_EVENT).toBe("openchamber:sync-retry-now")
      requestSyncRetryNow()

      await Promise.race([
        secondAttemptStarted,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("retry now did not wake retry sleep")), 250)),
      ])

      expect(sdkCallCount).toBe(2)
    } finally {
      cleanup()
    }
  })
})
