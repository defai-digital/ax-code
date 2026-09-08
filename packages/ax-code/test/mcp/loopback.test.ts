import { expect, test } from "vitest"
import { createServer } from "node:http"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { MCP } from "../../src/mcp"
import { Config } from "../../src/config/config"
import { McpTrust } from "../../src/mcp/trust"
import { McpOAuthCallback } from "../../src/mcp/oauth-callback"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

async function localServer(kind: "http" | "sse" = "http", host = "127.0.0.1", sseEndpoint = "/messages") {
  const mcp = new McpServer({ name: "local-fixture", version: "1.0.0" })
  mcp.registerTool("ping", { description: "Return a fixture marker" }, async () => ({
    content: [{ type: "text", text: "LOOPBACK_OK" }],
  }))
  const http = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true })
  let sse: SSEServerTransport | undefined
  if (kind === "http") await mcp.connect(http)
  let requests = 0
  const errors: unknown[] = []
  const server = createServer(async (request, response) => {
    requests++
    try {
      if (kind === "http") return await http.handleRequest(request, response)
      if (request.method === "GET" && request.url === "/mcp") {
        sse = new SSEServerTransport(sseEndpoint, response)
        await mcp.connect(sse)
      } else if (request.url?.startsWith("/messages") && sse) {
        await sse.handlePostMessage(request, response)
      } else {
        response.writeHead(405).end()
      }
    } catch (error) {
      errors.push(error)
      response.writeHead(500).end()
    }
  })
  server.listen(0, host)
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing fixture address")
  return {
    url: `http://${host.includes(":") ? `[${host}]` : host}:${address.port}/mcp`,
    get requests() {
      return requests
    },
    errors,
    async [Symbol.asyncDispose]() {
      await mcp.close()
      await http.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

test.each(["http", "sse"] as const)(
  "trusted loopback %s connects, lists tools, and calls a real local server",
  async (kind) => {
    await using server = await localServer(kind)
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        try {
          const result = await MCP.add("desktop", {
            type: "remote",
            url: server.url,
            allowLoopback: true,
            oauth: false,
          })
          expect(result.status.desktop).toEqual({ status: "connected" })
          const tools = await MCP.tools()
          expect(Object.keys(tools)).toContain("desktop_ping")
          const resultBody = await tools.desktop_ping.execute!({}, { toolCallId: "ping", messages: [] })
          expect(CallToolResultSchema.parse(resultBody).content).toEqual([{ type: "text", text: "LOOPBACK_OK" }])
          expect(server.errors).toEqual([])
        } finally {
          await Instance.dispose()
        }
      },
    })
  },
)

test("loopback HTTP remains blocked by default without contacting the server", async () => {
  await using server = await localServer()
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        await expect(MCP.add("desktop", { type: "remote", url: server.url, oauth: false })).rejects.toThrow(
          "private/reserved",
        )
        expect(server.requests).toBe(0)
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("IPv6 loopback initializes a real HTTP MCP server", async () => {
  await using server = await localServer("http", "::1")
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const result = await MCP.add("ipv6", { type: "remote", url: server.url, allowLoopback: true, oauth: false })
        expect(result.status.ipv6.status).toBe("connected")
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("a local SSE server cannot send messages to another local port", async () => {
  await using denied = await localServer()
  await using server = await localServer("sse", "127.0.0.1", denied.url)
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const result = await MCP.add("desktop", {
          type: "remote",
          url: server.url,
          allowLoopback: true,
          oauth: false,
          timeout: 1000,
        })
        expect(result.status.desktop.status).toBe("failed")
        expect(denied.requests).toBe(0)
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("local OAuth discovery cannot fetch metadata from another origin", async () => {
  await using denied = await localServer()
  await using server = createServer((_request, response) => {
    response.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${denied.url}"` }).end()
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Missing OAuth fixture address")
  const url = `http://127.0.0.1:${address.port}/mcp`
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const result = await MCP.add("desktop", { type: "remote", url, allowLoopback: true, timeout: 1000 })
        expect(result.status.desktop.status).not.toBe("connected")
        expect(denied.requests).toBe(0)
      } finally {
        await Instance.dispose()
        await McpOAuthCallback.stop()
        server.closeAllConnections()
      }
    },
  })
})

test("project loopback requires trust on startup, dynamic add, and explicit authentication", async () => {
  await using server = await localServer()
  const config = { type: "remote" as const, url: server.url, allowLoopback: true, oauth: false as const }
  await using tmp = await tmpdir({ git: true, config: { mcp: { desktop: config } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        expect((await MCP.status()).desktop.status).toBe("needs_trust")
        expect((await MCP.add("desktop", config)).status.desktop.status).toBe("needs_trust")
        await expect(MCP.startAuth("desktop")).rejects.toThrow("requires trust")
        expect(server.requests).toBe(0)
        expect((await MCP.trust("desktop")).desktop.status).toBe("connected")
        expect(server.requests).toBeGreaterThan(0)
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("enabling loopback invalidates existing project trust even through MCP.add", async () => {
  await using server = await localServer()
  const config = { type: "remote" as const, url: server.url, oauth: false as const }
  await using tmp = await tmpdir({ git: true, config: { mcp: { desktop: config } } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const entry = await Config.mcpEntry("desktop")
        if (!entry) throw new Error("Missing project MCP entry")
        await McpTrust.trust("desktop", config, entry.source)
        expect(McpTrust.fingerprint("desktop", config)).toBe(
          McpTrust.fingerprint("desktop", { ...config, allowLoopback: false }),
        )
        const result = await MCP.add("desktop", { ...config, allowLoopback: true })
        expect(result.status.desktop.status).toBe("needs_trust")
        expect(server.requests).toBe(0)
      } finally {
        await Instance.dispose()
      }
    },
  })
})

test("trusted loopback explicit authentication uses the local transport policy", async () => {
  await using server = await localServer()
  await using tmp = await tmpdir({
    git: true,
    config: { mcp: { desktop: { type: "remote", url: server.url, allowLoopback: true, enabled: false } } },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      try {
        const entry = await Config.mcpEntry("desktop")
        if (!entry || !("type" in entry.config)) throw new Error("Missing MCP configuration")
        await McpTrust.trust("desktop", entry.config, entry.source)
        expect(await MCP.startAuth("desktop")).toMatchObject({ authorizationUrl: "" })
        expect(server.requests).toBeGreaterThan(0)
      } finally {
        await Instance.dispose()
        await McpOAuthCallback.stop()
      }
    },
  })
})
