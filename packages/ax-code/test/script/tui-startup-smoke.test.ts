import { describe, expect, test } from "vitest"
import {
  isNodePtyDebugFallbackNoise,
  rendererProfileFromStartupEvents,
  tuiStartupWorkerReadyTimeoutMs,
} from "../../script/tui-startup-smoke"

describe("tui startup smoke", () => {
  test("identifies node-pty debug fallback loader noise", () => {
    const error = new Error("Cannot find module '../build/Debug/pty.node'")
    error.stack = [
      "Error: Cannot find module '../build/Debug/pty.node'",
      "    at /repo/node_modules/node-pty-prebuilt-multiarch/lib/prebuild-loader.js:13:17",
    ].join("\n")

    expect(isNodePtyDebugFallbackNoise(["innerError", error])).toBe(true)
  })

  test("does not treat unrelated console errors as node-pty loader noise", () => {
    const error = new Error("Cannot find module '../build/Debug/pty.node'")

    expect(isNodePtyDebugFallbackNoise(["innerError", error])).toBe(false)
    expect(isNodePtyDebugFallbackNoise(["innerError", new Error("different failure")])).toBe(false)
    expect(isNodePtyDebugFallbackNoise(["other", error])).toBe(false)
  })

  test("extracts the renderer profile from startup diagnostics", () => {
    expect(
      rendererProfileFromStartupEvents([
        { eventType: "tui.backendReady", data: {} },
        {
          eventType: "tui.startup.rendererProfile",
          data: {
            profile: "advanced",
            useThread: true,
            screenMode: "alternate-screen",
          },
        },
      ]),
    ).toBe("advanced")
  })

  test("ignores malformed renderer profile diagnostics", () => {
    expect(rendererProfileFromStartupEvents([])).toBeUndefined()
    expect(rendererProfileFromStartupEvents([{ eventType: "tui.startup.rendererProfile", data: null }])).toBeUndefined()
    expect(
      rendererProfileFromStartupEvents([{ eventType: "tui.startup.rendererProfile", data: { profile: 1 } }]),
    ).toBeUndefined()
  })

  test("sizes backend ready timeout for fresh startup work", () => {
    expect(tuiStartupWorkerReadyTimeoutMs(20_000, {})).toBe("15000")
    expect(tuiStartupWorkerReadyTimeoutMs(8_000, {})).toBe("8000")
    expect(tuiStartupWorkerReadyTimeoutMs(20_000, { AX_CODE_TUI_WORKER_READY_TIMEOUT_MS: "30000" })).toBe("30000")
    expect(tuiStartupWorkerReadyTimeoutMs(20_000, { AX_CODE_TUI_WORKER_READY_TIMEOUT_MS: "0" })).toBe("15000")
  })
})
