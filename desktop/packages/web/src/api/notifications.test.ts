import { afterEach, describe, expect, it, vi } from "vitest"

import { createWebNotificationsAPI } from "./notifications"

const originalWindow = globalThis.window
const originalNotification = globalThis.Notification

const setWindowWithInvoke = (invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) => {
  globalThis.window = {
    __TAURI__: {
      core: {
        invoke,
      },
    },
  } as unknown as Window & typeof globalThis
}

afterEach(() => {
  globalThis.window = originalWindow
  globalThis.Notification = originalNotification
  vi.restoreAllMocks()
})

describe("createWebNotificationsAPI", () => {
  it("honors successful desktop notification results", async () => {
    const invoke = vi.fn(async () => ({ success: true }))
    setWindowWithInvoke(invoke)

    await expect(createWebNotificationsAPI().notifyAgentCompletion({ title: "Done" })).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith("desktop_notify", {
      payload: {
        title: "Done",
        body: undefined,
        tag: undefined,
      },
    })
  })

  it("falls back to the web notification API when desktop reports failure", async () => {
    const invoke = vi.fn(async () => ({ success: false, reason: "unsupported" }))
    setWindowWithInvoke(invoke)

    const notification = vi.fn()
    Object.defineProperty(notification, "permission", { value: "granted" })
    globalThis.Notification = notification as unknown as typeof Notification

    await expect(createWebNotificationsAPI().notifyAgentCompletion({ title: "Done" })).resolves.toBe(true)
    expect(notification).toHaveBeenCalledWith("Done", {
      body: undefined,
      tag: undefined,
    })
  })

  it("treats legacy null desktop results as successful", async () => {
    const invoke = vi.fn(async () => null)
    setWindowWithInvoke(invoke)

    await expect(createWebNotificationsAPI().notifyAgentCompletion({ title: "Done" })).resolves.toBe(true)
  })
})
