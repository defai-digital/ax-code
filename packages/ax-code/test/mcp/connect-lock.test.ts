import { afterEach, expect, mock, test } from "bun:test"
import { setTimeout as sleep } from "node:timers/promises"

let connectStarted!: Promise<void>
let resolveConnectStarted!: () => void
let releaseConnect!: () => void
let connectRelease!: Promise<void>

function resetGate() {
  connectStarted = new Promise((resolve) => {
    resolveConnectStarted = resolve
  })
  connectRelease = new Promise((resolve) => {
    releaseConnect = resolve
  })
}

resetGate()

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    async connect() {
      resolveConnectStarted()
      await connectRelease
    }

    async listTools() {
      return { tools: [] }
    }

    async close() {}
  },
}))

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioTransport {
    stderr = {
      on() {},
      off() {},
    }

    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")

afterEach(async () => {
  resetGate()
  await Instance.disposeAll()
})

test("disconnect waits for an in-flight connect before disabling the MCP server", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("race", {
        type: "local",
        command: ["mock-mcp-server"],
      })

      await connectStarted

      const disconnected = MCP.disconnect("race")
      const early = await Promise.race([disconnected.then(() => "done"), sleep(25).then(() => "pending")])
      expect(early).toBe("pending")

      releaseConnect()
      await add
      await disconnected

      const clients = await MCP.clients()
      expect(clients.race).toBeUndefined()
    },
  })
})
