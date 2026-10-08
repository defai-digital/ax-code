import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, describe, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"
import { webMcpApprovalLines } from "../../src/mcp/webmcp-approval"

const origins = ["https://example.test"]

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

const plainProfile = () => WebMcpProfile.config({ allowedOrigins: origins }).webmcp
const readProfile = () => WebMcpProfile.config({ allowedOrigins: origins, read: true }, true).webmcp

describe("WebMCP T1 read tier profile", () => {
  test("read off rejects every T1 tool and leaves the launch argv unchanged", () => {
    const base = WebMcpProfile.config({ allowedOrigins: origins })
    const explicitFalse = WebMcpProfile.config({ allowedOrigins: origins, read: false })
    expect(explicitFalse.webmcp.read).toBe(false)
    expect(explicitFalse.command).toEqual(base.command)
    expect(WebMcpProfile.validateLaunch(explicitFalse)).toEqual(explicitFalse.webmcp)
    for (const name of WebMcpProfile.READ_TOOLS) {
      expect(WebMcpProfile.allows(name)).toBe(false)
      expect(WebMcpProfile.allows(name, plainProfile())).toBe(false)
      expect(() => WebMcpProfile.callSchema(name)).toThrow("not admitted")
      expect(() => WebMcpProfile.callSchema(name, plainProfile())).toThrow("not admitted")
      expect(() => WebMcpProfile.validateCall(plainProfile(), name, { pageId: 1 })).toThrow("not admitted")
    }
  })

  test("read on admits exactly the read-scope tools plus the six T0 tools", () => {
    const profile = readProfile()
    expect(profile.read).toBe(true)
    for (const name of [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_SCOPE_TOOLS]) {
      expect(WebMcpProfile.allows(name, profile)).toBe(true)
      expect(() => WebMcpProfile.callSchema(name, profile)).not.toThrow()
    }
    for (const name of [
      "evaluate_script",
      "click",
      "fill",
      "upload_file",
      "get_network_request",
      "get_console_message",
      "wait_for",
      "handle_dialog",
      "select_page",
      "resize_page",
      "stay",
    ]) {
      expect(WebMcpProfile.allows(name, profile)).toBe(false)
      expect(() => WebMcpProfile.callSchema(name, profile)).toThrow("not admitted")
    }
  })

  test("T1 schemas are strict: filePath and unknown keys are rejected, pageId is required", () => {
    const profile = readProfile()
    expect(WebMcpProfile.validateCall(profile, "take_snapshot", { pageId: 1, verbose: true })).toEqual({
      pageId: 1,
      verbose: true,
    })
    expect(() => WebMcpProfile.validateCall(profile, "take_snapshot", { pageId: 1, filePath: "/tmp/x" })).toThrow()
    expect(() =>
      WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, filePath: "/tmp/x.png" }),
    ).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "take_snapshot", { pageId: 1, extra: true })).toThrow()
    for (const name of WebMcpProfile.READ_TOOLS) {
      expect(() => WebMcpProfile.validateCall(profile, name, {})).toThrow("Invalid arguments")
    }
  })

  test("take_screenshot bounds format, quality and uid and refuses fullPage", () => {
    const profile = readProfile()
    expect(
      WebMcpProfile.validateCall(profile, "take_screenshot", {
        pageId: 1,
        format: "webp",
        quality: 80,
        uid: "node-1",
      }),
    ).toMatchObject({ format: "webp", quality: 80, uid: "node-1" })
    // fullPage is excluded: the pinned upstream auto-saves any screenshot of
    // 2 MB or more to a temp file even without filePath (page content would
    // land on disk), and it rejects the uid+fullPage combination outright.
    expect(() => WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, fullPage: true })).toThrow()
    expect(() =>
      WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, uid: "node-1", fullPage: true }),
    ).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, format: "gif" })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, quality: 101 })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, quality: -1 })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "take_screenshot", { pageId: 1, uid: "x".repeat(129) })).toThrow()
  })

  test("list_console_messages caps size, index and types and drops upstream extras", () => {
    const profile = readProfile()
    expect(
      WebMcpProfile.validateCall(profile, "list_console_messages", {
        pageId: 1,
        pageSize: 50,
        pageIdx: 0,
        types: ["log", "warn"],
      }),
    ).toMatchObject({ pageSize: 50, pageIdx: 0 })
    expect(() => WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, pageSize: 51 })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, pageSize: 0 })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, pageIdx: -1 })).toThrow()
    expect(() =>
      WebMcpProfile.validateCall(profile, "list_console_messages", {
        pageId: 1,
        types: Array.from({ length: 9 }, (_, i) => `t${i}`),
      }),
    ).toThrow()
    // types mirrors the pinned upstream FILTERABLE_MESSAGE_TYPES enum: a
    // well-formed but unsupported name is rejected before approval, not at
    // dispatch.
    expect(() => WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, types: ["nope"] })).toThrow()
    expect(WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, types: ["issue"] })).toEqual({
      pageId: 1,
      types: ["issue"],
    })
    expect(() =>
      WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, types: ["x".repeat(33)] }),
    ).toThrow()
    for (const extra of [
      { includeStackTraces: true },
      { includePreservedMessages: true },
      { serviceWorkerId: "sw-1" },
    ]) {
      expect(() => WebMcpProfile.validateCall(profile, "list_console_messages", { pageId: 1, ...extra })).toThrow()
    }
  })

  test("the T0 note is unchanged read off; the read note replaces it read on", () => {
    expect(WebMcpProfile.limitsNote(plainProfile())).toBe(WebMcpProfile.LIMITS_NOTE)
    expect(WebMcpProfile.LIMITS_NOTE).toContain("cannot read page text or the DOM")
    expect(WebMcpProfile.limitsNote(readProfile())).toBe(WebMcpProfile.READ_LIMITS_NOTE)
    expect(WebMcpProfile.READ_LIMITS_NOTE).toContain("Interaction is still impossible")
  })

  test("approval metadata labels a read call with its listed origin and read tier", () => {
    const profile = readProfile()
    const state = WebMcpProfile.stateFor(profile)
    expect(
      WebMcpProfile.recordListing(state, 1, [{ name: "search", description: "d" }], "https://example.test/"),
    ).toEqual({ ok: true })
    const call = WebMcpProfile.validateCall(profile, "take_snapshot", { pageId: 1 })
    expect(WebMcpProfile.approvalMetadata("bridge", profile, "take_snapshot", call)).toMatchObject({
      tool: "take_snapshot",
      pageId: 1,
      pageOrigin: "https://example.test",
      readTier: true,
    })
    const off = WebMcpProfile.approvalMetadata("bridge", plainProfile(), "take_snapshot", { pageId: 1 })
    expect(off).not.toHaveProperty("readTier")
  })

  test("approval lines surface a page-read label only for read calls", () => {
    const read = webMcpApprovalLines({ server: "bridge", tool: "take_snapshot", pageId: 1, readTier: true }).join("\n")
    expect(read).toContain("Page READ")
    const off = webMcpApprovalLines({ server: "bridge", tool: "take_snapshot", pageId: 1 }).join("\n")
    expect(off).not.toContain("Page READ")
  })
})

