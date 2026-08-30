import { afterEach, describe, expect, it, vi } from "vitest"

import { createSessionRuntime } from "./session-runtime.js"

describe("session runtime", () => {
  const runtimes = []

  afterEach(() => {
    for (const runtime of runtimes) {
      runtime.dispose()
    }
    runtimes.length = 0
  })

  it("invokes onActivityChange on every phase transition, including cooldown expiry", async () => {
    vi.useFakeTimers()
    try {
      const changes = []
      const runtime = createSessionRuntime({
        writeSseEvent() {},
        getNotificationClients: () => new Set(),
        broadcastEvent() {},
        onActivityChange: () => changes.push(Date.now()),
      })
      runtimes.push(runtime)

      const busy = {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "busy" } },
      }
      const idle = {
        type: "session.status",
        properties: { sessionID: "session-1", status: { type: "idle" } },
      }

      runtime.processAxCodeSsePayload(busy)
      expect(changes).toHaveLength(1) // idle -> busy
      expect(runtime.getSessionActivitySnapshot()["session-1"].type).toBe("busy")

      runtime.processAxCodeSsePayload(idle)
      expect(changes).toHaveLength(2) // busy -> cooldown
      expect(runtime.getSessionActivitySnapshot()["session-1"].type).toBe("cooldown")

      await vi.advanceTimersByTimeAsync(2_000)
      expect(changes).toHaveLength(3) // cooldown timer -> idle
      expect(runtime.getSessionActivitySnapshot()["session-1"].type).toBe("idle")

      // A repeated busy status with no phase change does not fire again.
      runtime.processAxCodeSsePayload(busy)
      const afterBusy = changes.length
      runtime.processAxCodeSsePayload(busy)
      expect(changes.length).toBe(afterBusy)
    } finally {
      vi.useRealTimers()
    }
  })

  it("broadcasts attention clears through the shared broadcaster", () => {
    const events = []
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error("SSE fallback should not be used when broadcastEvent is provided")
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload)
      },
    })
    runtimes.push(runtime)

    runtime.processAxCodeSsePayload({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "busy",
        },
      },
    })
    runtime.markUserMessageSent("session-1")
    runtime.processAxCodeSsePayload({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "idle",
        },
      },
    })
    runtime.markSessionViewed("session-1", "client-1")

    expect(events).toContainEqual({
      type: "openchamber:session-status",
      properties: expect.objectContaining({
        sessionID: "session-1",
        status: "idle",
        needsAttention: true,
      }),
    })
    expect(events.at(-1)).toEqual({
      type: "openchamber:session-status",
      properties: {
        sessionID: "session-1",
        status: "idle",
        timestamp: expect.any(Number),
        metadata: {},
        needsAttention: false,
      },
    })
  })

  it("trims legacy session.status info.type payload fields", () => {
    const events = []
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error("SSE fallback should not be used when broadcastEvent is provided")
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload)
      },
    })
    runtimes.push(runtime)

    runtime.processAxCodeSsePayload({
      type: "session.status",
      properties: {
        sessionID: " legacy-session-1 ",
        info: {
          type: " busy ",
        },
      },
    })

    expect(events).toContainEqual({
      type: "openchamber:session-status",
      properties: expect.objectContaining({
        sessionID: "legacy-session-1",
        status: "busy",
      }),
    })
  })

  it("broadcasts idle activity when cooldown expires", () => {
    vi.useFakeTimers()
    const events = []
    const runtime = createSessionRuntime({
      writeSseEvent() {
        throw new Error("SSE fallback should not be used when broadcastEvent is provided")
      },
      getNotificationClients: () => new Set(),
      broadcastEvent: (payload) => {
        events.push(payload)
      },
    })

    try {
      runtime.processAxCodeSsePayload({
        type: "session.status",
        properties: {
          sessionID: "session-activity-1",
          status: {
            type: "busy",
          },
        },
      })
      runtime.processAxCodeSsePayload({
        type: "session.status",
        properties: {
          sessionID: "session-activity-1",
          status: {
            type: "idle",
          },
        },
      })

      const activityPhases = () =>
        events.filter((event) => event.type === "openchamber:session-activity").map((event) => event.properties.phase)

      expect(activityPhases()).toEqual(["busy", "cooldown"])

      vi.advanceTimersByTime(1999)
      expect(activityPhases()).toEqual(["busy", "cooldown"])

      vi.advanceTimersByTime(1)

      expect(activityPhases()).toEqual(["busy", "cooldown", "idle"])
    } finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })
})
