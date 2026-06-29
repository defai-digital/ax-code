import { afterEach, describe, expect, test, vi } from "vitest"

const createMemoryStorage = () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    clear: () => {
      values.clear()
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size
    },
  } as Storage

  return { storage, values }
}

const importStore = async () => {
  vi.resetModules()

  const { storage, values } = createMemoryStorage()
  const setDirectoryMock = vi.fn()
  const updateDesktopSettingsMock = vi.fn(async () => undefined)
  const invalidateDirectoryMock = vi.fn()

  vi.doMock("./utils/safeStorage", () => ({
    getSafeStorage: () => storage,
  }))

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      setDirectory: setDirectoryMock,
      getFilesystemHome: vi.fn(() => new Promise<never>(() => undefined)),
      getSystemInfo: vi.fn(async () => ({ homeDirectory: "" })),
    },
  }))

  vi.doMock("@/lib/desktop", () => ({
    getDesktopHomeDirectory: vi.fn(async () => ""),
  }))

  vi.doMock("@/lib/persistence", () => ({
    updateDesktopSettings: updateDesktopSettingsMock,
  }))

  vi.doMock("@/stores/useFileSearchStore", () => ({
    useFileSearchStore: {
      getState: () => ({
        invalidateDirectory: invalidateDirectoryMock,
      }),
    },
  }))

  vi.doMock("@/stores/utils/streamDebug", () => ({
    streamDebugEnabled: () => false,
  }))

  const storeModule = await import("./useDirectoryStore")

  return {
    ...storeModule,
    invalidateDirectoryMock,
    setDirectoryMock,
    updateDesktopSettingsMock,
    values,
  }
}

describe("useDirectoryStore", () => {
  afterEach(() => {
    vi.doUnmock("./utils/safeStorage")
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/lib/desktop")
    vi.doUnmock("@/lib/persistence")
    vi.doUnmock("@/stores/useFileSearchStore")
    vi.doUnmock("@/stores/utils/streamDebug")
    vi.resetModules()
  })

  test("ignores invalid synchronized home directories", async () => {
    const { setDirectoryMock, updateDesktopSettingsMock, useDirectoryStore, values } = await importStore()
    const initialState = {
      currentDirectory: "/Users/alice/project",
      directoryHistory: ["/Users/alice/project"],
      historyIndex: 0,
      homeDirectory: "/Users/alice",
      hasPersistedDirectory: true,
      isHomeReady: true,
      isSwitchingDirectory: false,
    }

    for (const candidate of ["", "   ", "/"]) {
      values.clear()
      setDirectoryMock.mockClear()
      updateDesktopSettingsMock.mockClear()
      useDirectoryStore.setState(initialState)

      useDirectoryStore.getState().synchronizeHomeDirectory(candidate)

      expect(useDirectoryStore.getState()).toMatchObject(initialState)
      expect(values.get("homeDirectory")).toBeUndefined()
      expect(setDirectoryMock).not.toHaveBeenCalled()
      expect(updateDesktopSettingsMock).not.toHaveBeenCalled()
    }
  })

  test("normalizes synchronized home directories before updating state", async () => {
    const { updateDesktopSettingsMock, useDirectoryStore } = await importStore()

    useDirectoryStore.setState({
      currentDirectory: "/Users/alice/project",
      directoryHistory: ["/Users/alice/project"],
      historyIndex: 0,
      homeDirectory: "/Users/alice",
      hasPersistedDirectory: true,
      isHomeReady: true,
      isSwitchingDirectory: false,
    })

    useDirectoryStore.getState().synchronizeHomeDirectory("/Users/alice-new///")

    expect(useDirectoryStore.getState()).toMatchObject({
      currentDirectory: "/Users/alice/project",
      directoryHistory: ["/Users/alice/project"],
      homeDirectory: "/Users/alice-new",
      isHomeReady: true,
    })
    expect(updateDesktopSettingsMock).toHaveBeenCalledWith({ homeDirectory: "/Users/alice-new" })
  })

  test("keeps Windows drive-root parents absolute", async () => {
    const { setDirectoryMock, useDirectoryStore, values } = await importStore()
    values.set("homeDirectory", "C:/Users/alice")
    useDirectoryStore.setState({
      currentDirectory: "C:/Users",
      directoryHistory: ["C:/Users/alice", "C:/Users"],
      historyIndex: 1,
      homeDirectory: "C:/Users/alice",
      hasPersistedDirectory: true,
      isHomeReady: true,
      isSwitchingDirectory: false,
    })

    useDirectoryStore.getState().goToParent()

    expect(useDirectoryStore.getState().currentDirectory).toBe("C:/")
    expect(setDirectoryMock).toHaveBeenCalledWith("C:/")
    expect(values.get("lastDirectory")).toBe("C:/")
  })

  test("does not navigate above Windows drive roots", async () => {
    const { setDirectoryMock, useDirectoryStore, values } = await importStore()
    values.set("homeDirectory", "C:/Users/alice")
    useDirectoryStore.setState({
      currentDirectory: "C:/",
      directoryHistory: ["C:/Users/alice", "C:/"],
      historyIndex: 1,
      homeDirectory: "C:/Users/alice",
      hasPersistedDirectory: true,
      isHomeReady: true,
      isSwitchingDirectory: false,
    })
    setDirectoryMock.mockClear()

    useDirectoryStore.getState().goToParent()

    expect(useDirectoryStore.getState().currentDirectory).toBe("C:/")
    expect(setDirectoryMock).not.toHaveBeenCalled()
    expect(values.get("lastDirectory")).toBeUndefined()
  })
})
