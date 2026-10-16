import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { WebMcpProfile } from "../../src/mcp/webmcp-profile"

const bridge = vi.hoisted(() => ({
  names: [] as string[],
  launch: vi.fn(),
  call: vi.fn(),
}))

vi.mock("@modelcontextprotocol/client", () => ({
  Client: class {
    async connect() {}
    async close() {}
    async listTools() {
      return {
        tools: bridge.names.map((name) => ({ name, inputSchema: { type: "object", additionalProperties: true } })),
      }
    }
    setNotificationHandler(_schema: unknown, _handler: () => Promise<void>) {}
    setRequestHandler() {}
    callTool(...args: unknown[]) {
      return bridge.call(...args)
    }
  },
}))

vi.mock("@modelcontextprotocol/client/stdio", () => ({
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
      expect((await MCP.status()).bridge).toMatchObject({ status: "blocked", reason: "managed_policy" })
      expect(bridge.launch).not.toHaveBeenCalled()
      expect((await MCP.clients()).bridge).toBeUndefined()
    },
  })
})

test("managed deny reports a blocked status for a dynamic connection", async () => {
  await writeManaged({ webmcp: { allow: false } })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await MCP.add("bridge", profile())).status.bridge).toMatchObject({
        status: "blocked",
        reason: "managed_policy",
      })
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
  bridge.call.mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { pages: [{ id: 1, url: "https://example.test/", title: "App", selected: true }] },
  })
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

test("a project-sourced webmcp entry connects on an explicit gesture without a trust grant", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  await using tmp = await tmpdir({
    git: true,
    config: { mcp: { bridge: profile() } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Project sources are untrusted by default: startup holds the entry at
      // needs_trust and never spawns a process.
      expect((await MCP.status()).bridge).toMatchObject({ status: "needs_trust" })
      expect(bridge.launch).not.toHaveBeenCalled()
      // An explicit connect (the sidebar chip click) is itself the user
      // gesture: with the launch argv pinned by validateLaunch, the trust gate
      // is exempt here and the bridge connects without a prior trust grant.
      await MCP.connect("bridge")
      expect(bridge.launch).toHaveBeenCalled()
      expect((await MCP.status()).bridge).toMatchObject({ status: "connected" })
    },
  })
})

test("a webmcp entry with a tampered command connects but never runs that command", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  await using tmp = await tmpdir({
    git: true,
    config: {
      mcp: {
        bridge: {
          ...profile(),
          command: ["node", "-e", "process.exit(1)"],
        },
      },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      // ADR-173/197: the stored command is discarded, so the gesture launches
      // the regenerated argv and the tampered arguments never reach a process.
      expect((await MCP.status()).bridge).toMatchObject({ status: "connected" })
      const options = bridge.launch.mock.calls[0]?.[0] as { command: string; args: string[] }
      expect(options.args).toContain(WebMcpProfile.PACKAGE)
      expect(options.args).not.toContain("-e")
      expect(options.args).not.toContain("process.exit(1)")
    },
  })
})

test("a project-sourced webmcp entry with a custom executablePath stays trust-gated on an explicit connect", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  await using tmp = await tmpdir({
    git: true,
    init: async (dir) => {
      const chrome = path.join(dir, "chrome")
      // Records any execution: the version preflight runs this binary before
      // the bridge launch, so it must never run without a trust grant.
      await fs.writeFile(chrome, `#!/bin/sh\ntouch "${dir}/ran"\necho 'Google Chrome 154.0.0.0'\n`, { mode: 0o755 })
      await fs.writeFile(
        path.join(dir, "ax-code.json"),
        JSON.stringify({
          mcp: { bridge: WebMcpProfile.config({ allowedOrigins: ["https://example.test"], executablePath: chrome }) },
        }),
      )
      return dir
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      expect(bridge.launch).not.toHaveBeenCalled()
      await expect(fs.access(path.join(tmp.extra, "ran"))).rejects.toThrow()
      const status = (await MCP.status()).bridge
      expect(status).toMatchObject({ status: "needs_trust" })
      expect(status && "error" in status ? status.error : undefined).toContain("executablePath")
    },
  })
})

