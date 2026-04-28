import { test, expect, mock, beforeEach, afterAll } from "bun:test"

// Mock UnauthorizedError to match the SDK's class
class MockUnauthorizedError extends Error {
  constructor(message?: string) {
    super(message ?? "Unauthorized")
    this.name = "UnauthorizedError"
  }
}

// Track what options were passed to each transport constructor
const transportCalls: Array<{
  type: "streamable" | "sse"
  url: string
  options: { authProvider?: unknown }
}> = []
const transportInstances: Array<{ url: string; closeCalls: number }> = []
const clientInstances: Array<{ closeCalls: number }> = []
const authenticatedUrls = new Set<string>()
const pendingOauthStates = new Map<string, { reject: (error: Error) => void }>()
const pendingOauthNames = new Map<string, string>()
let callbackRunning = false

// Controls whether the mock transport simulates a 401 that triggers the SDK
// auth flow (which calls provider.state()) or a simple UnauthorizedError.
let simulateAuthFlow = true

function assertMockPublicUrl(url: string) {
  const hostname = new URL(url).hostname.toLowerCase()
  if (hostname === "localhost" || hostname === "::1") {
    throw new Error(`mock-ssrf: refusing private hostname ${hostname}`)
  }

  const ipv4 = hostname.split(".").map((part) => Number.parseInt(part, 10))
  if (ipv4.length !== 4 || ipv4.some((part) => Number.isNaN(part))) return

  const [a, b] = ipv4
  if (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  ) {
    throw new Error(`mock-ssrf: refusing private address ${hostname}`)
  }
}

afterAll(() => {
  mock.restore()
})

// Mock the transport constructors to simulate OAuth auto-auth on 401
mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTP {
    url: string
    closeCalls = 0
    authProvider:
      | {
          state?: () => Promise<string>
          redirectToAuthorization?: (url: URL) => Promise<void>
          saveCodeVerifier?: (v: string) => Promise<void>
        }
      | undefined
    constructor(url: URL, options?: { authProvider?: unknown }) {
      this.url = url.toString()
      this.authProvider = options?.authProvider as typeof this.authProvider
      transportCalls.push({
        type: "streamable",
        url: this.url,
        options: options ?? {},
      })
      transportInstances.push(this)
    }
    async start() {
      if (authenticatedUrls.has(this.url)) return
      // Simulate what the real SDK transport does on 401:
      // It calls auth() which eventually calls provider.state(), then
      // provider.redirectToAuthorization(), then throws UnauthorizedError.
      if (simulateAuthFlow && this.authProvider) {
        // The SDK calls provider.state() to get the OAuth state parameter
        if (this.authProvider.state) {
          await this.authProvider.state()
        }
        // The SDK calls saveCodeVerifier before redirecting
        if (this.authProvider.saveCodeVerifier) {
          await this.authProvider.saveCodeVerifier("test-verifier")
        }
        // The SDK calls redirectToAuthorization to redirect the user
        if (this.authProvider.redirectToAuthorization) {
          await this.authProvider.redirectToAuthorization(new URL("https://auth.example.com/authorize?state=test"))
        }
        throw new MockUnauthorizedError()
      }
      throw new MockUnauthorizedError()
    }
    async finishAuth(_code: string) {
      authenticatedUrls.add(this.url)
    }
    async close() {
      this.closeCalls++
    }
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    // `transportInstances` is typed `{ url: string; closeCalls: number }[]`,
    // so MockSSE must surface a `url` field on the instance — mirrors the
    // streamable mock above. Without this the `transportInstances.push(this)`
    // call below fails typecheck (Property 'url' missing in MockSSE).
    url: string
    closeCalls = 0
    constructor(url: URL, options?: { authProvider?: unknown }) {
      this.url = url.toString()
      transportCalls.push({
        type: "sse",
        url: this.url,
        options: options ?? {},
      })
      transportInstances.push(this)
    }
    async start() {
      throw new Error("Mock SSE transport cannot connect")
    }
    async close() {
      this.closeCalls++
    }
  },
}))

