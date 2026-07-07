import { afterEach, describe, expect, test, vi } from "vitest"
import type { SessionRollbackPoint } from "@ax-code/sdk/v2"

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

const point = (step: number, tool: string): SessionRollbackPoint => ({
  step,
  messageID: `msg_${step}`,
  partID: `prt_${step}`,
  tools: [tool],
  kinds: [tool],
})

const importStore = async () => {
  vi.resetModules()

  const rollbackRequests: Array<Deferred<{ data: SessionRollbackPoint[] }>> = []
  const apiClient = {
    session: {
      rollbackPoints: vi.fn(() => {
        const request = createDeferred<{ data: SessionRollbackPoint[] }>()
        rollbackRequests.push(request)
        return request.promise
      }),
    },
  }
  const getScopedApiClient = vi.fn(() => apiClient)

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      getApiClient: () => apiClient,
      getScopedApiClient,
    },
  }))

  vi.doMock("@/stores/useDirectoryStore", () => ({
    useDirectoryStore: {
      getState: () => ({ currentDirectory: "/repo" }),
    },
  }))

  const storeModule = await import("./useSessionRollbackStore")
  return {
    ...storeModule,
    getScopedApiClient,
    rollbackPoints: apiClient.session.rollbackPoints,
    rollbackRequests,
  }
}

describe("useSessionRollbackStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/stores/useDirectoryStore")
    vi.resetModules()
  })

  test("does not let an older rollback refresh overwrite a newer refresh", async () => {
    const { rollbackRequests, useSessionRollbackStore } = await importStore()
    const staleRefresh = useSessionRollbackStore.getState().refreshPoints("ses_1", { directory: "/repo" })
    const latestRefresh = useSessionRollbackStore.getState().refreshPoints("ses_1", { directory: "/repo" })
    await Promise.resolve()

    rollbackRequests[1].resolve({ data: [point(2, "edit")] })
    await latestRefresh

    rollbackRequests[0].resolve({ data: [point(1, "bash")] })
    await staleRefresh

    expect(useSessionRollbackStore.getState().getPoints("ses_1", { directory: "/repo" })).toEqual([point(2, "edit")])
  })

  test("normalizes scoped directory keys for rollback point refresh", async () => {
    const { getScopedApiClient, rollbackPoints, rollbackRequests, useSessionRollbackStore } = await importStore()
    const refresh = useSessionRollbackStore.getState().refreshPoints("ses_1", { directory: " c:\\Repo\\ " })
    await Promise.resolve()

    rollbackRequests[0].resolve({ data: [point(3, "write")] })
    await refresh

    expect(getScopedApiClient).toHaveBeenCalledWith("C:/Repo")
    expect(rollbackPoints).toHaveBeenCalledWith(
      { sessionID: "ses_1", directory: "C:/Repo", tool: undefined },
      { throwOnError: true },
    )
    expect(useSessionRollbackStore.getState().getPoints("ses_1", { directory: "C:/Repo/" })).toEqual([
      point(3, "write"),
    ])
  })
})
