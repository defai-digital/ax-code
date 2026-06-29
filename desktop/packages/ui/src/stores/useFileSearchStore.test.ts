import { beforeEach, describe, expect, test, vi } from "vitest"

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

const searchRequests: Array<Deferred<Array<{ path: string }>>> = []

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const searchFilesMock = vi.fn(() => {
  const request = createDeferred<Array<{ path: string }>>()
  searchRequests.push(request)
  return request.promise
})
const nativeSearchRequests: Array<{ directory: string; query: string }> = []
const searchFilesNativeMock = vi.fn(async (directory: string, query: string) => {
  nativeSearchRequests.push({ directory, query })
  return nativeSearchResult
})
const recordDesktopStartupEventMock = vi.fn(async () => {}) as (() => Promise<void>) & { mockClear: () => void }
let isTauriShellValue = false
let isElectronShellValue = false
let isDesktopLocalOriginActiveValue = true
let nativeSearchResult: Array<{ path: string }> | null = null

vi.doMock("@/lib/ax-code/client", () => ({
  axCodeClient: {
    searchFiles: searchFilesMock,
  },
}))

vi.doMock("@/lib/desktop", () => ({
  searchFilesNative: searchFilesNativeMock,
  isDesktopLocalOriginActive: () => isDesktopLocalOriginActiveValue,
  isTauriShell: () => isTauriShellValue,
  isElectronShell: () => isElectronShellValue,
  recordDesktopStartupEvent: recordDesktopStartupEventMock,
}))

const { useFileSearchStore } = await import("./useFileSearchStore")

describe("useFileSearchStore", () => {
  beforeEach(() => {
    searchRequests.length = 0
    nativeSearchRequests.length = 0
    recordDesktopStartupEventMock.mockClear()
    useFileSearchStore.setState({
      cache: {},
      cacheKeys: [],
      inFlight: {},
    })
    isTauriShellValue = false
    isElectronShellValue = false
    isDesktopLocalOriginActiveValue = true
    nativeSearchResult = null
  })

  test("does not cache a stale in-flight search after invalidation", async () => {
    const searchPromise = useFileSearchStore.getState().searchFiles("/project", "foo")
    expect(Object.keys(useFileSearchStore.getState().inFlight)).toHaveLength(1)

    useFileSearchStore.getState().invalidateDirectory("/project")
    expect(Object.keys(useFileSearchStore.getState().inFlight)).toHaveLength(0)

    searchRequests[0].resolve([{ path: "stale.ts" }])
    await searchPromise

    expect(useFileSearchStore.getState().cache).toEqual({})
    expect(useFileSearchStore.getState().cacheKeys).toEqual([])
  })

  test("does not notify subscribers when stale search handlers make no state change", async () => {
    const searchPromise = useFileSearchStore.getState().searchFiles("/project", "foo")
    useFileSearchStore.getState().invalidateDirectory("/project")

    let updateCount = 0
    const unsubscribe = useFileSearchStore.subscribe(() => {
      updateCount += 1
    })

    searchRequests[0].resolve([{ path: "stale.ts" }])
    await searchPromise
    unsubscribe()

    expect(updateCount).toBe(0)
  })

  test("does not let a stale request remove a newer in-flight search", async () => {
    const stalePromise = useFileSearchStore.getState().searchFiles("/project", "foo")
    useFileSearchStore.getState().invalidateDirectory("/project")
    const freshPromise = useFileSearchStore.getState().searchFiles("/project", "foo")

    searchRequests[0].resolve([{ path: "stale.ts" }])
    await stalePromise

    expect(Object.keys(useFileSearchStore.getState().inFlight)).toHaveLength(1)

    searchRequests[1].resolve([{ path: "fresh.ts" }])
    await freshPromise

    const cacheEntries = Object.values(useFileSearchStore.getState().cache)
    expect(cacheEntries).toHaveLength(1)
    expect(cacheEntries[0]?.files).toEqual([{ path: "fresh.ts" }])
  })

  test("keeps directory and query separators from colliding in cache keys", async () => {
    const firstPromise = useFileSearchStore.getState().searchFiles("/project::nested", "foo")
    searchRequests[0].resolve([{ path: "first.ts" }])
    await firstPromise

    const secondPromise = useFileSearchStore.getState().searchFiles("/project", "nested::foo")
    expect(searchRequests).toHaveLength(2)

    searchRequests[1].resolve([{ path: "second.ts" }])
    expect(await secondPromise).toEqual([{ path: "second.ts" }])
  })

  test("invalidates descendant directory search cache entries", async () => {
    const searchPromise = useFileSearchStore.getState().searchFiles("/project/src", "foo")
    searchRequests[0].resolve([{ path: "/project/src/stale.ts" }])
    await searchPromise

    expect(Object.keys(useFileSearchStore.getState().cache)).toHaveLength(1)

    useFileSearchStore.getState().invalidateDirectory("/project")

    expect(useFileSearchStore.getState().cache).toEqual({})
    expect(useFileSearchStore.getState().cacheKeys).toEqual([])
  })

  test("does not invalidate sibling directories with the same prefix", async () => {
    const searchPromise = useFileSearchStore.getState().searchFiles("/project-other/src", "foo")
    searchRequests[0].resolve([{ path: "/project-other/src/fresh.ts" }])
    await searchPromise

    useFileSearchStore.getState().invalidateDirectory("/project")

    const cacheEntries = Object.values(useFileSearchStore.getState().cache)
    expect(cacheEntries).toHaveLength(1)
    expect(cacheEntries[0]?.files).toEqual([{ path: "/project-other/src/fresh.ts" }])
  })

  test("invalidates absolute descendant cache entries from the filesystem root", async () => {
    const searchPromise = useFileSearchStore.getState().searchFiles("/project/src", "foo")
    searchRequests[0].resolve([{ path: "/project/src/stale.ts" }])
    await searchPromise

    useFileSearchStore.getState().invalidateDirectory("/")

    expect(useFileSearchStore.getState().cache).toEqual({})
    expect(useFileSearchStore.getState().cacheKeys).toEqual([])
  })

  test("uses native file search on the local Electron desktop origin", async () => {
    isTauriShellValue = true
    isElectronShellValue = true
    nativeSearchResult = [{ path: "from-native.ts" }]

    const searchPromise = useFileSearchStore.getState().searchFiles("/project", "foo", 10, { type: "file" })

    expect(nativeSearchRequests).toEqual([{ directory: "/project", query: "foo" }])
    expect(searchRequests).toHaveLength(0)
    expect(await searchPromise).toEqual([{ path: "from-native.ts" }])
  })

  test("keeps remote Electron hosts on the HTTP file search path", async () => {
    isTauriShellValue = true
    isElectronShellValue = true
    isDesktopLocalOriginActiveValue = false

    const searchPromise = useFileSearchStore.getState().searchFiles("/project", "foo", 10, { type: "file" })

    expect(nativeSearchRequests).toEqual([])
    expect(searchRequests).toHaveLength(1)
    searchRequests[0].resolve([{ path: "from-ax-code.ts" }])
    expect(await searchPromise).toEqual([{ path: "from-ax-code.ts" }])
  })
})
