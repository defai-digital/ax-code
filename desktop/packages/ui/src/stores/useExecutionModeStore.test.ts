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
      loadedByDirectory: { "/repo": true },
    })
    setAutonomousEnabledMock.mockRejectedValueOnce(new Error("server unavailable"))

    await useExecutionModeStore.getState().setMode("/repo", "autonomous")

    expect(useExecutionModeStore.getState().isPending("/repo")).toBe(false)
    expect(useExecutionModeStore.getState().getMode("/repo")).toBe("manual")
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })
})
