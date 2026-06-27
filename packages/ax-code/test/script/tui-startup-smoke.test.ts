import { describe, expect, test } from "vitest"
import { isNodePtyDebugFallbackNoise } from "../../script/tui-startup-smoke"

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
})
