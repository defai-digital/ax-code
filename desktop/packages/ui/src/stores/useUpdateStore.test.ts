import { beforeEach, describe, expect, test } from "vitest"
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
    invokedCommands = []
    mockElectronUpdaterWindow()
    useUpdateStore.getState().reset()
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
})
