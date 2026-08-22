import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import type { McpCallToolResult } from "../src/mcp/stdio-client"
import { CuaProvider } from "../src/providers/cua"
import { FakeMcpClient, PNG_BASE64, cua } from "./fixtures"

const server = fileURLToPath(new URL("./helpers/fake-mcp-server.mjs", import.meta.url))

function makeProvider(handler?: (tool: string) => McpCallToolResult) {
  const client = new FakeMcpClient((tool) => {
    if (handler) return handler(tool)
    switch (tool) {
      case "list_apps":
        return cua.listApps
      case "list_windows":
        return cua.listWindows
      case "get_window_state":
        return cua.windowState
      case "get_desktop_state":
        return cua.desktopState
      default:
        return cua.ok
    }
  })
  return { client, provider: new CuaProvider({ client }) }
}

/** drive the provider through the standard observe({ app }) flow */
async function observeApp(provider: CuaProvider) {
  return provider.observe({ app: "TextEdit" })
}

describe("CuaProvider", () => {
  test("observe({ app }) resolves pid and key window, then maps get_window_state", async () => {
    const { client, provider } = makeProvider()
    const observation = await observeApp(provider)

    expect(client.calls.map((call) => call.tool)).toEqual(["list_apps", "list_windows", "get_window_state"])
    expect(client.calls[1]?.args).toEqual({ pid: 4242 })
    expect(client.calls[2]?.args).toEqual({ pid: 4242, window_id: 101 })

    expect(observation.provider).toBe("cua")
    expect(observation.app).toEqual({ name: "TextEdit", pid: 4242 })
    expect(observation.window).toEqual({
      id: "101",
      title: "Untitled",
      bounds: { x: 50, y: 50, width: 800, height: 600 },
      app: { name: "TextEdit", pid: 4242 },
    })
    expect(observation.screenshot).toEqual({ data: PNG_BASE64, mimeType: "image/png", width: 640, height: 480 })
    expect(observation.a11yText).toContain("AXButton")
    expect(observation.elements).toEqual([
      {
        id: "snap-1:0",
        role: "AXButton",
        name: "Save",
        value: undefined,
        bounds: { x: 10, y: 20, width: 80, height: 24 },
      },
      {
        id: "1",
        role: "AXTextArea",
        name: "Editor",
        value: undefined,
        bounds: { x: 0, y: 60, width: 800, height: 540 },
      },
    ])
    expect(observation.raw).toBe(cua.windowState)
  })

  test("observe({ windowId }) resolves the pid via list_windows", async () => {
    const { client, provider } = makeProvider()
    const observation = await provider.observe({ windowId: "101" })
    expect(client.calls.map((call) => call.tool)).toEqual(["list_windows", "get_window_state"])
    expect(observation.window?.id).toBe("101")
  })

  test("observe({ windowId }) rejects unknown windows", async () => {
    const { provider } = makeProvider()
    await expect(provider.observe({ windowId: "999" })).rejects.toMatchObject({ code: "provider_error" })
  })

  test("observe({ desktop }) maps get_desktop_state", async () => {
    const { client, provider } = makeProvider()
    const observation = await provider.observe({ desktop: true })
    expect(client.lastCall()).toEqual({ tool: "get_desktop_state", args: {} })
    expect(observation.screenshot).toMatchObject({ data: PNG_BASE64, width: 2560, height: 1440 })
    expect(observation.elements).toEqual([])
  })

  test("observe({ app }) fails when the app is not running", async () => {
    const { provider } = makeProvider(() => cua.listApps)
    await expect(provider.observe({ app: "NotInstalled" })).rejects.toMatchObject({ code: "provider_error" })
  })

  test("click maps element targets to element_token / element_index with routing", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)

    await provider.act({ type: "click", target: { kind: "element", id: "snap-1:0" } })
    expect(client.lastCall()).toEqual({
      tool: "click",
      args: { pid: 4242, window_id: 101, element_token: "snap-1:0" },
    })

    await provider.act({ type: "click", target: { kind: "element", id: "1" } })
    expect(client.lastCall()).toEqual({
      tool: "click",
      args: { pid: 4242, window_id: 101, element_index: 1 },
    })
  })

  test("click maps point targets, count 2 to double_click, right button to right_click", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)

    await provider.act({ type: "click", target: { kind: "point", x: 100, y: 200 } })
    expect(client.lastCall()).toEqual({ tool: "click", args: { pid: 4242, window_id: 101, x: 100, y: 200 } })

    await provider.act({ type: "click", target: { kind: "point", x: 100, y: 200 }, count: 2 })
    expect(client.lastCall()).toEqual({ tool: "double_click", args: { pid: 4242, window_id: 101, x: 100, y: 200 } })

    await provider.act({ type: "click", target: { kind: "point", x: 100, y: 200 }, button: "right" })
    expect(client.lastCall()).toEqual({ tool: "right_click", args: { pid: 4242, window_id: 101, x: 100, y: 200 } })

    await provider.act({ type: "click", target: { kind: "point", x: 100, y: 200 }, button: "middle" })
    expect(client.lastCall()).toEqual({
      tool: "click",
      args: { pid: 4242, window_id: 101, x: 100, y: 200, button: "middle" },
    })
  })

  test("desktop-scope point clicks use screen coordinates", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ desktop: true })
    await provider.act({ type: "click", target: { kind: "point", x: 5, y: 6 } })
    expect(client.lastCall()).toEqual({ tool: "click", args: { x: 5, y: 6, scope: "desktop" } })
  })

  test("desktop-scope double/right clicks stay on the click tool", async () => {
    // double_click/right_click require pid and reject `scope`, so a desktop
    // context must route button/count through the plain click tool instead
    const { client, provider } = makeProvider()
    await provider.observe({ desktop: true })

    await provider.act({ type: "click", target: { kind: "point", x: 5, y: 6 }, count: 2 })
    expect(client.lastCall()).toEqual({ tool: "click", args: { x: 5, y: 6, scope: "desktop", count: 2 } })

    await provider.act({ type: "click", target: { kind: "point", x: 5, y: 6 }, button: "right" })
    expect(client.lastCall()).toEqual({ tool: "click", args: { x: 5, y: 6, scope: "desktop", button: "right" } })
  })

  test("desktop-scope type, keypress and drag route with scope: desktop", async () => {
    // without scope:"desktop" the backend rejects these calls with a
    // missing-pid error (type_text/press_key/hotkey/drag require pid otherwise)
    const { client, provider } = makeProvider()
    await provider.observe({ desktop: true })

    await provider.act({ type: "type", text: "hi" })
    expect(client.lastCall()).toEqual({ tool: "type_text", args: { scope: "desktop", text: "hi" } })

    await provider.act({ type: "keypress", keys: ["a"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { scope: "desktop", key: "a" } })

    await provider.act({ type: "keypress", keys: ["cmd", "s"] })
    expect(client.lastCall()).toEqual({ tool: "hotkey", args: { scope: "desktop", keys: ["cmd", "s"] } })

    await provider.act({ type: "drag", from: { kind: "point", x: 1, y: 2 }, to: { kind: "point", x: 3, y: 4 } })
    expect(client.lastCall()).toEqual({
      tool: "drag",
      args: { scope: "desktop", from_x: 1, from_y: 2, to_x: 3, to_y: 4 },
    })
  })

  test("target-less scroll after a desktop observe anchors at the screenshot center", async () => {
    const { client, provider } = makeProvider()
    await provider.observe({ desktop: true })
    await provider.act({ type: "scroll", direction: "down" })
    expect(client.lastCall()).toEqual({
      tool: "scroll",
      args: { x: 1280, y: 720, scope: "desktop", direction: "down", amount: 3 },
    })
  })

  test("scroll with an element target passes the element through", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)
    await provider.act({ type: "scroll", direction: "up", target: { kind: "element", id: "snap-1:0" } })
    expect(client.lastCall()).toEqual({
      tool: "scroll",
      args: { pid: 4242, window_id: 101, element_token: "snap-1:0", direction: "up", amount: 3 },
    })
  })

  test("type, keypress (single vs. combo) and scroll map to cua tools", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)

    await provider.act({ type: "type", text: "hello" })
    expect(client.lastCall()).toEqual({ tool: "type_text", args: { pid: 4242, window_id: 101, text: "hello" } })

    await provider.act({ type: "keypress", keys: ["return"] })
    expect(client.lastCall()).toEqual({ tool: "press_key", args: { pid: 4242, window_id: 101, key: "return" } })

    await provider.act({ type: "keypress", keys: ["cmd", "s"] })
    expect(client.lastCall()).toEqual({ tool: "hotkey", args: { pid: 4242, window_id: 101, keys: ["cmd", "s"] } })

    await provider.act({ type: "scroll", direction: "down", amount: 5 })
    expect(client.lastCall()).toEqual({
      tool: "scroll",
      args: { pid: 4242, window_id: 101, x: 320, y: 240, direction: "down", amount: 5 },
    })
  })

  test("drag resolves element endpoints to bounds centers", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)
    await provider.act({
      type: "drag",
      from: { kind: "element", id: "snap-1:0" },
      to: { kind: "point", x: 400, y: 300 },
    })
    expect(client.lastCall()).toEqual({
      tool: "drag",
      args: { pid: 4242, window_id: 101, from_x: 50, from_y: 32, to_x: 400, to_y: 300 },
    })
  })

  test("set_value maps element target and value", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)
    await provider.act({ type: "set_value", target: { kind: "element", id: "snap-1:0" }, value: "text" })
    expect(client.lastCall()).toEqual({
      tool: "set_value",
      args: { pid: 4242, window_id: 101, element_token: "snap-1:0", value: "text" },
    })
  })

  test("stale element ids are rejected before any tool call", async () => {
    const { client, provider } = makeProvider()
    await observeApp(provider)
    const callsBefore = client.calls.length
    await expect(provider.act({ type: "click", target: { kind: "element", id: "snap-9:9" } })).rejects.toMatchObject({
      code: "stale_target",
    })
    expect(client.calls.length).toBe(callsBefore)
  })

  test("activate_window resolves pid and calls bring_to_front", async () => {
    const { client, provider } = makeProvider()
    const result = await provider.act({ type: "activate_window", windowId: "101" })
    expect(client.calls.map((call) => call.tool)).toEqual(["list_windows", "bring_to_front"])
    expect(client.lastCall()).toEqual({ tool: "bring_to_front", args: { pid: 4242, window_id: 101 } })
    expect(result.ok).toBe(true)
  })

  test("launch_app maps to launch_app with the app name", async () => {
    const { client, provider } = makeProvider()
    await provider.act({ type: "launch_app", app: "TextEdit" })
    expect(client.lastCall()).toEqual({ tool: "launch_app", args: { name: "TextEdit" } })
  })

  test("backend refusal codes are carried verbatim", async () => {
    const { provider } = makeProvider((tool) => (tool === "click" ? cua.backgroundRefusal : cua.ok))
    await provider.observe({ desktop: true })
    const result = await provider.act({ type: "click", target: { kind: "point", x: 1, y: 1 } })
    expect(result).toMatchObject({ ok: false, provider: "cua", action: "click", refusal: "background_unavailable" })
  })

  test("a refusal recommending foreground escalation is retried once with delivery_mode", async () => {
    let typeCalls = 0
    const { client, provider } = makeProvider((tool) => {
      if (tool === "type_text") {
        typeCalls += 1
        return typeCalls === 1 ? cua.ambiguityRefusal : cua.ok
      }
      if (tool === "list_apps") return cua.listApps
      if (tool === "list_windows") return cua.listWindows
      if (tool === "get_window_state") return cua.windowState
      return cua.ok
    })
    await observeApp(provider)

    const result = await provider.act({ type: "type", text: "ax" })
    expect(result).toMatchObject({ ok: true, action: "type" })
    const calls = client.calls.filter((call) => call.tool === "type_text")
    expect(calls).toHaveLength(2)
    expect(calls[0]?.args).toEqual({ pid: 4242, window_id: 101, text: "ax" })
    expect(calls[1]?.args).toEqual({ pid: 4242, window_id: 101, text: "ax", delivery_mode: "foreground" })
  })

  test("escalation is also detected from the refusal text alone", async () => {
    let typeCalls = 0
    const { client, provider } = makeProvider((tool) => {
      if (tool === "type_text") {
        typeCalls += 1
        return typeCalls === 1 ? cua.ambiguityTextRefusal : cua.ok
      }
      if (tool === "list_apps") return cua.listApps
      if (tool === "list_windows") return cua.listWindows
      if (tool === "get_window_state") return cua.windowState
      return cua.ok
    })
    await observeApp(provider)

    const result = await provider.act({ type: "type", text: "ax" })
    expect(result.ok).toBe(true)
    expect(client.calls.filter((call) => call.tool === "type_text")).toHaveLength(2)
  })

  test("refusals without an escalation recommendation are not retried", async () => {
    const { client, provider } = makeProvider((tool) => {
      if (tool === "click") return cua.wrongTargetRefusal
      if (tool === "list_apps") return cua.listApps
      if (tool === "list_windows") return cua.listWindows
      if (tool === "get_window_state") return cua.windowState
      return cua.ok
    })
    await observeApp(provider)

    const result = await provider.act({ type: "click", target: { kind: "element", id: "snap-1:0" } })
    expect(result).toMatchObject({ ok: false, refusal: "wrong_target" })
    expect(client.calls.filter((call) => call.tool === "click")).toHaveLength(1)
  })

  test("a refusing retry is returned as-is, with exactly two calls", async () => {
    const { client, provider } = makeProvider((tool) => {
      if (tool === "type_text") return cua.ambiguityRefusal
      if (tool === "list_apps") return cua.listApps
      if (tool === "list_windows") return cua.listWindows
      if (tool === "get_window_state") return cua.windowState
      return cua.ok
    })
    await observeApp(provider)

    const result = await provider.act({ type: "type", text: "ax" })
    expect(result).toMatchObject({ ok: false, refusal: "same_pid_keyboard_ambiguity" })
    expect(client.calls.filter((call) => call.tool === "type_text")).toHaveLength(2)
  })

  test("tools without delivery_mode support are never escalated", async () => {
    const { client, provider } = makeProvider((tool) => {
      if (tool === "set_value") return cua.ambiguityRefusal
      if (tool === "list_apps") return cua.listApps
      if (tool === "list_windows") return cua.listWindows
      if (tool === "get_window_state") return cua.windowState
      return cua.ok
    })
    await observeApp(provider)

    const result = await provider.act({ type: "set_value", target: { kind: "element", id: "snap-1:0" }, value: "x" })
    expect(result).toMatchObject({ ok: false, refusal: "same_pid_keyboard_ambiguity" })
    expect(client.calls.filter((call) => call.tool === "set_value")).toHaveLength(1)
  })

  test("listApps and listWindows map structured content", async () => {
    const { provider } = makeProvider()
    expect(await provider.listApps()).toEqual([{ name: "TextEdit", pid: 4242, bundleId: "com.apple.TextEdit" }])
    expect(await provider.listWindows()).toEqual([
      {
        id: "101",
        title: "Untitled",
        bounds: { x: 50, y: 50, width: 800, height: 600 },
        app: { name: "TextEdit", pid: 4242 },
      },
    ])
  })

  test("capabilities advertise element, window and background support", () => {
    const { provider } = makeProvider()
    const caps = provider.capabilities()
    expect(caps.elementTargeting).toBe(true)
    expect(caps.windowActivation).toBe(true)
    expect(caps.backgroundDelivery).toBe(true)
    expect(caps.actions).toContain("activate_window")
  })

  test("concurrent first calls share a single spawned server process", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ax-computer-spawn-"))
    const countFile = path.join(dir, "spawns.txt")
    process.env.AX_FAKE_MCP_COUNT_FILE = countFile
    try {
      const provider = new CuaProvider({ command: process.execPath, args: [server, "slow-init"] })
      await Promise.all([provider.listApps(), provider.listApps()])
      await provider.dispose()
      const spawns = fs.readFileSync(countFile, "utf8").trim().split("\n")
      expect(spawns).toHaveLength(1)
    } finally {
      delete process.env.AX_FAKE_MCP_COUNT_FILE
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
