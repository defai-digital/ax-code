import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

describe("updateDesktopSettings", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.useRealTimers()
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
})
