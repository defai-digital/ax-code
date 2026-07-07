import { beforeEach, describe, expect, test, vi } from "vitest"
import { useUpdateStore } from "./useUpdateStore"

let invokedCommands: string[] = []

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

const waitForCommand = async (command: string) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (invokedCommands.includes(command)) return
    await Promise.resolve()
  }
  throw new Error(`Command was not invoked: ${command}`)
}

const restoreWindow = () => {
  delete (globalThis as Record<string, unknown>).window
}

const mockElectronUpdaterWindow = (invoke?: (command: string) => Promise<unknown>) => {
  ;(globalThis as Record<string, unknown>).window = {
    location: { origin: "http://localhost:5173" },
    __AX_CODE_DESKTOP_ELECTRON__: { runtime: "electron" },
    __TAURI__: {
      core: {
        invoke: invoke ?? (async (command: string) => {
          invokedCommands.push(command)
          if (command === "desktop_check_for_updates") {
            return {
              available: false,
              currentVersion: "1.1.1",
            }
          }
          return null
        }),
      },
    },
  }
}

describe("useUpdateStore runtime detection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    invokedCommands = []
    mockElectronUpdaterWindow()
    useUpdateStore.getState().reset()
  })

  test("treats web runtime update checks as a local no-op", async () => {
    restoreWindow()
    ;(globalThis as Record<string, unknown>).window = {
      location: { origin: "http://localhost:5173" },
      __AX_CODE_DESKTOP_RUNTIME_APIS__: { runtime: { platform: "web" } },
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))

    try {
      await useUpdateStore.getState().checkForUpdates()

      expect(fetchMock).not.toHaveBeenCalled()
      expect(useUpdateStore.getState()).toMatchObject({
        checking: false,
        available: false,
        info: null,
        runtimeType: "web",
      })
    } finally {
      restoreWindow()
    }
  })

  test("uses the native updater for the local Electron desktop shell", async () => {
    try {
      await useUpdateStore.getState().checkForUpdates()

      expect(invokedCommands).toEqual(["desktop_check_for_updates"])
      expect(useUpdateStore.getState().runtimeType).toBe("desktop")
      expect(useUpdateStore.getState().info).toEqual({
        available: false,
        currentVersion: "1.1.1",
      })
    } finally {
      restoreWindow()
    }
  })

  test("keeps the newest desktop update check result when checks overlap", async () => {
    const first = createDeferred<unknown>()
    const second = createDeferred<unknown>()
    const calls: Array<Deferred<unknown>> = []
    mockElectronUpdaterWindow(async (command) => {
      invokedCommands.push(command)
      if (command !== "desktop_check_for_updates") return null
      const deferred = calls.length === 0 ? first : second
      calls.push(deferred)
      return deferred.promise
    })

    try {
      const firstCheck = useUpdateStore.getState().checkForUpdates()
      const secondCheck = useUpdateStore.getState().checkForUpdates()
      await Promise.resolve()

      second.resolve({
        available: true,
        version: "1.1.2",
        currentVersion: "1.1.1",
      })
      await secondCheck

      first.resolve({
        available: false,
        currentVersion: "1.1.1",
      })
      await firstCheck

      expect(invokedCommands).toEqual(["desktop_check_for_updates", "desktop_check_for_updates"])
      expect(useUpdateStore.getState()).toMatchObject({
        checking: false,
        available: true,
        info: {
          available: true,
          version: "1.1.2",
          currentVersion: "1.1.1",
        },
      })
    } finally {
      restoreWindow()
    }
  })

  test("does not let a reset desktop download mark the update as downloaded later", async () => {
    const download = createDeferred<unknown>()
    mockElectronUpdaterWindow(async (command) => {
      invokedCommands.push(command)
      if (command === "desktop_check_for_updates") {
        return {
          available: true,
          version: "1.1.2",
          currentVersion: "1.1.1",
        }
      }
      if (command === "desktop_download_and_install_update") {
        return download.promise
      }
      return null
    })

    try {
      await useUpdateStore.getState().checkForUpdates()
      const downloadUpdate = useUpdateStore.getState().downloadUpdate()
      await waitForCommand("desktop_download_and_install_update")

      useUpdateStore.getState().reset()
      download.resolve(null)
      await downloadUpdate

      expect(invokedCommands).toEqual(["desktop_check_for_updates", "desktop_download_and_install_update"])
      expect(useUpdateStore.getState()).toMatchObject({
        checking: false,
        available: false,
        downloading: false,
        downloaded: false,
        info: null,
      })
    } finally {
      restoreWindow()
    }
  })

  test("downloads the confirmed desktop update without rechecking", async () => {
    let updateChecks = 0
    mockElectronUpdaterWindow(async (command) => {
      invokedCommands.push(command)
      if (command === "desktop_check_for_updates") {
        updateChecks += 1
        if (updateChecks > 1) {
          throw new Error("unexpected second update check")
        }
        return {
          available: true,
          version: "1.1.2",
          currentVersion: "1.1.1",
        }
      }
      if (command === "desktop_download_and_install_update") {
        return null
      }
      return null
    })

    try {
      await useUpdateStore.getState().checkForUpdates()
      await useUpdateStore.getState().downloadUpdate()

      expect(invokedCommands).toEqual(["desktop_check_for_updates", "desktop_download_and_install_update"])
      expect(useUpdateStore.getState()).toMatchObject({
        available: true,
        downloading: false,
        downloaded: true,
        error: null,
      })
    } finally {
      restoreWindow()
    }
  })

  test("does not let a concurrent update check strand an active desktop download", async () => {
    const download = createDeferred<unknown>()
    mockElectronUpdaterWindow(async (command) => {
      invokedCommands.push(command)
      if (command === "desktop_check_for_updates") {
        return {
          available: true,
          version: "1.1.2",
          currentVersion: "1.1.1",
        }
      }
      if (command === "desktop_download_and_install_update") {
        return download.promise
      }
      return null
    })

    try {
      await useUpdateStore.getState().checkForUpdates()
      const downloadUpdate = useUpdateStore.getState().downloadUpdate()
      await waitForCommand("desktop_download_and_install_update")

      await useUpdateStore.getState().checkForUpdates()
      download.resolve(null)
      await downloadUpdate

      expect(invokedCommands).toEqual([
        "desktop_check_for_updates",
        "desktop_download_and_install_update",
        "desktop_check_for_updates",
      ])
      expect(useUpdateStore.getState()).toMatchObject({
        available: true,
        downloading: false,
        downloaded: true,
        error: null,
      })
    } finally {
      restoreWindow()
    }
  })
})
