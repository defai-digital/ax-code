import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { parse as parseJsonc } from "jsonc-parser"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const bridge = vi.hoisted(() => ({
  names: [] as string[],
  launch: vi.fn(),
  call: vi.fn(),
  connectError: undefined as Error | undefined,
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {
      if (bridge.connectError) throw bridge.connectError
    }
    async close() {}
    async listTools() {
      return {
        tools: bridge.names.map((name) => ({ name, inputSchema: { type: "object", additionalProperties: true } })),
      }
    }
    setNotificationHandler(_schema: unknown, _handler: () => Promise<void>) {}
    callTool(...args: unknown[]) {
      return bridge.call(...args)
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = { on() {}, off() {} }
    constructor(options: unknown) {
      bridge.launch(options)
    }
    async close() {}
  },
}))

vi.hoisted(() => {
  process.env.AX_CODE_BROWSER_MODE = "embedded"
})
const { MCP } = await import("../../src/mcp")
const { BrowserRouting } = await import("../../src/mcp/browser-routing")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

afterEach(async () => {
  await Instance.disposeAll()
  vi.clearAllMocks()
})

test("resolves CLI Chrome and trusted Desktop embedded modes", () => {
  expect(BrowserRouting.resolve({})).toBe("chrome")
  expect(BrowserRouting.resolve({ AX_CODE_DESKTOP_BROWSER_TOKEN: "a".repeat(43) })).toBe("embedded")
  expect(
    BrowserRouting.resolve({ AX_CODE_BROWSER_MODE: "chrome", AX_CODE_DESKTOP_BROWSER_TOKEN: "a".repeat(43) }),
  ).toBe("chrome")
  expect(BrowserRouting.resolve({ AX_CODE_BROWSER_MODE: "embedded" })).toBe("embedded")
  expect(() => BrowserRouting.resolve({ AX_CODE_BROWSER_MODE: "automatic" })).toThrow("chrome or embedded")
})

test("launcher mode is immutable after import", () => {
  const previous = process.env.AX_CODE_BROWSER_MODE
  process.env.AX_CODE_BROWSER_MODE = "chrome"
  expect(BrowserRouting.mode()).toBe("embedded")
  process.env.AX_CODE_BROWSER_MODE = previous
})

test("recognizes profiled and legacy bridges while preserving unrelated MCP servers", () => {
  expect(BrowserRouting.externalBridgeBlocked({ webmcp: {} })).toBe(true)
  expect(BrowserRouting.externalBridgeBlocked({ type: "local", command: ["npx", "chrome-devtools-mcp@1.8.0"] })).toBe(
    true,
  )
  expect(
    BrowserRouting.externalBridgeBlocked({
      type: "local",
      command: ["node", "/tools/chrome-devtools-mcp/build/src/index.js"],
    }),
  ).toBe(true)
  expect(BrowserRouting.externalBridgeBlocked({ type: "local", command: ["node", "/tools/unrelated.js"] })).toBe(false)
})

test("startup, explicit reconnect and dynamic add cannot launch Chrome in embedded mode", async () => {
  const profile = WebMcpProfile.config({ allowedOrigins: [], read: true }, true)
  await using tmp = await tmpdir({ git: true, config: { mcp: { browser: profile } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.status()
      expect(bridge.launch).not.toHaveBeenCalled()
      await MCP.connect("browser")
      expect((await MCP.status()).browser).toMatchObject({ status: "blocked", reason: "embedded-browser-only" })
      const dynamic = await MCP.add("dynamic-browser", profile)
      expect(dynamic.status["dynamic-browser"]).toMatchObject({ status: "blocked" })
      const legacy = await MCP.add("legacy", {
        type: "local",
        enabled: true,
        command: ["npx", "chrome-devtools-mcp@1.8.0"],
      })
      expect(legacy.status.legacy).toMatchObject({ status: "blocked" })
      expect(bridge.launch).not.toHaveBeenCalled()
      const ordinary = await MCP.add("ordinary", {
        type: "local",
        enabled: true,
        command: ["node", "ordinary-fixture"],
      })
      expect(ordinary.status.ordinary).toMatchObject({ status: "connected" })
      expect(bridge.launch).toHaveBeenCalledTimes(1)
    },
  })
})