// Mock the MCP SDK Client
mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    closeCalls = 0
    setNotificationHandler() {}
    async connect(transport: { start: () => Promise<void> }) {
      await transport.start()
    }
    async listTools() {
      return { tools: [] }
    }
    async close() {
      this.closeCalls++
    }
    constructor() {
      clientInstances.push(this)
    }
  },
}))

// Mock UnauthorizedError in the auth module so instanceof checks work
mock.module("@modelcontextprotocol/sdk/client/auth.js", () => ({
  UnauthorizedError: MockUnauthorizedError,
}))

mock.module("../../src/util/ssrf", () => ({
  Ssrf: {
    assertPublicUrl: async (url: string) => {
      assertMockPublicUrl(url)
    },
    pinnedFetch: (url: string | URL | Request, init?: RequestInit) => fetch(url, init),
  },
}))

mock.module("../../src/mcp/oauth-callback", () => ({
  McpOAuthCallback: {
    ensureRunning: async () => {
      callbackRunning = true
    },
    waitForCallback: (oauthState: string, mcpName?: string) =>
      new Promise<string>((_resolve, reject) => {
        pendingOauthStates.set(oauthState, { reject })
        if (mcpName) pendingOauthNames.set(mcpName, oauthState)
      }),
    cancelPending: (mcpName: string) => {
      const oauthState = pendingOauthNames.get(mcpName)
      if (!oauthState) return
      const pending = pendingOauthStates.get(oauthState)
      if (!pending) return
      pendingOauthStates.delete(oauthState)
      pendingOauthNames.delete(mcpName)
      pending.reject(new Error("Authorization cancelled"))
    },
    stop: async () => {
      callbackRunning = false
      for (const oauthState of [...pendingOauthStates.keys()]) {
        pendingOauthStates.delete(oauthState)
      }
      pendingOauthNames.clear()
    },
    isRunning: () => callbackRunning,
    isPortInUse: async () => callbackRunning,
  },
}))

beforeEach(() => {
  transportCalls.length = 0
  transportInstances.length = 0
  clientInstances.length = 0
  authenticatedUrls.clear()
  simulateAuthFlow = true
  pendingOauthStates.clear()
  pendingOauthNames.clear()
})

// Import modules after mocking
const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

test("first connect to OAuth server shows needs_auth instead of failed", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth": {
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
      const result = await MCP.add("test-oauth", {
        type: "remote",
        url: "https://example.com/mcp",
      })

      const serverStatus = result.status as Record<string, { status: string; error?: string }>

      // The server should be detected as needing auth, NOT as failed.
      // Before the fix, provider.state() would throw a plain Error
      // ("No OAuth state saved for MCP server: test-oauth") which was
      // not caught as UnauthorizedError, causing status to be "failed".
      expect(serverStatus["test-oauth"]).toBeDefined()
      expect(serverStatus["test-oauth"].status).toBe("needs_auth")
    },
  })
})

test("connect path closes unused SSE transport when StreamableHTTP path is selected first", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {},
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const result = await MCP.add("test-oauth-close", {
        type: "remote",
        url: "https://example.com/mcp",
      })

      const serverStatus = result.status as Record<string, { status: string; error?: string }>
      expect(serverStatus["test-oauth-close"]).toBeDefined()
      expect(serverStatus["test-oauth-close"].status).toBe("needs_auth")

      const streamable = transportInstances[0]
      const sse = transportInstances[1]
      const firstClient = clientInstances[0]
      expect(streamable?.closeCalls).toBe(0)
      expect(sse?.closeCalls).toBe(1)
      // The first client is intentionally NOT closed in the needs_auth
      // path. In the real MCP SDK `client.close()` chains down to
      // `transport.close()`, so closing the client would also close the
      // transport we just stored in `pendingOAuthTransports` for
      // `finishAuth` to reuse. The mock here decouples client and
      // transport close, so previously this assertion was `1` and silently
      // masked the production bug where finishAuth got a dead transport.
      expect(firstClient?.closeCalls).toBe(0)
    },
  })
})

