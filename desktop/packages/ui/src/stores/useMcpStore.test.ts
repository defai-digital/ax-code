import { afterEach, describe, expect, test, vi } from "vitest"
import type { McpResource, McpStatus } from "@ax-code/sdk/v2"

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

const status = (state: McpStatus["status"]): McpStatus =>
  ({
    status: state,
  }) as McpStatus

const importStore = async () => {
  vi.resetModules()

  const statusRequests: Array<Deferred<{ data: Record<string, McpStatus> }>> = []
  const resourceRequests: Array<Deferred<{ data: Record<string, McpResource> }>> = []
  const resourceRead = vi.fn(async () => ({
    data: {
      contents: [{ uri: "mcp://repo/file?rev=1", mimeType: "text/plain", text: "hello" }],
    },
  }))
  const apiClient = {
    mcp: {
      status: vi.fn(() => {
        const request = createDeferred<{ data: Record<string, McpStatus> }>()
        statusRequests.push(request)
        return request.promise
      }),
      resources: {
        list: vi.fn(() => {
          const request = createDeferred<{ data: Record<string, McpResource> }>()
          resourceRequests.push(request)
          return request.promise
        }),
      },
      resource: {
        read: resourceRead,
      },
    },
  }
  const getScopedApiClient = vi.fn(() => apiClient)

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      getBaseUrl: () => "/api",
      getApiClient: () => apiClient,
      getScopedApiClient,
    },
  }))

  vi.doMock("@/stores/useDirectoryStore", () => ({
    useDirectoryStore: {
      getState: () => ({ currentDirectory: "/repo" }),
    },
  }))

  const storeModule = await import("./useMcpStore")
  return {
    ...storeModule,
    getScopedApiClient,
    statusRequests,
    resourceRead,
    resourceRequests,
  }
}

describe("useMcpStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/stores/useDirectoryStore")
    vi.resetModules()
  })

  test("does not let an older MCP status refresh overwrite a newer refresh", async () => {
    const { statusRequests, useMcpStore } = await importStore()

    const staleRefresh = useMcpStore.getState().refresh({ directory: "/repo" })
    const latestRefresh = useMcpStore.getState().refresh({ directory: "/repo" })
    await Promise.resolve()

    statusRequests[1].resolve({ data: { server: status("connected") } })
    await latestRefresh

    statusRequests[0].resolve({ data: { server: status("failed") } })
    await staleRefresh

    expect(useMcpStore.getState().getStatusForDirectory("/repo").server?.status).toBe("connected")
  })

  test("normalizes scoped directory keys for Windows paths", async () => {
    const { getScopedApiClient, statusRequests, useMcpStore } = await importStore()

    const refresh = useMcpStore.getState().refresh({ directory: " c:\\Repo\\ " })
    await Promise.resolve()

    statusRequests[0].resolve({ data: { server: status("connected") } })
    await refresh

    expect(getScopedApiClient).toHaveBeenCalledWith("C:/Repo")
    expect(useMcpStore.getState().getStatusForDirectory("C:/Repo/").server?.status).toBe("connected")
  })

  test("reads MCP resources through the formal generated SDK route", async () => {
    const { resourceRead, useMcpStore } = await importStore()
    const result = await useMcpStore.getState().readResource("docs", "mcp://repo/file?rev=1", "/repo")

    expect(resourceRead).toHaveBeenCalledWith({ name: "docs", uri: "mcp://repo/file?rev=1" }, { throwOnError: true })
    expect(result.contents[0]?.text).toBe("hello")
  })

  test("does not let an older MCP resources refresh overwrite a newer refresh", async () => {
    const { resourceRequests, useMcpStore } = await importStore()
    const staleRefresh = useMcpStore.getState().refreshResources({ directory: "/repo" })
    const latestRefresh = useMcpStore.getState().refreshResources({ directory: "/repo" })
    await Promise.resolve()

    resourceRequests[1].resolve({
      data: {
        "docs:latest": { client: "docs", name: "latest", uri: "mcp://docs/latest" },
      },
    })
    await latestRefresh

    resourceRequests[0].resolve({
      data: {
        "docs:stale": { client: "docs", name: "stale", uri: "mcp://docs/stale" },
      },
    })
    await staleRefresh

    expect(useMcpStore.getState().getResourcesForDirectory("/repo")["docs:latest"]?.uri).toBe("mcp://docs/latest")
    expect(useMcpStore.getState().getResourcesForDirectory("/repo")["docs:stale"]).toBeUndefined()
  })
})
