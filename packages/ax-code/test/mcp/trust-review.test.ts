import { afterEach, beforeEach, expect, test, vi } from "vitest"
import fs from "fs/promises"
import path from "path"

const localTransports: Array<{ command: string; args: string[]; closeCalls: number }> = []
let connectCalls = 0

vi.mock("@modelcontextprotocol/client/stdio", () => ({
  StdioClientTransport: class MockStdioClientTransport {
    command: string
    args: string[]
    closeCalls = 0
    stderr = {
      on() {},
      off() {},
    }

    constructor(input: { command: string; args?: string[] }) {
      this.command = input.command
      this.args = input.args ?? []
      localTransports.push(this)
    }

    async start() {}

    async close() {
      this.closeCalls++
    }
  },
}))

vi.mock("@modelcontextprotocol/client", async (importOriginal) => ({
  // v1 mocked separate SDK modules; v2 exports them from one package, so one
  // factory keeps the real exports and overrides only what the test fakes.
  ...(await importOriginal<typeof import("@modelcontextprotocol/client")>()),
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    async close() {}
  },
  SSEClientTransport: class MockSSEClientTransport {
    async close() {}
  },
  Client: class MockClient {
    transport?: { start?: () => Promise<void> }

    setNotificationHandler() {}
    setRequestHandler() {}

    async connect(transport: { start?: () => Promise<void> }) {
      this.transport = transport
      connectCalls++
      await transport.start?.()
    }

    async listTools() {
      return { tools: [] }
    }

    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Global } = await import("../../src/global")
const { Instance } = await import("../../src/project/instance")
const { McpTrust } = await import("../../src/mcp/trust")
const { tmpdir } = await import("../fixture/fixture")
const { Bus } = await import("../../src/bus")

const trustFile = path.join(Global.Path.data, "mcp-trust.json")

async function resetTrustFile() {
  await fs.rm(trustFile, { force: true }).catch(() => undefined)
}

beforeEach(async () => {
  localTransports.length = 0
  connectCalls = 0
  await resetTrustFile()
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetTrustFile()
})

// ADR-255: runtime-built review payload, fingerprint-bound trust, untrust, and the redacted event.

const LOCAL = {
  type: "local" as const,
  command: ["node", "server.js", "--port", "4000"],
  environment: { API_TOKEN: "super-secret-value", REGION: "eu" },
}

test("needs_trust carries the review a client shows, without environment values", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { local: LOCAL } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = (await MCP.status()).local
      expect(status?.status).toBe("needs_trust")
      if (status?.status !== "needs_trust") return
      expect(status.review).toEqual({
        transport: "local",
        command: ["node", "server.js", "--port", "4000"],
        environmentKeys: ["API_TOKEN", "REGION"],
      })
      expect(JSON.stringify(status)).not.toContain("super-secret-value")
    },
  })
})

test("the remote review keeps origin and path and header names only", () => {
  const review = MCP.trustReview({
    type: "remote",
    url: "https://mcp.example.com/v1/sse?api_key=abc123#frag",
    headers: { Authorization: "Bearer zzz", "X-Team": "core" },
  })
  expect(review).toEqual({
    transport: "remote",
    url: "https://mcp.example.com/v1/sse",
    headerKeys: ["Authorization", "X-Team"],
  })
  expect(JSON.stringify(review)).not.toMatch(/abc123|Bearer|core|frag/)
})

test("trustReviewed trusts only the fingerprint the user reviewed", async () => {
  await using tmp = await tmpdir({ git: true, config: { mcp: { local: LOCAL } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const events: Array<Record<string, unknown>> = []
      const unsubscribe = Bus.subscribe(MCP.TrustChanged, (event) => {
        events.push(event.properties)
      })
      try {
        const pending = (await MCP.status()).local
        if (pending?.status !== "needs_trust") throw new Error("expected needs_trust")

        expect(await MCP.trustReviewed("missing", pending.fingerprint)).toEqual({ ok: false, reason: "not_found" })
        const stale = await MCP.trustReviewed("local", "0".repeat(64))
        expect(stale).toEqual({ ok: false, reason: "fingerprint_mismatch", fingerprint: pending.fingerprint })
        expect(localTransports).toHaveLength(0)
        expect(events).toEqual([])

        const trusted = await MCP.trustReviewed("local", pending.fingerprint)
        expect(trusted.ok).toBe(true)
        if (trusted.ok) expect(trusted.status.local?.status).toBe("connected")
        expect(localTransports).toHaveLength(1)
        expect(await MCP.trustReviewed("local", pending.fingerprint)).toEqual({ ok: false, reason: "not_pending" })

        const untrusted = await MCP.untrust("local")
        expect(untrusted.local?.status).toBe("needs_trust")

        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(events).toEqual([
          { server: "local", fingerprint: pending.fingerprint, action: "trust", sourceKind: pending.source.kind },
          { server: "local", fingerprint: pending.fingerprint, action: "untrust", sourceKind: pending.source.kind },
        ])
        expect(JSON.stringify(events)).not.toContain("super-secret-value")
        expect(JSON.stringify(events)).not.toContain("server.js")
      } finally {
        unsubscribe()
      }
    },
  })
})