describe("WebMCP managed read gate", () => {
  test("allowRead:false forces read off without blocking the bridge", () => {
    const decision = WebMcpProfile.evaluate({ allowRead: false }, readProfile())
    expect(decision.ok).toBe(true)
    if (!decision.ok) return
    expect(decision.profile.read).not.toBe(true)
    for (const name of WebMcpProfile.READ_TOOLS) expect(WebMcpProfile.allows(name, decision.profile)).toBe(false)
    expect(WebMcpProfile.allows("list_pages", decision.profile)).toBe(true)
    const narrowed = WebMcpProfile.applyRequirement(
      { allowRead: false, allowedOrigins: ["https://example.test"] },
      readProfile(),
    )
    expect(narrowed.read).not.toBe(true)
    expect(narrowed.allowedOrigins).toEqual(["https://example.test"])
  })

  test("allowRead true or absent leaves a read:true profile on", () => {
    expect(WebMcpProfile.evaluate({ allowRead: true }, readProfile())).toMatchObject({ ok: true })
    const absent = WebMcpProfile.evaluate({}, readProfile())
    expect(absent.ok && absent.profile.read).toBe(true)
    const none = WebMcpProfile.evaluate(undefined, readProfile())
    expect(none.ok && none.profile.read).toBe(true)
  })

  test("a read-off profile is returned untouched by evaluate", () => {
    const plain = plainProfile()
    expect(WebMcpProfile.applyRequirement(undefined, plain)).toBe(plain)
    expect(WebMcpProfile.evaluate({ allowRead: false }, plain)).toEqual({ ok: true, profile: plain })
  })

  test("the requirement schema admits allowRead and rejects unknown keys", () => {
    expect(WebMcpProfile.Requirement.safeParse({ allowRead: true }).success).toBe(true)
    expect(WebMcpProfile.Requirement.safeParse({ allowRead: false }).success).toBe(true)
    expect(WebMcpProfile.Requirement.safeParse({ allowRead: "yes" }).success).toBe(false)
    expect(WebMcpProfile.Requirement.safeParse({ read: true }).success).toBe(false)
  })
})

