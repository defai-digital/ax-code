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

const fetchCalls: Array<RequestInfo | URL> = []
let queuedResponses: Array<Response | Promise<Response>> = []

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

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })

const snippet = (name: string, project: string) => ({
  name,
  content: `${name} body`,
  aliases: [],
  filePath: `/workspace/${project}/snippets/${name}.md`,
  source: "project" as const,
})

const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  fetchCalls.push(input)
  return queuedResponses.shift() ?? jsonResponse([])
})

const loadStore = async () => {
  const { useSnippetsStore } = await import("./useSnippetsStore")
  return useSnippetsStore
}

describe("useSnippetsStore", () => {
  beforeEach(() => {
    vi.resetModules()
    activeProjectPath = "/workspace/project"
    fetchCalls.length = 0
    queuedResponses = []
    globalThis.fetch = fetchMock as unknown as typeof fetch
    fetchMock.mockClear()
  })

  test("loads fresh snippets when the active project directory changes inside the cache TTL", async () => {
    queuedResponses = [
      jsonResponse([snippet("old-snippet", "old-project")]),
      jsonResponse([snippet("new-snippet", "new-project")]),
    ]

    const useSnippetsStore = await loadStore()

    activeProjectPath = "/workspace/old-project"
    await useSnippetsStore.getState().loadSnippets()
    expect(useSnippetsStore.getState().snippets).toEqual([snippet("old-snippet", "old-project")])

    activeProjectPath = "/workspace/new-project"
    await useSnippetsStore.getState().loadSnippets()

    expect(fetchCalls.map(String)).toEqual([
      "/api/config/snippets?directory=%2Fworkspace%2Fold-project",
      "/api/config/snippets?directory=%2Fworkspace%2Fnew-project",
    ])
    expect(useSnippetsStore.getState().snippets).toEqual([snippet("new-snippet", "new-project")])
    expect(useSnippetsStore.getState().isLoading).toBe(false)
  })

  test("does not share in-flight snippet loads across project directories", async () => {
    const staleSnippets = createDeferred<Response>()
    const latestSnippets = createDeferred<Response>()
    queuedResponses = [staleSnippets.promise, latestSnippets.promise]

    const useSnippetsStore = await loadStore()

    activeProjectPath = "/workspace/old-project"
    const oldLoad = useSnippetsStore.getState().loadSnippets()
    activeProjectPath = "/workspace/new-project"
    const newLoad = useSnippetsStore.getState().loadSnippets()
    await Promise.resolve()

    expect(fetchCalls.map(String)).toEqual([
      "/api/config/snippets?directory=%2Fworkspace%2Fold-project",
      "/api/config/snippets?directory=%2Fworkspace%2Fnew-project",
    ])

    latestSnippets.resolve(jsonResponse([snippet("new-snippet", "new-project")]))
    await newLoad

    staleSnippets.resolve(jsonResponse([snippet("old-snippet", "old-project")]))
    await oldLoad

    expect(useSnippetsStore.getState().snippets).toEqual([snippet("new-snippet", "new-project")])
    expect(useSnippetsStore.getState().isLoading).toBe(false)
  })
})
