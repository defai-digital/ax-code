import { beforeEach, describe, expect, mock, test } from "bun:test"

const workspaceState = new Map<string, unknown>()
let clientFactory: (config: any) => any

mock.module("vscode", () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: "/workspace/project" } }],
  },
}))

mock.module("@ax-code/sdk", () => ({
  createAxCodeClient: (config: any) => clientFactory(config),
}))

const { SessionClient } = await import("../src/session-client")

class FakeServer {
  private onExit: (() => void) | null = null

  constructor(public url: string | null) {}

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
      list: async () => ({ data: { providers: [] }, error: undefined }),
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
})
