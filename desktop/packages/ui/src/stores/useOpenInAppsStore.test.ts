import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

type FetchInstalledAppsResult = {
  apps: Array<{ name: string; iconDataUrl?: string | null }>
  success: boolean
  hasCache: boolean
  isCacheStale: boolean
}

const fetchDesktopInstalledAppsMock =
  vi.fn<(_apps: string[], _force?: boolean) => Promise<FetchInstalledAppsResult>>()

const installMockLocalStorage = () => {
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(String(key))
    },
    setItem: (key, value) => {
      values.set(String(key), String(value))
    },
  }
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: storage,
  })
}

const setDesktopPlatform = (platform: string) => {
  Object.defineProperty(window, "__AX_CODE_DESKTOP_PLATFORM__", {
    configurable: true,
    value: platform,
  })
}

const clearDesktopPlatform = () => {
  Reflect.deleteProperty(window, "__AX_CODE_DESKTOP_PLATFORM__")
}

const clearMockLocalStorage = () => {
  Reflect.deleteProperty(window, "localStorage")
}

const importStore = async () => {
  vi.resetModules()
  vi.doMock("@/lib/desktop", () => ({
    fetchDesktopInstalledApps: fetchDesktopInstalledAppsMock,
    isDesktopLocalOriginActive: () => true,
    isTauriShell: () => true,
  }))
  vi.doMock("@/lib/persistence", () => ({
    updateDesktopSettings: vi.fn(async () => {}),
  }))
  return import("./useOpenInAppsStore")
}

describe("useOpenInAppsStore", () => {
  beforeEach(() => {
    fetchDesktopInstalledAppsMock.mockReset()
    installMockLocalStorage()
    setDesktopPlatform("win32")
  })

  afterEach(() => {
    clearDesktopPlatform()
    clearMockLocalStorage()
    vi.doUnmock("@/lib/desktop")
    vi.doUnmock("@/lib/persistence")
    vi.resetModules()
  })

  test("keeps platform-normalized Explorer metadata after a manual app refresh", async () => {
    fetchDesktopInstalledAppsMock.mockResolvedValue({
      apps: [{ name: "Finder", iconDataUrl: "data:image/png;base64,explorer" }],
      success: true,
      hasCache: true,
      isCacheStale: false,
    })

    const { useOpenInAppsStore } = await importStore()

    await useOpenInAppsStore.getState().loadInstalledApps(true)

    const explorer = useOpenInAppsStore.getState().availableApps.find((app) => app.id === "finder")
    expect(explorer).toMatchObject({
      label: "Explorer",
      appName: "File Explorer",
      iconDataUrl: "data:image/png;base64,explorer",
    })
  })

  test("keeps installed-app updates that arrive before a stale cache response resolves", async () => {
    fetchDesktopInstalledAppsMock.mockImplementation(async () => {
      window.dispatchEvent(
        new CustomEvent("openchamber:installed-apps-updated", {
          detail: [{ name: "Cursor", iconDataUrl: "data:image/png;base64,cursor-fresh" }],
        }),
      )
      return {
        apps: [{ name: "Finder", iconDataUrl: "data:image/png;base64,finder-stale" }],
        success: true,
        hasCache: true,
        isCacheStale: true,
      }
    })

    const { useOpenInAppsStore } = await importStore()

    await useOpenInAppsStore.getState().loadInstalledApps(true)
    await Promise.resolve()

    const cursor = useOpenInAppsStore.getState().availableApps.find((app) => app.id === "cursor")
    expect(cursor).toMatchObject({
      appName: "Cursor",
      iconDataUrl: "data:image/png;base64,cursor-fresh",
    })
    expect(useOpenInAppsStore.getState().isCacheStale).toBe(false)
  })

  test("honors a forced refresh when it is the first store load", async () => {
    const forceArgs: Array<boolean | undefined> = []
    fetchDesktopInstalledAppsMock.mockImplementation(async (_apps, force) => {
      forceArgs.push(force)
      return {
        apps: [{ name: "Cursor", iconDataUrl: "data:image/png;base64,cursor" }],
        success: true,
        hasCache: true,
        isCacheStale: false,
      }
    })

    const { useOpenInAppsStore } = await importStore()

    await useOpenInAppsStore.getState().loadInstalledApps(true)

    expect(forceArgs).toEqual([undefined, true])
    expect(useOpenInAppsStore.getState().availableApps.some((app) => app.id === "cursor")).toBe(true)
  })
})
