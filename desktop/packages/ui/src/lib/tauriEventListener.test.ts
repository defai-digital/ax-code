import { describe, expect, test, vi } from "vitest"

import { listenToTauriEvent } from "./tauriEventListener"

describe("listenToTauriEvent", () => {
  test("disposes the listener when cleanup runs after listen resolves", async () => {
    const unlisten = vi.fn()
    const listen = vi.fn(async () => unlisten)

    const cleanup = listenToTauriEvent(listen, "openchamber:test", () => {})
    await Promise.resolve()

    cleanup()

    expect(listen).toHaveBeenCalledTimes(1)
    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  test("disposes the listener when cleanup runs before listen resolves", async () => {
    const unlisten = vi.fn()
    let resolveListen: (value: () => void) => void = () => {
      throw new Error("listen promise resolver was not initialized")
    }
    const listen = vi.fn(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve
        }),
    )

    const cleanup = listenToTauriEvent(listen, "openchamber:test", () => {})
    cleanup()
    expect(unlisten).not.toHaveBeenCalled()

    resolveListen?.(unlisten)
    await Promise.resolve()

    expect(unlisten).toHaveBeenCalledTimes(1)
  })

  test("ignores listener registration failures", () => {
    const listen = vi.fn(() => {
      throw new Error("bridge unavailable")
    })

    const cleanup = listenToTauriEvent(listen, "openchamber:test", () => {})

    expect(() => cleanup()).not.toThrow()
  })
})
