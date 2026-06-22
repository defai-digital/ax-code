// @vitest-environment node
// Installs a window whose storage getters throw; relies on there being no
// ambient jsdom window/localStorage.
import { describe, expect, test, vi } from "vitest"

const importSafeStorage = async () => {
  // Force a fresh module instance so safeStorage re-reads the stubbed window.
  vi.resetModules()
  return (await import("./safeStorage")) as typeof import("./safeStorage")
}

describe("safeStorage", () => {
  test("falls back to memory when storage getters throw", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
    const throwingWindow = {}

    Object.defineProperties(throwingWindow, {
      localStorage: {
        get() {
          throw new Error("localStorage blocked")
        },
      },
      sessionStorage: {
        get() {
          throw new Error("sessionStorage blocked")
        },
      },
    })

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: throwingWindow,
    })

    try {
      const { getSafeSessionStorage, getSafeStorage } = await importSafeStorage()
      const storage = getSafeStorage()
      const sessionStorage = getSafeSessionStorage()

      storage.setItem("local-key", "local-value")
      sessionStorage.setItem("session-key", "session-value")

      expect(storage.getItem("local-key")).toBe("local-value")
      expect(sessionStorage.getItem("session-key")).toBe("session-value")
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow)
      } else {
        delete (globalThis as { window?: unknown }).window
      }
    }
  })
})
