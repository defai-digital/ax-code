import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import type { ProviderResult } from "@/types"

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

const createQuotaResult = (providerName: string, fetchedAt: number): ProviderResult => ({
  providerId: "claude",
  providerName,
  ok: true,
  configured: true,
  usage: {
    windows: {
      daily: {
        usedPercent: fetchedAt,
        remainingPercent: 100 - fetchedAt,
        windowSeconds: null,
        resetAfterSeconds: null,
        resetAt: null,
        resetAtFormatted: null,
        resetAfterFormatted: null,
      },
    },
  },
  fetchedAt,
})

const importStore = async () => {
  vi.resetModules()
  vi.doMock("@/lib/persistence", () => ({
    updateDesktopSettings: vi.fn(async () => {}),
  }))
  vi.doMock("@/contexts/runtimeAPIRegistry", () => ({
    getRegisteredRuntimeAPIs: () => null,
  }))
  return import("./useQuotaStore")
}

describe("useQuotaStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.doUnmock("@/lib/persistence")
    vi.doUnmock("@/contexts/runtimeAPIRegistry")
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  test("keeps the newest quota response when provider refreshes overlap", async () => {
    const first = createDeferred<ProviderResult>()
    const second = createDeferred<ProviderResult>()
    const requests = [first, second]
    const fetchMock = vi.fn(async () => {
      const request = requests.shift()
      if (!request) {
        throw new Error("Unexpected quota fetch")
      }
      return {
        ok: true,
        json: async () => request.promise,
      } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    const { useQuotaStore } = await importStore()

    const firstRefresh = useQuotaStore.getState().fetchProviderQuota("claude")
    const secondRefresh = useQuotaStore.getState().fetchProviderQuota("claude")
    await Promise.resolve()

    second.resolve(createQuotaResult("newer", 80))
    await secondRefresh

    first.resolve(createQuotaResult("stale", 10))
    await firstRefresh

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useQuotaStore.getState().results).toMatchObject([
      {
        providerId: "claude",
        providerName: "newer",
        fetchedAt: 80,
      },
    ])
  })

  test("keeps provider loading true when a stale quota request finishes first", async () => {
    const first = createDeferred<ProviderResult>()
    const second = createDeferred<ProviderResult>()
    const requests = [first, second]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const request = requests.shift()
        if (!request) {
          throw new Error("Unexpected quota fetch")
        }
        return {
          ok: true,
          json: async () => request.promise,
        } as Response
      }),
    )

    const { useQuotaStore } = await importStore()

    const firstRefresh = useQuotaStore.getState().fetchProviderQuota("claude")
    const secondRefresh = useQuotaStore.getState().fetchProviderQuota("claude")
    await Promise.resolve()

    first.resolve(createQuotaResult("stale", 10))
    await firstRefresh

    expect(useQuotaStore.getState().isFetchingProvider.claude).toBe(true)

    second.resolve(createQuotaResult("newer", 80))
    await secondRefresh

    expect(useQuotaStore.getState().isFetchingProvider.claude).toBe(false)
  })
})
