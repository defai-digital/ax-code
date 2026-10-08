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

test("a modified bridge command is discarded and the launch regenerates from the profile (ADR-173)", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // A dynamic add resolves from an unknown (trusted-by-default) source and
      // connects immediately; the tampered command never executes.
      await MCP.add("bridge", { ...profile(), command: ["unreviewed-server"] })
      expect(bridge.launch).toHaveBeenCalledTimes(1)
      const options = bridge.launch.mock.calls[0]![0] as { command?: string; args?: string[] }
      expect(options.command).not.toBe("unreviewed-server")
      expect([...(options.command ? [options.command] : []), ...(options.args ?? [])]).toContain(
        "chrome-devtools-mcp@1.8.0",
      )
    },
  })
})

test("dynamic clients retain admission policy across discovery, notifications and reconnects", async () => {
  bridge.names = [...WebMcpProfile.TOOLS, "evaluate_script", "click"]
  bridge.call.mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
  })
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

test("a failed dispatch-time listing invalidates the stored baseline", async () => {
  bridge.names = ["list_webmcp_tools", "execute_webmcp_tool"]
  const descriptor = { name: "fixture", description: "d", inputSchema: { type: "object" } }
  const pages = {
    content: [{ type: "text", text: "## Pages\n1: App (https://example.test/)" }],
    structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
  }
  let listWorks = true
  bridge.call.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_webmcp_tools") {
      if (!listWorks) throw new Error("bridge exploded")
      return { content: [], structuredContent: { webmcpTools: [descriptor] } }
    }
    if (request.name === "list_pages") return pages
    throw new Error("must not dispatch")
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tools = await MCP.tools()
      await tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] })
      listWorks = false
      await expect(
        tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_relist", messages: [] }),
      ).rejects.toThrow("bridge exploded")
      // The fresh re-listing recovers, but the cleared baseline refuses the execute.
      listWorks = true
      await expect(
        tools.bridge_execute_webmcp_tool.execute!(
          { pageId: 1, toolName: "fixture", input: "{}" },
          { toolCallId: "call_exec", messages: [] },
        ),
      ).rejects.toThrow("called first")
      expect(
        bridge.call.mock.calls.filter(([request]) => (request as { name: string }).name === "execute_webmcp_tool"),
      ).toHaveLength(0)
    },
  })
})

test("an approval requested without a listing cannot dispatch against a later baseline", async () => {
  bridge.names = ["list_webmcp_tools", "execute_webmcp_tool"]
  const descriptor = { name: "fixture", description: "d", inputSchema: { type: "object" } }
  bridge.call.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_webmcp_tools") {
      return { content: [], structuredContent: { webmcpTools: [descriptor] } }
    }
    if (request.name === "list_pages") {
      return {
        content: [{ type: "text", text: "## Pages\n1: App (https://example.test/)" }],
        structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
      }
    }
    throw new Error("must not dispatch")
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tools = await MCP.tools()
      // Another session lists after this call's approval found nothing.
      const denied = { pageId: 1, toolName: "fixture", input: "{}" }
      WebMcpProfile.denyApproval(denied)
      await tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] })
      await expect(
        tools.bridge_execute_webmcp_tool.execute!(denied, { toolCallId: "call_exec", messages: [] }),
      ).rejects.toThrow("called first")
      expect(
        bridge.call.mock.calls.filter(([request]) => (request as { name: string }).name === "execute_webmcp_tool"),
      ).toHaveLength(0)
      // An unmarked dispatch against the same baseline still binds live.
      await expect(
        tools.bridge_execute_webmcp_tool.execute!(
          { pageId: 1, toolName: "fixture", input: "{}" },
          { toolCallId: "call_exec2", messages: [] },
        ),
      ).rejects.toThrow("must not dispatch")
    },
  })
})

