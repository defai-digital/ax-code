import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const bridge = vi.hoisted(() => ({
  names: [] as string[],
  launch: vi.fn(),
  call: vi.fn(),
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    async connect() {}
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

const { MCP } = await import("../../src/mcp")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

const managedDir = process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR!

async function writeManaged(settings: unknown) {
  await fs.mkdir(managedDir, { recursive: true })
  await fs.writeFile(path.join(managedDir, "ax-code.json"), JSON.stringify(settings))
}

afterEach(async () => {
  await Instance.disposeAll()
  await fs.rm(managedDir, { recursive: true, force: true })
  bridge.names = []
  vi.resetAllMocks()
})

const profile = () => WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true)

test("managed deny blocks a trusted startup entry before spawning", async () => {
  await writeManaged({ webmcp: { allow: false }, mcp: { bridge: profile() } })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await MCP.status()).bridge).toMatchObject({ status: "failed" })
      expect(bridge.launch).not.toHaveBeenCalled()
      expect((await MCP.clients()).bridge).toBeUndefined()
    },
  })
})

test("managed deny rejects a dynamic connection", async () => {
  await writeManaged({ webmcp: { allow: false } })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(MCP.add("bridge", profile())).rejects.toThrow("disabled by managed policy")
      expect(bridge.launch).not.toHaveBeenCalled()
    },
  })
})

test("a project source cannot set the managed requirement", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  await using tmp = await tmpdir({
    git: true,
    config: { webmcp: { allow: false }, mcp: { bridge: profile() } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      expect(bridge.launch).toHaveBeenCalled()
      expect((await MCP.tools()).bridge_list_pages).toBeDefined()
    },
  })
})

test("a managed origin list narrows call-time navigation", async () => {
  await writeManaged({ webmcp: { allow: true, allowedOrigins: ["https://example.test"] } })
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }] })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add(
        "bridge",
        WebMcpProfile.config({ allowedOrigins: ["https://example.test", "https://other.test"] }, true),
      )
      const tools = await MCP.tools()
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://example.test"])
      const options = { toolCallId: "call_narrow", messages: [], abortSignal: new AbortController().signal }
      await expect(tools.bridge_new_page.execute!({ url: "https://other.test/" }, options)).rejects.toThrow(
        "origin is not allowed",
      )
      expect(bridge.call).not.toHaveBeenCalled()
      await tools.bridge_new_page.execute!({ url: "https://example.test/" }, options)
      expect(bridge.call).toHaveBeenCalled()
    },
  })
})