describe("WebMCP read tier admission over MCP", () => {
  const profileWithRead = () => WebMcpProfile.config({ allowedOrigins: origins, read: true }, true)
  const profileWithoutRead = () => WebMcpProfile.config({ allowedOrigins: origins }, true)

  test("read off exposes only the six T0 tools even when the bridge advertises more", async () => {
    bridge.names = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS, "evaluate_script", "click"]
    bridge.call.mockResolvedValue({ content: [] })
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("bridge", profileWithoutRead())
        const tools = await MCP.tools()
        expect(Object.keys(tools).sort()).toEqual(WebMcpProfile.TOOLS.map((name) => `bridge_${name}`).sort())
        expect((await MCP.listAllTools()).map((tool) => tool.name).sort()).toEqual([...WebMcpProfile.TOOLS].sort())
      },
    })
  })

  test("read on exposes the read-scope tools with strict schemas", async () => {
    bridge.names = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_SCOPE_TOOLS, "evaluate_script", "click"]
    bridge.call.mockResolvedValue({ content: [] })
    // The entry must come from config: read grants look the entry up via
    // Config.get() (webMcpEntry), and MCP.add does not write config.
    await using tmp = await tmpdir({
      git: true,
      config: { username: "test", mcp: { bridge: profileWithRead() } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.connect("bridge")
        const tools = await MCP.tools()
        const expected = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_SCOPE_TOOLS]
          .map((name) => `bridge_${name}`)
          .sort()
        expect(Object.keys(tools).sort()).toEqual(expected)
        expect(tools.bridge_evaluate_script).toBeUndefined()
        expect(tools.bridge_click).toBeUndefined()
        expect(tools.bridge_take_snapshot.webmcp?.toolName).toBe("take_snapshot")
        const options = { toolCallId: "call_read", messages: [], abortSignal: new AbortController().signal }
        await expect(
          tools.bridge_take_screenshot.execute!({ pageId: 1, filePath: "/tmp/x.png" }, options),
        ).rejects.toThrow()
        // The bridge lists page 1 on the configured origin.
        bridge.call.mockImplementation((call: unknown) =>
          (call as { name?: string }).name === "list_pages"
            ? {
                content: [],
                structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
              }
            : { content: [{ type: "text", text: "snapshot text" }] },
        )
        // No read grant yet: dispatch fails closed before the bridge is asked
        // for any page content (ADR-171).
        await expect(tools.bridge_take_snapshot.execute!({ pageId: 1 }, options)).rejects.toThrow(
          "read access to this origin is not granted",
        )
        expect(
          bridge.call.mock.calls.filter((call) => (call[0] as { name?: string }).name === "take_snapshot"),
        ).toHaveLength(0)
        // Grant the origin: the read dispatches and the output is labeled
        // untrusted with its origin.
        const granted = await MCP.grantWebMcpReadOrigin("bridge", "https://example.test")
        expect(granted.ok).toBe(true)
        const result = (await tools.bridge_take_snapshot.execute!({ pageId: 1 }, options)) as {
          content?: { type?: string; text?: string }[]
        }
        expect(result.content?.[0]?.text).toBe("[Untrusted web content from https://example.test]")
      },
    })
  })

  test("managed allowRead:false forces the T1 tools off", async () => {
    await writeManaged({ webmcp: { allowRead: false } })
    bridge.names = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS]
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("bridge", profileWithRead())
        const tools = await MCP.tools()
        expect(Object.keys(tools).sort()).toEqual(WebMcpProfile.TOOLS.map((name) => `bridge_${name}`).sort())
        expect(tools.bridge_take_snapshot).toBeUndefined()
      },
    })
  })

  test("a project source cannot set the managed allowRead gate", async () => {
    bridge.names = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS]
    bridge.call.mockResolvedValue({ content: [] })
    await using tmp = await tmpdir({
      git: true,
      config: { username: "test", webmcp: { allowRead: false }, mcp: { bridge: profileWithRead() } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("bridge", profileWithRead())
        const tools = await MCP.tools()
        expect(tools.bridge_take_snapshot).toBeDefined()
      },
    })
  })
})

