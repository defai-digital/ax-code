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
const { Config } = await import("../../src/config/config")
const { Global } = await import("../../src/global")
const { tmpdir } = await import("../fixture/fixture")

const managedDir = process.env.AX_CODE_TEST_MANAGED_CONFIG_DIR

async function writeManaged(settings: unknown) {
  if (!managedDir) throw new Error("AX_CODE_TEST_MANAGED_CONFIG_DIR is not set")
  await fs.mkdir(managedDir, { recursive: true })
  await fs.writeFile(path.join(managedDir, "ax-code.json"), JSON.stringify(settings))
}

/** Global config is process-wide, so point it at a tmpdir for the test's life. */
async function withIsolatedGlobalConfig(run: () => Promise<void>) {
  await using globalTmp = await tmpdir()
  const previous = Global.Path.config
  ;(Global.Path as { config: string }).config = globalTmp.path
  Config.global.reset()
  try {
    await run()
  } finally {
    ;(Global.Path as { config: string }).config = previous
    Config.global.reset()
  }
}

async function globalConfigFile(): Promise<Record<string, unknown> | undefined> {
  const file = path.join(Global.Path.config, "ax-code.jsonc")
  if (!existsSync(file)) return undefined
  return parseJsonc(await fs.readFile(file, "utf8")) as Record<string, unknown>
}

function launchArgv(call: unknown): string[] {
  const options = call as { command?: string; args?: string[] }
  return [...(options.command ? [options.command] : []), ...(options.args ?? [])]
}

afterEach(async () => {
  await Instance.disposeAll()
  if (managedDir) await fs.rm(managedDir, { recursive: true, force: true })
  bridge.names = []
  vi.resetAllMocks()
})

test("ships a pre-registered, disabled, unrestricted default entry (ADR-170)", async () => {
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entry = (await Config.get()).mcp?.webmcp
        expect(entry).toMatchObject({ type: "local", enabled: false, webmcp: { allowedOrigins: [] } })
        if (entry && "type" in entry && entry.type === "local") {
          expect(entry.command.some((arg) => arg.startsWith("--allowed-url-pattern="))).toBe(false)
        }
        // The startup bulk connect never launches it: the chip is the gesture.
        expect((await MCP.status()).webmcp).toMatchObject({ status: "disabled" })
        expect(bridge.launch).not.toHaveBeenCalled()
      },
    })
  })
})

test("does not inject the default when a webmcp entry is already configured", async () => {
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { mcp: { bridge: WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }) } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const config = await Config.get()
        expect(config.mcp?.bridge).toBeDefined()
        expect(config.mcp?.webmcp).toBeUndefined()
      },
    })
  })
})

test("does not inject when the product name is taken by a plain entry", async () => {
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({
      git: true,
      config: { mcp: { webmcp: { type: "local", command: ["echo", "ok"], enabled: false } } },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const entry = (await Config.get()).mcp?.webmcp
        expect(entry).toMatchObject({ type: "local", enabled: false })
        expect(entry && "webmcp" in entry).toBe(false)
      },
    })
  })
})

test("the chip gesture persists to user-level config and survives a restart", async () => {
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.connect("webmcp")
        expect((await MCP.status()).webmcp).toMatchObject({ status: "connected" })
        expect(bridge.launch).toHaveBeenCalledTimes(1)
        expect(
          launchArgv(bridge.launch.mock.calls[0]![0]).some((arg) => arg.startsWith("--allowed-url-pattern=")),
        ).toBe(false)
      },
    })
    const written = await globalConfigFile()
    const persisted = written?.mcp as Record<string, Record<string, unknown>> | undefined
    expect(persisted?.webmcp?.enabled).toBe(true)
    expect((persisted?.webmcp?.webmcp as { allowedOrigins?: string[] } | undefined)?.allowedOrigins).toEqual([])

    // Restart: the persisted user-level entry replaces the injected default and
    // the startup bulk connect launches the bridge without a fresh gesture.
    await Instance.disposeAll()
    await using tmp2 = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp2.path,
      fn: async () => {
        expect((await MCP.status()).webmcp).toMatchObject({ status: "connected" })
        expect(bridge.launch).toHaveBeenCalledTimes(2)

        // The chip's off toggle persists the same way.
        await MCP.disconnect("webmcp")
        expect((await MCP.status()).webmcp).toMatchObject({ status: "disabled" })
      },
    })
    expect(
      ((await globalConfigFile())?.mcp as Record<string, { enabled?: boolean }> | undefined)?.webmcp?.enabled,
    ).toBe(false)

    // Restart again: the persisted disable wins; nothing launches.
    await Instance.disposeAll()
    await using tmp3 = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp3.path,
      fn: async () => {
        expect((await MCP.status()).webmcp).toMatchObject({ status: "disabled" })
        expect(bridge.launch).toHaveBeenCalledTimes(2)
      },
    })
  })
})

