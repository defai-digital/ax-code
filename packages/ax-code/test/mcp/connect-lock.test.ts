import { afterEach, expect, test, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"

let connectStarted!: Promise<void>
let resolveConnectStarted!: () => void
let releaseConnect!: () => void
let connectRelease!: Promise<void>
let failListTools = false
let hangListTools = false
let exposeToolNames = false
let nextTransportPid = 5001
type MockClientState = {
  closed: boolean
  listToolsCalls: number
  transport?: unknown
  notificationHandler?: () => Promise<void>
}
let createdClients: MockClientState[] = []
let delayedListCommand: string | undefined
let delayedListStarted!: Promise<void>
let resolveDelayedListStarted!: () => void
let releaseDelayedList!: () => void
let delayedListRelease!: Promise<void>

function resetConnectGate() {
  connectStarted = new Promise((resolve) => {
    resolveConnectStarted = resolve
  })
  connectRelease = new Promise((resolve) => {
    releaseConnect = resolve
  })
}

function resetGate() {
  resetConnectGate()
  failListTools = false
  hangListTools = false
  exposeToolNames = false
  nextTransportPid = 5001
  createdClients = []
  delayedListCommand = undefined
  delayedListStarted = new Promise((resolve) => {
    resolveDelayedListStarted = resolve
  })
  delayedListRelease = new Promise((resolve) => {
    releaseDelayedList = resolve
  })
}

resetGate()

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    onclose?: () => void
    transport?: unknown
    closed = false
    listToolsCalls = 0
    notificationHandler?: () => Promise<void>

    constructor() {
      createdClients.push(this)
    }

    async connect(transport: unknown) {
      this.transport = transport
      resolveConnectStarted()
      await connectRelease
    }

    async listTools() {
      this.listToolsCalls++
      const command = (this.transport as { command?: string } | undefined)?.command ?? "unknown"
      if (this.listToolsCalls > 1 && command === delayedListCommand) {
        resolveDelayedListStarted()
        await delayedListRelease
        throw new Error(`delayed list failed for ${command}`)
      }
      if (hangListTools) return new Promise<never>(() => {})
      if (failListTools) throw new Error("list failed")
      if (exposeToolNames) {
        return {
          tools: [
            {
              name: `tool_${command}`,
              description: `tool from ${command}`,
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }
      }
      return { tools: [] }
    }

    setNotificationHandler(_schema: unknown, handler: () => Promise<void>) {
      this.notificationHandler = handler
    }

    async close() {
      this.closed = true
    }
  },
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdioTransport {
    pid = nextTransportPid++
    command: string
    stderr = {
      on() {},
      off() {},
    }

    constructor(input: { command: string }) {
      this.command = input.command
    }

    async close() {}
  },
}))

const { MCP } = await import("../../src/mcp/index")
const { Instance } = await import("../../src/project/instance")
const { tmpdir } = await import("../fixture/fixture")
const { Config } = await import("../../src/config/config")
const { McpTrust } = await import("../../src/mcp/trust")

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

test("keeps discovered MCP tool caches isolated between live instances", async () => {
  await using alpha = await tmpdir({ git: true })
  await using beta = await tmpdir({ git: true })
  exposeToolNames = true

  const addServer = async (directory: string, name: string) => {
    await Instance.provide({
      directory,
      fn: async () => {
        const add = MCP.add(name, { type: "local", command: [name] })
        await connectStarted
        releaseConnect()
        await add
      },
    })
  }

  await addServer(alpha.path, "alpha")
  const alphaTools = await Instance.provide({ directory: alpha.path, fn: () => MCP.tools() })

  resetGate()
  exposeToolNames = true
  await addServer(beta.path, "beta")
  const betaTools = await Instance.provide({ directory: beta.path, fn: () => MCP.tools() })
  const alphaAgain = await Instance.provide({ directory: alpha.path, fn: () => MCP.tools() })

  expect(Object.keys(alphaTools)).toEqual(["alpha_tool_alpha"])
  expect(Object.keys(betaTools)).toEqual(["beta_tool_beta"])
  expect(Object.keys(alphaAgain)).toEqual(["alpha_tool_alpha"])

  await Instance.provide({ directory: alpha.path, fn: () => Instance.dispose() })
  const betaAfterAlphaDisposal = await Instance.provide({ directory: beta.path, fn: () => MCP.tools() })
  expect(Object.keys(betaAfterAlphaDisposal)).toEqual(["beta_tool_beta"])
})

test("marks startup state disposed before a slow configured connection finishes", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      mcp: {
        startup: { type: "local", command: ["startup"] },
      },
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const entry = await Config.mcpEntry("startup")
      if (!entry || !("type" in entry.config)) throw new Error("missing startup MCP fixture")
      await McpTrust.trust("startup", entry.config, entry.source)

      const clients = MCP.clients()
      await connectStarted
      const disposing = Instance.dispose()
      const early = await Promise.race([disposing.then(() => "done"), sleep(25).then(() => "pending")])
      expect(early).toBe("pending")
      releaseConnect()
      await clients
      await disposing
    },
  })

  expect(createdClients).toHaveLength(1)
  expect(createdClients[0]?.closed).toBe(true)
})

