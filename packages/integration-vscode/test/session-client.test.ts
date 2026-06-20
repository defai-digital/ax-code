import { beforeEach, describe, expect, vi, test } from "vitest"

const workspaceState = new Map<string, unknown>()
let clientFactory: (config: any) => any

vi.doMock("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace/project" } }],
  },
}))

vi.doMock("@ax-code/sdk/v2/client", () => ({
  createAxCodeClient: (config: any) => clientFactory(config),
}))

const { SessionClient } = await import("../src/session-client")

class FakeServer {
  private onExit: (() => void) | null = null

  constructor(
    public url: string | null,
    public headers: Record<string, string> = { Authorization: "Basic test" },
  ) {}

  setOnExit(cb: (() => void) | null) {
    this.onExit = cb
  }

  emitExit() {
    this.url = null
    this.onExit?.()
  }
}

function createContext() {
  return {
    workspaceState: {
      get: (key: string) => workspaceState.get(key),
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          workspaceState.delete(key)
        } else {
          workspaceState.set(key, value)
        }
      },
    },
  }
}

function createStreamEvents() {
  const streamText: Array<{ partId: string; text: string; html: string }> = []
  const toolUpdates: Array<{ partId: string; tool: string; status: string }> = []
  const agentInfo: Array<{ agent: string; modelID: string }> = []
  return {
    events: {
      onStreamText: (partId: string, text: string, html: string) => streamText.push({ partId, text, html }),
      onToolUpdate: (partId: string, tool: string, status: string) => toolUpdates.push({ partId, tool, status }),
      onAgentInfo: (agent: string, modelID: string) => agentInfo.push({ agent, modelID }),
    },
    streamText,
    toolUpdates,
    agentInfo,
  }
}

async function* emptyEventStream() {}

function createSdkClient(label: string) {
  return {
    event: {
      subscribe: () => ({ stream: emptyEventStream() }),
    },
    provider: {
      list: async () => ({
        data: {
          all: [
            {
              id: "xai",
              name: "x.ai",
              env: ["XAI_API_KEY"],
              models: {
                "grok-code": {
                  id: "grok-code",
                  name: "Grok Code",
                  release_date: "",
                  attachment: false,
                  reasoning: false,
                  tool_call: true,
                  limit: { context: 128000, output: 4096 },
                },
              },
            },
          ],
          default: { xai: "grok-code" },
          connected: ["xai"],
        },
        error: undefined,
      }),
    },
    session: {
      get: async () => ({ data: { id: "stored-session" }, error: undefined }),
      create: async () => ({ data: { id: "created-session" }, error: undefined }),
      abort: async () => ({ data: {}, error: undefined }),
      prompt: async () => ({
        data: {
          info: { agent: label, tokens: { total: 1 } },
          parts: [{ type: "text", text: label }],
        },
        error: undefined,
        response: { ok: true, status: 200 },
      }),
    },
  }
}

beforeEach(() => {
  workspaceState.clear()
  clientFactory = () => createSdkClient("default")
})

describe("SessionClient SSE filtering", () => {
  test("ignores session-scoped events while no session is selected", () => {
    const server = new FakeServer("http://server")
    const stream = createStreamEvents()
    const client = new SessionClient(createContext() as any, server as any, stream.events)

    ;(client as any).handleBusEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          type: "text",
          text: "stale response",
          sessionID: "other-session",
        },
      },
    })

    expect(stream.streamText).toEqual([])
  })
})

describe("SessionClient server restart handling", () => {
  test("preserves stored session id when validation is aborted", async () => {
    workspaceState.set("axCode.sessionId", "stored-session")
    let createCalled = false
    clientFactory = () => ({
      ...createSdkClient("default"),
      session: {
        ...createSdkClient("default").session,
        get: async (_params: unknown, { signal }: { signal: AbortSignal }) => {
          if (signal.aborted) {
            throw new DOMException("Aborted", "AbortError")
          }
          return { data: { id: "stored-session" }, error: undefined }
        },
        create: async () => {
          createCalled = true
          return { data: { id: "created-session" }, error: undefined }
        },
      },
    })

    const server = new FakeServer("http://server")
    const stream = createStreamEvents()
    const client = new SessionClient(createContext() as any, server as any, stream.events)
    const controller = new AbortController()
    controller.abort()

    await expect(client.sendMessage("first", null, controller.signal)).rejects.toThrow("Aborted")
    expect(client.currentSessionId).toBe("stored-session")
    expect(workspaceState.get("axCode.sessionId")).toBe("stored-session")
    expect(createCalled).toBe(false)
  })

  test("recreates the SDK client after the server exits", async () => {
    workspaceState.set("axCode.sessionId", "stored-session")
    const baseUrls: string[] = []
    clientFactory = (config: any) => {
      baseUrls.push(config.baseUrl)
      return createSdkClient(config.baseUrl)
    }

    const server = new FakeServer("http://first")
    const stream = createStreamEvents()
    const client = new SessionClient(createContext() as any, server as any, stream.events)

    await client.sendMessage("first", null, new AbortController().signal)
    server.emitExit()
    server.url = "http://second"
    const result = await client.sendMessage("second", null, new AbortController().signal)

    expect(baseUrls).toEqual(["http://first", "http://second"])
    expect(result.finalText).toBe("http://second")
  })

  test("passes server auth headers into the SDK client", async () => {
    const configs: any[] = []
    clientFactory = (config: any) => {
      configs.push(config)
      return createSdkClient("default")
    }

    const server = new FakeServer("http://server", { Authorization: "Basic server-auth" })
    const stream = createStreamEvents()
    const client = new SessionClient(createContext() as any, server as any, stream.events)

    await client.sendMessage("first", null, new AbortController().signal)

    expect(configs[0].headers).toEqual({ Authorization: "Basic server-auth" })
  })

  test("returns provider list using the generated provider.list response shape", async () => {
    const server = new FakeServer("http://server")
    const stream = createStreamEvents()
    const client = new SessionClient(createContext() as any, server as any, stream.events)

    const providers = await client.listProviders()

    expect(providers.all[0].id).toBe("xai")
    expect(providers.default.xai).toBe("grok-code")
    expect(providers.connected).toEqual(["xai"])
  })
})
