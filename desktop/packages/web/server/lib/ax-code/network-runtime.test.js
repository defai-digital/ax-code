import { afterEach, describe, expect, it, vi } from "vitest"

import { createAxCodeNetworkRuntime } from "./network-runtime.js"

const createRuntime = () =>
  createAxCodeNetworkRuntime({
    state: {
      axCodePort: 4096,
      axCodeBaseUrl: null,
      axCodeApiPrefix: "",
      axCodeApiPrefixDetected: false,
      axCodeApiDetectionTimer: null,
    },
    getAxCodeAuthHeaders: () => ({}),
  })

describe("ax-code network runtime", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("clears the probe abort timer when readiness fetch rejects", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline")
      }),
    )

    const runtime = createRuntime()
    const readyPromise = runtime.waitForReady("http://127.0.0.1:4096", 1)

    await vi.advanceTimersByTimeAsync(100)
    await expect(readyPromise).resolves.toBe(false)

    expect(vi.getTimerCount()).toBe(0)
  })
})
