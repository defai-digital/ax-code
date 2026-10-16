import { afterEach, expect, test, vi } from "vitest"

const bridge = vi.hoisted(() => ({
  capabilities: { logging: {} } as Record<string, unknown> | undefined,
  listPrompts: vi.fn(async () => ({ prompts: [{ name: "greet", description: "Greeting prompt" }] })),
  listResources: vi.fn(async () => ({ resources: [{ name: "notes", uri: "file:///notes" }] })),
}))

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    async connect() {}
    async close() {}
    getServerCapabilities() {
      return bridge.capabilities
    }
    listTools() {
      return Promise.resolve({ tools: [] })
    }
    // The catalog pages prompts and resources with raw list requests (SDK v2
    // typed list verbs aggregate pages); route them to the same fakes.
    request(request: { method: string }) {
      if (request.method === "prompts/list") return bridge.listPrompts()
      if (request.method === "resources/list") return bridge.listResources()
      throw new Error(`unexpected request ${request.method}`)
    }
    setNotificationHandler() {}
    setRequestHandler() {}
  },
}))

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class {
    stderr = { on() {}, off() {} }
    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

afterEach(async () => {
  await Instance.disposeAll()
  vi.clearAllMocks()
})

test("a server that only declares logging is not asked for prompts or resources", async () => {
  await using tmp = await tmpdir({ git: true })
  // chrome-devtools-mcp initializes with `{ capabilities: { logging: {} } }`, so
  // both list calls are guaranteed to fail with JSON-RPC -32601.
  bridge.capabilities = { logging: {} }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("tools-only", { type: "local", command: ["tools-only-server"] })

      expect(await MCP.prompts()).toEqual({})
      expect(await MCP.resources()).toEqual({})
      expect(bridge.listPrompts).not.toHaveBeenCalled()
      expect(bridge.listResources).not.toHaveBeenCalled()
    },
  })
})

test("a server that declares prompts and resources is still listed", async () => {
  await using tmp = await tmpdir({ git: true })
  bridge.capabilities = { prompts: {}, resources: {} }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("catalog", { type: "local", command: ["catalog-server"] })

      expect(Object.keys(await MCP.prompts())).toEqual(["catalog:greet"])
      expect(Object.keys(await MCP.resources())).toEqual(["catalog:notes"])
    },
  })
})
