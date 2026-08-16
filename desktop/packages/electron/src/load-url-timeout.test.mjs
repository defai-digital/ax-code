import { createRequire } from "node:module"
import { describe, expect, test, vi } from "vitest"

const require = createRequire(import.meta.url)
const { loadUrlWithTimeout, DEFAULT_LOAD_URL_TIMEOUT_MS } = require("./load-url-timeout.js")

describe("loadUrlWithTimeout", () => {
  test("resolves once the window finishes loading", async () => {
    const timer = { unref: vi.fn() }
    const setTimer = vi.fn(() => timer)
    const clearTimer = vi.fn()
    const window = { loadURL: vi.fn(async () => {}) }

    await loadUrlWithTimeout(window, "http://localhost:3000", { setTimer, clearTimer })

    expect(window.loadURL).toHaveBeenCalledWith("http://localhost:3000")
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), DEFAULT_LOAD_URL_TIMEOUT_MS)
    expect(clearTimer).toHaveBeenCalledWith(timer)
  })

  test("rejects with the load error and clears the timer", async () => {
    const timer = { unref: vi.fn() }
    const clearTimer = vi.fn()
    const failure = new Error("ERR_CONNECTION_REFUSED")
    const window = { loadURL: vi.fn(async () => Promise.reject(failure)) }

    await expect(
      loadUrlWithTimeout(window, "http://localhost:3000", { setTimer: () => timer, clearTimer }),
    ).rejects.toBe(failure)
    expect(clearTimer).toHaveBeenCalledWith(timer)
  })

  test("rejects on timeout when the load never settles", async () => {
    let onTimeout
    const setTimer = vi.fn((callback) => {
      onTimeout = callback
      return { unref: vi.fn() }
    })
    const window = { loadURL: vi.fn(() => new Promise(() => {})) }

    const loading = loadUrlWithTimeout(window, "http://localhost:3000", { setTimer, timeoutMs: 30_000 })
    const assertion = expect(loading).rejects.toThrow("window failed to load within 30000ms: http://localhost:3000")
    onTimeout()
    await assertion
  })

  test("ignores a late load settlement after the timeout fired", async () => {
    let onTimeout
    const setTimer = vi.fn((callback) => {
      onTimeout = callback
      return { unref: vi.fn() }
    })
    let resolveLoad
    const window = {
      loadURL: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve
          }),
      ),
    }

    const loading = loadUrlWithTimeout(window, "http://localhost:3000", { setTimer })
    const assertion = expect(loading).rejects.toThrow("window failed to load within")
    onTimeout()
    resolveLoad()
    await assertion
  })
})
