import { describe, expect, it, vi } from "vitest"

import { createGlobalMessageStreamHub } from "./global-hub.js"
import { createSseResponse } from "./test-helpers.js"

async function waitForAssertion(assertion) {
  const deadline = Date.now() + 1000
  let lastError

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }

  throw lastError
}

describe("createGlobalMessageStreamHub", () => {
  it("continues fanout when an event subscriber throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const received = []
    const hub = createGlobalMessageStreamHub({
      buildAxCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getAxCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () =>
        createSseResponse({
          blocks: ['id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n'],
        }),
    })

    hub.subscribeEvent(() => {
      throw new Error("subscriber failed")
    })
    hub.subscribeEvent((event) => {
      received.push(event.eventId)
    })

    try {
      hub.start()
      await waitForAssertion(() => {
        expect(received).toEqual(["evt-1"])
      })
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      hub.stop()
      warnSpy.mockRestore()
    }
  })

  it("continues status fanout when a status subscriber throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const received = []
    const hub = createGlobalMessageStreamHub({
      buildAxCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getAxCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () => createSseResponse(),
    })

    hub.subscribeStatus(() => {
      throw new Error("status subscriber failed")
    })
    hub.subscribeStatus((status) => {
      received.push(status.type)
    })

    try {
      hub.start()
      await waitForAssertion(() => {
        expect(received).toContain("connect")
      })
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      hub.stop()
      warnSpy.mockRestore()
    }
  })

  it("replays the full buffer when the Last-Event-ID anchor has been evicted", async () => {
    const received = []
    const hub = createGlobalMessageStreamHub({
      buildAxCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getAxCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      replayLimit: 2,
      fetchImpl: async () =>
        createSseResponse({
          blocks: [
            'id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n',
            'id: evt-2\ndata: {"type":"session.updated","properties":{}}\n\n',
            'id: evt-3\ndata: {"type":"session.updated","properties":{}}\n\n',
          ],
        }),
    })

    hub.subscribeEvent((event) => {
      received.push(event.eventId)
    })

    try {
      hub.start()
      await waitForAssertion(() => {
        expect(received).toEqual(["evt-1", "evt-2", "evt-3"])
      })

      // evt-1 was evicted (replayLimit=2). A reconnect with Last-Event-ID=evt-1
      // must still recover the buffered events instead of getting nothing.
      expect(hub.replayAfter("evt-1").map((entry) => entry.eventId)).toEqual(["evt-2", "evt-3"])
      // A still-buffered anchor returns only events after it.
      expect(hub.replayAfter("evt-2").map((entry) => entry.eventId)).toEqual(["evt-3"])
      // No anchor → no replay (the client does a full bootstrap instead).
      expect(hub.replayAfter("")).toEqual([])
    } finally {
      hub.stop()
    }
  })

  it("continues fanout when an async event subscriber rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const received = []
    const hub = createGlobalMessageStreamHub({
      buildAxCodeUrl: (pathname) => `http://127.0.0.1:4096${pathname}`,
      getAxCodeAuthHeaders: () => ({}),
      upstreamReconnectDelayMs: 100,
      fetchImpl: async () =>
        createSseResponse({
          blocks: ['id: evt-1\ndata: {"type":"session.updated","properties":{}}\n\n'],
        }),
    })

    hub.subscribeEvent(async () => {
      throw new Error("async subscriber failed")
    })
    hub.subscribeEvent((event) => {
      received.push(event.eventId)
    })

    try {
      hub.start()
      await waitForAssertion(() => {
        expect(received).toEqual(["evt-1"])
      })
      await waitForAssertion(() => {
        expect(warnSpy).toHaveBeenCalled()
      })
    } finally {
      hub.stop()
      warnSpy.mockRestore()
    }
  })
})
