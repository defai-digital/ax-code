import { afterEach, describe, expect, it } from "vitest"
import type { EventPipelineInput } from "../event-pipeline"
import { createEventPipeline } from "../event-pipeline"
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

describe("createEventPipeline — system resume reconnect", () => {
  it("reconnects immediately on openchamber:system-resume event", async () => {
    globalThis.document = {
      visibilityState: "visible",
      addEventListener() {},
      removeEventListener() {},
    } as unknown as Document
    const windowTarget = createEventTarget({
      location: {
        href: "http://127.0.0.1:3000/",
        origin: "http://127.0.0.1:3000",
      },
    })
    globalThis.window = windowTarget as unknown as Window & typeof globalThis

    const disconnectReasons: string[] = []
    let reconnectCount = 0
    const eventCalls: number[] = []

    let sdkCallIndex = 0
    let releaseFirstStream: () => void = () => {}
    const firstHold = new Promise<void>((resolve) => {
      releaseFirstStream = resolve
    })

    const sdk = {
      global: {
        // Accept options with signal so the mock generator can abort.
        event: async (options?: { signal?: AbortSignal }) => {
          const callIndex = sdkCallIndex++
          eventCalls.push(callIndex)
          const signal = options?.signal
          if (callIndex === 0) {
            return {
              stream: (async function* () {
                yield {
                  payload: { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } },
                }
                // Wait for either the hold promise or abort signal.
                await Promise.race([
                  firstHold,
                  new Promise<never>((_, reject) => {
                    if (signal?.aborted) {
                      reject(signal.reason || new DOMException("Aborted", "AbortError"))
                      return
                    }
                    signal?.addEventListener("abort", () => {
                      reject(signal.reason || new DOMException("Aborted", "AbortError"))
                    })
                  }),
                ])
              })(),
            }
          }
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

    const recovered = new Promise<void>((resolve) => {
      const { cleanup } = createEventPipeline({
        sdk,
        transport: "sse",
        heartbeatTimeoutMs: 60_000,
        reconnectDelayMs: 60_000,
        onEvent: () => {},
        onDisconnect: (reason) => {
          disconnectReasons.push(reason)
        },
        onReconnect: () => {
          reconnectCount += 1
          // onReconnect fires on the initial connect too (count=1),
          // so wait for the second reconnect (count=2) triggered by resume.
          if (reconnectCount === 2) {
            cleanup()
            resolve()
          }
        },
      })

      // Wait for first SSE attempt to start and deliver the event, then
      // simulate OS resume by invoking the registered handler directly.
      setTimeout(() => {
        windowTarget.dispatch("openchamber:system-resume")
      }, 80)
    })

    await recovered
    releaseFirstStream()

    // Should have made two SDK calls: initial connect + reconnect after resume.
    expect(eventCalls.length).toBe(2)
    // Disconnect reason should include system_resume.
    expect(disconnectReasons.some((r) => r.includes("system_resume"))).toBe(true)
  })

  it("wakes a disconnected retry sleep on openchamber:system-resume event", async () => {
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
      windowTarget.dispatch("openchamber:system-resume")

      await Promise.race([
        secondAttemptStarted,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("resume did not wake retry sleep")), 250)),
      ])

      expect(sdkCallCount).toBe(2)
    } finally {
      cleanup()
    }
  })
})
