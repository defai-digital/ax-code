import { afterEach, describe, expect, test, vi } from "vitest"

const createMemoryStorage = () => {
  const values = new Map<string, string>()
  return {
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
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const importStore = async (options: {
  pendingPermissions: Deferred<Array<{ id: string; sessionID: string }>>
}) => {
  vi.resetModules()

  const respondToPermissionMock = vi.fn(async () => undefined)
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true })),
  )

  vi.doMock("./utils/safeStorage", () => ({
    getSafeStorage: () => createMemoryStorage(),
  }))
  vi.doMock("@/sync/sync-refs", () => ({
    getAllSyncSessions: () => [{ id: "root" }],
    getSyncChildStores: () => ({ children: new Map() }),
  }))
  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      getDirectory: () => "/project",
      listPendingPermissions: vi.fn(() => options.pendingPermissions.promise),
    },
  }))
  vi.doMock("@/sync/session-actions", () => ({
    respondToPermission: respondToPermissionMock,
  }))
  vi.doMock("@/sync/session-ui-store", () => ({
    useSessionUIStore: {
      getState: () => ({
        getDirectoryForSession: () => "/project",
      }),
    },
  }))

  const { usePermissionStore } = await import("./permissionStore")
  return { usePermissionStore, respondToPermissionMock }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("permissionStore setSessionAutoAccept", () => {
  test("auto-accepts pending permissions gathered while enabling", async () => {
    const pendingPermissions = deferred<Array<{ id: string; sessionID: string }>>()
    const { usePermissionStore, respondToPermissionMock } = await importStore({ pendingPermissions })

    const enable = usePermissionStore.getState().setSessionAutoAccept("root", true)
    pendingPermissions.resolve([{ id: "perm-1", sessionID: "root" }])
    await enable

    expect(respondToPermissionMock).toHaveBeenCalledTimes(1)
    expect(respondToPermissionMock).toHaveBeenCalledWith("root", "perm-1", "once")
  })

  test("a disable during the enable gather stops the pending auto-approve batch", async () => {
    // The enable path awaits network lookups before bulk-approving; the user
    // can turn auto-accept back off in that window. The stale enable must
    // not keep approving permissions the user just declined to auto-grant.
    const pendingPermissions = deferred<Array<{ id: string; sessionID: string }>>()
    const { usePermissionStore, respondToPermissionMock } = await importStore({ pendingPermissions })

    const enable = usePermissionStore.getState().setSessionAutoAccept("root", true)
    await usePermissionStore.getState().setSessionAutoAccept("root", false)
    pendingPermissions.resolve([{ id: "perm-1", sessionID: "root" }])
    await enable

    expect(respondToPermissionMock).not.toHaveBeenCalled()
    expect(usePermissionStore.getState().autoAccept["root"]).toBe(false)
  })

  test("pruneAutoAccept drops entries for deleted sessions and keeps the rest", async () => {
    const pendingPermissions = deferred<Array<{ id: string; sessionID: string }>>()
    pendingPermissions.resolve([])
    const { usePermissionStore } = await importStore({ pendingPermissions })

    await usePermissionStore.getState().setSessionAutoAccept("root", true)
    usePermissionStore.setState((state) => ({ autoAccept: { ...state.autoAccept, other: true } }))

    usePermissionStore.getState().pruneAutoAccept(["root", "never-seen"])

    expect(usePermissionStore.getState().autoAccept).toEqual({ other: true })
  })
})
