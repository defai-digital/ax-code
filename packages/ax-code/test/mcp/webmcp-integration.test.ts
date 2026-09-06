import { afterEach, expect, test, vi } from "vitest"
import { asSchema } from "ai"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const bridge = vi.hoisted(() => ({
  names: [] as string[],
  notify: undefined as (() => Promise<void>) | undefined,
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
    setNotificationHandler(_schema: unknown, handler: () => Promise<void>) {
      bridge.notify = handler
    }
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
const { Bus } = await import("../../src/bus")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const { Global } = await import("../../src/global")

afterEach(async () => {
  await Instance.disposeAll()
  bridge.names = []
  bridge.notify = undefined
  vi.resetAllMocks()
})

const profile = () => WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true)

test("profile entries remain disabled without explicit enablement, including startup", async () => {
  const config = { ...profile(), enabled: undefined }
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: config } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await MCP.status()).bridge).toMatchObject({ status: "disabled" })
      expect((await MCP.add("dynamic", config)).status.dynamic).toMatchObject({ status: "disabled" })
      expect(bridge.launch).not.toHaveBeenCalled()
    },
  })
})

test("launch validation fails before spawning a modified bridge", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(MCP.add("bridge", { ...profile(), command: ["unreviewed-server"] })).rejects.toThrow(
        "exact reviewed launch command",
      )
      expect(bridge.launch).not.toHaveBeenCalled()
      expect((await MCP.clients()).bridge).toBeUndefined()
    },
  })
})

test("dynamic clients retain admission policy across discovery, notifications and reconnects", async () => {
  bridge.names = [...WebMcpProfile.TOOLS, "evaluate_script", "click"]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }] })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = profile()
      await MCP.add("bridge", config)
      expect(bridge.launch).toHaveBeenCalledWith(expect.objectContaining({ cwd: Global.Path.home }))
      expect(Global.Path.home).not.toBe(tmp.path)
      config.webmcp.allowedOrigins.push("https://not-approved.test")
      const tools = await MCP.tools()
      expect(Object.keys(tools).sort()).toEqual(WebMcpProfile.TOOLS.map((name) => `bridge_${name}`).sort())
      expect((await MCP.listAllTools()).map((tool) => tool.name).sort()).toEqual([...WebMcpProfile.TOOLS].sort())
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://example.test"])
      expect((await asSchema(tools.bridge_new_page.inputSchema).jsonSchema).additionalProperties).toBe(false)

      const options = { toolCallId: "call_bridge", messages: [], abortSignal: new AbortController().signal }
      await expect(tools.bridge_new_page.execute!({ url: "https://not-approved.test/" }, options)).rejects.toThrow(
        "origin is not allowed",
      )
      expect(bridge.call).not.toHaveBeenCalled()
      await tools.bridge_new_page.execute!({ url: "https://example.test/" }, options)
      expect(bridge.call).toHaveBeenCalledWith(
        { name: "new_page", arguments: { url: "https://example.test/" } },
        expect.anything(),
        expect.objectContaining({ signal: options.abortSignal }),
      )

      const changed = new Promise<void>((resolve) => {
        const unsubscribe = Bus.subscribe(MCP.ToolsChanged, () => {
          unsubscribe()
          resolve()
        })
      })
      bridge.names.push("upload_file")
      await bridge.notify!()
      await changed
      expect(Object.keys(await MCP.tools())).not.toContain("bridge_upload_file")

      // Replacing the connection does not inherit policy from a former client.
      await MCP.add("bridge", { type: "local", command: ["ordinary-mcp"] })
      expect(bridge.launch).toHaveBeenLastCalledWith(expect.objectContaining({ cwd: tmp.path }))
      const ordinary = await MCP.tools()
      expect(ordinary.bridge_upload_file).toBeDefined()
      expect(ordinary.bridge_new_page.webmcp).toBeUndefined()
    },
  })
})

test("bridge failures propagate without retries", async () => {
  bridge.names = ["execute_webmcp_tool"]
  bridge.call.mockRejectedValue(new Error("completion uncertain"))
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tool = (await MCP.tools()).bridge_execute_webmcp_tool
      await expect(
        tool.execute!({ pageId: 1, toolName: "fixture" }, { toolCallId: "call_fail", messages: [] }),
      ).rejects.toThrow("completion uncertain")
      expect(bridge.call).toHaveBeenCalledOnce()
    },
  })
})
