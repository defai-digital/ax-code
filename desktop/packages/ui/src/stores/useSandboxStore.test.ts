import { afterEach, describe, expect, test, vi } from "vitest"

const importStore = async () => {
  vi.resetModules()

  const getIsolationMock = vi.fn(async () => ({ mode: "workspace-write" }))
  const setIsolationMock = vi.fn(async (mode: string) => ({ mode }))
  const toastErrorMock = vi.fn()

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      withDirectory: async (_directory: string | null, run: () => Promise<unknown>) => run(),
      getIsolation: getIsolationMock,
      setIsolation: setIsolationMock,
    },
  }))

  vi.doMock("@/components/ui", () => ({
    toast: {
      error: toastErrorMock,
    },
  }))

  const storeModule = await import("./useSandboxStore")

  return {
    ...storeModule,
    getIsolationMock,
    setIsolationMock,
    toastErrorMock,
  }
}

describe("useSandboxStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/components/ui")
    vi.resetModules()
  })

  test("clears pending state when sandbox loading fails", async () => {
    const { getIsolationMock, useSandboxStore } = await importStore()
    getIsolationMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useSandboxStore.getState().loadSandbox("/repo")

    expect(useSandboxStore.getState().isPending("/repo")).toBe(false)
    expect(useSandboxStore.getState().isSandbox("/repo")).toBeUndefined()
  })

  test("reverts optimistic sandbox toggle when isolation update fails", async () => {
    const { setIsolationMock, toastErrorMock, useSandboxStore } = await importStore()
    useSandboxStore.setState({
      sandboxByDirectory: { "/repo": false },
      pendingByDirectory: {},
    })
    setIsolationMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useSandboxStore.getState().setSandbox("/repo", true)

    expect(useSandboxStore.getState().isPending("/repo")).toBe(false)
    expect(useSandboxStore.getState().isSandbox("/repo")).toBe(false)
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })

  test("restores read-only instead of upgrading to workspace-write on re-enable", async () => {
    const { getIsolationMock, setIsolationMock, useSandboxStore } = await importStore()
    getIsolationMock.mockResolvedValueOnce({ mode: "read-only" })

    await useSandboxStore.getState().loadSandbox("/repo")
    expect(useSandboxStore.getState().isSandbox("/repo")).toBe(true)

    await useSandboxStore.getState().setSandbox("/repo", false)
    expect(setIsolationMock).toHaveBeenLastCalledWith("full-access")

    await useSandboxStore.getState().setSandbox("/repo", true)
    expect(setIsolationMock).toHaveBeenLastCalledWith("read-only")
  })

  test("re-fetches on every load so out-of-band changes propagate", async () => {
    const { getIsolationMock, useSandboxStore } = await importStore()

    await useSandboxStore.getState().loadSandbox("/repo")
    expect(useSandboxStore.getState().isSandbox("/repo")).toBe(true)

    // Setting changed externally (e.g. via the CLI) — a later load must pick
    // it up instead of serving the cached value forever.
    getIsolationMock.mockResolvedValueOnce({ mode: "full-access" })
    await useSandboxStore.getState().loadSandbox("/repo")

    expect(useSandboxStore.getState().isSandbox("/repo")).toBe(false)
  })

  test("normalizes directory keys across Windows path variants", async () => {
    const { useSandboxStore } = await importStore()

    useSandboxStore.setState({
      sandboxByDirectory: { "C:/Repo": true },
      pendingByDirectory: {},
    })

    expect(useSandboxStore.getState().isSandbox("c:\\Repo\\")).toBe(true)
  })
})