test("state() generates a new state when none is saved", async () => {
  const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
  const { McpAuth } = await import("../../src/mcp/auth")

  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-state-gen",
        "https://example.com/mcp",
        {},
        { onRedirect: async () => {} },
      )

      // Ensure no state exists
      const entryBefore = await McpAuth.get("test-state-gen")
      expect(entryBefore?.oauthState).toBeUndefined()

      // state() should generate and return a new state, not throw
      const state = await provider.state()
      expect(typeof state).toBe("string")
      expect(state.length).toBe(64) // 32 bytes as hex

      // The generated state should be persisted
      const entryAfter = await McpAuth.get("test-state-gen")
      expect(entryAfter?.oauthState).toBe(state)
    },
  })
})

test("state() returns existing state when one is saved", async () => {
  const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
  const { McpAuth } = await import("../../src/mcp/auth")

  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = new McpOAuthProvider(
        "test-state-existing",
        "https://example.com/mcp",
        {},
        { onRedirect: async () => {} },
      )

      // Pre-save a state
      const existingState = "pre-saved-state-value"
      await McpAuth.updateOAuthState("test-state-existing", existingState)

      // state() should return the existing state
      const state = await provider.state()
      expect(state).toBe(existingState)
    },
  })
})

test("startAuth reuses an existing saved oauth state", async () => {
  const { McpAuth } = await import("../../src/mcp/auth")

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth": {
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
      const state = "existing-oauth-state"
      await McpAuth.updateOAuthState("test-oauth", state)

      await MCP.startAuth("test-oauth")

      expect(await McpAuth.getOAuthState("test-oauth")).toBe(state)
    },
  })
})

test("startAuth closes prior pending OAuth transport before creating a new one", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-rotate": {
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
      await MCP.startAuth("test-oauth-rotate")
      const firstTransport = transportInstances[0]
      const firstClient = clientInstances[0]
      expect(firstTransport?.closeCalls).toBe(0)
      expect(firstClient?.closeCalls).toBe(1)

      await MCP.startAuth("test-oauth-rotate")
      const secondClient = clientInstances[1]

      expect(firstTransport?.closeCalls).toBe(1)
      expect(transportInstances).toHaveLength(2)
      expect(clientInstances).toHaveLength(2)

      const secondTransport = transportInstances[1]
      expect(secondTransport?.closeCalls).toBe(0)
      expect(secondClient?.closeCalls).toBe(1)

      await MCP.removeAuth("test-oauth-rotate")
      expect(secondTransport?.closeCalls).toBe(1)
    },
  })
})

test("startAuth closes temporary client and transport when authentication is already valid", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-success": {
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
      authenticatedUrls.add("https://example.com/mcp")

      const result = await MCP.startAuth("test-oauth-success")
      expect(result.authorizationUrl).toBe("")

      const transport = transportInstances[0]
      const client = clientInstances[0]
      expect(transport?.closeCalls).toBe(1)
      expect(client?.closeCalls).toBe(1)
    },
  })
})

test("finishAuth closes the pending OAuth transport after reconnecting", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-finish": {
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
      await MCP.startAuth("test-oauth-finish")
      const pending = transportInstances[0]!
      expect(pending.closeCalls).toBe(0)

      const status = await MCP.finishAuth("test-oauth-finish", "auth-code")
      expect(status.status).toBe("connected")
      expect(pending.closeCalls).toBe(1)
    },
  })
})

test("removeAuth closes the pending OAuth transport", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-remove": {
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
      await MCP.startAuth("test-oauth-remove")
      const pending = transportInstances[0]!
      expect(pending.closeCalls).toBe(0)

      await MCP.removeAuth("test-oauth-remove")
      expect(pending.closeCalls).toBe(1)
    },
  })
})

test("instance disposal closes pending OAuth transports", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        `${dir}/ax-code.json`,
        JSON.stringify({
          $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
          mcp: {
            "test-oauth-dispose": {
              type: "remote",
              url: "https://example.com/mcp",
            },
          },
        }),
      )
    },
  })

  let pending: { closeCalls: number } | undefined
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.startAuth("test-oauth-dispose")
      pending = transportInstances[0]
      expect(pending?.closeCalls).toBe(0)
    },
  })

  await Instance.disposeAll()
  expect(pending?.closeCalls).toBe(1)
})
