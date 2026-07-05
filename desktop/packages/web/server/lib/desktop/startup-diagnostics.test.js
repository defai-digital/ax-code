import { describe, expect, it } from "vitest"

import { createStartupDiagnosticsRuntime } from "./startup-diagnostics.js"

describe("startup diagnostics runtime", () => {
  it("records sanitized milestone events with relative timing", () => {
    let current = 1000
    const runtime = createStartupDiagnosticsRuntime({
      now: () => current,
      source: "test",
    })

    current = 1250
    runtime.markOnce("ax-code.process.launched", {
      via: "sdk-headless",
      token: "secret-token",
    })
    runtime.markOnce("ax-code.process.launched", { via: "duplicate" })

    const snapshot = runtime.snapshot()

    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.events[0]).toMatchObject({
      name: "ax-code.process.launched",
      source: "test",
      sinceStartMs: 250,
      details: {
        via: "sdk-headless",
        token: "[redacted]",
      },
    })
  })

  it("imports initial snapshot events and caps retained history", () => {
    const runtime = createStartupDiagnosticsRuntime({
      now: () => 2000,
      source: "server",
      maxEvents: 2,
      initialSnapshot: {
        bootId: "boot-a",
        startedAtEpochMs: 1000,
        events: [{ name: "electron.app.ready", source: "electron-main", atEpochMs: 1100 }],
      },
    })

    runtime.record("server.start")
    runtime.record("server.ready")

    const snapshot = runtime.snapshot()

    expect(snapshot.bootId).toBe("boot-a")
    expect(snapshot.events.map((event) => event.name)).toEqual(["server.start", "server.ready"])
  })

  it("normalizes non-empty string fields from snapshots and records", () => {
    const runtime = createStartupDiagnosticsRuntime({
      now: () => 2000,
      source: "server",
      initialSnapshot: {
        bootId: " boot-a ",
        startedAtEpochMs: 1000,
        events: [{ name: " electron.app.ready ", source: " electron-main ", atEpochMs: 1100 }],
      },
    })

    runtime.record(" server.ready ")

    const snapshot = runtime.snapshot()

    expect(snapshot.bootId).toBe("boot-a")
    expect(snapshot.events).toEqual([
      expect.objectContaining({
        name: "electron.app.ready",
        source: "electron-main",
      }),
      expect.objectContaining({
        name: "server.ready",
        source: "server",
      }),
    ])
  })
})
