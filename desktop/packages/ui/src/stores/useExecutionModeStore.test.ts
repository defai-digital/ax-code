import { afterEach, describe, expect, test, vi } from "vitest"

const importStore = async () => {
  vi.resetModules()

  const getAutonomousEnabledMock = vi.fn(async () => true)
  const getSuperLongEnabledMock = vi.fn(async () => false)
  const setAutonomousEnabledMock = vi.fn(async (enabled: boolean) => enabled)
  const setSuperLongEnabledMock = vi.fn(async (enabled: boolean) => enabled)
  const toastErrorMock = vi.fn()

  vi.doMock("@/lib/ax-code/client", () => ({
    axCodeClient: {
      withDirectory: async (_directory: string | null, run: () => Promise<unknown>) => run(),
      getAutonomousEnabled: getAutonomousEnabledMock,
      getSuperLongEnabled: getSuperLongEnabledMock,
      setAutonomousEnabled: setAutonomousEnabledMock,
      setSuperLongEnabled: setSuperLongEnabledMock,
    },
  }))

  vi.doMock("@/components/ui", () => ({
    toast: {
      error: toastErrorMock,
    },
  }))

  const storeModule = await import("./useExecutionModeStore")

  return {
    ...storeModule,
    getAutonomousEnabledMock,
    getSuperLongEnabledMock,
    setAutonomousEnabledMock,
    setSuperLongEnabledMock,
    toastErrorMock,
  }
}

describe("useExecutionModeStore", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/ax-code/client")
    vi.doUnmock("@/components/ui")
    vi.resetModules()
  })

  test("clears pending state when execution mode loading fails", async () => {
    const { getAutonomousEnabledMock, useExecutionModeStore } = await importStore()
    getAutonomousEnabledMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useExecutionModeStore.getState().loadMode("/repo")

    expect(useExecutionModeStore.getState().isPending("/repo")).toBe(false)
    expect(useExecutionModeStore.getState().getMode("/repo")).toBeUndefined()
  })

  test("reverts optimistic execution mode when applying mode fails", async () => {
    const { setAutonomousEnabledMock, toastErrorMock, useExecutionModeStore } = await importStore()
    useExecutionModeStore.setState({
      modeByDirectory: { "/repo": "manual" },
      pendingByDirectory: {},
    })
    setAutonomousEnabledMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useExecutionModeStore.getState().setMode("/repo", "autonomous")

    expect(useExecutionModeStore.getState().isPending("/repo")).toBe(false)
    expect(useExecutionModeStore.getState().getMode("/repo")).toBe("manual")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })

  test("settles on the mid-transition server state when a later step fails", async () => {
    const { setAutonomousEnabledMock, toastErrorMock, useExecutionModeStore } = await importStore()
    useExecutionModeStore.setState({
      modeByDirectory: { "/repo": "long-run" },
      pendingByDirectory: {},
    })
    // long-run → manual: super-long-off lands, autonomous-off fails. The
    // server now holds autonomous-without-super-long, so the UI must show
    // "autonomous", not revert to "long-run".
    setAutonomousEnabledMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useExecutionModeStore.getState().setMode("/repo", "manual")

    expect(useExecutionModeStore.getState().isPending("/repo")).toBe(false)
    expect(useExecutionModeStore.getState().getMode("/repo")).toBe("autonomous")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })

  test("re-fetches on every load so out-of-band changes propagate", async () => {
    const { getAutonomousEnabledMock, getSuperLongEnabledMock, useExecutionModeStore } = await importStore()

    await useExecutionModeStore.getState().loadMode("/repo")
    expect(useExecutionModeStore.getState().getMode("/repo")).toBe("autonomous")

    // Setting changed externally (e.g. via the CLI) — a later load must pick
    // it up instead of serving the cached value forever.
    getAutonomousEnabledMock.mockResolvedValueOnce(false)
    getSuperLongEnabledMock.mockResolvedValueOnce(false)
    await useExecutionModeStore.getState().loadMode("/repo")

    expect(useExecutionModeStore.getState().getMode("/repo")).toBe("manual")
  })

  test("normalizes directory keys across Windows path variants", async () => {
    const { useExecutionModeStore } = await importStore()

    useExecutionModeStore.setState({
      modeByDirectory: { "C:/Repo": "autonomous" },
      pendingByDirectory: {},
    })

    expect(useExecutionModeStore.getState().getMode("c:\\Repo\\")).toBe("autonomous")
  })
})
