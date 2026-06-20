import { afterEach, expect, test, vi } from "vitest"
import { setTimeout as sleep } from "node:timers/promises"

let connectStarted!: Promise<void>
let resolveConnectStarted!: () => void
let releaseConnect!: () => void
let connectRelease!: Promise<void>
let failListTools = false
let nextTransportPid = 5001

function resetGate() {
  connectStarted = new Promise((resolve) => {
    resolveConnectStarted = resolve
  })
  connectRelease = new Promise((resolve) => {
    releaseConnect = resolve
  })
  failListTools = false
  nextTransportPid = 5001
}

resetGate()

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    onclose?: () => void
    transport?: unknown

    async connect(transport: unknown) {
      this.transport = transport
      resolveConnectStarted()
      await connectRelease
    }

    async listTools() {
      if (failListTools) throw new Error("list failed")
      return { tools: [] }
    }

    setNotificationHandler() {}

    async close() {}
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioTransport {
    pid = nextTransportPid++
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

test("MCP client teardown kills process trees before closing clients", async () => {
  const source = await Bun.file(new URL("../../src/mcp/index.ts", import.meta.url)).text()

  expect(source).toContain("await killProcessTree(pid)")
  expect(source).toContain("rememberClientTransport(client, transport)")
  expect(source).toContain('await closeIfPossible(client, name, "disconnecting")')
  expect(source).toContain('await closeIfPossible(existingClient, name, "replacing existing client")')
})

test("clients added dynamically clear stale state when they close outside the instance context", async () => {
  await using tmp = await tmpdir({ git: true })
  let client: { onclose?: () => void } | undefined

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("dynamic-close", {
        type: "local",
        command: ["mock-mcp-server"],
      })

      await connectStarted
      releaseConnect()
      await add

      client = (await MCP.clients())["dynamic-close"] as { onclose?: () => void }
      expect(client?.onclose).toBeFunction()
    },
  })

  expect(() => client?.onclose?.()).not.toThrow()
  await sleep(0)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await MCP.clients())["dynamic-close"]).toBeUndefined()
    },
  })
})

test("tools closes and kills MCP clients when listTools fails", async () => {
  await using tmp = await tmpdir({ git: true })
  const source = await Bun.file(new URL("../../src/mcp/index.ts", import.meta.url)).text()

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("failing-tools", {
        type: "local",
        command: ["mock-mcp-server"],
      })

      await connectStarted
      releaseConnect()
      await add

      failListTools = true
      await MCP.tools()

      const clients = await MCP.clients()
      expect(clients["failing-tools"]).toBeUndefined()
      expect(source).toContain('await closeIfPossible(client, clientName, "listTools failed")')
    },
  })
})
