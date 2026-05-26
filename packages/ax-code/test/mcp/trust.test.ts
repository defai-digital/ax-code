import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import path from "path"

const localTransports: Array<{ command: string; args: string[]; closeCalls: number }> = []
let connectCalls = 0

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
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

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockStreamableHTTPClientTransport {
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSEClientTransport {
    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    transport?: { start?: () => Promise<void> }

    setNotificationHandler() {}

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
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

beforeEach(() => {
  localTransports.length = 0
  connectCalls = 0
})

afterEach(async () => {
  await Instance.disposeAll()
})

test("project MCP local command stays disconnected until explicitly trusted", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      mcp: {
        local: {
          type: "local",
          command: ["node", "server.js"],
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const initial = await MCP.status()
      expect(initial.local?.status).toBe("needs_trust")
      expect(localTransports).toHaveLength(0)
      expect(connectCalls).toBe(0)

      const trusted = await MCP.trust("local")
      expect(trusted.local?.status).toBe("connected")
      expect(localTransports).toHaveLength(1)
      expect(localTransports[0]).toMatchObject({ command: "node", args: ["server.js"] })
      expect(connectCalls).toBe(1)
    },
  })
})

test("project MCP trust is invalidated when the command fingerprint changes", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      mcp: {
        local: {
          type: "local",
          command: ["node", "server-a.js"],
        },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await MCP.trust("local")
      expect(localTransports).toHaveLength(1)
    },
  })

  localTransports.length = 0
  connectCalls = 0

  await Bun.write(
    path.join(tmp.path, "ax-code.json"),
    JSON.stringify({
      $schema: "https://raw.githubusercontent.com/defai-digital/ax-code/main/packages/ax-code/config.schema.json",
      mcp: {
        local: {
          type: "local",
          command: ["node", "server-b.js"],
        },
      },
    }),
  )

  await Instance.reload({ directory: tmp.path })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const status = await MCP.status()
      expect(status.local?.status).toBe("needs_trust")
      expect(localTransports).toHaveLength(0)
      expect(connectCalls).toBe(0)
    },
  })
})