test("a drifted launch command is trust-gated, then self-heals on connect (ADR-173)", async () => {
  const fresh = WebMcpProfile.config({ allowedOrigins: ["https://example.test"] }, true)
  const drifted = { ...fresh, command: [...fresh.command, "--no-category-network"] }
  bridge.names = [...WebMcpProfile.TOOLS]
  await using tmp = await tmpdir({ git: true, config: { username: "test", mcp: { bridge: drifted } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // A drifted project entry is not trust-exempt (the ADR-173 exemption
      // requires the current reviewed argv), so the gesture alone stays gated.
      await MCP.connect("bridge")
      expect((await MCP.status()).bridge).toMatchObject({ status: "needs_trust" })
      expect(bridge.launch).not.toHaveBeenCalled()
      // The trust gesture clears the gate; the launch regenerates from the
      // validated profile instead of executing the drifted stored command.
      await MCP.trust("bridge")
      await MCP.connect("bridge")
      expect((await MCP.status()).bridge).toMatchObject({ status: "connected" })
      const argv = launchArgv(bridge.launch.mock.calls[0]![0])
      expect(argv).not.toContain("--no-category-network")
      expect(argv).toContain("--allowed-url-pattern=https://example.test/*")
    },
  })
})

test("managed deny blocks the injected default on the chip gesture", async () => {
  await writeManaged({ webmcp: { allow: false } })
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.connect("webmcp")
        expect((await MCP.status()).webmcp).toMatchObject({ status: "blocked", reason: "managed_policy" })
        expect(bridge.launch).not.toHaveBeenCalled()
      },
    })
    // A managed denial must never persist an enablement.
    expect(await globalConfigFile()).toBeUndefined()
  })
})

test("managed origins narrow the injected default and restore browser-layer patterns", async () => {
  await writeManaged({ webmcp: { allowedOrigins: ["https://corp.test"] } })
  bridge.names = [...WebMcpProfile.TOOLS]
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.connect("webmcp")
        expect((await MCP.status()).webmcp).toMatchObject({ status: "connected" })
        expect(launchArgv(bridge.launch.mock.calls[0]![0])).toContain("--allowed-url-pattern=https://corp.test/*")
        const tools = await MCP.tools()
        expect(tools.webmcp_new_page.webmcp?.profile.allowedOrigins).toEqual(["https://corp.test"])
      },
    })
  })
})

test("the injected default navigates any https origin with approval only (no grant, no relaunch)", async () => {
  bridge.names = [...WebMcpProfile.TOOLS]
  bridge.call.mockResolvedValue({
    content: [{ type: "text", text: "ok" }],
    structuredContent: { pages: [{ id: 1, url: "https://anything.test/", title: "App", selected: true }] },
  })
  await withIsolatedGlobalConfig(async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await MCP.connect("webmcp")
        const tools = await MCP.tools()
        const options = { toolCallId: "call_1", messages: [], abortSignal: new AbortController().signal }
        await expect(tools.webmcp_new_page.execute!({ url: "https://anything.test/" }, options)).resolves.toBeDefined()
        // One launch, no grant relaunch.
        expect(bridge.launch).toHaveBeenCalledTimes(1)
      },
    })
  })
})
