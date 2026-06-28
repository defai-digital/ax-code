import { beforeEach, describe, expect, test, vi } from "vitest"

import type { McpServerWithScope } from "./useMcpConfigStore"

let activeProjectPath = "/workspace/project"

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
  },
}))

vi.doMock("@/stores/useAgentsStore", () => ({
  refreshAfterAxCodeRestart: vi.fn(async () => undefined),
}))

vi.doMock("@/lib/configUpdate", () => ({
  startConfigUpdate: vi.fn(() => undefined),
  finishConfigUpdate: vi.fn(() => undefined),
  subscribeConfigUpdate: vi.fn(() => () => undefined),
  getConfigUpdateSnapshot: vi.fn(() => ({ isUpdating: false, message: null })),
}))

const { useMcpConfigStore } = await import("./useMcpConfigStore")

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

const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })

type FetchCall = {
  input: RequestInfo | URL
  init?: RequestInit
}

const fetchCalls: FetchCall[] = []
let queuedResponses: Array<Response | Promise<Response>> = []

const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  fetchCalls.push({ input, init })
  return queuedResponses.shift() ?? jsonResponse([])
})

const queueFetchResponses = (responses: Array<Response | Promise<Response>>) => {
  queuedResponses = [...responses]
}

const resetStore = () => {
  useMcpConfigStore.setState({
    mcpServers: [],
    selectedMcpName: null,
    isLoading: false,
    mcpDraft: null,
  })
}

describe("useMcpConfigStore", () => {
  beforeEach(() => {
    activeProjectPath = "/workspace/project"
    resetStore()
    fetchCalls.length = 0
    queuedResponses = []
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  test("keeps the newest forced MCP config list when refreshes overlap", async () => {
    const staleRefresh = createDeferred<Response>()
    const latestRefresh = createDeferred<Response>()
    const staleServer: McpServerWithScope = {
      name: "stale",
      type: "local",
      command: ["node", "stale.js"],
      enabled: true,
      scope: "project",
    }
    const latestServer: McpServerWithScope = {
      name: "latest",
      type: "local",
      command: ["node", "latest.js"],
      enabled: true,
      scope: "project",
    }
    queueFetchResponses([staleRefresh.promise, latestRefresh.promise])

    const firstLoad = useMcpConfigStore.getState().loadMcpConfigs({ force: true })
    const secondLoad = useMcpConfigStore.getState().loadMcpConfigs({ force: true })
    await Promise.resolve()

    latestRefresh.resolve(jsonResponse([latestServer]))
    await secondLoad

    staleRefresh.resolve(jsonResponse([staleServer]))
    await firstLoad

    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]?.input).toBe("/api/config/mcp?directory=%2Fworkspace%2Fproject")
    expect(useMcpConfigStore.getState().mcpServers).toEqual([latestServer])
    expect(useMcpConfigStore.getState().isLoading).toBe(false)
  })

  test("keeps the newest MCP config list after switching project directories", async () => {
    const staleRefresh = createDeferred<Response>()
    const latestRefresh = createDeferred<Response>()
    const staleServer: McpServerWithScope = {
      name: "old-project",
      type: "local",
      command: ["node", "old-project.js"],
      enabled: true,
      scope: "project",
    }
    const latestServer: McpServerWithScope = {
      name: "new-project",
      type: "local",
      command: ["node", "new-project.js"],
      enabled: true,
      scope: "project",
    }
    queueFetchResponses([staleRefresh.promise, latestRefresh.promise])

    activeProjectPath = "/workspace/old-project"
    const oldLoad = useMcpConfigStore.getState().loadMcpConfigs({ force: true })
    activeProjectPath = "/workspace/new-project"
    const newLoad = useMcpConfigStore.getState().loadMcpConfigs({ force: true })
    await Promise.resolve()

    latestRefresh.resolve(jsonResponse([latestServer]))
    await newLoad

    staleRefresh.resolve(jsonResponse([staleServer]))
    await oldLoad

    expect(fetchCalls.map((call) => call.input)).toEqual([
      "/api/config/mcp?directory=%2Fworkspace%2Fold-project",
      "/api/config/mcp?directory=%2Fworkspace%2Fnew-project",
    ])
    expect(useMcpConfigStore.getState().mcpServers).toEqual([latestServer])
    expect(useMcpConfigStore.getState().isLoading).toBe(false)
  })
})
