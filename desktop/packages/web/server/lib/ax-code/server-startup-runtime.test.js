import { describe, expect, it, vi } from "vitest"

import { createServerStartupRuntime } from "./server-startup-runtime.js"

const createRuntime = (env = {}) =>
  createServerStartupRuntime({
    process: {
      env,
      on: vi.fn(),
    },
    server: {},
    gracefulShutdown: vi.fn(),
    getSignalsAttached: () => false,
    setSignalsAttached: vi.fn(),
    syncToHmrState: vi.fn(),
  })

describe("server startup runtime", () => {
  it("prefers explicit bind host over env host", () => {
    const runtime = createRuntime({ AX_CODE_DESKTOP_HOST: " 0.0.0.0 " })

    expect(runtime.resolveBindHost("127.0.0.1")).toBe("127.0.0.1")
  })

  it("trims env bind host before using it", () => {
    const runtime = createRuntime({ AX_CODE_DESKTOP_HOST: " 0.0.0.0 " })

    expect(runtime.resolveBindHost()).toBe("0.0.0.0")
  })

  it("falls back to localhost when no host is configured", () => {
    const runtime = createRuntime({ AX_CODE_DESKTOP_HOST: "   " })

    expect(runtime.resolveBindHost()).toBe("127.0.0.1")
  })
})