test("preflight rejects error results even with plausible snapshot data", async () => {
  bridge.names = ["list_webmcp_tools", "execute_webmcp_tool"]
  const descriptor = { name: "fixture", description: "d", inputSchema: { type: "object" } }
  const goodPages = {
    content: [{ type: "text", text: "## Pages\n1: App (https://example.test/)" }],
    structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
  }
  let pagesResult: unknown = goodPages
  let listingResult: unknown = { content: [], structuredContent: { webmcpTools: [descriptor] } }
  bridge.call.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_webmcp_tools") return listingResult
    if (request.name === "list_pages") return pagesResult
    throw new Error("must not dispatch")
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tools = await MCP.tools()
      await tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] })
      const execute = () =>
        tools.bridge_execute_webmcp_tool.execute!(
          { pageId: 1, toolName: "fixture", input: "{}" },
          { toolCallId: "call_exec", messages: [] },
        )
      pagesResult = { ...goodPages, isError: true }
      await expect(execute()).rejects.toThrow("bridge operation failed")
      pagesResult = goodPages
      listingResult = {
        content: [],
        structuredContent: { webmcpTools: [descriptor], errorMessage: "stale snapshot" },
      }
      await expect(execute()).rejects.toThrow("bridge operation failed")
      expect(
        bridge.call.mock.calls.filter(([request]) => (request as { name: string }).name === "execute_webmcp_tool"),
      ).toHaveLength(0)
    },
  })
})

test("dispatch propagates cancellation and caps the total webmcp budget", async () => {
  bridge.names = ["list_webmcp_tools", "execute_webmcp_tool"]
  const descriptor = { name: "fixture", description: "d", inputSchema: { type: "object" } }
  bridge.call.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_webmcp_tools") {
      return { content: [], structuredContent: { webmcpTools: [descriptor] } }
    }
    if (request.name === "list_pages") {
      return {
        content: [{ type: "text", text: "## Pages\n1: App (https://example.test/)" }],
        structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
      }
    }
    return {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { message: JSON.stringify({ status: "Completed" }) },
    }
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tools = await MCP.tools()
      await tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] })
      const controller = new AbortController()
      await tools.bridge_execute_webmcp_tool.execute!(
        { pageId: 1, toolName: "fixture", input: "{}" },
        { toolCallId: "call_exec", messages: [], abortSignal: controller.signal },
      )
      const calls = bridge.call.mock.calls.slice(3)
      expect(calls.map(([request]) => (request as { name: string }).name)).toEqual([
        "list_pages",
        "list_webmcp_tools",
        "list_pages",
        "execute_webmcp_tool",
      ])
      const main = calls[3][2] as { timeout?: unknown; maxTotalTimeout?: unknown }
      expect(main.timeout).toEqual(expect.any(Number))
      // One shared deadline: every later call sees no more budget than the one before.
      let previous = Number.POSITIVE_INFINITY
      for (const [, , options] of calls) {
        const typed = options as { signal?: unknown; timeout?: unknown }
        expect(typed.signal).toBe(controller.signal)
        expect(typed.timeout).toEqual(expect.any(Number))
        expect(typed.timeout as number).toBeLessThanOrEqual(previous)
        previous = typed.timeout as number
      }
      expect(main.maxTotalTimeout).toBe(main.timeout)
    },
  })
})

test("bridge failures propagate without retries", async () => {
  bridge.names = ["list_webmcp_tools", "execute_webmcp_tool"]
  const descriptor = { name: "fixture", description: "d", inputSchema: { type: "object" } }
  bridge.call.mockImplementation(async (request: { name: string }) => {
    if (request.name === "list_webmcp_tools") {
      return { content: [], structuredContent: { webmcpTools: [descriptor] } }
    }
    if (request.name === "list_pages") {
      return {
        content: [{ type: "text", text: "## Pages\n1: App (https://example.test/)" }],
        structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
      }
    }
    throw new Error("completion uncertain")
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.add("bridge", profile())
      const tools = await MCP.tools()
      await tools.bridge_list_webmcp_tools.execute!({ pageId: 1 }, { toolCallId: "call_list", messages: [] })
      const executed = () =>
        bridge.call.mock.calls.filter(([request]) => (request as { name: string }).name === "execute_webmcp_tool")
          .length
      expect(executed()).toBe(0)
      await expect(
        tools.bridge_execute_webmcp_tool.execute!(
          { pageId: 1, toolName: "fixture", input: "{}" },
          { toolCallId: "call_fail", messages: [] },
        ),
      ).rejects.toThrow("completion uncertain")
      expect(executed()).toBe(1)
    },
  })
})

