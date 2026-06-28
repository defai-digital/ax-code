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

const agentLists: Array<Deferred<unknown[]>> = []
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
    listAgents: vi.fn(async () => {
      return await (agentLists.shift()?.promise ?? Promise.resolve([]))
    }),
  },
}))

vi.doMock("@/stores/useConfigStore", () => ({
  useConfigStore: {
    getState: () => ({
      loadConfig: vi.fn(async () => undefined),
      invalidateModelMetadataCache: vi.fn(() => undefined),
    }),
    setState: vi.fn(() => undefined),
  },
}))

vi.doMock("@/stores/useCommandsStore", () => ({
  useCommandsStore: {
    getState: () => ({
      loadCommands: vi.fn(async () => true),
    }),
  },
}))

vi.doMock("@/stores/useSkillsStore", () => ({
  useSkillsStore: {
    getState: () => ({
      loadSkills: vi.fn(async () => true),
    }),
  },
}))

vi.doMock("@/stores/useSkillsCatalogStore", () => ({
  useSkillsCatalogStore: {
    getState: () => ({
      loadCatalog: vi.fn(async () => true),
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

const { useAgentsStore } = await import("./useAgentsStore")

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const fetchCalls: Array<RequestInfo | URL> = []
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  fetchCalls.push(input)
  const name = String(input).includes("new-agent") ? "new-agent" : "old-agent"
  const project = String(input).includes("new-project") ? "new-project" : "old-project"
  return jsonResponse({
    scope: "project",
    sources: {
      md: {
        path: `/workspace/${project}/agents/${name}.md`,
      },
    },
  })
})

const resetStore = () => {
  useAgentsStore.setState({
    selectedAgentName: null,
    agents: [],
    isLoading: false,
    agentDraft: null,
  })
}

describe("useAgentsStore", () => {
  beforeEach(() => {
    activeProjectPath = "/workspace/project"
    resetStore()
    agentLists.length = 0
    withDirectories.length = 0
    fetchCalls.length = 0
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("keeps the newest agent list after switching project directories", async () => {
    const staleAgents = createDeferred<unknown[]>()
    const latestAgents = createDeferred<unknown[]>()
    agentLists.push(staleAgents, latestAgents)

    activeProjectPath = "/workspace/old-project"
    const oldLoad = useAgentsStore.getState().loadAgents()
    activeProjectPath = "/workspace/new-project"
    const newLoad = useAgentsStore.getState().loadAgents()
    await Promise.resolve()

    latestAgents.resolve([{ name: "new-agent" }])
    await newLoad

    staleAgents.resolve([{ name: "old-agent" }])
    await oldLoad

    expect(withDirectories).toEqual(["/workspace/old-project", "/workspace/new-project"])
    expect(fetchCalls.map(String)).toEqual([
      "/api/config/agents/new-agent?directory=%2Fworkspace%2Fnew-project",
      "/api/config/agents/old-agent?directory=%2Fworkspace%2Fold-project",
    ])
    expect(useAgentsStore.getState().agents).toEqual([
      {
        name: "new-agent",
        scope: "project",
        group: undefined,
      },
    ])
    expect(useAgentsStore.getState().isLoading).toBe(false)
  })
})
