import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

describe("updateDesktopSettings", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.doUnmock("@/contexts/runtimeAPIRegistry")
  })

  test("resolves returned promises after the debounced settings save finishes", async () => {
    const saveControl: { resolve?: (value: null) => void } = {}
    const save = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          saveControl.resolve = resolve
        }),
    )

    vi.doMock("@/contexts/runtimeAPIRegistry", () => ({
      getRegisteredRuntimeAPIs: () => ({
        settings: {
          load: vi.fn(),
          save,
        },
      }),
    }))

    const { updateDesktopSettings } = await import("./persistence")

    let firstResolved = false
    let secondResolved = false
    const first = updateDesktopSettings({ themeId: "dark" }).then(() => {
      firstResolved = true
    })

    await vi.advanceTimersByTimeAsync(199)
    expect(save).not.toHaveBeenCalled()
    expect(firstResolved).toBe(false)

    const second = updateDesktopSettings({ fontSize: 115 }).then(() => {
      secondResolved = true
    })

    await vi.advanceTimersByTimeAsync(199)
    expect(save).not.toHaveBeenCalled()
    expect(firstResolved).toBe(false)
    expect(secondResolved).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ themeId: "dark", fontSize: 115 })
    expect(firstResolved).toBe(false)
    expect(secondResolved).toBe(false)

    const completeSave = saveControl.resolve
    if (!completeSave) {
      throw new Error("settings save was not started")
    }
    completeSave(null)
    await Promise.all([first, second])

    expect(firstResolved).toBe(true)
    expect(secondResolved).toBe(true)
  })

  test("rejects when the server settings fallback is unavailable", async () => {
    vi.doMock("@/contexts/runtimeAPIRegistry", () => ({
      getRegisteredRuntimeAPIs: () => null,
    }))

    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to parse URL from /api/config/settings"))
    vi.stubGlobal("fetch", fetch)

    const { updateDesktopSettings } = await import("./persistence")
    const update = updateDesktopSettings({ themeId: "dark" })
    const rejection = expect(update).rejects.toThrow("Failed to parse URL from /api/config/settings")

    await vi.advanceTimersByTimeAsync(200)
    await rejection
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("flushes a pending save when the page is closing", async () => {
    const save = vi.fn().mockResolvedValue(null)
    vi.doMock("@/contexts/runtimeAPIRegistry", () => ({
      getRegisteredRuntimeAPIs: () => ({
        settings: {
          load: vi.fn(),
          save,
        },
      }),
    }))

    const { updateDesktopSettings } = await import("./persistence")
    const update = updateDesktopSettings({ themeId: "dark" })

    window.dispatchEvent(new Event("pagehide"))

    expect(save).toHaveBeenCalledWith({ themeId: "dark" })
    await expect(update).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    expect(save).toHaveBeenCalledTimes(1)
  })
})
