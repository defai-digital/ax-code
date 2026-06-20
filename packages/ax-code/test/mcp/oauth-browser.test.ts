import { test, expect, beforeEach, afterAll, vi } from "vitest"
import { EventEmitter } from "events"

// Track open() calls and control failure behavior
let openShouldFail = false
let openCalledWith: string | undefined

vi.mock("open", () => ({
  default: async (url: string) => {
    openCalledWith = url

    // Return a mock subprocess that emits an error if openShouldFail is true
    const subprocess = new EventEmitter()
    if (openShouldFail) {
      // Emit error asynchronously like a real subprocess would
      setTimeout(() => {
        subprocess.emit("error", new Error("spawn xdg-open ENOENT"))
      }, 10)
    }
    return subprocess
  },
}))

// Mock UnauthorizedError
class MockUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []

// Mock the transport constructors
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    url: string
    authProvider: { redirectToAuthorization?: (url: URL) => Promise<void> } | undefined
    constructor(url: URL, options?: { authProvider?: { redirectToAuthorization?: (url: URL) => Promise<void> } }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      // Simulate OAuth redirect by calling the authProvider's redirectToAuthorization
      if (this.authProvider?.redirectToAuthorization) {
        await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?client_id=test"))
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      // Mock successful auth completion
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(url: URL) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: {},
      })
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
  },
}))

// Mock the MCP SDK Client to trigger OAuth flow
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
  },
}))

// Mock UnauthorizedError in the auth module
vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

beforeEach(() => {
  openShouldFail = false
  openCalledWith = undefined
  transportCalls.length = 0
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { Bus } = await import("../../src/bus")
const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const { Ssrf } = await import("../../src/util/ssrf")
const { Config } = await import("../../src/config/config")
const { McpTrust } = await import("../../src/mcp/trust")
const originalAssertPublicUrl = Ssrf.assertPublicUrl

afterAll(async () => {
  Ssrf.assertPublicUrl = originalAssertPublicUrl
  await McpOAuthCallback.stop()
  vi.restoreAllMocks()
})

const ensureSpy = vi.spyOn(McpOAuthCallback, "ensureRunning")
const waitSpy = vi.spyOn(McpOAuthCallback, "waitForCallback")
const stopSpy = vi.spyOn(McpOAuthCallback, "stop")

let rejectAuth: ((error: Error) => void) | undefined

beforeEach(() => {
  rejectAuth = undefined
  Ssrf.assertPublicUrl = vi.fn(async () => {})
  ensureSpy.mockResolvedValue(undefined)
  waitSpy.mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        rejectAuth = reject
      }),
  )
  stopSpy.mockImplementation(async () => {
    rejectAuth?.(new Error("OAuth callback server stopped"))
    rejectAuth = undefined
  })
})

async function trustConfiguredMcp(name: string) {
  const entry = await Config.mcpEntry(name)
  if (!entry) throw new Error(`missing MCP config for ${name}`)
  if (!("type" in entry.config)) throw new Error(`MCP config is disabled for ${name}`)
  await McpTrust.trust(name, entry.config, entry.source)
}

test("BrowserOpenFailed event is published when open() throws", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-server": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await trustConfiguredMcp("test-oauth-server")
      openShouldFail = true

      const events: Array<{ mcpName: string; url: string }> = []
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
      })

      // Run authenticate with a timeout to avoid waiting forever for the callback
      // Attach a handler immediately so callback shutdown rejections
      // don't show up as unhandled between tests.
      const authPromise = MCP.authenticate("test-oauth-server").catch(() => undefined)

      // open() waits 500ms before treating browser launch as successful.
      await new Promise((resolve) => setTimeout(resolve, 1_000))

      await McpOAuthCallback.stop()
      await authPromise

      unsubscribe()

      // Verify the BrowserOpenFailed event was published
      expect(events.length).toBe(1)
      expect(events[0].mcpName).toBe("test-oauth-server")
      expect(events[0].url).toContain("https://")
    },
  })
})

test("BrowserOpenFailed event is NOT published when open() succeeds", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-server-2": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await trustConfiguredMcp("test-oauth-server-2")
      openShouldFail = false

      const events: Array<{ mcpName: string; url: string }> = []
      const unsubscribe = Bus.subscribe(MCP.BrowserOpenFailed, (evt) => {
        events.push(evt.properties)
      })

      const authPromise = MCP.authenticate("test-oauth-server-2").catch(() => undefined)

      await new Promise((resolve) => setTimeout(resolve, 1_000))

      await McpOAuthCallback.stop()
      await authPromise

      unsubscribe()

      // Verify NO BrowserOpenFailed event was published
      expect(events.length).toBe(0)
      // Verify open() was still called
      expect(openCalledWith).toBeDefined()
    },
  })
})

test("open() is called with the authorization URL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-server-3": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await trustConfiguredMcp("test-oauth-server-3")
      openShouldFail = false
      openCalledWith = undefined

      const authPromise = MCP.authenticate("test-oauth-server-3").catch(() => undefined)

      await new Promise((resolve) => setTimeout(resolve, 1_000))

      await McpOAuthCallback.stop()
      await authPromise

      // Verify open was called with a URL
      expect(openCalledWith).toBeDefined()
      expect(typeof openCalledWith).toBe("string")
      expect(openCalledWith!).toContain("https://")
    },
  })
})
