import { afterEach, describe, expect, test, vi } from "vitest"
import type { McpStatus } from "@ax-code/sdk/v2"

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
  const apiClient = {
    mcp: {
      status: vi.fn(() => {
        const request = createDeferred<{ data: Record<string, McpStatus> }>()
        statusRequests.push(request)
        return request.promise
      }),
    },
  }

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      getApiClient: () => apiClient,
      getScopedApiClient: () => apiClient,
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
    statusRequests,
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
})
