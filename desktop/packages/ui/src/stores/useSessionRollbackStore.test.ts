import { afterEach, describe, expect, test, vi } from "vitest"
import type { SessionRollbackPoint, SessionRollbackPreview } from "@ax-code/sdk/v2"

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
  const rollbackPreview = vi.fn(
    async (): Promise<{ data: SessionRollbackPreview }> => ({
      data: {
        point: point(4, "edit"),
        diffs: [
          {
            file: "src/app.ts",
            before: "old",
            after: "new",
            additions: 1,
            deletions: 1,
            status: "modified",
          },
        ],
        summary: { files: 1, additions: 1, deletions: 1 },
      },
    }),
  )
  const apiClient = {
    session: {
      rollbackPoints: vi.fn(() => {
        const request = createDeferred<{ data: SessionRollbackPoint[] }>()
        rollbackRequests.push(request)
        return request.promise
      }),
      rollbackPreview,
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
    rollbackPreview,
    rollbackRequests,
  }
}

describe("useSessionRollbackStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/stores/useDirectoryStore")
    vi.resetModules()
    vi.useRealTimers()
  })

  test("a rollback points request that never settles times out instead of latching the spinner", async () => {
    vi.useFakeTimers()
    const { useSessionRollbackStore } = await importStore()

    const refresh = useSessionRollbackStore.getState().refreshPoints("ses_1", { directory: "/repo" })
    const outcome = refresh.catch((error: unknown) => error)
    await Promise.resolve()
    expect(useSessionRollbackStore.getState().isLoading("ses_1", { directory: "/repo" })).toBe(true)

    await vi.advanceTimersByTimeAsync(12_000)

    expect(await outcome).toBeInstanceOf(Error)
    expect(String(await outcome)).toContain("Timed out")
    expect(useSessionRollbackStore.getState().isLoading("ses_1", { directory: "/repo" })).toBe(false)
    expect(useSessionRollbackStore.getState().getError("ses_1", { directory: "/repo" })).toContain("Timed out")
  })

  test("clearSession prunes loading and error entries alongside cached points", async () => {
    vi.useFakeTimers()
    const { rollbackRequests, useSessionRollbackStore } = await importStore()

    // First key reaches a persistent error state via timeout.
    const failed = useSessionRollbackStore
      .getState()
      .refreshPoints("ses_1", { directory: "/repo" })
      .catch(() => undefined)
    await vi.advanceTimersByTimeAsync(12_000)
    await failed
    expect(useSessionRollbackStore.getState().getError("ses_1", { directory: "/repo" })).not.toBeNull()

    // Second key is mid-flight with the loading flag set.
    void useSessionRollbackStore
      .getState()
      .refreshPoints("ses_1", { directory: "/repo", tool: "edit" })
      .catch(() => undefined)
    await Promise.resolve()
    expect(useSessionRollbackStore.getState().isLoading("ses_1", { directory: "/repo", tool: "edit" })).toBe(true)

    useSessionRollbackStore.getState().clearSession("ses_1", "/repo")

    expect(useSessionRollbackStore.getState().getError("ses_1", { directory: "/repo" })).toBeNull()
    expect(useSessionRollbackStore.getState().isLoading("ses_1", { directory: "/repo", tool: "edit" })).toBe(false)
    expect(useSessionRollbackStore.getState().getPoints("ses_1", { directory: "/repo" })).toEqual([])
    // The untouched maps hold no leftover entries for the cleared session.
    expect(Object.keys(useSessionRollbackStore.getState().loadingKeys)).toEqual([])
    expect(Object.keys(useSessionRollbackStore.getState().errorKeys)).toEqual([])
    rollbackRequests.forEach((request) => request.resolve({ data: [] }))
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

  test("previews rollback points through the generated SDK route", async () => {
    const { rollbackPreview, useSessionRollbackStore } = await importStore()
    const result = await useSessionRollbackStore
      .getState()
      .previewRollback("ses_1", { step: 4 }, { directory: "/repo" })

    expect(rollbackPreview).toHaveBeenCalledWith(
      {
        sessionID: "ses_1",
        directory: "/repo",
        sessionRollbackApplyInput: { step: 4 },
      },
      { throwOnError: true },
    )
    expect(result.summary.files).toBe(1)
  })
})