test("closes a dynamically added client that finishes after instance disposal", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("late", { type: "local", command: ["late"] })
      await connectStarted
      const disposing = Instance.dispose()
      const early = await Promise.race([disposing.then(() => "done"), sleep(25).then(() => "pending")])
      expect(early).toBe("pending")
      releaseConnect()
      await add
      await disposing
    },
  })

  expect(createdClients).toHaveLength(1)
  expect(createdClients[0]?.closed).toBe(true)
})

test("closes established clients before waiting for admitted connection work during disposal", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = MCP.add("replace", { type: "local", command: ["first"] })
      await connectStarted
      releaseConnect()
      await first

      const established = createdClients[0]!
      resetConnectGate()
      const replacement = MCP.add("replace", { type: "local", command: ["replacement"] })
      await connectStarted

      const disposing = Instance.dispose()
      await vi.waitFor(() => expect(established.closed).toBe(true))
      const early = await Promise.race([disposing.then(() => "done"), sleep(25).then(() => "pending")])
      expect(early).toBe("pending")

      releaseConnect()
      await replacement
      await disposing
    },
  })

  expect(createdClients).toHaveLength(2)
  expect(createdClients[1]?.closed).toBe(true)
})

test("a stale listTools failure cannot downgrade a replacement client", async () => {
  await using tmp = await tmpdir({ git: true })
  exposeToolNames = true

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = MCP.add("race", { type: "local", command: ["old"] })
      await connectStarted
      releaseConnect()
      await first

      delayedListCommand = "old"
      const staleListing = MCP.tools()
      await delayedListStarted

      const replacement = await MCP.add("race", { type: "local", command: ["new"] })
      expect(replacement.status.race).toEqual({ status: "connected" })
      releaseDelayedList()
      await expect(staleListing).resolves.toEqual({})

      const current = (await MCP.clients()).race as unknown as { transport?: { command?: string }; closed: boolean }
      expect(current.transport?.command).toBe("new")
      expect(current.closed).toBe(false)
      expect(Object.keys(await MCP.tools())).toEqual(["race_tool_new"])
    },
  })
})

test("MCP client teardown kills process trees before closing clients", async () => {
  const source = await readFile(new URL("../../src/mcp/impl.ts", import.meta.url), "utf-8")

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
      expect(client?.onclose).toBeTypeOf("function")
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

test("tool-change notifications retain owner context and no-op after disposal", async () => {
  await using tmp = await tmpdir({ git: true })
  exposeToolNames = true
  let client: MockClientState | undefined

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("notify", { type: "local", command: ["notify"] })
      await connectStarted
      releaseConnect()
      await add
      await MCP.tools()
      client = (await MCP.clients()).notify as unknown as MockClientState
    },
  })

  const callsBefore = client?.listToolsCalls ?? 0
  await expect(client?.notificationHandler?.()).resolves.toBeUndefined()
  await sleep(0)
  await Instance.provide({ directory: tmp.path, fn: () => MCP.tools() })
  expect(client?.listToolsCalls).toBeGreaterThan(callsBefore)

  await Instance.provide({ directory: tmp.path, fn: () => Instance.dispose() })
  await expect(client?.notificationHandler?.()).resolves.toBeUndefined()
})

test("tools closes and kills MCP clients when listTools fails", async () => {
  await using tmp = await tmpdir({ git: true })
  const source = await readFile(new URL("../../src/mcp/impl.ts", import.meta.url), "utf-8")

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

test("failed replacement closes and removes the previous MCP client", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const first = MCP.add("replace-failure", {
        type: "local",
        command: ["mock-mcp-server"],
      })
      await connectStarted
      releaseConnect()
      await first

      const previous = (await MCP.clients())["replace-failure"] as unknown as { closed: boolean }
      expect(previous.closed).toBe(false)

      failListTools = true
      await MCP.add("replace-failure", {
        type: "local",
        command: ["mock-mcp-server"],
      })

      expect(previous.closed).toBe(true)
      expect((await MCP.clients())["replace-failure"]).toBeUndefined()
    },
  })
})

test("tool enumeration times out and removes an unresponsive MCP client", async () => {
  await using tmp = await tmpdir({ git: true, config: { experimental: { mcp_timeout: 10 } } })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const add = MCP.add("hanging-tools", {
        type: "local",
        command: ["mock-mcp-server"],
      })
      await connectStarted
      releaseConnect()
      await add

      hangListTools = true
      await expect(MCP.tools()).resolves.toEqual({})
      expect((await MCP.clients())["hanging-tools"]).toBeUndefined()
    },
  })
})