test("a session origin grant relaunches the bridge with regenerated argv and ends on disconnect (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: profile() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      expect(bridge.launch).toHaveBeenCalledTimes(1)
      expect(await MCP.checkWebMcpOriginGrant("bridge", "https://news.test")).toEqual({ ok: true })
      expect(await MCP.checkWebMcpOriginGrant("missing", "https://news.test")).toMatchObject({ ok: false })

      expect(await MCP.grantWebMcpOrigin("bridge", "https://news.test")).toEqual({ ok: true })
      expect(bridge.launch).toHaveBeenCalledTimes(2)
      const relaunch = bridge.launch.mock.calls[1]![0] as { args: string[] }
      expect(relaunch.args).toContain("--allowed-url-pattern=https://news.test/*")
      expect(bridge.launch.mock.calls[0]![0].args).not.toContain("--allowed-url-pattern=https://news.test/*")
      const tools = await MCP.tools()
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual([
        "https://example.test",
        "https://news.test",
      ])
      // The configured entry is untouched: grants are never written back.
      expect((await MCP.checkWebMcpOriginGrant("bridge", "https://example.test")).ok).toBe(true)

      await MCP.disconnect("bridge")
      await MCP.connect("bridge")
      const after = await MCP.tools()
      expect(after.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://example.test"])
    },
  })
})

test("an apex and www pair is granted with one relaunch (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: profile() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      expect(await MCP.grantWebMcpOrigin("bridge", "https://news.test", "https://www.news.test")).toEqual({ ok: true })
      expect(bridge.launch).toHaveBeenCalledTimes(2)
      const relaunch = bridge.launch.mock.calls[1]![0] as { args: string[] }
      expect(relaunch.args).toContain("--allowed-url-pattern=https://news.test/*")
      expect(relaunch.args).toContain("--allowed-url-pattern=https://www.news.test/*")
    },
  })
})

test("concurrent origin grants cannot exceed the 8-origin cap (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  const seven = () =>
    WebMcpProfile.config(
      { allowedOrigins: ["https://example.test", ...Array.from({ length: 6 }, (_, i) => `https://c${i}.test`)] },
      true,
    )
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: seven() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      // Both approvals pass the pre-prompt check at 7 origins; the in-lock
      // re-check must let exactly one through.
      const outcomes = await Promise.all([
        MCP.grantWebMcpOrigin("bridge", "https://a.test"),
        MCP.grantWebMcpOrigin("bridge", "https://b.test"),
      ])
      expect(outcomes.filter((decision) => decision.ok)).toHaveLength(1)
      expect(outcomes.find((decision) => !decision.ok)).toMatchObject({
        ok: false,
        error: "WebMCP already has the maximum of 8 allowed origins",
      })
      const tools = await MCP.tools()
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toHaveLength(8)
    },
  })
})

test("a grant is refused when the bridge was disconnected while its approval was open (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: profile() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      expect(bridge.launch).toHaveBeenCalledTimes(1)
      expect(await MCP.checkWebMcpOriginGrant("bridge", "https://news.test")).toEqual({ ok: true })
      // The user toggles the bridge off while the approval prompt is open.
      await MCP.disconnect("bridge")
      expect(await MCP.grantWebMcpOrigin("bridge", "https://news.test")).toMatchObject({ ok: false })
      // The stale approval neither relaunches the bridge nor leaves a grant.
      expect(bridge.launch).toHaveBeenCalledTimes(1)
      await MCP.connect("bridge")
      const tools = await MCP.tools()
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://example.test"])
    },
  })
})

test("a failed relaunch rolls the origin grant back (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  await using tmp = await tmpdir({ git: true, config: { mcp: { bridge: profile() } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      bridge.launch.mockImplementationOnce(() => {
        throw new Error("spawn failed")
      })
      expect(await MCP.grantWebMcpOrigin("bridge", "https://news.test")).toMatchObject({ ok: false })
      // The reported failure must not silently apply the origin later.
      await MCP.connect("bridge")
      const tools = await MCP.tools()
      expect(tools.bridge_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://example.test"])
    },
  })
})