test("a project-sourced webmcp entry with a stale command connects on an explicit gesture with the regenerated argv", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  // The shape an older ax-code wrote: an earlier pin and a retired flag set.
  const stale = [
    "npx",
    "-y",
    "chrome-devtools-mcp@1.8.0",
    "--isolated",
    "--no-usage-statistics",
    "--no-performance-crux",
    "--no-category-emulation",
    "--no-category-performance",
    "--category-experimental-webmcp",
    "--experimental-structured-content",
    "--chrome-arg=--enable-features=WebMCP",
  ]
  await using tmp = await tmpdir({
    git: true,
    config: { mcp: { bridge: { ...profile(), command: stale } } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await MCP.status()).bridge).toMatchObject({ status: "needs_trust" })
      await MCP.connect("bridge")
      expect((await MCP.status()).bridge).toMatchObject({ status: "connected" })
      const options = bridge.launch.mock.calls[0]?.[0] as { args: string[] }
      expect(options.args).toContain(WebMcpProfile.PACKAGE)
      expect(options.args).not.toContain("chrome-devtools-mcp@1.8.0")
      expect(options.args).not.toContain("--no-category-emulation")
    },
  })
})

test("chrome preflight requires Chrome 150+", async () => {
  const dir = await fs.mkdtemp(path.join("/tmp", "webmcp-chrome-"))
  try {
    const good = path.join(dir, "chrome-good")
    const old = path.join(dir, "chrome-old")
    await fs.writeFile(good, "#!/bin/sh\necho 'Google Chrome 154.0.8037.98'\n", { mode: 0o755 })
    await fs.writeFile(old, "#!/bin/sh\necho 'Google Chrome 149.0.1.1'\n", { mode: 0o755 })
    expect(WebMcpProfile.chromeMajor("Google Chrome 154.0.8037.98")).toBe(154)
    expect(WebMcpProfile.chromeMajor("Chromium 150.0.0.0")).toBe(150)
    expect(WebMcpProfile.chromeMajor("Google Chrome for Testing 150.0.0.0")).toBe(150)
    expect(WebMcpProfile.chromeMajor("Mozilla Firefox 154.0.1")).toBeUndefined()
    expect(WebMcpProfile.chromeMajor("prefix 150.0 rest")).toBeUndefined()
    expect(WebMcpProfile.chromeMajor("no version here")).toBeUndefined()
    expect(WebMcpProfile.chromeMajor("oops Google Chrome 154.0.8037.98")).toBeUndefined()
    expect(WebMcpProfile.chromeMajor("Google Chrome 99999999999999999999999.0")).toBeUndefined()
    expect(await WebMcpProfile.verifyChromeVersion(good)).toEqual({ ok: true })
    expect(await WebMcpProfile.verifyChromeVersion(old)).toMatchObject({ ok: false })
    expect(await WebMcpProfile.verifyChromeVersion(path.join(dir, "missing"))).toMatchObject({ ok: false })
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test("a session origin grant is refused under a managed ceiling without relaunching (ADR-168)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({ content: [{ type: "text", text: "ok" }], structuredContent: { pages: [] } })
  await writeManaged({
    webmcp: { allowedOrigins: ["https://example.test", "https://allowed.test"] },
    mcp: { bridge: profile() },
  })
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.connect("bridge")
      const launches = bridge.launch.mock.calls.length
      expect(await MCP.grantWebMcpOrigin("bridge", "https://news.test")).toMatchObject({ ok: false })
      expect(await MCP.checkWebMcpOriginGrant("bridge", "https://news.test")).toMatchObject({ ok: false })
      expect(bridge.launch.mock.calls.length).toBe(launches)
      // An origin the managed list admits can still be granted.
      expect(await MCP.checkWebMcpOriginGrant("bridge", "https://allowed.test")).toEqual({ ok: true })
    },
  })
})
