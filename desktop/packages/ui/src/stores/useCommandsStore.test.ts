import { beforeEach, describe, expect, test, vi } from "vitest"

let activeProjectPath = "/workspace/project"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const commandLists: Array<Deferred<unknown[]>> = []
const withDirectories: Array<string | null> = []

vi.doMock("@/stores/useProjectsStore", () => ({
  useProjectsStore: {
    getState: () => ({
      getActiveProject: () => ({ path: activeProjectPath }),
    }),
  },
}))

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    getDirectory: () => "/fallback/project",
    withDirectory: async (directory: string | null, run: () => Promise<unknown>) => {
      withDirectories.push(directory)
      return await run()
    },
    listCommandsWithDetails: vi.fn(async () => {
      return await (commandLists.shift()?.promise ?? Promise.resolve([]))
    }),
  },
}))

vi.doMock("@/lib/configSync", () => ({
  emitConfigChange: vi.fn(() => undefined),
  scopeMatches: vi.fn(() => false),
  subscribeToConfigChanges: vi.fn(() => () => undefined),
}))

vi.doMock("@/lib/configUpdate", () => ({
  startConfigUpdate: vi.fn(() => undefined),
  finishConfigUpdate: vi.fn(() => undefined),
  updateConfigUpdateMessage: vi.fn(() => undefined),
  subscribeConfigUpdate: vi.fn(() => () => undefined),
  getConfigUpdateSnapshot: vi.fn(() => ({ isUpdating: false, message: null })),
}))

const { useCommandsStore } = await import("./useCommandsStore")

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const fetchCalls: Array<RequestInfo | URL> = []
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  fetchCalls.push(input)
  return jsonResponse({ scope: "project" })
})

const resetStore = () => {
  useCommandsStore.setState({
    selectedCommandName: null,
    commands: [],
    isLoading: false,
    commandDraft: null,
  })
}

describe("useCommandsStore", () => {
  beforeEach(() => {
    activeProjectPath = "/workspace/project"
    resetStore()
    commandLists.length = 0
    withDirectories.length = 0
    fetchCalls.length = 0
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("keeps the newest command list after switching project directories", async () => {
    const staleCommands = createDeferred<unknown[]>()
    const latestCommands = createDeferred<unknown[]>()
    commandLists.push(staleCommands, latestCommands)

    activeProjectPath = "/workspace/old-project"
    const oldLoad = useCommandsStore.getState().loadCommands()
    activeProjectPath = "/workspace/new-project"
    const newLoad = useCommandsStore.getState().loadCommands()
    await Promise.resolve()

    latestCommands.resolve([{ name: "new-command", source: "project" }])
    await newLoad

    staleCommands.resolve([{ name: "old-command", source: "project" }])
    await oldLoad

    expect(withDirectories).toEqual(["/workspace/old-project", "/workspace/new-project"])
    expect(fetchCalls.map(String)).toEqual([
      "/api/config/commands/new-command?directory=%2Fworkspace%2Fnew-project",
      "/api/config/commands/old-command?directory=%2Fworkspace%2Fold-project",
    ])
    expect(useCommandsStore.getState().commands).toEqual([
      {
        name: "new-command",
        source: "project",
        scope: "project",
      },
    ])
    expect(useCommandsStore.getState().isLoading).toBe(false)
  })
})