describe("WebMCP read grants and bounded output (ADR-171)", () => {
  test("checkReadGrant refuses a read-off profile and origins outside a narrowing list", () => {
    const readOn = readProfile()
    expect(WebMcpProfile.checkReadGrant(undefined, plainProfile(), new Set(), "https://example.test")).toMatchObject({
      ok: false,
    })
    expect(WebMcpProfile.checkReadGrant(undefined, readOn, new Set(), "https://other.test")).toMatchObject({
      ok: false,
    })
    expect(WebMcpProfile.checkReadGrant(undefined, readOn, new Set(), "https://example.test")).toEqual({ ok: true })
    // An unrestricted profile may grant any well-formed origin: the prompt is
    // the control. The cap still applies.
    const open = WebMcpProfile.config({ allowedOrigins: [], read: true }).webmcp
    expect(WebMcpProfile.checkReadGrant(undefined, open, new Set(), "https://anything.test")).toEqual({ ok: true })
    const full = new Set(Array.from({ length: 8 }, (_, i) => `https://s${i}.test`))
    expect(WebMcpProfile.checkReadGrant(undefined, open, full, "https://ninth.test")).toMatchObject({ ok: false })
    // The managed ceiling still binds: deny blocks, narrowing restricts.
    expect(WebMcpProfile.checkReadGrant({ allowRead: false }, readOn, new Set(), "https://example.test")).toMatchObject(
      { ok: false },
    )
  })

  test("boundReadResult labels output with its origin", () => {
    const result = { content: [{ type: "text", text: "page text" }] }
    WebMcpProfile.boundReadResult("take_snapshot", result, "https://example.test")
    expect(result.content[0]).toEqual({ type: "text", text: "[Untrusted web content from https://example.test]" })
    expect(result.content[1]).toEqual({ type: "text", text: "page text" })
  })

  test("boundReadResult rejects an oversize snapshot with narrowing guidance, not truncation", () => {
    const big = "x".repeat(33 * 1024)
    expect(() =>
      WebMcpProfile.boundReadResult("take_snapshot", { content: [{ type: "text", text: big }] }, "https://a.test"),
    ).toThrow("exceeded the 32 KiB read budget")
  })

  test("boundReadResult fails closed on the upstream auto-saved screenshot response", () => {
    const result = {
      content: [{ type: "text", text: "Saved screenshot to /tmp/secret-user-123/screenshot.png" }],
    }
    expect(() => WebMcpProfile.boundReadResult("take_screenshot", result, "https://a.test")).toThrow(
      "wrote it to a temporary file",
    )
    // The thrown message must never carry the on-disk path.
    try {
      WebMcpProfile.boundReadResult("take_screenshot", result, "https://a.test")
    } catch (error) {
      expect(String(error)).not.toContain("/tmp/")
      expect(String(error)).not.toContain("secret-user")
    }
  })

  test("boundReadResult keeps only the last 50 console messages", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`)
    const result = {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: { messages: lines },
    }
    WebMcpProfile.boundReadResult("list_console_messages", result, "https://a.test")
    expect(result.structuredContent.messages).toHaveLength(50)
    expect(result.structuredContent.messages[0]).toBe("line 30")
    expect(result.content[1].text).toContain("30 earlier console messages omitted")
    expect(result.content[1].text).toContain("line 79")
    expect(result.content[1].text).not.toContain("line 0\n")
  })
})

describe("WebMCP network metadata admission (ADR-172)", () => {
  // Every tool the pinned chrome-devtools-mcp@1.8.0 registers (extracted from
  // its vendored tools/*.js). The admission contract pins exactly the six T0
  // tools plus the four read-scope tools: a regression in allows() must fail
  // here rather than silently widen the surface that reaches the model.
  const UPSTREAM_TOOLS = [
    "click",
    "click_at",
    "close_heapsnapshot",
    "close_page",
    "compare_heapsnapshots",
    "drag",
    "emulate",
    "evaluate_script",
    "execute_3p_developer_tool",
    "execute_webmcp_tool",
    "fill",
    "fill_form",
    "get_console_message",
    "get_heapsnapshot_class_nodes",
    "get_heapsnapshot_details",
    "get_heapsnapshot_dominators",
    "get_heapsnapshot_duplicate_strings",
    "get_heapsnapshot_edges",
    "get_heapsnapshot_object_details",
    "get_heapsnapshot_retainers",
    "get_heapsnapshot_retaining_paths",
    "get_heapsnapshot_summary",
    "get_network_request",
    "get_os_app_state",
    "get_tab_id",
    "handle_dialog",
    "hover",
    "install_extension",
    "install_pwa",
    "launch_pwa",
    "lighthouse_audit",
    "list_3p_developer_tools",
    "list_extensions",
    "list_network_requests",
    "list_pages",
    "list_webmcp_tools",
    "navigate_page",
    "new_page",
    "performance_analyze_insight",
    "performance_start_trace",
    "performance_stop_trace",
    "press_key",
    "query_heapsnapshot_objects",
    "reload_extension",
    "resize_page",
    "screencast_start",
    "screencast_stop",
    "select_page",
    "take_heapsnapshot",
    "take_screenshot",
    "take_snapshot",
    "trigger_extension_action",
    "type_text",
    "uninstall_extension",
    "uninstall_pwa",
    "upload_file",
    "wait_for",
  ]

  test("allows() admits exactly the reviewed set against the pinned upstream tool list", () => {
    const readOn = readProfile()
    const t0 = new Set<string>(WebMcpProfile.TOOLS)
    const admitted = new Set<string>([...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_SCOPE_TOOLS])
    for (const name of UPSTREAM_TOOLS) {
      expect(WebMcpProfile.allows(name, readOn)).toBe(admitted.has(name))
      expect(WebMcpProfile.allows(name, plainProfile())).toBe(t0.has(name))
      expect(WebMcpProfile.allows(name, undefined)).toBe(t0.has(name))
    }
  })

  test("list_network_requests is admitted only with the read tier on", () => {
    expect(WebMcpProfile.allows("list_network_requests", readProfile())).toBe(true)
    expect(WebMcpProfile.allows("list_network_requests", plainProfile())).toBe(false)
  })

  test("list_network_requests schema bounds the request and drops preserved requests", () => {
    const profile = readProfile()
    expect(
      WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, resourceTypes: ["image"] }),
    ).toEqual({ pageId: 1, resourceTypes: ["image"] })
    expect(
      WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, pageSize: 100, pageIdx: 20 }),
    ).toMatchObject({ pageSize: 100, pageIdx: 20 })
    expect(() => WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, pageSize: 101 })).toThrow()
    expect(() => WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, pageIdx: 21 })).toThrow()
    // Preserved requests span navigations and would leak the previous origin's
    // URLs into a granted origin's result — the parameter is not accepted.
    expect(() =>
      WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, includePreservedRequests: true }),
    ).toThrow()
    expect(() =>
      WebMcpProfile.validateCall(profile, "list_network_requests", { pageId: 1, resourceTypes: ["image", "nope"] }),
    ).toThrow()
  })

  test("network output loses userinfo, fragments and secret query keys, keeps ordinary queries", () => {
    const result = {
      content: [
        {
          type: "text",
          text: "200 GET https://user:pass@cdn.example.com/cat.jpg?token=abc123&size=large#frag\n200 GET https://api.example.com/v1/list?page=2",
        },
      ],
    }
    WebMcpProfile.boundReadResult("list_network_requests", result, "https://example.test")
    const text = result.content[1].text as string
    expect(text).not.toContain("user:pass")
    expect(text).not.toContain("token=abc123")
    expect(text).toContain("token=[redacted]")
    expect(text).not.toContain("#frag")
    expect(text).toContain("size=large")
    expect(text).toContain("page=2")
  })

  test("an oversized network list is rejected with narrowing guidance", () => {
    const big = "x".repeat(33 * 1024)
    expect(() =>
      WebMcpProfile.boundReadResult(
        "list_network_requests",
        { content: [{ type: "text", text: big }] },
        "https://a.test",
      ),
    ).toThrow("exceeded the 32 KiB read budget")
  })
})
