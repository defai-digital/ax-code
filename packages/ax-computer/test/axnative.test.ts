import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, test, vi } from "vitest"
import { AXNativeProvider, defaultAxnativeCommand } from "../src/providers/axnative"
import type { McpCallToolResult } from "../src/mcp/stdio-client"
import { FakeMcpClient, ocu } from "./fixtures"

const buildDir = fileURLToPath(new URL("../native/ax-computer-driver/.build", import.meta.url))
const releaseBinary = path.join(buildDir, "release", "ax-computer-driver")
const debugBinary = path.join(buildDir, "debug", "ax-computer-driver")

/** expose the protected resolution chain for assertions */
class TestProvider extends AXNativeProvider {
  resolvedCommand() {
    return this.resolveCommand()
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("defaultAxnativeCommand", () => {
  test("prefers the release build product", () => {
    expect(defaultAxnativeCommand(() => true)).toBe(releaseBinary)
  })

  test("falls back to the debug build product when release is absent", () => {
    expect(defaultAxnativeCommand((candidate) => candidate === debugBinary)).toBe(debugBinary)
  })

  test("falls back to the PATH name when nothing is built", () => {
    expect(defaultAxnativeCommand(() => false)).toBe("ax-computer-driver")
  })
})

describe("AXNativeProvider command resolution", () => {
  test("config.command wins over env and built binaries", () => {
    vi.stubEnv("AX_COMPUTER_AXNATIVE_COMMAND", "/env/ax-computer-driver")
    expect(new TestProvider({ command: "/config/ax-computer-driver" }).resolvedCommand()).toBe(
      "/config/ax-computer-driver",
    )
  })

  test("AX_COMPUTER_AXNATIVE_COMMAND wins over built binaries", () => {
    vi.stubEnv("AX_COMPUTER_AXNATIVE_COMMAND", "/env/ax-computer-driver")
    // host-independent: env must be consulted before any build product,
    // whether or not this machine has one built
    expect(new TestProvider().resolvedCommand()).toBe("/env/ax-computer-driver")
  })

  test("without config or env, resolves to the built binary or the PATH name", () => {
    vi.stubEnv("AX_COMPUTER_AXNATIVE_COMMAND", undefined)
    const resolved = new TestProvider().resolvedCommand()
    expect([releaseBinary, debugBinary, "ax-computer-driver"]).toContain(resolved)
  })
})

describe("AXNativeProvider MCP surface", () => {
  function makeProvider(handler?: (tool: string) => McpCallToolResult) {
    const client = new FakeMcpClient((tool) =>
      handler ? handler(tool) : tool === "get_app_state" ? ocu.appState : ocu.clickOk,
    )
    return { client, provider: new AXNativeProvider({ client }) }
  }

  test("provider name is axnative and stamps observations/results", async () => {
    const { provider } = makeProvider(() => ocu.appState)
    expect(provider.name).toBe("axnative")

    const observation = await provider.observe({ app: "TextEdit" })
    expect(observation.provider).toBe("axnative")

    const result = await provider.act({ type: "click", target: { kind: "element", id: "0" } })
    expect(result.provider).toBe("axnative")
  })

  test("uses the same MCP tool names as the ocu surface", async () => {
    const { client, provider } = makeProvider((tool) =>
      tool === "get_app_state" || tool === "list_apps" ? ocu.appState : ocu.clickOk,
    )
    await provider.listApps()
    await provider.observe({ app: "TextEdit" })
    await provider.act({ type: "click", target: { kind: "element", id: "0" } })
    await provider.act({ type: "type", text: "hello" })
    await provider.act({ type: "keypress", keys: ["cmd", "n"] })
    await provider.act({ type: "scroll", direction: "down" })
    await provider.act({ type: "drag", from: { kind: "point", x: 1, y: 2 }, to: { kind: "point", x: 3, y: 4 } })
    await provider.act({ type: "set_value", target: { kind: "element", id: "1" }, value: "42" })

    expect(client.calls.map((call) => call.tool)).toEqual([
      "list_apps",
      "get_app_state",
      "click",
      "type_text",
      "press_key",
      "scroll",
      "drag",
      "set_value",
    ])
  })
})
