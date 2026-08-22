import { describe, expect, test } from "vitest"
import type { McpCallToolResult } from "../src/mcp/stdio-client"
import { CuaProvider, type CuaSdkDriver, type CuaSdkToolResult } from "../src/providers/cua"
import { FakeMcpClient, PNG_BASE64, cua } from "./fixtures"

/** map an MCP-shaped fixture to the SDK envelope (inverse of the adapter) */
function toSdkResult(result: McpCallToolResult): CuaSdkToolResult {
  const text: string[] = []
  const images: { mimeType: string; dataBase64: string }[] = []
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") text.push(block.text)
    if (block.type === "image" && typeof block.data === "string") {
      images.push({ mimeType: block.mimeType ?? "image/png", dataBase64: block.data })
    }
  }
  return {
    text: text.join("\n"),
    images,
    structuredJson: result.structuredContent === undefined ? undefined : JSON.stringify(result.structuredContent),
    isError: result.isError ?? false,
  }
}

/** scripted CuaSdkDriver for sdk-transport tests; records every call */
class FakeSdkDriver implements CuaSdkDriver {
  readonly calls: { tool: string; args: Record<string, unknown> }[] = []
  shutdowns = 0
  destroyed = false

  constructor(private readonly handler: (tool: string, args: Record<string, unknown>) => McpCallToolResult) {}

  async callTool(name: string, argumentsJson: string): Promise<CuaSdkToolResult> {
    const args = JSON.parse(argumentsJson) as Record<string, unknown>
    this.calls.push({ tool: name, args })
    return toSdkResult(this.handler(name, args))
  }

  async shutdown(): Promise<void> {
    this.shutdowns += 1
  }

  uniffiDestroy(): void {
    this.destroyed = true
  }

  lastCall(): { tool: string; args: Record<string, unknown> } {
    const call = this.calls[this.calls.length - 1]
    if (!call) throw new Error("FakeSdkDriver: no calls recorded")
    return call
  }
}

function makeProvider(handler?: (tool: string) => McpCallToolResult) {
  const driver = new FakeSdkDriver((tool) => {
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
  return { driver, provider: new CuaProvider({ transport: "sdk", driver }) }
}

/** drive the provider through the standard observe({ app }) flow */
async function observeApp(provider: CuaProvider) {
  return provider.observe({ app: "TextEdit" })
}

describe("CuaProvider sdk transport", () => {
  test("observe({ app }) routes the mcp tool sequence through driver.callTool", async () => {
    const { driver, provider } = makeProvider()
    const observation = await observeApp(provider)

    expect(driver.calls.map((call) => call.tool)).toEqual(["list_apps", "list_windows", "get_window_state"])
    expect(driver.calls[1]?.args).toEqual({ pid: 4242 })
    expect(driver.calls[2]?.args).toEqual({ pid: 4242, window_id: 101 })

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
  })

  test("observe({ desktop }) maps the envelope image and structured dimensions", async () => {
    const { driver, provider } = makeProvider()
    const observation = await provider.observe({ desktop: true })
    expect(driver.lastCall()).toEqual({ tool: "get_desktop_state", args: {} })
    expect(observation.screenshot).toMatchObject({ data: PNG_BASE64, width: 2560, height: 1440 })
    expect(observation.elements).toEqual([])
  })

  test("act serializes arguments to JSON and maps element routing", async () => {
    const { driver, provider } = makeProvider()
    await observeApp(provider)

    await provider.act({ type: "click", target: { kind: "element", id: "snap-1:0" } })
    expect(driver.lastCall()).toEqual({
      tool: "click",
      args: { pid: 4242, window_id: 101, element_token: "snap-1:0" },
    })

    await provider.act({ type: "type", text: "hello" })
    expect(driver.lastCall()).toEqual({ tool: "type_text", args: { pid: 4242, window_id: 101, text: "hello" } })

    await provider.act({ type: "keypress", keys: ["cmd", "s"] })
    expect(driver.lastCall()).toEqual({ tool: "hotkey", args: { pid: 4242, window_id: 101, keys: ["cmd", "s"] } })
  })

  test("activate_window resolves pid and calls bring_to_front", async () => {
    const { driver, provider } = makeProvider()
    const result = await provider.act({ type: "activate_window", windowId: "101" })
    expect(driver.calls.map((call) => call.tool)).toEqual(["list_windows", "bring_to_front"])
    expect(driver.lastCall()).toEqual({ tool: "bring_to_front", args: { pid: 4242, window_id: 101 } })
    expect(result.ok).toBe(true)
  })

  test("backend refusal codes are carried verbatim through the envelope", async () => {
    const { provider } = makeProvider((tool) => (tool === "click" ? cua.backgroundRefusal : cua.ok))
    await provider.observe({ desktop: true })
    const result = await provider.act({ type: "click", target: { kind: "point", x: 1, y: 1 } })
    expect(result).toMatchObject({ ok: false, provider: "cua", action: "click", refusal: "background_unavailable" })
  })

  test("a refusal recommending foreground escalation is retried once with delivery_mode", async () => {
    let typeCalls = 0
    const { driver, provider } = makeProvider((tool) => {
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
    const calls = driver.calls.filter((call) => call.tool === "type_text")
    expect(calls).toHaveLength(2)
    expect(calls[0]?.args).toEqual({ pid: 4242, window_id: 101, text: "ax" })
    expect(calls[1]?.args).toEqual({ pid: 4242, window_id: 101, text: "ax", delivery_mode: "foreground" })
  })

  test("dispose shuts the driver down and releases the binding handle", async () => {
    const { driver, provider } = makeProvider()
    await provider.listApps()
    await provider.dispose()
    expect(driver.shutdowns).toBe(1)
    expect(driver.destroyed).toBe(true)
  })

  test("a malformed structuredJson does not break observation", async () => {
    const driver: CuaSdkDriver = {
      async callTool() {
        return {
          text: "",
          images: [{ mimeType: "image/png", dataBase64: PNG_BASE64 }],
          structuredJson: "{not-json",
          isError: false,
        }
      },
      async shutdown() {},
    }
    const provider = new CuaProvider({ transport: "sdk", driver })
    const observation = await provider.observe({ desktop: true })
    // dimensions fall back to the PNG header (1x1 fixture) when the
    // structured payload cannot be parsed
    expect(observation.screenshot).toEqual({ data: PNG_BASE64, mimeType: "image/png", width: 1, height: 1 })
  })

  test("driver errors propagate to the caller", async () => {
    const driver: CuaSdkDriver = {
      async callTool() {
        throw new Error("native runtime unavailable")
      },
      async shutdown() {},
    }
    const provider = new CuaProvider({ transport: "sdk", driver })
    await expect(provider.listApps()).rejects.toThrow("native runtime unavailable")
  })

  test("the default transport stays mcp and never touches the sdk driver", async () => {
    // no transport given: the injected mcp client is used, driver is ignored
    const driver = new FakeSdkDriver(() => cua.ok)
    const client = new FakeMcpClient((tool) => (tool === "list_apps" ? cua.listApps : cua.ok))
    const provider = new CuaProvider({ client, driver })
    await provider.listApps()
    expect(client.calls.map((call) => call.tool)).toEqual(["list_apps"])
    expect(driver.calls).toEqual([])
  })
})
