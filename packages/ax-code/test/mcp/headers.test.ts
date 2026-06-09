import { test, expect, mock, beforeEach, afterAll } from "bun:test"

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: {
    authProvider?: unknown
    requestInit?: RequestInit
    fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>
  }
}> = []

let callbackRunning = false
const pendingOauthStates = new Map<string, { reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
const pendingOauthNames = new Map<string, string>()

function resetMockOAuthCallback() {
  callbackRunning = false
  for (const { timeout } of pendingOauthStates.values()) {
    clearTimeout(timeout)
  }
  pendingOauthStates.clear()
  pendingOauthNames.clear()
}

// Mock the transport constructors to capture their arguments
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    constructor(
      url: URL,
      options?: {
        authProvider?: unknown
        requestInit?: RequestInit
        fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>
      },
    ) {
      transportCalls.push({
        type: "streamable",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(
      url: URL,
      options?: {
        authProvider?: unknown
        requestInit?: RequestInit
        fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>
      },
    ) {
      transportCalls.push({
        type: "sse",
        url: url.toString(),
        options: options ?? {},
      })
    }
    async start() {
      throw new Error("Mock transport cannot connect")
    }
  },
}))

mock.module("../../src/mcp/oauth-callback", () => ({
  McpOAuthCallback: {
    ensureRunning: mock(async () => {
      callbackRunning = true
    }),
    waitForCallback: (oauthState: string, mcpName?: string) =>
      new Promise<string>((_resolve, reject) => {
        const previous = pendingOauthStates.get(oauthState)
        if (previous) {
          clearTimeout(previous.timeout)
          previous.reject(new Error("OAuth callback request superseded"))
        }

        const timeout = setTimeout(
          () => {
            pendingOauthStates.delete(oauthState)
            if (mcpName) pendingOauthNames.delete(mcpName)
            reject(new Error("OAuth callback timeout - authorization took too long"))
          },
          5 * 60 * 1000,
        )

        pendingOauthStates.set(oauthState, { reject, timeout })
        if (mcpName) pendingOauthNames.set(mcpName, oauthState)
      }),
    cancelPending: (mcpName: string) => {
      const oauthState = pendingOauthNames.get(mcpName)
      if (!oauthState) return
      const pending = pendingOauthStates.get(oauthState)
      if (!pending) return
      clearTimeout(pending.timeout)
      pendingOauthStates.delete(oauthState)
      pendingOauthNames.delete(mcpName)
      pending.reject(new Error("Authorization cancelled"))
    },
    stop: async () => {
      resetMockOAuthCallback()
    },
    isRunning: () => callbackRunning,
    isPortInUse: async () => callbackRunning,
  },
}))

beforeEach(() => {
  transportCalls.length = 0
  resetMockOAuthCallback()
})

// Import MCP after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const { Ssrf } = await import("../../src/util/ssrf")
const originalAssertPublicUrl = Ssrf.assertPublicUrl
const originalPinnedFetch = Ssrf.pinnedFetch
const pinnedCalls: Array<{ url: string; init?: RequestInit & { label?: string } }> = []

beforeEach(() => {
  Ssrf.assertPublicUrl = mock(async () => {})
  Ssrf.pinnedFetch = mock(async (url: string | URL, init?: RequestInit & { label?: string }) => {
    pinnedCalls.push({ url: url.toString(), init })
    return new Response(null, { status: 204 })
  }) as typeof Ssrf.pinnedFetch
  pinnedCalls.length = 0
})

afterAll(() => {
  Ssrf.assertPublicUrl = originalAssertPublicUrl
  Ssrf.pinnedFetch = originalPinnedFetch
  mock.restore()
})

test("headers are passed to transports when oauth is enabled (default)", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-server": {
              type: "remote",
              url: "https://example.com/mcp",
              headers: {
                Authorization: "Bearer test-token",
                "X-Custom-Header": "custom-value",
              },
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Trigger MCP initialization - it will fail to connect but we can check the transport options
      await MCP.add("test-server", {
        type: "remote",
        url: "https://example.com/mcp",
        headers: {
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        },
      }).catch(() => {})

      // Both transports should have been created with headers
      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
          "X-Custom-Header": "custom-value",
        })
        // OAuth should be enabled by default, so authProvider should exist
        expect(call.options.authProvider).toBeDefined()
        expect(call.options.fetch).toBeDefined()
        await call.options.fetch?.(new URL(call.url), { method: "GET" })
        expect(pinnedCalls.at(-1)).toMatchObject({ url: call.url, init: { method: "GET", label: "mcp" } })
      }
    },
  })
})

test("headers are passed to transports when oauth is explicitly disabled", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-oauth", {
        type: "remote",
        url: "https://example.com/mcp",
        oauth: false,
        headers: {
          Authorization: "Bearer test-token",
        },
      }).catch(() => {})

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        expect(call.options.requestInit).toBeDefined()
        expect(call.options.requestInit?.headers).toEqual({
          Authorization: "Bearer test-token",
        })
        // OAuth is disabled, so no authProvider
        expect(call.options.authProvider).toBeUndefined()
        expect(call.options.fetch).toBeDefined()
      }
    },
  })
})

test("no requestInit when headers are not provided", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      transportCalls.length = 0

      await MCP.add("test-server-no-headers", {
        type: "remote",
        url: "https://example.com/mcp",
      }).catch(() => {})

      expect(transportCalls.length).toBeGreaterThanOrEqual(1)

      for (const call of transportCalls) {
        // No headers means requestInit should be undefined
        expect(call.options.requestInit).toBeUndefined()
        expect(call.options.fetch).toBeDefined()
      }
    },
  })
})

test("converted MCP tools forward the tool abort signal to client.callTool", async () => {
  const source = await Bun.file(new URL("../../src/mcp/tool-conversion.ts", import.meta.url)).text()
  expect(source).toContain("execute: async (args: unknown, opts: ToolCallOptions)")
  expect(source).toContain("signal: opts.abortSignal")
})
