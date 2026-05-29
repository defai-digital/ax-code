import { describe, expect, test } from "bun:test"
import { assertTrustedRendererBridgeCall, createRendererDesktopBridge } from "../src/bridge/renderer-bridge"
import { parseBridgeCommand, validateBridgeSender } from "../src/bridge/schema"

describe("desktop bridge contract", () => {
  test("accepts only declared bridge commands with valid payloads", () => {
    expect(parseBridgeCommand("platform.capabilities", {}).name).toBe("platform.capabilities")
    expect(parseBridgeCommand("external.open", { url: "https://example.com" }).payload.url).toBe("https://example.com")
    expect(
      parseBridgeCommand("path.reveal", { path: "/workspace/ax-code/packages/app/src/App.tsx" }).payload.path,
    ).toBe("/workspace/ax-code/packages/app/src/App.tsx")
    expect(
      parseBridgeCommand("notification.show", {
        title: "Scheduled automation queued",
        body: "Daily branch review",
        source: "scheduled-task",
      }).payload.source,
    ).toBe("scheduled-task")

    expect(() => parseBridgeCommand("external.open", { url: "javascript:alert(1)" })).toThrow()
    expect(() => parseBridgeCommand("backend.start", { directory: "" })).toThrow()
    expect(() => parseBridgeCommand("path.reveal", { path: "" })).toThrow()
    expect(() => parseBridgeCommand("notification.show", { title: "", source: "unknown" })).toThrow()
  })

  test("validates desktop sender origin before privileged bridge calls", () => {
    expect(validateBridgeSender({ url: "app://ax-code/index.html" })).toBe(true)
    expect(validateBridgeSender({ url: "http://127.0.0.1:3137/" })).toBe(true)
    expect(validateBridgeSender({ url: "https://attacker.example/" })).toBe(false)
    expect(validateBridgeSender({ url: "file:///tmp/app.html" })).toBe(false)
  })

  test("never exposes a generic raw invoke without command parsing", async () => {
    const calls: Array<{ name: string; payload: unknown }> = []
    const bridge = createRendererDesktopBridge(async (name, payload) => {
      calls.push({ name, payload })
      return { ok: true }
    })

    await bridge.invoke("diagnostics.exportLogs", { includeBackendLogs: false })

    expect(calls).toEqual([{ name: "diagnostics.exportLogs", payload: { includeBackendLogs: false } }])
    expect(() =>
      assertTrustedRendererBridgeCall({ url: "https://attacker.example/" }, "diagnostics.exportLogs", {
        includeBackendLogs: false,
      }),
    ).toThrow()
  })
})
