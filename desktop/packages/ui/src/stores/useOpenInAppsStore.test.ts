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
})
