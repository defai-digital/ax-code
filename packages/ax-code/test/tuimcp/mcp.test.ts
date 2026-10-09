import { describe, expect, test } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"
import { createTuiMcpController } from "../../src/tuimcp/controller"
import type { LiveState } from "../../src/tuimcp/controller"
import { startTuiMcpEndpoint } from "../../src/tuimcp/endpoint"
import { createTuiMcpServer } from "../../src/tuimcp/mcp-server"
import { tmpdir } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"

async function fixture() {
  const state: LiveState = { workspace: "/secret/workspace", route: "home", ready: true, blocked: false }
  const controller = createTuiMcpController({
    state: () => state,
    validateSession: async () => {},
    navigate: (sessionId) => {
      state.route = "session"
      state.sessionId = sessionId
    },
  })
  const endpoint = await startTuiMcpEndpoint(controller)
  return { controller, endpoint, [Symbol.asyncDispose]: () => endpoint.close() }
}

describe.skipIf(process.platform === "win32")("TUIMCP MCP interoperability", () => {
  test("standard SDK discovers strict bounded tools and receives domain errors", async () => {
    await using f = await fixture()
    const server = createTuiMcpServer(f.endpoint.filename)
    const client = new Client({ name: "test", version: "1" })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const listing = await client.listTools()
      expect(listing.tools.map((tool) => tool.name)).toEqual(["get_view_context", "select_session"])
      expect(listing.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true)
      const context = await client.callTool({ name: "get_view_context", arguments: {} })
      expect(context.isError).toBe(false)
      expect(JSON.stringify(context)).not.toContain("secret")
      expect(context.structuredContent).toMatchObject({ status: "context" })
      expect(await client.callTool({ name: "get_view_context", arguments: { dump: true } })).toMatchObject({
        isError: true,
        structuredContent: { code: "invalid_request" },
      })
      expect(await client.callTool({ name: "execute_command", arguments: { command: "prompt.submit" } })).toMatchObject(
        { isError: true },
      )
      const view = f.controller.context()
      const args = {
        requestId: randomUUID(),
        instanceId: view.instanceId,
        generation: view.generation,
        expectedRevision: view.revision,
        sessionId: SessionID.ascending(),
      }
      expect(await client.callTool({ name: "select_session", arguments: args })).toMatchObject({
        isError: false,
        structuredContent: { status: "applied" },
      })
      f.controller.dispose()
      expect(await client.callTool({ name: "get_view_context", arguments: {} })).toMatchObject({
        isError: true,
        structuredContent: { code: "revoked" },
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
  test("the registered CLI keeps serving after the normal forced-exit grace period", async () => {
    await using f = await fixture()
    await using tmp = await tmpdir()
    const client = new Client({ name: "cli-test", version: "1" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../../../../script/node-ffi-runner.mjs", import.meta.url)),
        "--import",
        "tsx",
        "--import",
        fileURLToPath(new URL("../../../../script/solid-loader.mjs", import.meta.url)),
        "--conditions=node",
        fileURLToPath(new URL("../../src/index-node-tui.ts", import.meta.url)),
        "mcp",
        "tui",
        "--endpoint",
        f.endpoint.filename,
      ],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
        AX_CODE_TEST_HOME: tmp.path,
        AX_CODE_DISABLE_MODELS_FETCH: "1",
        AX_CODE_DISABLE_AUTOUPDATE: "1",
        AX_CODE_DISABLE_PROJECT_CONFIG: "1",
        AX_CODE_DISABLE_LSP_DOWNLOAD: "1",
        AX_CODE_DISABLE_AUTO_INDEX: "1",
      },
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
      await new Promise((resolve) => setTimeout(resolve, 2_250))
      expect((await client.listTools()).tools).toHaveLength(2)
      expect(await client.callTool({ name: "get_view_context", arguments: {} })).toMatchObject({ isError: false })
    } finally {
      await client.close()
    }
  }, 30_000)
  test("real stdio remains valid MCP and closes on client exit", async () => {
    await using f = await fixture()
    const client = new Client({ name: "stdio-test", version: "1" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        "--import",
        "tsx",
        "--conditions=node",
        fileURLToPath(new URL("./stdio-server.ts", import.meta.url)),
        f.endpoint.filename,
      ],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools).toHaveLength(2)
      expect(await client.callTool({ name: "get_view_context", arguments: {} })).toMatchObject({
        isError: false,
        structuredContent: { status: "context" },
      })
    } finally {
      await client.close()
    }
  })
})
