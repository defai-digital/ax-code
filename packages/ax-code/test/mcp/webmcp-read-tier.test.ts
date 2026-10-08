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

  test("read on admits exactly the three T1 tools plus the six T0 tools", () => {
    const profile = readProfile()
    expect(profile.read).toBe(true)
    for (const name of [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS]) {
      expect(WebMcpProfile.allows(name, profile)).toBe(true)
      expect(() => WebMcpProfile.callSchema(name, profile)).not.toThrow()
    }
    for (const name of [
      "evaluate_script",
      "click",
      "fill",
      "upload_file",
      "list_network_requests",
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

  test("take_screenshot bounds format, quality and uid", () => {
    const profile = readProfile()
    expect(
      WebMcpProfile.validateCall(profile, "take_screenshot", {
        pageId: 1,
        format: "webp",
        quality: 80,
        uid: "node-1",
        fullPage: true,
      }),
    ).toMatchObject({ format: "webp", quality: 80, uid: "node-1", fullPage: true })
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

  test("read on exposes the three T1 tools with strict schemas", async () => {
    bridge.names = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS, "evaluate_script", "click"]
    bridge.call.mockResolvedValue({ content: [] })
    await using tmp = await tmpdir({ git: true, config: { username: "test" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.add("bridge", profileWithRead())
        const tools = await MCP.tools()
        const expected = [...WebMcpProfile.TOOLS, ...WebMcpProfile.READ_TOOLS].map((name) => `bridge_${name}`).sort()
        expect(Object.keys(tools).sort()).toEqual(expected)
        expect(tools.bridge_evaluate_script).toBeUndefined()
        expect(tools.bridge_click).toBeUndefined()
        expect(tools.bridge_take_snapshot.webmcp?.toolName).toBe("take_snapshot")
        const options = { toolCallId: "call_read", messages: [], abortSignal: new AbortController().signal }
        await expect(
          tools.bridge_take_screenshot.execute!({ pageId: 1, filePath: "/tmp/x.png" }, options),
        ).rejects.toThrow()
        await tools.bridge_take_snapshot.execute!({ pageId: 1 }, options)
        expect(bridge.call).toHaveBeenCalledWith(
          { name: "take_snapshot", arguments: { pageId: 1 } },
          expect.anything(),
          expect.anything(),
        )
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
