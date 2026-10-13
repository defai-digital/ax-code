import { afterEach, expect, test, vi } from "vitest"

type PromptPage = { prompts: Array<{ name: string; description: string }>; nextCursor?: string }
type ResourcePage = { resources: Array<{ name: string; uri: string }>; nextCursor?: string }

const bridge = vi.hoisted(() => ({
  capabilities: { prompts: {}, resources: {} } as Record<string, unknown> | undefined,
  promptPage: (_cursor?: string): { prompts: Array<{ name: string; description: string }>; nextCursor?: string } => ({
    prompts: [],
  }),
  resourcePage: (_cursor?: string): { resources: Array<{ name: string; uri: string }>; nextCursor?: string } => ({
    resources: [],
  }),
  promptCalls: [] as Array<string | undefined>,
  resourceCalls: [] as Array<string | undefined>,
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {}
    async close() {}
    getServerCapabilities() {
      return bridge.capabilities
    }
    listTools() {
      return Promise.resolve({ tools: [] })
    }
    listPrompts(params?: { cursor?: string }) {
      bridge.promptCalls.push(params?.cursor)
      return Promise.resolve(bridge.promptPage(params?.cursor))
    }
    listResources(params?: { cursor?: string }) {
      bridge.resourceCalls.push(params?.cursor)
      return Promise.resolve(bridge.resourcePage(params?.cursor))
    }
    setNotificationHandler() {}
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
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
  bridge.promptCalls = []
  bridge.resourceCalls = []
})

test("a paginated prompt list returns every page", async () => {
  await using tmp = await tmpdir({ git: true })
  bridge.promptPage = (cursor) =>
    cursor === undefined
      ? { prompts: [{ name: "first", description: "First page" }], nextCursor: "page-2" }
      : { prompts: [{ name: "second", description: "Second page" }] }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("catalog", { type: "local", command: ["catalog-server"] })

      expect(Object.keys(await MCP.prompts())).toEqual(["catalog:first", "catalog:second"])
      expect(bridge.promptCalls).toEqual([undefined, "page-2"])
    },
  })
})

test("a paginated resource list returns every page", async () => {
  await using tmp = await tmpdir({ git: true })
  bridge.resourcePage = (cursor) =>
    cursor === undefined
      ? { resources: [{ name: "notes", uri: "file:///notes" }], nextCursor: "page-2" }
      : { resources: [{ name: "spec", uri: "file:///spec" }] }

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("catalog", { type: "local", command: ["catalog-server"] })

      expect(Object.keys(await MCP.resources())).toEqual(["catalog:notes", "catalog:spec"])
      expect(bridge.resourceCalls).toEqual([undefined, "page-2"])
    },
  })
})

test("a server that repeats one cursor cannot loop the listing forever", async () => {
  await using tmp = await tmpdir({ git: true })
  bridge.promptPage = () => ({ prompts: [{ name: "same", description: "Repeated page" }], nextCursor: "stuck" })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("catalog", { type: "local", command: ["catalog-server"] })

      expect(Object.keys(await MCP.prompts())).toEqual(["catalog:same"])
      expect(bridge.promptCalls.length).toBe(MCP.MAX_CATALOG_PAGES)
    },
  })
})
